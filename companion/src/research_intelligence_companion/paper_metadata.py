"""Bounded, local-only paper metadata normalization and migration helpers."""

from __future__ import annotations

import copy
import re
import unicodedata
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

PAPER_SCHEMA_VERSION = "m4d.v1"
LEGACY_PAPER_SCHEMA_VERSION = "m2.v1"
SUPPORTED_PAPER_SCHEMA_VERSIONS = {LEGACY_PAPER_SCHEMA_VERSION, PAPER_SCHEMA_VERSION}

MAX_TITLE_LENGTH = 500
MAX_AUTHOR_COUNT = 100
MAX_AUTHOR_LENGTH = 300
MAX_ABSTRACT_LENGTH = 100_000
MAX_SHORT_METADATA_LENGTH = 500
MAX_IDENTIFIER_LENGTH = 256
MAX_KEYWORD_COUNT = 100
MAX_KEYWORD_LENGTH = 120
MAX_URL_LENGTH = 2_000

PUBLICATION_TYPES = {
    "journal_article",
    "conference_paper",
    "book",
    "book_chapter",
    "thesis",
    "report",
    "preprint",
    "review",
    "other",
    "unknown",
}
PUBLICATION_STATUSES = {"published", "accepted", "in_press", "preprint", "unpublished", "unknown"}
PROVENANCE_SOURCES = {"manual", "imported_record", "system_derived"}

_DOI_URL_PREFIX = re.compile(r"^(?:https?://)?(?:dx\.)?doi\.org/", re.IGNORECASE)
_DOI_LABEL_PREFIX = re.compile(r"^doi:", re.IGNORECASE)
_DOI_PATTERN = re.compile(r"^10\.\d{4,9}/\S+$", re.IGNORECASE)
_PMID_PATTERN = re.compile(r"^[0-9]+$")
_PMCID_PATTERN = re.compile(r"^PMC[0-9]+$", re.IGNORECASE)
_ARXIV_PREFIX = re.compile(r"^(?:arxiv:|https?://arxiv\.org/(?:abs|pdf)/)", re.IGNORECASE)
_ARXIV_PATTERN = re.compile(r"^(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+/\d{7})$", re.IGNORECASE)
_ISSN_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{3}[0-9X]$", re.IGNORECASE)
_ORCID_PATTERN = re.compile(r"^\d{4}-\d{4}-\d{4}-[\dX]{4}$", re.IGNORECASE)


def _clean(value: Any) -> str:
    return unicodedata.normalize("NFKC", value).strip() if isinstance(value, str) else ""


def normalize_identifier(identifier_type: str, value: str) -> str | None:
    """Normalize only bounded identifier forms; never performs network lookup."""
    kind = _clean(identifier_type).casefold().replace("-", "_").replace(" ", "_")
    if kind == "arxiv":
        kind = "arxiv_id"
    normalized = _clean(value)
    if (
        not normalized
        or len(normalized) > MAX_IDENTIFIER_LENGTH
        or any(ord(ch) < 32 or ch.isspace() for ch in normalized)
    ):
        return None
    if kind == "doi":
        value = _DOI_LABEL_PREFIX.sub("", _DOI_URL_PREFIX.sub("", normalized)).casefold()
        return value if _DOI_PATTERN.fullmatch(value) else None
    if kind == "pmid":
        value = re.sub(r"^pmid:", "", normalized, flags=re.IGNORECASE)
        return value if _PMID_PATTERN.fullmatch(value) else None
    if kind == "pmcid":
        value = re.sub(r"^pmc:", "PMC", normalized, flags=re.IGNORECASE)
        return value.upper() if _PMCID_PATTERN.fullmatch(value) else None
    if kind == "arxiv_id":
        value = _ARXIV_PREFIX.sub("", normalized).casefold()
        return value if _ARXIV_PATTERN.fullmatch(value) else None
    if kind == "isbn":
        value = re.sub(r"[- ]", "", normalized).upper()
        return value if len(value) in {10, 13} and re.fullmatch(r"[0-9X]+", value) else None
    if kind == "issn":
        value = normalized.upper()
        return value if _ISSN_PATTERN.fullmatch(value) else None
    if kind == "orcid":
        value = re.sub(r"^https?://orcid\.org/", "", normalized, flags=re.IGNORECASE).upper()
        return value if _ORCID_PATTERN.fullmatch(value) else None
    if kind == "other":
        return normalized
    return None


