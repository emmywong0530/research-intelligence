from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import paired_headers
from research_intelligence_companion import workspace as workspace_module
from research_intelligence_companion.device import DeviceRegistry, WorkspaceIdentityCollision
from research_intelligence_companion.models import SCHEMA_VERSION
from research_intelligence_companion.workspace import (
    WorkspaceError,
    create_backup,
    list_backups,
    open_workspace,
    read_record,
    read_workspace_metadata,
    resolve_under_workspace,
    restore_backup,
    workspace_revision,
    write_record,
)
from research_intelligence_companion.workspace import (
    create_workspace as create_local_workspace,
)

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

    moved_path = tmp_path / "renamed-workspace"
    shutil.move(workspace_path, moved_path)
    moved_open = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(moved_path)},
    )
    assert moved_open.status_code == 200
    assert moved_open.json()["workspace_id"] == workspace_id


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


def test_workspace_identity_survives_move_and_updates_device_registry(tmp_path: Path) -> None:
    root, metadata, _ = create_local_workspace(str(tmp_path / "original"), "Portable")
    original_id = metadata["workspace_id"]
    moved = tmp_path / "renamed"
    shutil.move(root, moved)

    reopened_root, reopened, _ = open_workspace(str(moved))
    assert reopened_root == moved.resolve()
    assert reopened["workspace_id"] == original_id

    registry = DeviceRegistry(tmp_path / "device")
    assert registry.register_workspace(original_id, moved) == "registered"
    second_move = tmp_path / "renamed-again"
    shutil.move(moved, second_move)
    assert registry.register_workspace(original_id, second_move) == "updated"
    assert registry.registered_workspace(original_id)["workspace_root"] == str(
        second_move.resolve()
    )


def test_duplicate_workspace_id_is_rejected_without_overwriting_registry(tmp_path: Path) -> None:
    root, metadata, _ = create_local_workspace(str(tmp_path / "original"))
    duplicate = tmp_path / "duplicate"
    shutil.copytree(root, duplicate)
    registry = DeviceRegistry(tmp_path / "device")
    workspace_id = metadata["workspace_id"]
    registry.register_workspace(workspace_id, root)

    with pytest.raises(WorkspaceIdentityCollision):
        registry.register_workspace(workspace_id, duplicate)
    assert registry.registered_workspace(workspace_id)["workspace_root"] == str(root.resolve())


def test_api_reports_duplicate_workspace_identity_collision(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers, root, workspace_id = create_workspace(client, tmp_path, origin_headers)
    duplicate = tmp_path / "duplicate"
    shutil.copytree(root, duplicate)
    response = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(duplicate)},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "workspace_identity_collision"
    assert response.json()["detail"]["workspace_id"] == workspace_id


def test_same_durable_workspace_can_register_on_a_second_device_registry(tmp_path: Path) -> None:
    root, metadata, _ = create_local_workspace(str(tmp_path / "workspace"))
    workspace_id = metadata["workspace_id"]
    first_device = DeviceRegistry(tmp_path / "device-one")
    second_device = DeviceRegistry(tmp_path / "device-two")
    first_device.register_workspace(workspace_id, root)
    assert second_device.register_workspace(workspace_id, root) == "registered"
    assert second_device.registered_workspace(workspace_id)["workspace_root"] == str(root.resolve())


def test_device_registry_accepts_cross_device_style_move_after_source_disappears(
    tmp_path: Path,
) -> None:
    root, metadata, _ = create_local_workspace(str(tmp_path / "source"))
    workspace_id = metadata["workspace_id"]
    registry = DeviceRegistry(tmp_path / "device")
    registry.register_workspace(workspace_id, root)
    moved = tmp_path / "downloaded-copy"
    shutil.copytree(root, moved)
    shutil.rmtree(root)

    assert registry.register_workspace(workspace_id, moved) == "updated"
    assert registry.registered_workspace(workspace_id)["workspace_root"] == str(moved.resolve())


@pytest.mark.parametrize(
    "fault_point",
    [
        "before_record_replacement",
        "after_record_replacement_before_metadata",
        "during_metadata_replacement",
        "after_metadata_replacement_before_commit",
    ],
)
@pytest.mark.parametrize("existing_record", [False, True])
def test_record_transaction_faults_leave_the_complete_prior_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    fault_point: str,
    existing_record: bool,
) -> None:
    root, _, _ = create_local_workspace(
        str(tmp_path / f"workspace-{fault_point}-{existing_record}")
    )
    previous_revision: str | None = None
    if existing_record:
        _, previous_revision, _, _ = write_record(
            root,
            "projects",
            "project-alpha",
            project_record(),
            expected_revision=None,
        )

    def inject(point: str) -> None:
        if point == fault_point:
            raise RuntimeError(f"injected failure: {point}")

    monkeypatch.setattr(workspace_module, "_transaction_fault_injector", inject)
    updated = project_record(name="Updated advice")
    with pytest.raises(RuntimeError, match="injected failure"):
        write_record(
            root,
            "projects",
            "project-alpha",
            updated,
            expected_revision=previous_revision,
        )
    monkeypatch.setattr(workspace_module, "_transaction_fault_injector", None)

    metadata, _ = read_workspace_metadata(root)
    if existing_record:
        record, revision, _ = read_record(root, "projects", "project-alpha")
        assert record["name"] == "AI Advice"
        assert revision == previous_revision
        assert metadata["projects"] == ["project-alpha"]
    else:
        assert not (root / "projects/project-alpha/project.json").exists()
        assert metadata["projects"] == []
    transaction_root = root / ".research-intelligence" / "transactions"
    assert not list(transaction_root.iterdir()) if transaction_root.exists() else True


