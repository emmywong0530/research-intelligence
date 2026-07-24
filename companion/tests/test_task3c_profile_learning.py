from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import VALID_ORIGIN, paired_headers

TIMESTAMP = "2026-07-24T12:00:00Z"


def project_record(project_id: str = "project-task3c") -> dict[str, object]:
    return {
        "schema_version": "m2.v1",
        "project_id": project_id,
        "name": f"Research project {project_id}",
        "natural_language_research_idea": "Understand how people use AI advice.",
        "central_research_question": "When does AI advice change decisions?",
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def proposal(
    *, proposal_id: str = "proposal-search-1", status: str = "proposed"
) -> dict[str, object]:
    return {
        "proposal_id": proposal_id,
        "type": "new_search_terms",
        "explanation": "Add a phrase that makes the explicit search scope more precise.",
        "status": status,
        "reversible": True,
        "created_at": TIMESTAMP,
        "target_field": "search_queries",
        "current_value": {"values": ["AI advice interaction"]},
        "proposed_value": {"values": ["conversational AI advice"]},
        "history": [
            {"event": "created", "status": "proposed", "occurred_at": TIMESTAMP}
        ],
    }


def profile_record(
    *, schema_version: str = "m2.v1", with_proposal: bool = True
) -> dict[str, object]:
    record: dict[str, object] = {
        "schema_version": schema_version,
        "research_profile_id": "research_profile_project-task3c",
        "project_id": "project-task3c",
        "central_research_question": "When does AI advice change decisions?",
        "concepts": [{"term": "Advice taking", "weight": 1.25}],
        "preferred_evidence_types": ["Experiments"],
        "exclusions": ["Clinical-only studies"],
        "search_queries": ["AI advice interaction"],
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }
    if with_proposal:
        record["proposals"] = [proposal()]
    return record


def create_workspace(client: TestClient, tmp_path: Path) -> tuple[dict[str, str], Path, str]:
    headers = paired_headers(client, {"Origin": VALID_ORIGIN})
    workspace_path = tmp_path / "task3c-workspace"
    response = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(workspace_path), "name": "Task 3C Workspace"},
    )
    assert response.status_code == 200, response.text
    workspace_id = response.json()["workspace_id"]
    project = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-task3c",
        headers=headers,
        json={"record": project_record()},
    )
    assert project.status_code == 200, project.text
    return headers, workspace_path, workspace_id


def write_profile(
    client: TestClient,
    headers: dict[str, str],
    workspace_id: str,
    record: dict[str, object],
    *,
    expected_revision: str | None = None,
):
    body: dict[str, object] = {"record": record, "parent_id": "project-task3c"}
    if expected_revision is not None:
        body["expected_revision"] = expected_revision
    return client.put(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles/research_profile_project-task3c",
        headers=headers,
        json=body,
    )


def test_explicit_proposal_payload_validates_and_migrates_from_task3b(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path)
    legacy = profile_record(with_proposal=True)
    (workspace_path / "projects/project-task3c/research-profile.json").write_text(
        json.dumps(legacy) + "\n", encoding="utf-8"
    )

    reopened = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(workspace_path)},
    )
    assert reopened.status_code == 200, reopened.text
    read = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles/research_profile_project-task3c",
        headers=headers,
    )
    assert read.status_code == 200, read.text
    migrated = read.json()["record"]
    assert migrated["schema_version"] == "m3c.v1"
    assert migrated["proposals"] == legacy["proposals"]
    assert list((workspace_path / "backups").iterdir())

    before = read.json()["revision"]
    reopened_again = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(workspace_path)},
    )
    assert reopened_again.status_code == 200
    read_again = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles/research_profile_project-task3c",
        headers=headers,
    )
    assert read_again.json()["revision"] == before


def test_future_profile_schema_is_refused_without_overwrite(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, _workspace_id = create_workspace(client, tmp_path)
    future = profile_record(schema_version="m9.v1", with_proposal=False)
    target = workspace_path / "projects/project-task3c/research-profile.json"
    target.write_text(json.dumps(future) + "\n", encoding="utf-8")

    response = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(workspace_path)},
    )
    assert response.status_code == 400
    assert json.loads(target.read_text(encoding="utf-8"))["schema_version"] == "m9.v1"


def test_corrupt_profile_is_refused_without_guessing(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, _workspace_id = create_workspace(client, tmp_path)
    target = workspace_path / "projects/project-task3c/research-profile.json"
    target.write_text('{"schema_version":"m2.v1",', encoding="utf-8")
    response = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(workspace_path)},
    )
    assert response.status_code == 400
    assert target.read_text(encoding="utf-8") == '{"schema_version":"m2.v1",'


def test_invalid_task3c_proposal_is_rejected_before_any_profile_write(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path)
    invalid = profile_record()
    invalid["proposals"] = [{
        "proposal_id": "proposal-invalid",
        "type": "new_search_terms",
        "explanation": "Missing durable snapshots.",
        "status": "proposed",
        "created_at": TIMESTAMP,
        "target_field": "search_queries",
    }]
    response = write_profile(client, headers, workspace_id, invalid)
    assert response.status_code == 400
    assert not (workspace_path / "projects/project-task3c/research-profile.json").exists()