def identifier_values(payload: dict[str, Any]) -> list[tuple[str, str]]:
    values: set[tuple[str, str]] = set()
    if payload.get("doi"):
        normalized = normalize_identifier("doi", str(payload["doi"]))
        if normalized:
            values.add(("doi", normalized))
    for container_name in ("identifiers", "external_identifiers"):
        for raw_type, raw_value in (payload.get(container_name) or {}).items():
            if not isinstance(raw_value, str):
                continue
            kind = _clean(str(raw_type)).casefold().replace("-", "_").replace(" ", "_")
            if kind == "arxiv":
                kind = "arxiv_id"
            normalized = normalize_identifier(kind, raw_value)
            if normalized:
                values.add((kind, normalized))
    return sorted(values)


def _author_details(authors: list[str]) -> list[dict[str, str]]:
    # Legacy display strings are retained as literal names. We never infer a
    # given/family split from punctuation or ordering.
    return [{"literal_name": author} for author in authors]


def migrate_paper_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    version = payload.get("schema_version")
    if version == PAPER_SCHEMA_VERSION:
        return copy.deepcopy(payload), False
    if version != LEGACY_PAPER_SCHEMA_VERSION:
        raise ValueError("Unsupported paper schema version; refusing to overwrite paper data.")
    migrated = copy.deepcopy(payload)
    migrated["schema_version"] = PAPER_SCHEMA_VERSION
    authors = [_clean(author) for author in migrated.get("authors", []) if _clean(author)]
    migrated["authors"] = authors
    migrated.setdefault("author_details", _author_details(authors))
    identifiers: dict[str, str] = {}
    if migrated.get("doi"):
        normalized = normalize_identifier("doi", str(migrated["doi"]))
        if normalized:
            migrated["doi"] = normalized
            identifiers["doi"] = normalized
    for raw_type, raw_value in (migrated.get("external_identifiers") or {}).items():
        normalized = normalize_identifier(str(raw_type), str(raw_value))
        if normalized:
            key = _clean(str(raw_type)).casefold().replace("-", "_").replace(" ", "_")
            if key == "arxiv":
                key = "arxiv_id"
            identifiers[key] = normalized
    if identifiers:
        migrated["identifiers"] = identifiers
    migrated.setdefault("metadata_provenance", {"record_origin": "imported_record"})
    return migrated, True


