from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .workspace import (
    WorkspaceError,
    _candidate_paths,
    _paper_source_paths,
    _read_json,
    _stable_id,
    _validate_paper_association,
    _validate_source_file_association,
    find_record_path,
    sha256_file,
    validate_durable_record_payload,
    write_record,
)

DUPLICATE_SCHEMA_VERSION = "m4c.v1"
MAX_DUPLICATE_ANALYSIS_PAPERS = 2000
MAX_DUPLICATE_GROUPS = 500
MAX_DUPLICATE_WARNINGS = 100
MAX_PAPER_TITLE_LENGTH = 240
MAX_AUTHOR_COUNT = 5
REVIEW_COLLECTION = "duplicate-reviews"
_SUPPORTED_IDENTIFIER_TYPES = {"doi", "pmid", "arxiv_id"}
_DOI_URL_PREFIX = re.compile(r"^(?:https?://)?(?:dx\.)?doi\.org/", re.IGNORECASE)
_DOI_LABEL_PREFIX = re.compile(r"^doi:", re.IGNORECASE)
_PMID_PREFIX = re.compile(r"^pmid:", re.IGNORECASE)
_ARXIV_PREFIX = re.compile(r"^(?:arxiv:|https?://arxiv\.org/(?:abs|pdf)/)", re.IGNORECASE)
_DOI_PATTERN = re.compile(r"^10\.\d{4,9}/\S+$", re.IGNORECASE)
_PMID_PATTERN = re.compile(r"^[0-9]+$")
_ARXIV_PATTERN = re.compile(r"^(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+/\d{7})$", re.IGNORECASE)


class DuplicateAnalysisLimitError(WorkspaceError):
    pass


class DuplicateGroupNotFoundError(WorkspaceError):
    pass


@dataclass(frozen=True)
class _PaperInfo:
    paper_id: str
    project_id: str
    project_name: str
    title: str
    authors: tuple[str, ...]
    year: int | None
    publication_venue: str | None
    normalized_title: str
    normalized_first_author: str | None


@dataclass(frozen=True)
class _SourceInfo:
    sha256: str
    original_filename: str


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"\s*([,;:!?])\s*", r"\1 ", normalized)
    normalized = re.sub(r"\s+\.", ".", normalized)
    return normalized.rstrip(" .!?;:").strip()


def normalize_title(value: str) -> str:
    """Normalize only Unicode width, case, whitespace and punctuation spacing."""
    return _normalize_text(value)


def normalize_author_surname(value: str) -> str | None:
    """Extract the supplied author's surname without inferring or reordering names."""
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = unicodedata.normalize("NFKC", value).strip()
    surname = normalized.split(",", 1)[0] if "," in normalized else normalized.rsplit(None, 1)[-1]
    result = _normalize_text(surname)
    return result or None


def _identifier_type(value: str) -> str:
    return re.sub(r"[-\s]+", "_", unicodedata.normalize("NFKC", value).strip().casefold())


def normalize_identifier(identifier_type: str, value: str) -> str | None:
    """Return a conservative normalized DOI, PMID or arXiv identifier."""
    if not isinstance(identifier_type, str) or not isinstance(value, str):
        return None
    kind = _identifier_type(identifier_type)
    if kind == "arxiv":
        kind = "arxiv_id"
    if kind not in _SUPPORTED_IDENTIFIER_TYPES:
        return None
    normalized = unicodedata.normalize("NFKC", value).strip()
    if any(character.isspace() or ord(character) < 32 for character in normalized):
        return None
    if kind == "doi":
        normalized = _DOI_URL_PREFIX.sub("", normalized)
        normalized = _DOI_LABEL_PREFIX.sub("", normalized)
        normalized = normalized.casefold()
        return normalized if _DOI_PATTERN.fullmatch(normalized) else None
    if kind == "pmid":
        normalized = _PMID_PREFIX.sub("", normalized)
        return normalized if _PMID_PATTERN.fullmatch(normalized) else None
    normalized = _ARXIV_PREFIX.sub("", normalized).casefold()
    return normalized if _ARXIV_PATTERN.fullmatch(normalized) else None


def _warning(warnings: list[str], message: str) -> None:
    if message not in warnings and len(warnings) < MAX_DUPLICATE_WARNINGS:
        warnings.append(message)


