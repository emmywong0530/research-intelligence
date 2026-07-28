from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from conftest import VALID_ORIGIN, paired_headers

TIMESTAMP = "2026-07-19T12:00:00Z"


def project_record(project_id: str) -> dict[str, object]:
    return {
        "schema_version": "m2.v1",
        "project_id": project_id,
        "name": f"Project {project_id}",
        "natural_language_research_idea": "Understand paper metadata persistence.",
        "central_research_question": "Can metadata remain project-scoped?",
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def paper_record(
    paper_id: str, project_id: str, *, title: str = "Metadata paper"
) -> dict[str, object]:
    return {
        "schema_version": "m2.v1",
        "paper_id": paper_id,
        "title": title,
        "authors": ["A. Researcher", "B. Scholar"],
        "year": 2024,
        "publication_venue": "Journal of Local Research",
        "doi": "10.1234/example",
        "abstract": "A manually supplied abstract.",
        "pdf_access_status": "unavailable",
        "assigned_project_ids": [project_id],
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def create_workspace_with_projects(
    client: TestClient, tmp_path: Path
) -> tuple[dict[str, str], Path, str]:
    headers = paired_headers(client, {"Origin": VALID_ORIGIN})
    workspace_path = tmp_path / "task3e-workspace"
    created = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(workspace_path), "name": "Task 3E Workspace"},
    )
    assert created.status_code == 200, created.text
    workspace_id = created.json()["workspace_id"]
    for project_id in ("project-paper-a", "project-paper-b"):
        response = client.put(
            f"/api/v1/workspaces/{workspace_id}/records/projects/{project_id}",
            headers=headers,
            json={"record": project_record(project_id)},
        )
        assert response.status_code == 200, response.text
    return headers, workspace_path, workspace_id


def write_paper(
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
        f"/api/v1/workspaces/{workspace_id}/records/papers/{record['paper_id']}",
        headers=headers,
        json=body,
    )


def test_paper_create_update_list_reopen_and_conflict_are_project_scoped(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id = create_workspace_with_projects(client, tmp_path)
    created = write_paper(
        client,
        headers,
        workspace_id,
        paper_record("paper-a", "project-paper-a"),
        parent_id="project-paper-a",
    )
    assert created.status_code == 200, created.text
    payload = created.json()
    assert payload["relative_path"] == "papers/paper-a/metadata.json"
    assert (workspace_path / "papers/paper-a/metadata.json").is_file()

    other = write_paper(
        client,
        headers,
        workspace_id,
        paper_record("paper-b", "project-paper-b"),
        parent_id="project-paper-b",
    )
    assert other.status_code == 200, other.text
    listed_a = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers?project_id=project-paper-a",
        headers=headers,
    )
    assert listed_a.status_code == 200
    assert [item["record_id"] for item in listed_a.json()["records"]] == ["paper-a"]

    updated_record = paper_record("paper-a", "project-paper-a", title="Updated metadata paper")
    updated = write_paper(
        client,
        headers,
        workspace_id,
        updated_record,
        parent_id="project-paper-a",
        expected_revision=payload["revision"],
    )
    assert updated.status_code == 200, updated.text
    stale = write_paper(
        client,
        headers,
        workspace_id,
        paper_record("paper-a", "project-paper-a", title="Stale overwrite"),
        parent_id="project-paper-a",
        expected_revision=payload["revision"],
    )
    assert stale.status_code == 409
    current = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-a", headers=headers
    )
    assert current.json()["record"]["title"] == "Updated metadata paper"

    reopened = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(workspace_path)},
    )
    assert reopened.status_code == 200
    assert reopened.json()["workspace_id"] == workspace_id
    reopened_read = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-a", headers=headers
    )
    assert reopened_read.status_code == 200
    assert reopened_read.json()["record"]["title"] == "Updated metadata paper"


def test_paper_association_and_schema_are_rejected_before_write(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id = create_workspace_with_projects(client, tmp_path)
    missing_parent = write_paper(
        client, headers, workspace_id, paper_record("paper-missing-parent", "project-paper-a")
    )
    assert missing_parent.status_code == 400
    mismatched_parent = write_paper(
        client,
        headers,
        workspace_id,
        paper_record("paper-mismatch", "project-paper-a"),
        parent_id="project-paper-b",
    )
    assert mismatched_parent.status_code == 400
    invalid_authors = paper_record("paper-invalid", "project-paper-a")
    invalid_authors["authors"] = []
    invalid = write_paper(
        client,
        headers,
        workspace_id,
        invalid_authors,
        parent_id="project-paper-a",
    )
    assert invalid.status_code == 400
    assert not (workspace_path / "papers/paper-invalid/metadata.json").exists()

    created = write_paper(
        client,
        headers,
        workspace_id,
        paper_record("paper-reassign", "project-paper-a"),
        parent_id="project-paper-a",
    )
    assert created.status_code == 200
    reassigned = write_paper(
        client,
        headers,
        workspace_id,
        paper_record("paper-reassign", "project-paper-b"),
        parent_id="project-paper-b",
        expected_revision=created.json()["revision"],
    )
    assert reassigned.status_code == 400


def test_paper_routes_require_authentication_and_exact_origin(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _, workspace_id = create_workspace_with_projects(client, tmp_path)
    unauthenticated = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers?project_id=project-paper-a",
        headers={"Origin": VALID_ORIGIN},
    )
    assert unauthenticated.status_code == 401
    invalid_origin = {**headers, "Origin": "https://unconfigured.example"}
    assert client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers?project_id=project-paper-a",
        headers=invalid_origin,
    ).status_code == 403
    missing_origin = {key: value for key, value in headers.items() if key.lower() != "origin"}
    assert client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers?project_id=project-paper-a",
        headers=missing_origin,
    ).status_code == 403