def test_accept_reject_and_reverse_preserve_decision_history_and_conflicts(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _workspace_path, workspace_id = create_workspace(client, tmp_path)
    created = write_profile(client, headers, workspace_id, profile_record())
    assert created.status_code == 200, created.text
    created_revision = created.json()["revision"]

    accepted = profile_record(schema_version="m3c.v1")
    accepted["search_queries"] = ["AI advice interaction", "conversational AI advice"]
    accepted_proposal = proposal(status="accepted")
    accepted_proposal.update(
        {
            "decision_at": TIMESTAMP,
            "applied_revision": created_revision,
            "applied_value": {"values": ["AI advice interaction", "conversational AI advice"]},
            "history": [
                *accepted_proposal["history"],
                {
                    "event": "accepted",
                    "status": "accepted",
                    "occurred_at": TIMESTAMP,
                    "value": {"values": ["AI advice interaction", "conversational AI advice"]},
                    "revision": created_revision,
                },
            ],
        }
    )
    accepted["proposals"] = [accepted_proposal]
    applied = write_profile(
        client, headers, workspace_id, accepted, expected_revision=created_revision
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["record"]["search_queries"][-1] == "conversational AI advice"

    stale = profile_record(schema_version="m3c.v1")
    stale["central_research_question"] = "A stale edit must not win."
    stale_response = write_profile(
        client,
        headers,
        workspace_id,
        stale,
        expected_revision=created_revision,
    )
    assert stale_response.status_code == 409

    blocked = dict(accepted)
    blocked["updated_at"] = "2026-07-24T12:01:00Z"
    blocked["search_queries"] = ["AI advice interaction", "later user edit"]
    blocked_proposal = dict(accepted_proposal)
    blocked_proposal["reversal_result"] = "blocked"
    blocked_proposal["history"] = [
        *accepted_proposal["history"],
        {
            "event": "reversal_blocked",
            "status": "accepted",
            "occurred_at": "2026-07-24T12:01:00Z",
            "value": {"values": ["AI advice interaction", "later user edit"]},
            "revision": applied.json()["revision"],
            "note": "The profile field changed after this proposal was applied.",
        },
    ]
    blocked["proposals"] = [blocked_proposal]
    blocked_response = write_profile(
        client,
        headers,
        workspace_id,
        blocked,
        expected_revision=applied.json()["revision"],
    )
    assert blocked_response.status_code == 200, blocked_response.text
    assert blocked_response.json()["record"]["proposals"][0]["reversal_result"] == "blocked"
    assert blocked_response.json()["record"]["search_queries"][-1] == "later user edit"

    reversal = dict(blocked_response.json()["record"])
    reversal["updated_at"] = "2026-07-24T12:02:00Z"
    reversal["search_queries"] = ["AI advice interaction", "conversational AI advice"]
    reversed_proposal = dict(blocked_proposal)
    reversed_proposal.update(
        {
            "status": "reversed",
            "reversed_at": "2026-07-24T12:02:00Z",
            "reversal_result": "restored",
            "history": [
                *blocked_proposal["history"],
                {
                    "event": "reversed",
                    "status": "reversed",
                    "occurred_at": "2026-07-24T12:02:00Z",
                    "value": {"values": ["AI advice interaction"]},
                    "revision": blocked_response.json()["revision"],
                },
            ],
        }
    )
    reversal["proposals"] = [reversed_proposal]
    restored = write_profile(
        client,
        headers,
        workspace_id,
        reversal,
        expected_revision=blocked_response.json()["revision"],
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["record"]["proposals"][0]["status"] == "reversed"


def test_proposal_scope_and_authentication_are_preserved(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _workspace_path, workspace_id = create_workspace(client, tmp_path)
    profile = profile_record()
    created = write_profile(client, headers, workspace_id, profile)
    assert created.status_code == 200
    unauthenticated = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles",
        headers={"Origin": VALID_ORIGIN},
    )
    assert unauthenticated.status_code == 401
    wrong_project = dict(profile)
    wrong_project["project_id"] = "project-other"
    wrong_project["research_profile_id"] = "research_profile_project-other"
    rejected = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles/research_profile_project-other",
        headers=headers,
        json={"record": wrong_project, "parent_id": "project-other"},
    )
    assert rejected.status_code == 400


def test_profile_decision_transaction_rolls_back_on_injected_failure(
    client: TestClient, tmp_path: Path, monkeypatch
) -> None:
    from research_intelligence_companion import workspace as workspace_module

    headers, workspace_path, workspace_id = create_workspace(client, tmp_path)
    created = write_profile(client, headers, workspace_id, profile_record())
    assert created.status_code == 200
    old_bytes = (workspace_path / "projects/project-task3c/research-profile.json").read_bytes()
    updated = profile_record(schema_version="m3c.v1")
    updated["search_queries"] = ["should not persist"]

    def fail(point: str) -> None:
        if point == "after_record_replacement_before_metadata":
            raise RuntimeError("injected transaction failure")

    monkeypatch.setattr(workspace_module, "_transaction_fault_injector", fail)
    with pytest.raises(RuntimeError, match="injected transaction failure"):
        write_profile(
            client,
            headers,
            workspace_id,
            updated,
            expected_revision=created.json()["revision"],
        )
    monkeypatch.setattr(workspace_module, "_transaction_fault_injector", None)
    assert (
        workspace_path / "projects/project-task3c/research-profile.json"
    ).read_bytes() == old_bytes

    reopened = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(workspace_path)},
    )
    assert reopened.status_code == 200
