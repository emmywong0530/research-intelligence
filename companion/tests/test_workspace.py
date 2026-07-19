from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import paired_headers
from research_intelligence_companion.models import SCHEMA_VERSION
from research_intelligence_companion.workspace import (
    WorkspaceError,
    atomic_write_json,
    resolve_under_workspace,
    sha256_file,
    simulate_interrupted_write,
)


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


def test_workspace_api_rejects_path_traversal(
    client: TestClient, tmp_path: Path, origin_headers: dict[str, str]
) -> None:
    headers = paired_headers(client, origin_headers)
    opened = client.post(
        "/api/v1/workspaces/open",
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
        "/api/v1/workspaces/open",
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
