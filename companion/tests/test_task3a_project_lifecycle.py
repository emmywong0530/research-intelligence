from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from conftest import PRODUCTION_ORIGIN, VALID_ORIGIN, paired_headers
from research_intelligence_companion.app import create_app
from research_intelligence_companion.settings import CompanionSettings

TIMESTAMP = "2026-07-19T12:00:00Z"


def project_record(
    project_id: str = "project-task3a", name: str = "Advice research"
) -> dict[str, object]:
    return {
        "schema_version": "m2.v1",
        "project_id": project_id,
        "name": name,
        "natural_language_research_idea": "Understand how people use AI advice.",
        "central_research_question": "When does AI advice change decisions?",
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def create_workspace(
    client: TestClient, tmp_path: Path, origin: str = VALID_ORIGIN
) -> tuple[dict[str, str], Path, str]:
    origin_headers = {"Origin": origin}
    headers = paired_headers(client, origin_headers)
    workspace_path = tmp_path / "task3a-workspace"
    response = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(workspace_path), "name": "Task 3A Workspace"},
    )
    assert response.status_code == 200, response.text
    return headers, workspace_path, response.json()["workspace_id"]


def write_project(
    client: TestClient,
    headers: dict[str, str],
    workspace_id: str,
    record: dict[str, object],
    expected_revision: str | None = None,
):
    body: dict[str, object] = {"record": record}
    if expected_revision is not None:
        body["expected_revision"] = expected_revision
    return client.put(
        f"/api/v1/workspaces/{workspace_id}/records/projects/{record['project_id']}",
        headers=headers,
        json=body,
    )


def test_project_create_read_update_list_and_reopen_persisted_record(
    client: TestClient,
    tmp_path: Path,
    origin_headers: dict[str, str],
) -> None:
    headers = paired_headers(client, origin_headers)
    workspace_path = tmp_path / "task3a-workspace"
    created_workspace = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(workspace_path), "name": "Task 3A Workspace"},
    )
    assert created_workspace.status_code == 200
    workspace_id = created_workspace.json()["workspace_id"]

    created = write_project(client, headers, workspace_id, project_record())
    assert created.status_code == 200, created.text
    created_payload = created.json()
    assert created_payload["record"]["project_id"] == "project-task3a"
    assert created_payload["relative_path"] == "projects/project-task3a/project.json"
    assert created_payload["revision"]

    listed = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/projects", headers=headers
    )
    assert listed.status_code == 200
    assert [item["record_id"] for item in listed.json()["records"]] == ["project-task3a"]

    read = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-task3a",
        headers=headers,
    )
    assert read.status_code == 200
    assert read.json()["revision"] == created_payload["revision"]

    updated_record = project_record(name="Updated advice research")
    updated = write_project(
        client,
        headers,
        workspace_id,
        updated_record,
        expected_revision=created_payload["revision"],
    )
    assert updated.status_code == 200
    assert updated.json()["record"]["project_id"] == "project-task3a"
    assert updated.json()["record"]["name"] == "Updated advice research"
    assert updated.json()["previous_revision"] == created_payload["revision"]

    stale = write_project(
        client,
        headers,
        workspace_id,
        project_record(name="Must not overwrite"),
        expected_revision=created_payload["revision"],
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "workspace_conflict"
    current = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-task3a",
        headers=headers,
    )
    assert current.json()["record"]["name"] == "Updated advice research"

    metadata = json.loads((workspace_path / "workspace.json").read_text(encoding="utf-8"))
    assert metadata["projects"] == ["project-task3a"]
    assert metadata["workspace_id"] == workspace_id

    reopened_settings = CompanionSettings(
        host="127.0.0.1", allowed_origins=(VALID_ORIGIN, PRODUCTION_ORIGIN)
    )
    with TestClient(create_app(reopened_settings)) as recreated_client:
        recreated_headers = paired_headers(recreated_client, origin_headers)
        reopened = recreated_client.post(
            "/api/v1/workspaces/open",
            headers=recreated_headers,
            json={"path": str(workspace_path)},
        )
        assert reopened.status_code == 200
        assert reopened.json()["workspace_id"] == workspace_id
        reopened_read = recreated_client.get(
            f"/api/v1/workspaces/{workspace_id}/records/projects/project-task3a",
            headers=recreated_headers,
        )
        assert reopened_read.status_code == 200
        assert reopened_read.json()["record"]["name"] == "Updated advice research"


def test_project_schema_and_secret_rejection_happen_before_write(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path)
    invalid = project_record()
    invalid["updated_at"] = "not-a-timestamp"
    rejected = write_project(client, headers, workspace_id, invalid)
    assert rejected.status_code == 400
    assert not (workspace_path / "projects/project-task3a/project.json").exists()

    secret_record = project_record()
    secret_record["privacy_configuration"] = {"api_key": "never-write-this"}
    secret = write_project(client, headers, workspace_id, secret_record)
    assert secret.status_code == 400
    assert not list(workspace_path.rglob("project.json"))


def test_project_workspace_routes_require_authentication_and_exact_origin(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    unauthenticated = client.get(
        "/api/v1/workspaces/workspace_missing/records/projects",
        headers=origin_headers,
    )
    assert unauthenticated.status_code == 401

    headers, _, workspace_id = create_workspace(client, tmp_path)
    invalid_origin = {**headers, "Origin": "https://unconfigured.example"}
    assert client.get(
        f"/api/v1/workspaces/{workspace_id}/records/projects", headers=invalid_origin
    ).status_code == 403

    missing_origin = {key: value for key, value in headers.items() if key.lower() != "origin"}
    assert client.get(
        f"/api/v1/workspaces/{workspace_id}/records/projects", headers=missing_origin
    ).status_code == 403

    production_headers = paired_headers(client, {"Origin": PRODUCTION_ORIGIN})
    assert client.get(
        f"/api/v1/workspaces/{workspace_id}/records/projects", headers=production_headers
    ).status_code == 200
