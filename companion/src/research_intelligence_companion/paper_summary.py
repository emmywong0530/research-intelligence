from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .fingerprints import domain_fingerprint
from .workspace import (
    PaperNotFoundError,
    WorkspaceBusyError,
    WorkspaceError,
    read_paper_extraction_content,
    read_record,
)

SUMMARY_OPERATION_ID = "paper_summary"
SUMMARY_PROMPT_ID = "paper.summary"
SUMMARY_OUTPUT_CONTRACT = "paper-summary.v1"
SUMMARY_SOURCE_TYPE = "paper_extraction"
SUMMARY_PREPARATION_VERSION = "paper-summary-source.v1"
SUMMARY_MAX_PAGES = 60
SUMMARY_MAX_CHARACTERS = 48_000
SUMMARY_MIN_CHARACTERS = 20
SUMMARY_MAX_OUTPUT_CHARACTERS = 12_000


class PaperSummarySourceError(ValueError):
    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(message)


@dataclass(frozen=True)
class PaperSummarySource:
    project_id: str
    paper_id: str
    paper_revision: str
    source_snapshot: dict[str, object]
    summary_input: str
    metadata_fields: tuple[str, ...]
    title: str


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\x00", " ")).strip()


def _metadata_allowlist(paper: dict[str, Any]) -> dict[str, object]:
    allowed: dict[str, object] = {}
    for field in (
        "title",
        "authors",
        "year",
        "publication_venue",
        "publisher",
        "publication_type",
        "publication_status",
        "abstract",
        "keywords",
    ):
        value = paper.get(field)
        if isinstance(value, str):
            cleaned = _clean(value)
            if cleaned:
                allowed[field] = cleaned
        elif isinstance(value, list):
            items = [_clean(item) for item in value if isinstance(item, str) and _clean(item)]
            if items:
                allowed[field] = items
        elif isinstance(value, int) and not isinstance(value, bool):
            allowed[field] = value
    identifiers = paper.get("identifiers")
    if isinstance(identifiers, dict):
        safe_identifiers = {
            key: _clean(value)
            for key, value in identifiers.items()
            if key in {"doi", "pmid", "pmcid", "arxiv_id", "isbn", "issn", "other"}
            and isinstance(value, str)
            and _clean(value)
        }
        if safe_identifiers:
            allowed["identifiers"] = safe_identifiers
    return allowed


def _page_text(payload: dict[str, Any]) -> tuple[str, int, bool]:
    pages = payload.get("pages")
    if not isinstance(pages, list):
        raise PaperSummarySourceError("source_invalid", "The extracted page list is invalid.")
    sections: list[str] = []
    included_pages = 0
    used = 0
    truncated = False
    for page in pages[:SUMMARY_MAX_PAGES]:
        if not isinstance(page, dict):
            raise PaperSummarySourceError("source_invalid", "The extracted page data is invalid.")
        page_number = page.get("page_number")
        text = page.get("text")
        if not isinstance(page_number, int) or not isinstance(text, str):
            raise PaperSummarySourceError("source_invalid", "The extracted page data is invalid.")
        cleaned = _clean(text)
        if not cleaned:
            continue
        section = f"[Page {page_number}]\n{cleaned}"
        separator = "\n\n" if sections else ""
        remaining = SUMMARY_MAX_CHARACTERS - used - len(separator)
        if remaining <= 0:
            truncated = True
            break
        if len(section) > remaining:
            section = section[:remaining].rsplit(" ", 1)[0].rstrip()
            truncated = True
        if section:
            sections.append(f"{separator}{section}")
            used += len(section)
            included_pages += 1
        if truncated:
            break
    if len(pages) > SUMMARY_MAX_PAGES:
        truncated = True
    text = "".join(sections)
    if len(text) < SUMMARY_MIN_CHARACTERS:
        raise PaperSummarySourceError(
            "source_insufficient",
            "The current local extraction does not contain enough text for a paper summary.",
            status_code=409,
        )
    return text, included_pages, truncated


