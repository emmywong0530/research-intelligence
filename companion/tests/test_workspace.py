from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import paired_headers
from research_intelligence_companion import workspace as workspace_module
from research_intelligence_companion.models import SCHEMA_VERSION
from research_intelligence_companion.workspace import (
    WorkspaceBusyError,
    WorkspaceError,
    _atomic_write_bytes,
    _iter_durable_files,
    atomic_write_json,
    create_workspace,
    list_records,
    resolve_under_workspace,
    sha256_file,
    simulate_interrupted_write,
    workspace_revision,
)


def processing_directory(root: Path) -> Path:
    directory = root / "activity" / "processing"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def test_workspace_paths_outside_selected_root_fail(tmp_path: Path) -> None:
    with pytest.raises(WorkspaceError):
        resolve_under_workspace(tmp_path, "../outside.json")


def test_interrupted_writes_do_not_corrupt_prior_file(tmp_path: Path) -> None:
    target = tmp_path / "workspace.json"
    first_hash = atomic_write_json(target, {"schema_version": SCHEMA_VERSION, "value": "prior"})
    preserved = simulate_interrupted_write(
        target,
        {"schema_version": SCHEMA_VERSION, "value": "bad"},
    )
    assert preserved is True
    assert sha256_file(target) == first_hash


def test_schema_version_fields_are_required(tmp_path: Path) -> None:
    with pytest.raises(WorkspaceError):
        atomic_write_json(tmp_path / "workspace.json", {"value": "missing schema version"})


def test_workspace_revision_excludes_hidden_atomic_temporary_files(tmp_path: Path) -> None:
    root, _, _ = create_workspace(str(tmp_path / "workspace"))
    temporary = processing_directory(root) / ".processing_record.json.random.tmp"
    temporary.write_text("partial", encoding="utf-8")

    before = workspace_revision(root)
    temporary.write_text("different partial content", encoding="utf-8")

    assert workspace_revision(root) == before
    assert temporary not in _iter_durable_files(root)


def test_workspace_revision_retries_when_a_durable_file_disappears(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, _, _ = create_workspace(str(tmp_path / "workspace"))
    disappearing = processing_directory(root) / "durable.json"
    disappearing.write_text("durable", encoding="utf-8")
    original_sha256_file = workspace_module.sha256_file
    removed = False

    def remove_before_hash(path: Path) -> str:
        nonlocal removed
        if path == disappearing and not removed:
            removed = True
            disappearing.unlink()
        return original_sha256_file(path)

    monkeypatch.setattr(workspace_module, "sha256_file", remove_before_hash)

    revision = workspace_revision(root)

    assert removed is True
    assert isinstance(revision, str)
    assert len(revision) == 64


def test_workspace_revision_retries_to_a_valid_old_or_new_atomic_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, _, _ = create_workspace(str(tmp_path / "workspace"))
    target = processing_directory(root) / "durable.json"
    target.write_bytes(b"old")
    original_sha256_file = workspace_module.sha256_file
    swapped = False

    def replace_before_hash(path: Path) -> str:
        nonlocal swapped
        if path == target and not swapped:
            swapped = True
            _atomic_write_bytes(target, b"new")
        return original_sha256_file(path)

    monkeypatch.setattr(workspace_module, "sha256_file", replace_before_hash)

    revision = workspace_revision(root)

    assert swapped is True
    assert revision == workspace_revision(root)


def test_workspace_revision_is_deterministic_without_concurrent_mutation(tmp_path: Path) -> None:
    root, _, _ = create_workspace(str(tmp_path / "workspace"))
    target = processing_directory(root) / "durable.json"
    target.write_bytes(b"stable")

    assert workspace_revision(root) == workspace_revision(root)


def test_workspace_revision_returns_controlled_busy_error_after_bounded_retries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, _, _ = create_workspace(str(tmp_path / "workspace"))
    target = processing_directory(root) / "durable.json"
    target.write_bytes(b"initial")
    original_sha256_file = workspace_module.sha256_file
    next_content = b"changed"

    def replace_on_every_hash(path: Path) -> str:
        nonlocal next_content
        if path == target:
            _atomic_write_bytes(target, next_content)
            next_content = b"initial" if next_content == b"changed" else b"changed"
        return original_sha256_file(path)

    monkeypatch.setattr(workspace_module, "sha256_file", replace_on_every_hash)

    with pytest.raises(WorkspaceBusyError, match="retry the operation") as error:
        workspace_revision(root)

    assert str(root) not in str(error.value)


def test_record_listing_never_returns_atomic_temporary_files(tmp_path: Path) -> None:
    root, _, _ = create_workspace(str(tmp_path / "workspace"))
    project = {
        "schema_version": "m2.v1",
        "project_id": "project-visible",
        "name": "Visible project",
        "natural_language_research_idea": "A durable project idea.",
        "central_research_question": "What remains visible?",
        "created_at": "2026-07-31T12:00:00Z",
        "updated_at": "2026-07-31T12:00:00Z",
    }
    atomic_write_json(root / "projects" / "project-visible" / "project.json", project)
    temporary = root / "projects" / "project-visible" / ".project.json.random.tmp"
    temporary.write_text(json.dumps(project), encoding="utf-8")

    records = list_records(root, "projects")

    assert [item["record_id"] for item in records] == ["project-visible"]


def test_workspace_busy_revision_maps_to_safe_api_error(
    client: TestClient,
    tmp_path: Path,
    origin_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = paired_headers(client, origin_headers)
    created = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(tmp_path / "workspace")},
    )
    assert created.status_code == 200
    workspace_id = created.json()["workspace_id"]

    def always_busy(_root: Path) -> str:
        raise WorkspaceBusyError("internal path must not escape")

    monkeypatch.setattr(workspace_module, "workspace_revision", always_busy)
    response = client.get(f"/api/v1/workspaces/{workspace_id}/metadata", headers=headers)

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "workspace_busy",
        "message": "The workspace changed while it was being read; retry the operation.",
    }
    assert str(tmp_path) not in response.text


def test_workspace_api_rejects_path_traversal(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers = paired_headers(client, origin_headers)
    opened = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(tmp_path)},
    )
    assert opened.status_code == 200
    workspace_id = opened.json()["workspace_id"]

    response = client.post(
        "/api/v1/workspaces/resolve",
        headers=headers,
        json={"workspace_id": workspace_id, "relative_path": "../outside.json"},
    )
    assert response.status_code == 400


def test_atomic_write_spike_endpoint(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers = paired_headers(client, origin_headers)
    opened = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(tmp_path)},
    )
    workspace_id = opened.json()["workspace_id"]

    response = client.post(
        "/api/v1/spikes/atomic-write-test",
        headers=headers,
        json={"workspace_id": workspace_id},
    )
    assert response.status_code == 200
    assert response.json()["interrupted_write_preserved_prior_file"] is True
