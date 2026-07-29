from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from conftest import VALID_ORIGIN
from test_task3e_paper_records import create_workspace_with_projects, paper_record, write_paper

PDF_BYTES = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"


def create_paper(client: TestClient, tmp_path: Path) -> tuple[dict[str, str], Path, str, str, str]:
    headers, workspace_path, workspace_id = create_workspace_with_projects(client, tmp_path)
    created = write_paper(
        client,
        headers,
        workspace_id,
        paper_record("paper-pdf", "project-paper-a"),
        parent_id="project-paper-a",
    )
    assert created.status_code == 200, created.text
    return headers, workspace_path, workspace_id, "project-paper-a", created.json()["revision"]


def upload(
    client: TestClient,
    headers: dict[str, str],
    workspace_id: str,
    project_id: str,
    paper_id: str = "paper-pdf",
    *,
    content: bytes = PDF_BYTES,
    filename: str = "selected-paper.pdf",
    revision: str | None = None,
    replace: bool = False,
):
    query = {"replace": str(replace).lower()}
    if revision is not None:
        query["expected_revision"] = revision
    return client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/source-file",
        headers={**headers, "Content-Type": "application/pdf", "X-Original-Filename": filename},
        params=query,
        content=content,
    )


def test_pdf_import_is_project_scoped_durable_and_reopenable(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    imported = upload(client, headers, workspace_id, project_id, revision=revision)
    assert imported.status_code == 200, imported.text
    payload = imported.json()
    assert payload["source"]["original_filename"] == "selected-paper.pdf"
    assert payload["source"]["relative_path"] == "papers/paper-pdf/source/original.pdf"
    assert payload["paper"]["pdf_access_status"] == "pdf_ready"
    assert (workspace_path / "papers/paper-pdf/source/original.pdf").read_bytes() == PDF_BYTES
    assert (workspace_path / "papers/paper-pdf/source/source.json").is_file()

    source = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/source-file",
        headers=headers,
    )
    assert source.status_code == 200
    reopened = client.post(
        "/api/v1/workspaces/open", headers=headers, json={"path": str(workspace_path)}
    )
    assert reopened.status_code == 200
    source_after_reopen = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/source-file",
        headers=headers,
    )
    assert source_after_reopen.status_code == 200
    assert source_after_reopen.json()["source"]["sha256"] == payload["source"]["sha256"]
    (workspace_path / "papers/paper-pdf/source/original.pdf").write_bytes(PDF_BYTES + b"tampered")
    corrupted = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/source-file",
        headers=headers,
    )
    assert corrupted.status_code == 400
    assert "does not match" in corrupted.json()["detail"]


def test_pdf_import_requires_auth_origin_and_validates_file(
    client: TestClient, tmp_path: Path, monkeypatch
) -> None:
    headers, _workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    unauthenticated = upload(
        client,
        {"Origin": VALID_ORIGIN},
        workspace_id,
        project_id,
        revision=revision,
    )
    assert unauthenticated.status_code == 401
    invalid_origin = upload(
        client,
        {**headers, "Origin": "https://unconfigured.example"},
        workspace_id,
        project_id,
        revision=revision,
    )
    assert invalid_origin.status_code == 403
    invalid_signature = upload(
        client,
        headers,
        workspace_id,
        project_id,
        content=b"not a pdf",
        revision=revision,
    )
    assert invalid_signature.status_code == 400
    invalid_filename = upload(
        client,
        headers,
        workspace_id,
        project_id,
        filename="../escape.pdf",
        revision=revision,
    )
    assert invalid_filename.status_code == 400
    from research_intelligence_companion import app as app_module
    from research_intelligence_companion import workspace as workspace_module

    monkeypatch.setattr(app_module, "MAX_PDF_SIZE_BYTES", 5)
    monkeypatch.setattr(workspace_module, "MAX_PDF_SIZE_BYTES", 5)
    oversized = upload(
        client,
        headers,
        workspace_id,
        project_id,
        content=PDF_BYTES,
        revision=revision,
    )
    assert oversized.status_code == 413


def test_pdf_import_requires_explicit_replacement_and_rejects_stale_paper(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    first = upload(client, headers, workspace_id, project_id, revision=revision)
    assert first.status_code == 200, first.text
    no_replace = upload(
        client,
        headers,
        workspace_id,
        project_id,
        revision=first.json()["paper_revision"],
    )
    assert no_replace.status_code == 400
    stale = upload(client, headers, workspace_id, project_id, revision=revision)
    assert stale.status_code == 409
    replacement = upload(
        client,
        headers,
        workspace_id,
        project_id,
        content=PDF_BYTES + b"replacement",
        filename="replacement.pdf",
        revision=first.json()["paper_revision"],
        replace=True,
    )
    assert replacement.status_code == 200, replacement.text
    assert replacement.json()["source"]["original_filename"] == "replacement.pdf"


def test_pdf_import_failure_injection_recovers_old_or_new_state(
    client: TestClient, tmp_path: Path, monkeypatch
) -> None:
    headers, workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    first = upload(client, headers, workspace_id, project_id, revision=revision)
    assert first.status_code == 200
    replacement_revision = first.json()["paper_revision"]
    app_workspace = client.app.state.task0_state.workspace_roots[workspace_id]
    from research_intelligence_companion import workspace as workspace_module

    for point in (
        "before_pdf_replacement",
        "after_pdf_replacement_before_source",
        "during_source_replacement",
        "during_paper_replacement",
        "after_pdf_import_live_commit_before_marker",
        "during_pdf_import_cleanup",
    ):
        def inject(current: str, expected: str = point) -> None:
            if current == expected:
                raise RuntimeError(f"injected {current}")

        monkeypatch.setattr(workspace_module, "_transaction_fault_injector", inject)
        response = upload(
            client,
            headers,
            workspace_id,
            project_id,
            content=PDF_BYTES + point.encode(),
            filename=f"{point}.pdf",
            revision=replacement_revision,
            replace=True,
        )
        expected_status = 200 if point == "during_pdf_import_cleanup" else 400
        assert response.status_code == expected_status
        monkeypatch.setattr(workspace_module, "_transaction_fault_injector", None)
        reopened = client.post(
            "/api/v1/workspaces/open", headers=headers, json={"path": str(workspace_path)}
        )
        assert reopened.status_code == 200
        source = client.get(
            f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/source-file",
            headers=headers,
        )
        assert source.status_code == 200
        assert source.json()["source"]["original_filename"] in {
            "selected-paper.pdf",
            f"{point}.pdf",
        }
        replacement_revision = client.get(
            f"/api/v1/workspaces/{workspace_id}/records/papers/paper-pdf", headers=headers
        ).json()["revision"]
    assert (app_workspace / "papers/paper-pdf/source/original.pdf").is_file()