def prepare_paper_summary_source(root, project_id: str, paper_id: str) -> PaperSummarySource:
    try:
        paper, paper_revision, _ = read_record(root, "papers", paper_id)
    except WorkspaceBusyError:
        raise
    except WorkspaceError as exc:
        if isinstance(exc, PaperNotFoundError):
            raise PaperSummarySourceError("paper_missing", str(exc), status_code=404) from exc
        raise PaperSummarySourceError("paper_unavailable", str(exc), status_code=409) from exc
    assigned = paper.get("assigned_project_ids")
    if assigned != [project_id]:
        raise PaperSummarySourceError(
            "project_mismatch",
            "The paper does not belong to the requested project.",
            status_code=403,
        )
    try:
        extraction_status, extraction, source = read_paper_extraction_content(
            root, project_id, paper_id
        )
    except WorkspaceBusyError:
        raise
    except WorkspaceError as exc:
        raise PaperSummarySourceError("source_unavailable", str(exc), status_code=409) from exc
    try:
        _paper_after, paper_revision_after, _ = read_record(root, "papers", paper_id)
    except WorkspaceBusyError:
        raise
    except WorkspaceError as exc:
        raise PaperSummarySourceError("source_unavailable", str(exc), status_code=409) from exc
    if paper_revision_after != paper_revision:
        raise WorkspaceBusyError(
            "The paper metadata changed while the summary source was being prepared; "
            "retry the operation."
        )
    if extraction_status != "completed" or extraction is None:
        raise PaperSummarySourceError(
            "extraction_required",
            "Run local text extraction successfully before requesting a summary.",
            status_code=409,
        )
    page_text, included_pages, truncated = _page_text(extraction)
    metadata = _metadata_allowlist(paper)
    metadata_fields = tuple(sorted(metadata))
    metadata_lines = ["Paper metadata (bounded allowlist):"]
    for key in metadata_fields:
        metadata_lines.append(f"{key}: {metadata[key]}")
    summary_input = "\n".join(metadata_lines) + "\n\nExtracted paper text:\n" + page_text
    prepared_fingerprint = domain_fingerprint(
        "ri-paper-summary-prepared-text:v1", {"text": summary_input}
    )
    metadata_fingerprint = domain_fingerprint("ri-paper-summary-metadata:v1", metadata)
    source_snapshot: dict[str, object] = {
        "source_type": SUMMARY_SOURCE_TYPE,
        "project_id": project_id,
        "paper_id": paper_id,
        "source_id": source["source_id"],
        "source_sha256": source["sha256"],
        "extraction_id": extraction["extraction_id"],
        "extraction_full_text_sha256": extraction["full_text_sha256"],
        "extraction_status": "completed",
        "preparation_version": SUMMARY_PREPARATION_VERSION,
        "page_count": extraction["page_count"],
        "included_page_count": included_pages,
        "included_characters": len(summary_input),
        "truncated": truncated,
        "metadata_fingerprint": metadata_fingerprint,
        "prepared_text_fingerprint": prepared_fingerprint,
    }
    return PaperSummarySource(
        project_id=project_id,
        paper_id=paper_id,
        paper_revision=paper_revision,
        source_snapshot=source_snapshot,
        summary_input=summary_input,
        metadata_fields=metadata_fields,
        title=str(metadata.get("title", "Paper")),
    )


def validate_summary_output(output: dict[str, object] | None) -> dict[str, object]:
    if not isinstance(output, dict):
        raise PaperSummarySourceError(
            "invalid_output", "The provider returned no structured paper summary."
        )
    contract_id = output.get("contract_id")
    summary = output.get("summary")
    key_points = output.get("key_points")
    limitations = output.get("limitations")
    open_questions = output.get("open_questions")
    if contract_id != SUMMARY_OUTPUT_CONTRACT or not isinstance(summary, str):
        raise PaperSummarySourceError(
            "invalid_output", "The provider returned an unsupported paper summary contract."
        )
    if not 1 <= len(summary) <= SUMMARY_MAX_OUTPUT_CHARACTERS:
        raise PaperSummarySourceError("invalid_output", "The paper summary length is invalid.")
    if not isinstance(key_points, list) or not 1 <= len(key_points) <= 8:
        raise PaperSummarySourceError("invalid_output", "The paper summary key points are invalid.")
    if any(not isinstance(item, str) or not 1 <= len(item) <= 500 for item in key_points):
        raise PaperSummarySourceError("invalid_output", "The paper summary key points are invalid.")
    for optional in (limitations, open_questions):
        if optional is not None and (
            not isinstance(optional, list)
            or len(optional) > 6
            or any(not isinstance(item, str) or not 1 <= len(item) <= 500 for item in optional)
        ):
            raise PaperSummarySourceError("invalid_output", "The paper summary lists are invalid.")
    return {
        "contract_id": SUMMARY_OUTPUT_CONTRACT,
        "summary": summary,
        "key_points": key_points,
        "limitations": limitations or [],
        "open_questions": open_questions or [],
    }