def normalize_paper_payload(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = copy.deepcopy(payload)
    if normalized.get("schema_version") == LEGACY_PAPER_SCHEMA_VERSION:
        return normalized
    normalized["schema_version"] = PAPER_SCHEMA_VERSION
    normalized["title"] = _clean(normalized.get("title"))
    normalized["authors"] = [_clean(author) for author in normalized.get("authors", [])]
    if not normalized.get("author_details"):
        normalized["author_details"] = _author_details(normalized["authors"])
    elif isinstance(normalized["author_details"], list):
        normalized["author_details"] = [
            {
                **detail,
                **(
                    {"orcid": normalize_identifier("orcid", str(detail["orcid"]))}
                    if isinstance(detail, dict) and detail.get("orcid")
                    else {}
                ),
            }
            if isinstance(detail, dict)
            else detail
            for detail in normalized["author_details"]
        ]
    for field in (
        "publication_venue",
        "publisher",
        "abstract",
        "url",
        "volume",
        "issue",
        "page_start",
        "page_end",
        "article_number",
        "edition",
        "language",
        "research_type",
        "methodological_subtype",
        "evidence_structure",
        "source_version_type",
    ):
        if field in normalized and isinstance(normalized[field], str):
            normalized[field] = _clean(normalized[field])
    if "doi" in normalized and normalized["doi"]:
        normalized["doi"] = normalize_identifier("doi", str(normalized["doi"])) or normalized["doi"]
    identifiers: dict[str, str] = {}
    for raw_type, raw_value in (normalized.get("identifiers") or {}).items():
        value = normalize_identifier(str(raw_type), str(raw_value))
        if value:
            key = _clean(str(raw_type)).casefold().replace("-", "_").replace(" ", "_")
            identifiers["arxiv_id" if key == "arxiv" else key] = value
    if normalized.get("doi"):
        identifiers["doi"] = str(normalized["doi"])
    if identifiers:
        normalized["identifiers"] = identifiers
    if isinstance(normalized.get("keywords"), list):
        seen: set[str] = set()
        normalized["keywords"] = [
            item
            for item in (_clean(value) for value in normalized["keywords"])
            if item and not (item.casefold() in seen or seen.add(item.casefold()))
        ]
    normalized.setdefault("metadata_provenance", {"record_origin": "manual"})
    return normalized


def validate_paper_metadata(payload: dict[str, Any]) -> None:
    version = payload.get("schema_version")
    if version not in SUPPORTED_PAPER_SCHEMA_VERSIONS:
        raise ValueError("Unsupported paper schema version.")
    if version == LEGACY_PAPER_SCHEMA_VERSION:
        return
    if (
        not isinstance(payload.get("title"), str)
        or not 0 < len(payload["title"]) <= MAX_TITLE_LENGTH
    ):
        raise ValueError("Paper title must be non-empty and within the local metadata limit.")
    authors = payload.get("authors")
    if (
        not isinstance(authors, list)
        or not 0 < len(authors) <= MAX_AUTHOR_COUNT
        or any(
            not isinstance(item, str) or not 0 < len(item) <= MAX_AUTHOR_LENGTH for item in authors
        )
    ):
        raise ValueError("Paper authors must be a bounded ordered list of non-empty names.")
    details = payload.get("author_details")
    if not isinstance(details, list) or len(details) != len(authors):
        raise ValueError("Structured author details must preserve the ordered author list.")
    for detail in details:
        if not isinstance(detail, dict) or not any(
            detail.get(key) for key in ("literal_name", "given_name", "family_name")
        ):
            raise ValueError("Each structured author needs a literal, given or family name.")
        if detail.get("orcid") and not normalize_identifier("orcid", str(detail["orcid"])):
            raise ValueError("Author ORCID is not a valid bounded identifier.")
    if isinstance(payload.get("abstract"), str) and len(payload["abstract"]) > MAX_ABSTRACT_LENGTH:
        raise ValueError("Paper abstract exceeds the local metadata limit.")
    for field in (
        "publication_venue",
        "publisher",
        "volume",
        "issue",
        "page_start",
        "page_end",
        "article_number",
        "edition",
        "language",
    ):
        if (
            field in payload
            and payload[field] is not None
            and (
                not isinstance(payload[field], str)
                or len(payload[field]) > MAX_SHORT_METADATA_LENGTH
            )
        ):
            raise ValueError(f"Paper {field} exceeds the local metadata limit.")
    keywords = payload.get("keywords", [])
    if (
        not isinstance(keywords, list)
        or len(keywords) > MAX_KEYWORD_COUNT
        or any(
            not isinstance(item, str) or not 0 < len(item) <= MAX_KEYWORD_LENGTH
            for item in keywords
        )
    ):
        raise ValueError("Paper keywords must be a bounded list of non-empty terms.")
    for container_name in ("identifiers", "external_identifiers"):
        container = payload.get(container_name, {})
        if not isinstance(container, dict) or any(
            not isinstance(value, str) or not normalize_identifier(str(key), value)
            for key, value in container.items()
        ):
            raise ValueError("Paper identifiers must use supported bounded forms.")
    if payload.get("doi") and not normalize_identifier("doi", str(payload["doi"])):
        raise ValueError("Paper DOI is not valid.")
    if payload.get("url"):
        if not isinstance(payload["url"], str) or len(payload["url"]) > MAX_URL_LENGTH:
            raise ValueError("Paper URL exceeds the local metadata limit.")
        parsed = urlparse(payload["url"])
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username
            or parsed.password
        ):
            raise ValueError("Paper URL must be an HTTP(S) URL without credentials.")
    provenance = payload.get("metadata_provenance")
    if (
        not isinstance(provenance, dict)
        or provenance.get("record_origin") not in PROVENANCE_SOURCES
    ):
        raise ValueError("Paper metadata provenance must use a bounded source value.")
    if payload.get("publication_type") and payload["publication_type"] not in PUBLICATION_TYPES:
        raise ValueError("Paper publication type is not supported in this milestone.")
    if (
        payload.get("publication_status")
        and payload["publication_status"] not in PUBLICATION_STATUSES
    ):
        raise ValueError("Paper publication status is not supported in this milestone.")


def paper_completeness(payload: dict[str, Any]) -> dict[str, Any]:
    fields = (
        "title",
        "authors",
        "year",
        "publication_venue",
        "abstract",
        "identifiers",
        "keywords",
    )
    present = [field for field in fields if payload.get(field)]
    missing = [field for field in fields if field not in present]
    percentage = round((len(present) / len(fields)) * 100)
    return {
        "present_fields": present,
        "missing_fields": missing,
        "percentage": percentage,
        "status": "complete" if not missing else "partial" if present else "minimal",
    }


def metadata_now() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