def _project_names(root: Path, warnings: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for path in _candidate_paths(root, "projects"):
        try:
            if path.is_symlink():
                raise WorkspaceError("project record must not be a symlink")
            payload = _read_json(path)
            validate_durable_record_payload("projects", payload)
            project_id = str(payload["project_id"])
            if path.parent.name != project_id:
                raise WorkspaceError("project path does not match its ID")
            result[project_id] = str(payload["name"])[:MAX_PAPER_TITLE_LENGTH]
        except WorkspaceError:
            _warning(warnings, "A malformed project record was skipped during duplicate analysis.")
    return result


def _paper_records(
    root: Path, project_names: dict[str, str], warnings: list[str]
) -> list[_PaperInfo]:
    records: list[_PaperInfo] = []
    for path in _candidate_paths(root, "papers"):
        try:
            if path.is_symlink():
                raise WorkspaceError("paper path is not canonical")
            payload = _read_json(path)
            validate_durable_record_payload("papers", payload)
            paper_id = str(payload["paper_id"])
            if path.parent.name != paper_id:
                raise WorkspaceError("paper path does not match its ID")
            project_id = _validate_paper_association(root, payload)
            if project_id not in project_names:
                raise WorkspaceError("paper project is unavailable")
            authors = tuple(str(author)[:240] for author in payload["authors"][:MAX_AUTHOR_COUNT])
            records.append(
                _PaperInfo(
                    paper_id=paper_id,
                    project_id=project_id,
                    project_name=project_names[project_id],
                    title=str(payload["title"])[:MAX_PAPER_TITLE_LENGTH],
                    authors=authors,
                    year=payload.get("year"),
                    publication_venue=(
                        str(payload["publication_venue"])[:240]
                        if payload.get("publication_venue") is not None
                        else None
                    ),
                    normalized_title=normalize_title(str(payload["title"])),
                    normalized_first_author=normalize_author_surname(str(payload["authors"][0])),
                )
            )
        except (WorkspaceError, IndexError, TypeError):
            _warning(warnings, "A malformed paper record was skipped during duplicate analysis.")
    records.sort(key=lambda paper: paper.paper_id)
    if len(records) > MAX_DUPLICATE_ANALYSIS_PAPERS:
        raise DuplicateAnalysisLimitError(
            f"Duplicate analysis is limited to {MAX_DUPLICATE_ANALYSIS_PAPERS} valid paper records."
        )
    return records


def _paper_sources(
    root: Path, papers: list[_PaperInfo], warnings: list[str]
) -> dict[str, _SourceInfo]:
    result: dict[str, _SourceInfo] = {}
    for paper in papers:
        try:
            pdf_path, source_path = _paper_source_paths(root, paper.paper_id)
            if not pdf_path.exists() and not source_path.exists():
                continue
            if pdf_path.is_symlink() or source_path.is_symlink():
                raise WorkspaceError("source files must not be symlinks")
            if not pdf_path.is_file() or not source_path.is_file():
                raise WorkspaceError("source files are incomplete")
            source = _read_json(source_path)
            validate_durable_record_payload("source-files", source)
            _validate_source_file_association(root, source, parent_id=paper.paper_id)
            if (
                source["sha256"] != sha256_file(pdf_path)
                or source["size_bytes"] != pdf_path.stat().st_size
            ):
                raise WorkspaceError("source checksum or size does not match")
            result[paper.paper_id] = _SourceInfo(
                sha256=str(source["sha256"]).casefold(),
                original_filename=str(source["original_filename"])[:255],
            )
        except (WorkspaceError, OSError):
            _warning(
                warnings,
                f"Paper {paper.paper_id} has unverifiable source data; "
                "exact PDF evidence was excluded.",
            )
    return result


def _identifier_values(payload: dict[str, Any]) -> list[tuple[str, str]]:
    values: list[tuple[str, str]] = []
    if payload.get("doi"):
        normalized = normalize_identifier("doi", str(payload["doi"]))
        if normalized:
            values.append(("doi", normalized))
    for raw_type, raw_value in (payload.get("external_identifiers") or {}).items():
        normalized = normalize_identifier(str(raw_type), str(raw_value))
        if normalized:
            kind = (
                "arxiv_id"
                if _identifier_type(str(raw_type)) == "arxiv"
                else _identifier_type(str(raw_type))
            )
            values.append((kind, normalized))
    return sorted(set(values))


def _paper_payloads(root: Path, papers: list[_PaperInfo]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for paper in papers:
        path = find_record_path(root, "papers", paper.paper_id)
        if path is not None:
            result[paper.paper_id] = _read_json(path)
    return result


def _paper_view(paper: _PaperInfo) -> dict[str, Any]:
    return {
        "paper_id": paper.paper_id,
        "project_id": paper.project_id,
        "project_name": paper.project_name,
        "title": paper.title,
        "authors": list(paper.authors),
        "year": paper.year,
        "publication_venue": paper.publication_venue,
    }


def _fingerprints(evidence_type: str, evidence_value: Any, paper_ids: list[str]) -> tuple[str, str]:
    evidence_bytes = json.dumps(
        {"evidence_type": evidence_type, "evidence_value": evidence_value},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    group_bytes = json.dumps(
        {
            "evidence_type": evidence_type,
            "evidence_value": evidence_value,
            "paper_ids": sorted(paper_ids),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(group_bytes).hexdigest(), hashlib.sha256(evidence_bytes).hexdigest()


def _load_reviews(root: Path, workspace_id: str, warnings: list[str]) -> dict[str, dict[str, Any]]:
    reviews: dict[str, dict[str, Any]] = {}
    for path in root.glob("feedback/duplicate-reviews/*.json"):
        try:
            if path.is_symlink():
                raise WorkspaceError("review record must not be a symlink")
            review = _read_json(path)
            validate_durable_record_payload(REVIEW_COLLECTION, review)
            if review["workspace_id"] != workspace_id:
                raise WorkspaceError("review belongs to another workspace")
            review["_revision"] = sha256_file(path)
            reviews[review["group_fingerprint"]] = review
        except WorkspaceError:
            _warning(warnings, "A malformed duplicate review record was skipped.")
    return reviews


def _group(
    evidence_type: str,
    evidence_value: Any,
    papers: list[_PaperInfo],
    evidence_fingerprint: str,
    source_values: dict[str, _SourceInfo],
    review: dict[str, Any] | None,
) -> dict[str, Any]:
    paper_ids = sorted(paper.paper_id for paper in papers)
    group_fingerprint, _ = _fingerprints(evidence_type, evidence_value, paper_ids)
    if evidence_type == "exact_source":
        details = {
            "label": "Exact PDF duplicate",
            "explanation": "These paper records contain identical imported PDF bytes.",
            "source_sha256_preview": f"{str(evidence_value)[:12]}…",
            "source_filenames": sorted(
                {source_values[p.paper_id].original_filename for p in papers}
            ),
        }
    elif evidence_type == "exact_identifier":
        identifier_type, identifier_value = evidence_value
        details = {
            "label": "Matching identifier",
            "explanation": (
                "These paper records contain the same conservatively normalized local identifier."
            ),
            "identifier_type": identifier_type,
            "normalized_identifier": identifier_value,
        }
    else:
        title, year, author = evidence_value
        fields = ["normalized title"]
        if year is not None:
            fields.append("publication year")
        if author is not None:
            fields.append("first-author surname")
        details = {
            "label": "Possible metadata duplicate",
            "explanation": "The normalized title and available supporting metadata match.",
            "matched_fields": fields,
            "normalized_title_preview": title[:160],
        }
    return {
        "group_fingerprint": group_fingerprint,
        "evidence_fingerprint": evidence_fingerprint,
        "evidence_type": evidence_type,
        "review_status": review["review_status"] if review else "unreviewed",
        "reviewed_at": review.get("reviewed_at") if review else None,
        "review_revision": review.get("_revision") if review else None,
        "details": details,
        "papers": [_paper_view(paper) for paper in sorted(papers, key=lambda item: item.paper_id)],
    }


def build_duplicate_report(
    root: Path, *, project_id: str | None = None, paper_id: str | None = None
) -> dict[str, Any]:
    metadata_path = root / "workspace.json"
    metadata = _read_json(metadata_path)
    workspace_id = str(metadata["workspace_id"])
    warnings: list[str] = []
    project_names = _project_names(root, warnings)
    papers = _paper_records(root, project_names, warnings)
    if project_id is not None:
        _stable_id(project_id, "project ID")
        if project_id not in project_names:
            raise WorkspaceError("Project was not found in this workspace.")
    payloads = _paper_payloads(root, papers)
    sources = _paper_sources(root, papers, warnings)
    reviews = _load_reviews(root, workspace_id, warnings)
    groups: list[dict[str, Any]] = []

    source_groups: dict[str, list[_PaperInfo]] = defaultdict(list)
    for paper in papers:
        source = sources.get(paper.paper_id)
        if source:
            source_groups[source.sha256].append(paper)
    for value, members in sorted(source_groups.items()):
        if len(members) >= 2:
            group_fingerprint, evidence_fingerprint = _fingerprints(
                "exact_source", value, [paper.paper_id for paper in members]
            )
            review = reviews.get(group_fingerprint)
            groups.append(
                _group("exact_source", value, members, evidence_fingerprint, sources, review)
            )

    identifier_groups: dict[tuple[str, str], list[_PaperInfo]] = defaultdict(list)
    for paper in papers:
        for identifier in _identifier_values(payloads.get(paper.paper_id, {})):
            identifier_groups[identifier].append(paper)
    for value, members in sorted(identifier_groups.items()):
        if len(members) >= 2:
            group_fingerprint, evidence_fingerprint = _fingerprints(
                "exact_identifier", value, [paper.paper_id for paper in members]
            )
            review = reviews.get(group_fingerprint)
            groups.append(
                _group("exact_identifier", value, members, evidence_fingerprint, sources, review)
            )

    metadata_groups: dict[tuple[str, int | None, str | None], list[_PaperInfo]] = defaultdict(list)
    for paper in papers:
        if paper.normalized_title:
            metadata_groups[
                (paper.normalized_title, paper.year, paper.normalized_first_author)
            ].append(paper)
    for value, members in sorted(
        metadata_groups.items(),
        key=lambda item: (
            item[0][0],
            -1 if item[0][1] is None else item[0][1],
            "" if item[0][2] is None else item[0][2],
        ),
    ):
        if len(members) >= 2:
            group_fingerprint, evidence_fingerprint = _fingerprints(
                "metadata_candidate", value, [paper.paper_id for paper in members]
            )
            review = reviews.get(group_fingerprint)
            groups.append(
                _group("metadata_candidate", value, members, evidence_fingerprint, sources, review)
            )

    groups.sort(key=lambda group: (group["evidence_type"], group["group_fingerprint"]))
    if len(groups) > MAX_DUPLICATE_GROUPS:
        _warning(warnings, f"Only the first {MAX_DUPLICATE_GROUPS} duplicate groups are returned.")
        groups = groups[:MAX_DUPLICATE_GROUPS]
    if project_id is not None:
        groups = [
            group
            for group in groups
            if any(paper["project_id"] == project_id for paper in group["papers"])
        ]
    if paper_id is not None:
        _stable_id(paper_id, "paper ID")
        groups = [
            group
            for group in groups
            if any(paper["paper_id"] == paper_id for paper in group["papers"])
        ]
    affected = {paper["paper_id"] for group in groups for paper in group["papers"]}
    summary = {
        "group_count": len(groups),
        "papers_with_evidence": len(affected),
        "exact_source_groups": sum(group["evidence_type"] == "exact_source" for group in groups),
        "exact_identifier_groups": sum(
            group["evidence_type"] == "exact_identifier" for group in groups
        ),
        "metadata_candidate_groups": sum(
            group["evidence_type"] == "metadata_candidate" for group in groups
        ),
    }
    return {
        "report_schema_version": DUPLICATE_SCHEMA_VERSION,
        "workspace_id": workspace_id,
        "groups": groups,
        "warnings": warnings,
        "summary": summary,
    }


def read_duplicate_group(root: Path, group_fingerprint: str) -> dict[str, Any]:
    _validate_fingerprint(group_fingerprint)
    report = build_duplicate_report(root)
    for group in report["groups"]:
        if group["group_fingerprint"] == group_fingerprint:
            return group
    raise DuplicateGroupNotFoundError(
        "Duplicate evidence group was not found or is no longer current."
    )


def _validate_fingerprint(value: str) -> None:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Fa-f0-9]{64}", value):
        raise WorkspaceError("Duplicate group fingerprint is invalid.")


def write_duplicate_review(
    root: Path, group_fingerprint: str, review_status: str, expected_revision: str | None
) -> tuple[dict[str, Any], dict[str, Any], str]:
    if review_status not in {"reviewed_duplicate", "reviewed_not_duplicate", "ignored"}:
        raise WorkspaceError("Duplicate review status is invalid.")
    group = read_duplicate_group(root, group_fingerprint)
    if review_status == "reviewed_not_duplicate" and group["evidence_type"] == "exact_source":
        raise WorkspaceError("Exact PDF evidence cannot be marked as not a duplicate.")
    metadata = _read_json(root / "workspace.json")
    now = datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
    review_id = f"duplicate_review_{group_fingerprint}"
    payload = {
        "schema_version": DUPLICATE_SCHEMA_VERSION,
        "duplicate_review_id": review_id,
        "workspace_id": metadata["workspace_id"],
        "group_fingerprint": group_fingerprint,
        "paper_ids": sorted(paper["paper_id"] for paper in group["papers"]),
        "evidence_type": group["evidence_type"],
        "evidence_fingerprint": group["evidence_fingerprint"],
        "review_status": review_status,
        "reviewed_at": now,
        "updated_at": now,
    }
    record, revision, _relative_path, _previous_revision = write_record(
        root,
        REVIEW_COLLECTION,
        review_id,
        payload,
        expected_revision=expected_revision,
    )
    updated_group = read_duplicate_group(root, group_fingerprint)
    return updated_group, record, revision
