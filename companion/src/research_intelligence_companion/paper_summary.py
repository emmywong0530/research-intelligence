from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .fingerprints import domain_fingerprint
from .processing_policy import ProcessingScopeError, resolve_paper_processing_scope
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
# The page cap remains deliberately below the prompt-registry limit. The
# combined source budget leaves room for bounded metadata and the prompt
# wrapper without changing the public preflight or processing-record shape.
SUMMARY_MAX_CHARACTERS = 48_000
SUMMARY_SOURCE_MAX_CHARACTERS = 56_000
SUMMARY_METADATA_MAX_CHARACTERS = 8_000
SUMMARY_TITLE_MAX_CHARACTERS = 500
SUMMARY_ABSTRACT_MAX_CHARACTERS = 3_000
SUMMARY_SHORT_FIELD_MAX_CHARACTERS = 300
SUMMARY_AUTHORS_MAX_ITEMS = 100
SUMMARY_AUTHORS_MAX_ITEM_CHARACTERS = 300
SUMMARY_AUTHORS_MAX_CHARACTERS = 1_200
SUMMARY_KEYWORDS_MAX_ITEMS = 100
SUMMARY_KEYWORDS_MAX_ITEM_CHARACTERS = 120
SUMMARY_KEYWORDS_MAX_CHARACTERS = 300
SUMMARY_IDENTIFIER_MAX_ITEM_CHARACTERS = 256
SUMMARY_IDENTIFIERS_MAX_CHARACTERS = 600
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


def _truncate(value: str, limit: int) -> tuple[str, bool]:
    cleaned = _clean(value)
    if len(cleaned) <= limit:
        return cleaned, False
    return cleaned[:limit].rstrip(), True


def _bounded_list(
    values: list[object], *, max_items: int, item_limit: int, combined_limit: int
) -> tuple[list[str], bool]:
    bounded: list[str] = []
    truncated = len(values) > max_items
    for raw in values[:max_items]:
        if not isinstance(raw, str):
            truncated = True
            continue
        item, item_truncated = _truncate(raw, item_limit)
        truncated = truncated or item_truncated
        if not item:
            truncated = True
            continue
        candidate = "; ".join([*bounded, item])
        if len(candidate) > combined_limit:
            truncated = True
            break
        bounded.append(item)
    return bounded, truncated


def _metadata_allowlist(paper: dict[str, Any]) -> tuple[dict[str, object], bool]:
    allowed: dict[str, object] = {}
    truncated = False
    scalar_limits = {
        "title": SUMMARY_TITLE_MAX_CHARACTERS,
        "publication_venue": SUMMARY_SHORT_FIELD_MAX_CHARACTERS,
        "publisher": SUMMARY_SHORT_FIELD_MAX_CHARACTERS,
        "publication_type": 80,
        "publication_status": 80,
        "abstract": SUMMARY_ABSTRACT_MAX_CHARACTERS,
    }
    for field in (
        "title",
        "year",
        "publication_venue",
        "publisher",
        "publication_type",
        "publication_status",
        "abstract",
    ):
        value = paper.get(field)
        if isinstance(value, str):
            cleaned, field_truncated = _truncate(value, scalar_limits[field])
            truncated = truncated or field_truncated
            if cleaned:
                allowed[field] = cleaned
        elif isinstance(value, int) and not isinstance(value, bool):
            allowed[field] = value
    for field, max_items, item_limit, combined_limit in (
        (
            "authors",
            SUMMARY_AUTHORS_MAX_ITEMS,
            SUMMARY_AUTHORS_MAX_ITEM_CHARACTERS,
            SUMMARY_AUTHORS_MAX_CHARACTERS,
        ),
        (
            "keywords",
            SUMMARY_KEYWORDS_MAX_ITEMS,
            SUMMARY_KEYWORDS_MAX_ITEM_CHARACTERS,
            SUMMARY_KEYWORDS_MAX_CHARACTERS,
        ),
    ):
        value = paper.get(field)
        if isinstance(value, list):
            items, field_truncated = _bounded_list(
                value,
                max_items=max_items,
                item_limit=item_limit,
                combined_limit=combined_limit,
            )
            truncated = truncated or field_truncated
            if items:
                allowed[field] = items
    identifiers = paper.get("identifiers")
    safe_identifiers: dict[str, str] = {}
    if isinstance(identifiers, dict):
        for key in sorted(identifiers):
            if key not in {"doi", "pmid", "pmcid", "arxiv_id", "isbn", "issn", "other"}:
                truncated = True
                continue
            value = identifiers[key]
            if not isinstance(value, str):
                truncated = True
                continue
            cleaned, item_truncated = _truncate(value, SUMMARY_IDENTIFIER_MAX_ITEM_CHARACTERS)
            truncated = truncated or item_truncated
            if not cleaned:
                truncated = True
                continue
            candidate = "; ".join(
                [*(f"{name}={item}" for name, item in safe_identifiers.items()), f"{key}={cleaned}"]
            )
            if len(candidate) > SUMMARY_IDENTIFIERS_MAX_CHARACTERS:
                truncated = True
                break
            safe_identifiers[key] = cleaned
    direct_doi = paper.get("doi")
    if not safe_identifiers.get("doi") and isinstance(direct_doi, str):
        cleaned, item_truncated = _truncate(direct_doi, SUMMARY_IDENTIFIER_MAX_ITEM_CHARACTERS)
        truncated = truncated or item_truncated
        if cleaned:
            candidate = "; ".join(
                [*(f"{name}={item}" for name, item in safe_identifiers.items()), f"doi={cleaned}"]
            )
            if len(candidate) <= SUMMARY_IDENTIFIERS_MAX_CHARACTERS:
                safe_identifiers["doi"] = cleaned
            else:
                truncated = True
    if safe_identifiers:
        allowed["identifiers"] = safe_identifiers
    return allowed, truncated


