"""Shared policy primitives for authenticated AI-processing operations.

This module deliberately contains no scheduling or provider code.  It is the
small common boundary that future operations can reuse for ownership checks,
cache lineage decisions, and response-size protection.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .workspace import (
    WorkspaceBusyError,
    WorkspaceError,
    _validate_paper_association,
    read_record,
)

# A history endpoint fails closed instead of silently truncating durable audit
# history.  The UI may display a smaller window, but the API never returns an
# unbounded list.
MAX_PROCESSING_HISTORY_RECORDS = 200


class ProcessingScopeError(ValueError):
    """A stable, safe error raised while establishing paper scope."""

    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(message)


@dataclass(frozen=True)
class PaperProcessingScope:
    """The verified workspace/project/paper boundary for one operation."""

    project_id: str
    paper_id: str
    project_revision: str
    paper_revision: str
    paper: dict[str, Any]


def resolve_paper_processing_scope(
    root: Path, project_id: str, paper_id: str
) -> PaperProcessingScope:
    """Verify project and paper ownership before any paper processing read.

    The workspace root is already selected by the authenticated route.  This
    primitive supplies the remaining project/paper ownership proof and the
    revisions used by the source snapshot boundary.
    """

    try:
        _project, project_revision, _ = read_record(root, "projects", project_id)
    except WorkspaceBusyError:
        raise
    except WorkspaceError as exc:
        raise ProcessingScopeError(
            "project_missing",
            "The project was not found in the opened workspace.",
            status_code=404,
        ) from exc

    try:
        paper, paper_revision, _ = read_record(root, "papers", paper_id)
    except WorkspaceBusyError:
        raise
    except WorkspaceError as exc:
        raise ProcessingScopeError(
            "paper_missing",
            "The paper was not found in the opened workspace.",
            status_code=404,
        ) from exc

    try:
        assigned_project_id = _validate_paper_association(root, paper)
    except WorkspaceBusyError:
        raise
    except WorkspaceError as exc:
        raise ProcessingScopeError(
            "paper_unavailable",
            "The paper association could not be verified safely.",
            status_code=409,
        ) from exc
    if assigned_project_id != project_id:
        raise ProcessingScopeError(
            "project_mismatch",
            "The paper is not available for this project.",
            status_code=403,
        )
    return PaperProcessingScope(
        project_id=project_id,
        paper_id=paper_id,
        project_revision=project_revision,
        paper_revision=paper_revision,
        paper=paper,
    )


def lineage_root_id(
    record: dict[str, object], records_by_id: dict[str, dict[str, object]]
) -> str | None:
    """Return the root of a processing lineage, failing closed on broken chains."""

    current_id = str(record.get("processing_id", ""))
    visited: set[str] = set()
    while current_id and current_id not in visited:
        visited.add(current_id)
        current = records_by_id.get(current_id)
        if current is None:
            return None
        parent_id = current.get("original_processing_id")
        if not parent_id:
            return current_id
        current_id = str(parent_id)
    return None


def lineage_is_invalidated(
    record: dict[str, object], records_by_id: dict[str, dict[str, object]]
) -> bool:
    """Whether any member of the candidate's reusable lineage was invalidated."""

    root_id = lineage_root_id(record, records_by_id)
    if root_id is None:
        return True
    return any(
        bool(candidate.get("invalidated"))
        and lineage_root_id(candidate, records_by_id) == root_id
        for candidate in records_by_id.values()
    )


def cache_candidate_is_usable(
    record: dict[str, object],
    key: str,
    records_by_id: dict[str, dict[str, object]],
) -> bool:
    """Canonical cache eligibility for every processing operation."""

    return bool(
        record.get("cache_key") == key
        and record.get("status") == "completed"
        and not record.get("stale")
        and not record.get("invalidated")
        and record.get("output") is not None
        and not lineage_is_invalidated(record, records_by_id)
    )
