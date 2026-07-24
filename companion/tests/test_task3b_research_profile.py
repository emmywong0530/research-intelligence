from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from conftest import VALID_ORIGIN, paired_headers
from research_intelligence_companion.app import create_app
from research_intelligence_companion.settings import CompanionSettings

TIMESTAMP = "2026-07-19T12:00:00Z"


def project_record(project_id: str = "project-task3b") -> dict[str, object]:
    return {
        "schema_version": "m2.v1",
        "project_id": project_id,
        "name": f"Research project {project_id}",
        "natural_language_research_idea": "Understand how people use AI advice.",
        "central_research_question": "When does AI advice change decisions?",
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def profile_record(project_id: str = "project-task3b") -> dict[str, object]:
    return {
        "schema_version": "m2.v1",
        "research_profile_id": f"research_profile_{project_id}",
        "project_id": project_id,
        "central_research_question": "When does AI advice change decisions?",
        "concepts": [{"term": "Advice taking", "weight": 1.25}],
        "synonyms": ["Advice use"],
        "theories": ["Trust calibration"],
        "mechanisms": ["Source evaluation"],
        "outcomes": ["Decision change"],
        "contexts": ["Interactive studies"],
        "populations": ["Adults"],
        "preferred_disciplines": ["Behavioural science"],
        "preferred_evidence_types": ["Experiments"],
        "exclusions": ["Clinical-only studies"],
        "watched_authors": ["A. Researcher"],
        "search_queries": ["AI advice interaction"],
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def create_workspace(
    client: TestClient, tmp_path: Path
) -> tuple[dict[str, str], Path, str]:
    origin_headers = {"Origin": VALID_ORIGIN}
    headers = paired_headers(client, origin_headers)
    workspace_path = tmp_path / "task3b-workspace"
    response = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(workspace_path), "name": "Task 3B Workspace"},
    )
    assert response.status_code == 200, response.text
    workspace_id = response.json()["workspace_id"]
    project = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-task3b",
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
    parent_id: str | None = None,
):
    body: dict[str, object] = {"record": record}
    if expected_revision is not None:
        body["expected_revision"] = expected_revision
    if parent_id is not None:
        body["parent_id"] = parent_id
    return client.put(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles/{record['research_profile_id']}",
        headers=headers,
        json=body,
    )


