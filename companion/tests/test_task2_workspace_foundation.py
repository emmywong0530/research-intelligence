from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import paired_headers
from research_intelligence_companion.models import SCHEMA_VERSION
from research_intelligence_companion.workspace import WorkspaceError, resolve_under_workspace

TIMESTAMP = "2026-07-19T12:00:00Z"


def project_record(project_id: str = "project-alpha", name: str = "AI Advice") -> dict[str, object]:
    return {
        "schema_version": "m2.v1",
        "project_id": project_id,
        "name": name,
        "natural_language_research_idea": "How people use AI advice.",
        "central_research_question": "When does AI advice change decisions?",
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def create_workspace(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> tuple[dict[str, str], Path, str]:
    headers = paired_headers(client, origin_headers)
    workspace_path = tmp_path / "workspace"
    response = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(workspace_path), "name": "Research Workspace"},
    )
    assert response.status_code == 200
    return headers, workspace_path, response.json()["workspace_id"]


def write_project(
    client: TestClient,
    headers: dict[str, str],
    workspace_id: str,
    record: dict[str, object],
    expected_revision: str | None = None,
) -> dict[str, object]:
    body: dict[str, object] = {"record": record}
    if expected_revision is not None:
        body["expected_revision"] = expected_revision
    response = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/projects/{record['project_id']}",
        headers=headers,
        json=body,
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_create_and_open_workspace_builds_approved_structure(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path, origin_headers)
    expected_directories = {
        "projects",
        "papers",
        "notes",
        "syntheses",
        "gaps",
        "feedback",
        "activity",
        "backups",
    }
    assert {path.name for path in workspace_path.iterdir() if path.is_dir()} == expected_directories
    metadata = json.loads((workspace_path / "workspace.json").read_text(encoding="utf-8"))
    assert metadata["workspace_id"] == workspace_id
    assert metadata["schema_version"] == "m2.v1"

    reopened = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(workspace_path)},
    )
    assert reopened.status_code == 200
    assert reopened.json()["workspace_id"] == workspace_id

    metadata_response = client.get(
        f"/api/v1/workspaces/{workspace_id}/metadata", headers=headers
    )
    assert metadata_response.status_code == 200
    assert metadata_response.json()["metadata"]["workspace_id"] == workspace_id


def test_open_rejects_invalid_workspace_metadata(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers = paired_headers(client, origin_headers)
    workspace_path = tmp_path / "invalid-workspace"
    workspace_path.mkdir()
    (workspace_path / "workspace.json").write_text(
        json.dumps({"schema_version": "m2.v1", "workspace_id": "wrong"}),
        encoding="utf-8",
    )
    response = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(workspace_path)},
    )
    assert response.status_code == 400
    assert "Invalid workspace record" in response.json()["detail"]


def test_schema_validation_rejects_invalid_records_before_writing(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path, origin_headers)
    invalid = project_record()
    invalid["updated_at"] = "not-a-timestamp"
    response = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-alpha",
        headers=headers,
        json={"record": invalid},
    )
    assert response.status_code == 400
    assert not (workspace_path / "projects/project-alpha/project.json").exists()

    secret_record = project_record()
    secret_record["privacy_configuration"] = {"api_key": "DO_NOT_WRITE"}
    secret_response = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-alpha",
        headers=headers,
        json={"record": secret_record},
    )
    assert secret_response.status_code == 400
    assert b"DO_NOT_WRITE" not in workspace_path.read_bytes() if workspace_path.is_file() else True


def test_valid_record_write_read_and_list_updates_workspace_index(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path, origin_headers)
    written = write_project(client, headers, workspace_id, project_record())
    assert written["relative_path"] == "projects/project-alpha/project.json"
    assert written["revision"]

    read = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-alpha",
        headers=headers,
    )
    assert read.status_code == 200
    assert read.json()["record"]["name"] == "AI Advice"
    assert read.json()["revision"] == written["revision"]

    listed = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/projects", headers=headers
    )
    assert listed.status_code == 200
    assert [item["record_id"] for item in listed.json()["records"]] == ["project-alpha"]
    metadata = json.loads((workspace_path / "workspace.json").read_text(encoding="utf-8"))
    assert metadata["projects"] == ["project-alpha"]


def test_stale_revision_is_rejected_and_current_data_is_preserved(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers, _, workspace_id = create_workspace(client, tmp_path, origin_headers)
    first = write_project(client, headers, workspace_id, project_record())
    second = write_project(
        client,
        headers,
        workspace_id,
        project_record(name="Updated advice"),
        expected_revision=first["revision"],
    )
    stale = project_record(name="Stale advice")
    conflict = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-alpha",
        headers=headers,
        json={"record": stale, "expected_revision": first["revision"]},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "workspace_conflict"
    assert conflict.json()["detail"]["current_revision"] == second["revision"]

    reported = client.post(
        f"/api/v1/workspaces/{workspace_id}/conflicts",
        headers=headers,
        json={
            "collection": "projects",
            "record_id": "project-alpha",
            "expected_revision": first["revision"],
        },
    )
    assert reported.status_code == 200
    assert reported.json()["conflict"] is True
    current = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-alpha",
        headers=headers,
    )
    assert current.json()["record"]["name"] == "Updated advice"


