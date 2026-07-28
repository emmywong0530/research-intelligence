from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from conftest import VALID_ORIGIN, paired_headers

TIMESTAMP = "2026-07-28T12:00:00Z"


def project_record(project_id: str) -> dict[str, object]:
    return {
        "schema_version": "m2.v1",
        "project_id": project_id,
        "name": f"Project {project_id}",
        "natural_language_research_idea": "Keep local notes durable.",
        "central_research_question": "Can notes stay scoped and recoverable?",
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def paper_record(paper_id: str, project_id: str) -> dict[str, object]:
    return {
        "schema_version": "m2.v1",
        "paper_id": paper_id,
        "title": "A paper with notes",
        "authors": ["A. Researcher"],
        "pdf_access_status": "unavailable",
        "assigned_project_ids": [project_id],
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def note_record(
    note_id: str,
    scope_type: str,
    project_id: str,
    *,
    paper_id: str | None = None,
    title: str = "A durable note",
) -> dict[str, object]:
    record: dict[str, object] = {
        "schema_version": "m3f.v1",
        "note_id": note_id,
        "scope_type": scope_type,
        "project_id": project_id,
        "title": title,
        "body": "A plain-text observation that should survive reopen.",
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }
    if paper_id is not None:
        record["paper_id"] = paper_id
    return record


def setup_workspace(client: TestClient, tmp_path: Path) -> tuple[dict[str, str], Path, str]:
    headers = paired_headers(client, {"Origin": VALID_ORIGIN})
    workspace_path = tmp_path / "task3f-workspace"
    created = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(workspace_path), "name": "Task 3F Workspace"},
    )
    assert created.status_code == 200, created.text
    workspace_id = created.json()["workspace_id"]
    for project_id in ("project-notes-a", "project-notes-b"):
        response = client.put(
            f"/api/v1/workspaces/{workspace_id}/records/projects/{project_id}",
            headers=headers,
            json={"record": project_record(project_id)},
        )
        assert response.status_code == 200, response.text
    paper = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-notes-a",
        headers=headers,
        json={
            "record": paper_record("paper-notes-a", "project-notes-a"),
            "parent_id": "project-notes-a",
        },
    )
    assert paper.status_code == 200, paper.text
    return headers, workspace_path, workspace_id


def write_note(
    client: TestClient,
    headers: dict[str, str],
    workspace_id: str,
    record: dict[str, object],
    *,
    parent_id: str | None = None,
    expected_revision: str | None = None,
):
    body: dict[str, object] = {"record": record}
    if parent_id is not None:
        body["parent_id"] = parent_id
    if expected_revision is not None:
        body["expected_revision"] = expected_revision
    return client.put(
        f"/api/v1/workspaces/{workspace_id}/records/notes/{record['note_id']}",
        headers=headers,
        json=body,
    )


def test_project_and_paper_notes_persist_with_server_side_scope_filters(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id = setup_workspace(client, tmp_path)
    project_note = write_note(
        client,
        headers,
        workspace_id,
        note_record("note-project-a", "project", "project-notes-a"),
        parent_id="project-notes-a",
    )
    assert project_note.status_code == 200, project_note.text
    assert (
        project_note.json()["relative_path"] == "projects/project-notes-a/notes/note-project-a.json"
    )
    paper_note = write_note(
        client,
        headers,
        workspace_id,
        note_record("note-paper-a", "paper", "project-notes-a", paper_id="paper-notes-a"),
        parent_id="paper-notes-a",
    )
    assert paper_note.status_code == 200, paper_note.text
    assert paper_note.json()["relative_path"] == "papers/paper-notes-a/notes/note-paper-a.json"
    assert (workspace_path / "projects/project-notes-a/notes/note-project-a.json").is_file()
    assert (workspace_path / "papers/paper-notes-a/notes/note-paper-a.json").is_file()

    project_notes = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/notes?project_id=project-notes-a&scope_type=project",
        headers=headers,
    )
    assert project_notes.status_code == 200
    assert [item["record_id"] for item in project_notes.json()["records"]] == ["note-project-a"]
    paper_notes = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/notes?project_id=project-notes-a&paper_id=paper-notes-a&scope_type=paper",
        headers=headers,
    )
    assert paper_notes.status_code == 200
    assert [item["record_id"] for item in paper_notes.json()["records"]] == ["note-paper-a"]
    unscoped_notes = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/notes", headers=headers
    )
    assert unscoped_notes.status_code == 400

    reopened = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(workspace_path)},
    )
    assert reopened.status_code == 200
    assert reopened.json()["workspace_id"] == workspace_id
    read_back = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/notes/note-paper-a",
        headers=headers,
    )
    assert read_back.status_code == 200
    assert read_back.json()["record"]["scope_type"] == "paper"


def test_note_association_schema_and_stale_revision_are_rejected(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id = setup_workspace(client, tmp_path)
    missing_parent = write_note(
        client,
        headers,
        workspace_id,
        note_record("note-missing-parent", "project", "project-notes-a"),
    )
    assert missing_parent.status_code == 400

    invalid_scope = note_record("note-invalid-scope", "project", "project-notes-a")
    invalid_scope["scope_type"] = "workspace"
    assert (
        write_note(
            client, headers, workspace_id, invalid_scope, parent_id="project-notes-a"
        ).status_code
        == 400
    )
    invalid_body = note_record("note-invalid-body", "project", "project-notes-a")
    invalid_body["body"] = ""
    invalid = write_note(client, headers, workspace_id, invalid_body, parent_id="project-notes-a")
    assert invalid.status_code == 400
    assert not (workspace_path / "projects/project-notes-a/notes/note-invalid-body.json").exists()

    cross_project = note_record(
        "note-cross-project", "paper", "project-notes-b", paper_id="paper-notes-a"
    )
    assert (
        write_note(
            client, headers, workspace_id, cross_project, parent_id="paper-notes-a"
        ).status_code
        == 400
    )

    created = write_note(
        client,
        headers,
        workspace_id,
        note_record("note-revision", "project", "project-notes-a"),
        parent_id="project-notes-a",
    )
    assert created.status_code == 200
    current = note_record("note-revision", "project", "project-notes-a", title="Current note")
    updated = write_note(
        client,
        headers,
        workspace_id,
        current,
        parent_id="project-notes-a",
        expected_revision=created.json()["revision"],
    )
    assert updated.status_code == 200
    stale = note_record("note-revision", "project", "project-notes-a", title="Stale overwrite")
    conflict = write_note(
        client,
        headers,
        workspace_id,
        stale,
        parent_id="project-notes-a",
        expected_revision=created.json()["revision"],
    )
    assert conflict.status_code == 409
    assert (
        client.get(
            f"/api/v1/workspaces/{workspace_id}/records/notes/note-revision", headers=headers
        ).json()["record"]["title"]
        == "Current note"
    )


def test_note_routes_require_authentication_and_exact_origin(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _, workspace_id = setup_workspace(client, tmp_path)
    unauthenticated = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/notes?project_id=project-notes-a",
        headers={"Origin": VALID_ORIGIN},
    )
    assert unauthenticated.status_code == 401
    invalid_origin = {**headers, "Origin": "https://unconfigured.example"}
    assert (
        client.get(
            f"/api/v1/workspaces/{workspace_id}/records/notes?project_id=project-notes-a",
            headers=invalid_origin,
        ).status_code
        == 403
    )
    missing_origin = {key: value for key, value in headers.items() if key.lower() != "origin"}
    assert (
        client.get(
            f"/api/v1/workspaces/{workspace_id}/records/notes?project_id=project-notes-a",
            headers=missing_origin,
        ).status_code
        == 403
    )