def test_profile_create_read_update_list_and_reopen_persisted_record(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path)
    created = write_profile(
        client, headers, workspace_id, profile_record(), parent_id="project-task3b"
    )
    assert created.status_code == 200, created.text
    created_payload = created.json()
    assert created_payload["record"]["research_profile_id"] == "research_profile_project-task3b"
    assert created_payload["record"]["project_id"] == "project-task3b"
    assert created_payload["relative_path"] == "projects/project-task3b/research-profile.json"
    assert created_payload["revision"]

    listed = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles",
        headers=headers,
    )
    assert listed.status_code == 200
    assert [item["record_id"] for item in listed.json()["records"]] == [
        "research_profile_project-task3b"
    ]

    read = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles/research_profile_project-task3b",
        headers=headers,
    )
    assert read.status_code == 200
    assert read.json()["revision"] == created_payload["revision"]

    updated_record = profile_record()
    updated_record["central_research_question"] = (
        "How does experienced interaction change advice use?"
    )
    updated = write_profile(
        client,
        headers,
        workspace_id,
        updated_record,
        expected_revision=created_payload["revision"],
        parent_id="project-task3b",
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["previous_revision"] == created_payload["revision"]

    stale_record = profile_record()
    stale_record["central_research_question"] = "Must not overwrite the current profile."
    stale = write_profile(
        client,
        headers,
        workspace_id,
        stale_record,
        expected_revision=created_payload["revision"],
        parent_id="project-task3b",
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "workspace_conflict"
    current = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles/research_profile_project-task3b",
        headers=headers,
    )
    assert current.json()["record"]["central_research_question"] == (
        "How does experienced interaction change advice use?"
    )

    metadata = json.loads((workspace_path / "workspace.json").read_text(encoding="utf-8"))
    assert metadata["projects"] == ["project-task3b"]
    assert not metadata.get("research_profiles")

    recreated_settings = CompanionSettings(host="127.0.0.1", allowed_origins=(VALID_ORIGIN,))
    with TestClient(create_app(recreated_settings)) as recreated_client:
        recreated_headers = paired_headers(recreated_client, {"Origin": VALID_ORIGIN})
        reopened = recreated_client.post(
            "/api/v1/workspaces/open",
            headers=recreated_headers,
            json={"path": str(workspace_path)},
        )
        assert reopened.status_code == 200
        reopened_read = recreated_client.get(
            f"/api/v1/workspaces/{workspace_id}/records/research-profiles/research_profile_project-task3b",
            headers=recreated_headers,
        )
        assert reopened_read.status_code == 200
        assert reopened_read.json()["record"]["project_id"] == "project-task3b"
        assert reopened_read.json()["record"]["central_research_question"] == (
            "How does experienced interaction change advice use?"
        )


def test_profile_identity_project_association_and_duplicate_prevention(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _, workspace_id = create_workspace(client, tmp_path)
    wrong_id = profile_record()
    wrong_id["research_profile_id"] = "research_profile_wrong"
    rejected_id = write_profile(client, headers, workspace_id, wrong_id, parent_id="project-task3b")
    assert rejected_id.status_code == 400
    assert "deterministic ID" in rejected_id.json()["detail"]

    wrong_parent = write_profile(
        client,
        headers,
        workspace_id,
        profile_record(),
        parent_id="project-other",
    )
    assert wrong_parent.status_code == 400
    assert "parent project" in wrong_parent.json()["detail"]

    missing_project = profile_record("project-missing")
    missing = write_profile(
        client,
        headers,
        workspace_id,
        missing_project,
        parent_id="project-missing",
    )
    assert missing.status_code == 400
    assert "project was not found" in missing.json()["detail"]

    created = write_profile(
        client,
        headers,
        workspace_id,
        profile_record(),
        parent_id="project-task3b",
    )
    assert created.status_code == 200
    duplicate = write_profile(
        client,
        headers,
        workspace_id,
        profile_record(),
        parent_id="project-task3b",
    )
    assert duplicate.status_code == 409
    current = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles/research_profile_project-task3b",
        headers=headers,
    )
    assert current.json()["record"]["central_research_question"] == profile_record()[
        "central_research_question"
    ]


def test_profile_schema_and_secret_rejection_happen_before_write(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path)
    invalid = profile_record()
    invalid["central_research_question"] = ""
    rejected = write_profile(client, headers, workspace_id, invalid, parent_id="project-task3b")
    assert rejected.status_code == 400
    assert not (workspace_path / "projects/project-task3b/research-profile.json").exists()

    secret = profile_record()
    secret["privacy_configuration"] = {"api_key": "never-write-this"}
    secret_response = write_profile(
        client,
        headers,
        workspace_id,
        secret,
        parent_id="project-task3b",
    )
    assert secret_response.status_code == 400
    assert not list(workspace_path.rglob("research-profile.json"))


def test_profile_routes_require_authentication_and_exact_origin(
    client: TestClient, tmp_path: Path
) -> None:
    origin_headers = {"Origin": VALID_ORIGIN}
    unauthenticated = client.get(
        "/api/v1/workspaces/workspace_missing/records/research-profiles",
        headers=origin_headers,
    )
    assert unauthenticated.status_code == 401
    headers, _, workspace_id = create_workspace(client, tmp_path)
    invalid_origin = {**headers, "Origin": "https://unconfigured.example"}
    assert client.get(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles",
        headers=invalid_origin,
    ).status_code == 403
    missing_origin = {key: value for key, value in headers.items() if key.lower() != "origin"}
    assert client.get(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles",
        headers=missing_origin,
    ).status_code == 403


def test_project_contexts_are_isolated(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _, workspace_id = create_workspace(client, tmp_path)
    second_project = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-second",
        headers=headers,
        json={"record": project_record("project-second")},
    )
    assert second_project.status_code == 200
    first = write_profile(
        client,
        headers,
        workspace_id,
        profile_record(),
        parent_id="project-task3b",
    )
    second = write_profile(
        client,
        headers,
        workspace_id,
        profile_record("project-second"),
        parent_id="project-second",
    )
    assert first.status_code == 200
    assert second.status_code == 200

    listed = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/research-profiles",
        headers=headers,
    )
    assert {item["record"]["project_id"] for item in listed.json()["records"]} == {
        "project-task3b",
        "project-second",
    }

    wrong_association = profile_record("project-second")
    wrong_association["research_profile_id"] = "research_profile_project-task3b"
    rejected = write_profile(
        client,
        headers,
        workspace_id,
        wrong_association,
        parent_id="project-second",
    )
    assert rejected.status_code == 400