def _render_metadata(metadata: dict[str, object]) -> str:
    lines = ["Paper metadata (bounded allowlist):"]
    for key in sorted(metadata):
        value = metadata[key]
        if isinstance(value, list):
            rendered = "; ".join(str(item) for item in value)
        elif isinstance(value, dict):
            rendered = "; ".join(
                f"{name}={value[name]}" for name in sorted(value)
            )
        else:
            rendered = str(value)
        lines.append(f"{key}: {rendered}")
    rendered = "\n".join(lines)
    if len(rendered) > SUMMARY_METADATA_MAX_CHARACTERS:
        raise PaperSummarySourceError(
            "source_invalid", "The bounded paper metadata exceeds the summary source budget."
        )
    return rendered


@dataclass(frozen=True)
class _BoundedSummaryInput:
    metadata: dict[str, object]
    metadata_fields: tuple[str, ...]
    summary_input: str
    included_page_count: int
    truncated: bool


def _page_text(
    payload: dict[str, Any], *, max_characters: int = SUMMARY_MAX_CHARACTERS
) -> tuple[str, int, bool]:
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
        remaining = max_characters - used - len(separator)
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


def _build_summary_input(paper: dict[str, Any], extraction: dict[str, Any]) -> _BoundedSummaryInput:
    metadata, metadata_truncated = _metadata_allowlist(paper)
    metadata_fields = tuple(sorted(metadata))
    metadata_text = _render_metadata(metadata)
    extracted_prefix = "\n\nExtracted paper text:\n"
    page_budget = min(
        SUMMARY_MAX_CHARACTERS,
        SUMMARY_SOURCE_MAX_CHARACTERS - len(metadata_text) - len(extracted_prefix),
    )
    page_text, included_pages, page_truncated = _page_text(
        extraction, max_characters=page_budget
    )
    summary_input = metadata_text + extracted_prefix + page_text
    if len(summary_input) > SUMMARY_SOURCE_MAX_CHARACTERS:
        raise PaperSummarySourceError(
            "source_invalid", "The prepared paper summary source exceeds its character budget."
        )
    return _BoundedSummaryInput(
        metadata=metadata,
        metadata_fields=metadata_fields,
        summary_input=summary_input,
        included_page_count=included_pages,
        truncated=metadata_truncated or page_truncated,
    )


def prepare_paper_summary_source(root, project_id: str, paper_id: str) -> PaperSummarySource:
    try:
        scope = resolve_paper_processing_scope(root, project_id, paper_id)
    except WorkspaceBusyError:
        raise
    except ProcessingScopeError as exc:
        raise PaperSummarySourceError(exc.code, str(exc), status_code=exc.status_code) from exc
    except WorkspaceError as exc:
        if isinstance(exc, PaperNotFoundError):
            raise PaperSummarySourceError("paper_missing", str(exc), status_code=404) from exc
        raise PaperSummarySourceError("paper_unavailable", str(exc), status_code=409) from exc
    paper = scope.paper
    paper_revision = scope.paper_revision
    try:
        extraction_status, extraction, source = read_paper_extraction_content(
            root, project_id, paper_id
        )
    except WorkspaceBusyError:
        raise
    except WorkspaceError as exc:
        raise PaperSummarySourceError("source_unavailable", str(exc), status_code=409) from exc
    try:
        extraction_status_after, extraction_after, source_after = read_paper_extraction_content(
            root, project_id, paper_id
        )
    except WorkspaceBusyError:
        raise
    except WorkspaceError as exc:
        raise PaperSummarySourceError("source_unavailable", str(exc), status_code=409) from exc
    if (
        extraction_status_after != extraction_status
        or extraction is None
        or extraction_after is None
        or extraction_after.get("extraction_id") != extraction.get("extraction_id")
        or extraction_after.get("full_text_sha256") != extraction.get("full_text_sha256")
        or source_after.get("sha256") != source.get("sha256")
    ):
        raise WorkspaceBusyError(
            "The paper extraction changed while the summary source was being prepared; "
            "retry the operation."
        )
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
    bounded_input = _build_summary_input(paper, extraction)
    metadata = bounded_input.metadata
    metadata_fields = bounded_input.metadata_fields
    summary_input = bounded_input.summary_input
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
        "included_page_count": bounded_input.included_page_count,
        "included_characters": len(summary_input),
        "truncated": bounded_input.truncated,
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