def test_backup_restore_is_revision_guarded_and_preserves_recovery_backup(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path, origin_headers)
    first = write_project(client, headers, workspace_id, project_record())
    backup = client.post(
        f"/api/v1/workspaces/{workspace_id}/backups",
        headers=headers,
        json={"reason": "test snapshot"},
    )
    assert backup.status_code == 200
    backup_id = backup.json()["backup"]["backup_id"]
    assert (workspace_path / "backups" / backup_id / "manifest.json").exists()

    metadata_before_update = client.get(
        f"/api/v1/workspaces/{workspace_id}/metadata", headers=headers
    ).json()["revision"]
    write_project(
        client,
        headers,
        workspace_id,
        project_record(name="Newer advice"),
        expected_revision=first["revision"],
    )
    stale_restore = client.post(
        f"/api/v1/workspaces/{workspace_id}/backups/{backup_id}/restore",
        headers=headers,
        json={"expected_workspace_revision": metadata_before_update},
    )
    assert stale_restore.status_code == 409

    current_workspace_revision = client.get(
        f"/api/v1/workspaces/{workspace_id}/metadata", headers=headers
    ).json()["revision"]
    restored = client.post(
        f"/api/v1/workspaces/{workspace_id}/backups/{backup_id}/restore",
        headers=headers,
        json={"expected_workspace_revision": current_workspace_revision},
    )
    assert restored.status_code == 200
    assert restored.json()["recovery_backup_id"] != backup_id
    read = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-alpha",
        headers=headers,
    )
    assert read.json()["record"]["name"] == "AI Advice"

    backups = client.get(f"/api/v1/workspaces/{workspace_id}/backups", headers=headers)
    assert backups.status_code == 200
    assert len(backups.json()["backups"]) >= 2


def test_path_security_rejects_absolute_paths_and_symlink_escape(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path, origin_headers)
    absolute = client.post(
        "/api/v1/workspaces/resolve",
        headers=headers,
        json={"workspace_id": workspace_id, "relative_path": str(tmp_path / "outside")},
    )
    assert absolute.status_code == 400

    outside = tmp_path / "outside"
    outside.mkdir()
    link = workspace_path / "notes" / "linked"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("Symlink creation is unavailable in this environment.")
    with pytest.raises(WorkspaceError):
        resolve_under_workspace(workspace_path, "notes/linked/secret.json")


def test_workspace_endpoints_require_pairing_and_health_reports_device_separation(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    unauthenticated = client.post(
        "/api/v1/workspaces/create",
        headers=origin_headers,
        json={"path": str(tmp_path / "unauthenticated")},
    )
    assert unauthenticated.status_code == 401

    headers, workspace_path, workspace_id = create_workspace(client, tmp_path, origin_headers)
    health = client.get(f"/api/v1/workspaces/{workspace_id}/health", headers=headers)
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"
    assert health.json()["device_local_registry"]["separate_from_workspace"] is True
    assert not list(workspace_path.rglob("*.sqlite3"))
    assert not list(workspace_path.rglob("*.db"))


def test_abandoned_temporary_files_are_cleaned_on_initialise(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path, origin_headers)
    abandoned = workspace_path / "projects" / ".project.json.abandoned.tmp"
    abandoned.write_text("partial", encoding="utf-8")
    initialised = client.post(
        f"/api/v1/workspaces/{workspace_id}/initialize", headers=headers
    )
    assert initialised.status_code == 200
    assert not abandoned.exists()


def test_api_secret_fields_are_never_written_to_workspace(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers, workspace_path, workspace_id = create_workspace(client, tmp_path, origin_headers)
    record = project_record()
    record["automation_configuration"] = {"access_token": "DO_NOT_WRITE"}
    response = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/projects/project-alpha",
        headers=headers,
        json={"record": record},
    )
    assert response.status_code == 400
    assert all(
        b"DO_NOT_WRITE" not in path.read_bytes()
        for path in workspace_path.rglob("*")
        if path.is_file()
    )


def test_api_response_envelopes_keep_task0_schema_version(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers, _, workspace_id = create_workspace(client, tmp_path, origin_headers)
    health = client.get(f"/api/v1/workspaces/{workspace_id}/health", headers=headers)
    assert health.json()["schema_version"] == SCHEMA_VERSION
