from __future__ import annotations

import math
from copy import deepcopy
from typing import Any

SUPPORTED_PROPOSAL_TYPES = {
    "changed_concept_weights",
    "new_search_terms",
    "exclusions",
    "preferred_methods",
}

PROPOSAL_TARGET_FIELDS = {
    "concepts",
    "search_queries",
    "exclusions",
    "preferred_evidence_types",
}

PROPOSAL_TYPE_TO_FIELD = {
    "changed_concept_weights": "concepts",
    "new_search_terms": "search_queries",
    "exclusions": "exclusions",
    # Task 3C maps the proposal's user-facing "preferred methods" language
    # to the existing durable evidence-type field.
    "preferred_methods": "preferred_evidence_types",
}

_PROPOSAL_EVENTS = {
    "created",
    "accepted",
    "modified",
    "rejected",
    "reversed",
    "reversal_blocked",
}
_PROPOSAL_STATUSES = {"proposed", "accepted", "modified", "rejected", "reversed"}


def _is_task3c_proposal(proposal: dict[str, Any]) -> bool:
    return "target_field" in proposal or any(
        key in proposal
        for key in (
            "current_value",
            "proposed_value",
            "modified_value",
            "applied_value",
            "history",
        )
    )


def _validate_string_values(value: Any, label: str) -> None:
    if (
        not isinstance(value, dict)
        or set(value) != {"values"}
        or not isinstance(value["values"], list)
    ):
        raise ValueError(f"{label} must be an object containing a values list.")
    seen: set[str] = set()
    for item in value["values"]:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{label} values must be non-empty strings.")
        normalised = item.strip().casefold()
        if normalised in seen:
            raise ValueError(f"{label} values must not contain case-insensitive duplicates.")
        seen.add(normalised)


def _validate_concept_values(value: Any, label: str) -> None:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be a list of weighted concepts.")
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) - {"term", "weight"} or "term" not in item:
            raise ValueError(f"{label} contains an invalid concept.")
        term = item["term"]
        if not isinstance(term, str) or not term.strip():
            raise ValueError(f"{label} terms must be non-empty strings.")
        normalised = term.strip().casefold()
        if normalised in seen:
            raise ValueError(f"{label} terms must not contain case-insensitive duplicates.")
        seen.add(normalised)
        if "weight" in item and (
            isinstance(item["weight"], bool) or not isinstance(item["weight"], (int, float))
        ):
            raise ValueError(f"{label} weights must be finite numbers.")
        if "weight" in item and not math.isfinite(float(item["weight"])):
            raise ValueError(f"{label} weights must be finite numbers.")


def _validate_value(target_field: str, value: Any, label: str) -> None:
    if target_field == "concepts":
        _validate_concept_values(value, label)
    else:
        _validate_string_values(value, label)


def _validate_history(proposal: dict[str, Any]) -> None:
    history = proposal.get("history", [])
    if not isinstance(history, list):
        raise ValueError("Proposal history must be a list.")
    for event in history:
        if not isinstance(event, dict) or event.get("event") not in _PROPOSAL_EVENTS:
            raise ValueError("Proposal history contains an invalid event.")
        if "occurred_at" not in event:
            raise ValueError("Proposal history events require occurred_at.")