def test_committed_record_transaction_cleanup_is_recovered_on_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, _, _ = create_local_workspace(str(tmp_path / "workspace"))

    def inject(point: str) -> None:
        if point == "during_transaction_cleanup":
            raise RuntimeError("cleanup interrupted")

    monkeypatch.setattr(workspace_module, "_transaction_fault_injector", inject)
    write_record(root, "projects", "project-alpha", project_record(), expected_revision=None)
    transaction_root = root / ".research-intelligence" / "transactions"
    assert list(transaction_root.iterdir())
    monkeypatch.setattr(workspace_module, "_transaction_fault_injector", None)
    open_workspace(str(root))
    assert not list(transaction_root.iterdir())
    record, _, _ = read_record(root, "projects", "project-alpha")
    assert record["name"] == "AI Advice"


def test_open_rolls_back_an_abandoned_record_transaction(tmp_path: Path) -> None:
    root, _, _ = create_local_workspace(str(tmp_path / "workspace"))
    write_record(root, "projects", "project-alpha", project_record(), expected_revision=None)
    record_path = root / "projects/project-alpha/project.json"
    before_record = record_path.read_bytes()
    before_metadata = (root / "workspace.json").read_bytes()
    transaction = workspace_module._new_transaction_directory(root, "record_abandoned")
    workspace_module._atomic_write_bytes(transaction / "before-record.bin", before_record)
    workspace_module._atomic_write_bytes(transaction / "before-metadata.bin", before_metadata)
    journal = {
        "schema_version": "transaction.v1",
        "kind": "record",
        "transaction_id": "record_abandoned",
        "state": "committing",
        "record_relative_path": "projects/project-alpha/project.json",
    }
    workspace_module._atomic_write_internal_json(transaction / "journal.json", journal)
    record_path.write_text(json.dumps(project_record(name="partial")), encoding="utf-8")

    open_workspace(str(root))
    restored, _, _ = read_record(root, "projects", "project-alpha")
    assert restored["name"] == "AI Advice"


def _two_state_workspace(tmp_path: Path) -> tuple[Path, str, dict[str, object]]:
    root, _, _ = create_local_workspace(str(tmp_path / "workspace"))
    first = project_record()
    write_record(root, "projects", "project-alpha", first, expected_revision=None)
    backup = create_backup(root, reason="restore-test")
    write_record(
        root,
        "projects",
        "project-alpha",
        project_record(name="Newer advice"),
        expected_revision=read_record(root, "projects", "project-alpha")[1],
    )
    return root, backup["backup_id"], backup


@pytest.mark.parametrize("corruption", ["missing", "hash"])
def test_restore_validates_complete_snapshot_before_changing_live_data(
    tmp_path: Path, corruption: str
) -> None:
    root, backup_id, _ = _two_state_workspace(tmp_path)
    backup_root = root / "backups" / backup_id
    snapshot_file = backup_root / "snapshot/projects/project-alpha/project.json"
    if corruption == "missing":
        snapshot_file.unlink()
    else:
        snapshot_file.write_text("corrupted", encoding="utf-8")
    backup_directories_before = sorted(path.name for path in (root / "backups").iterdir())

    with pytest.raises(WorkspaceError):
        restore_backup(root, backup_id, expected_workspace_revision=workspace_revision(root))
    current, _, _ = read_record(root, "projects", "project-alpha")
    assert current["name"] == "Newer advice"
    assert sorted(path.name for path in (root / "backups").iterdir()) == backup_directories_before


@pytest.mark.parametrize("fault_point", ["restore_before_commit", "restore_during_commit"])
def test_restore_faults_roll_back_and_retain_recovery_backup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fault_point: str
) -> None:
    root, backup_id, _ = _two_state_workspace(tmp_path)

    def inject(point: str) -> None:
        if point == fault_point:
            raise RuntimeError(f"injected restore failure: {point}")

    monkeypatch.setattr(workspace_module, "_transaction_fault_injector", inject)
    with pytest.raises(RuntimeError, match="injected restore failure"):
        restore_backup(root, backup_id, expected_workspace_revision=workspace_revision(root))
    monkeypatch.setattr(workspace_module, "_transaction_fault_injector", None)

    current, _, _ = read_record(root, "projects", "project-alpha")
    assert current["name"] == "Newer advice"
    assert any(item["reason"].startswith("before-restore-") for item in list_backups(root))


def test_open_recovers_restore_journal_and_keeps_recovery_backup(tmp_path: Path) -> None:
    root, backup_id, _ = _two_state_workspace(tmp_path)
    backup_root, manifest = workspace_module._read_backup(root, backup_id)
    recovery = create_backup(root, reason="recovery-before-test")
    recovery_root, recovery_manifest = workspace_module._read_backup(root, recovery["backup_id"])
    expected, hashes = workspace_module._verify_backup_snapshot(root, backup_root, manifest)
    transaction = workspace_module._new_transaction_directory(root, "restore_abandoned")
    staging = workspace_module._stage_backup_snapshot(transaction, backup_root, expected, hashes)
    journal = {
        "schema_version": "restore.v1",
        "kind": "restore",
        "transaction_id": "restore_abandoned",
        "state": "committing",
        "backup_id": backup_id,
        "recovery_backup_id": recovery["backup_id"],
        "expected_files": sorted(expected),
        "file_hashes": hashes,
    }
    workspace_module._atomic_write_internal_json(transaction / "journal.json", journal)
    workspace_module._apply_staged_snapshot(root, staging, expected, hashes)

    open_workspace(str(root))
    current, _, _ = read_record(root, "projects", "project-alpha")
    assert current["name"] == "Newer advice"
    assert (recovery_root / "manifest.json").exists()
    assert recovery_manifest["backup_id"] == recovery["backup_id"]
    assert not (root / ".research-intelligence/transactions/restore_abandoned").exists()