def validate_profile_proposals(
    record: dict[str, Any],
    previous_record: dict[str, Any] | None = None,
) -> None:
    proposals = record.get("proposals", [])
    if not isinstance(proposals, list):
        raise ValueError("Research Profile proposals must be a list.")
    identifiers: set[str] = set()
    for proposal in proposals:
        if not isinstance(proposal, dict):
            raise ValueError("Research Profile proposals must be objects.")
        proposal_id = proposal.get("proposal_id")
        if proposal_id in identifiers:
            raise ValueError("Research Profile proposal IDs must be unique.")
        identifiers.add(proposal_id)
        if not _is_task3c_proposal(proposal):
            # Preserve old Task 3B-compatible proposal shells without guessing
            # the missing durable values needed for an actionable decision.
            continue
        proposal_type = proposal.get("type")
        target_field = proposal.get("target_field")
        if proposal_type not in SUPPORTED_PROPOSAL_TYPES:
            raise ValueError("This proposal type is not supported by Task 3C.")
        if (
            target_field not in PROPOSAL_TARGET_FIELDS
            or PROPOSAL_TYPE_TO_FIELD[proposal_type] != target_field
        ):
            raise ValueError("Proposal type and target field do not match.")
        for key in ("current_value", "proposed_value"):
            if key not in proposal:
                raise ValueError(f"Task 3C proposals require {key}.")
            _validate_value(target_field, proposal[key], key)
        if "modified_value" in proposal:
            _validate_value(target_field, proposal["modified_value"], "modified_value")
        if "applied_value" in proposal:
            _validate_value(target_field, proposal["applied_value"], "applied_value")
        _validate_history(proposal)
        status = proposal.get("status")
        if status not in _PROPOSAL_STATUSES:
            raise ValueError("Proposal status is invalid.")
        if status in {"accepted", "modified"}:
            required = {"decision_at", "applied_revision", "applied_value"}
            if not required.issubset(proposal):
                raise ValueError("Applied proposals require decision, revision, and applied value.")
        if status == "modified" and "modified_value" not in proposal:
            raise ValueError("Modified proposals require modified_value.")
        if status == "rejected" and "decision_at" not in proposal:
            raise ValueError("Rejected proposals require decision_at.")
        if status == "reversed":
            required = {"decision_at", "applied_revision", "applied_value", "reversed_at"}
            if not required.issubset(proposal) or proposal.get("reversal_result") != "restored":
                raise ValueError("Reversed proposals require a successful reversal record.")
        if proposal.get("reversal_result") == "blocked" and status not in {"accepted", "modified"}:
            raise ValueError("A blocked reversal must preserve an accepted or modified status.")

    if previous_record is not None:
        _validate_proposal_transition(previous_record.get("proposals", []), proposals)


def _validate_proposal_transition(previous: Any, incoming: Any) -> None:
    if not isinstance(previous, list) or not isinstance(incoming, list):
        return
    incoming_by_id = {item.get("proposal_id"): item for item in incoming if isinstance(item, dict)}
    for old in previous:
        if not isinstance(old, dict):
            continue
        proposal_id = old.get("proposal_id")
        new = incoming_by_id.get(proposal_id)
        if new is None:
            raise ValueError("Proposal decision history cannot be deleted.")
        for key in (
            "proposal_id",
            "type",
            "explanation",
            "created_at",
            "target_field",
            "current_value",
            "proposed_value",
        ):
            if old.get(key) != new.get(key):
                raise ValueError("Proposal identity and original values cannot be changed.")
        old_status = old.get("status")
        new_status = new.get("status")
        if old_status == "proposed" and new_status not in {
            "proposed",
            "accepted",
            "modified",
            "rejected",
        }:
            raise ValueError(
                "A proposed profile change can only be accepted, modified, or rejected."
            )
        if old_status in {"accepted", "modified"} and new_status not in {old_status, "reversed"}:
            raise ValueError("An applied proposal cannot be decided a second time.")
        if old_status in {"accepted", "modified"} and new_status == old_status:
            for key in (
                "decision_at",
                "modified_value",
                "applied_value",
                "applied_revision",
                "reversed_at",
            ):
                if old.get(key) != new.get(key):
                    raise ValueError("An applied proposal decision is immutable.")
            if old.get("reversal_result") != new.get("reversal_result") and new.get(
                "reversal_result"
            ) != "blocked":
                raise ValueError("An applied proposal decision is immutable.")
        if old_status in {"rejected", "reversed"} and new_status != old_status:
            raise ValueError("A completed proposal decision cannot be changed.")


def profile_value(record: dict[str, Any], target_field: str) -> Any:
    if target_field == "concepts":
        return deepcopy(record.get("concepts", []))
    return {"values": deepcopy(record.get(target_field, []))}


def validate_profile_value(target_field: str, value: Any) -> None:
    _validate_value(target_field, value, "profile value")
