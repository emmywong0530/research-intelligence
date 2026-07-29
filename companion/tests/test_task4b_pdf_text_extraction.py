from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from conftest import VALID_ORIGIN
from research_intelligence_companion import workspace as workspace_module
from test_task4a_pdf_import import create_paper, upload


def pdf_bytes(pages: list[str]) -> bytes:
    objects: list[str] = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids ["
        f"{' '.join(f'{3 + index * 2} 0 R' for index in range(len(pages)))}"
        f"] /Count {len(pages)} >>",
    ]
    font_id = 3 + len(pages) * 2
    for index, text in enumerate(pages):
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET"
        objects.append(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> "
            f"/Contents {4 + index * 2} 0 R >>"
        )
        objects.append(
            f"<< /Length {len(stream.encode('latin-1'))} >>\nstream\n{stream}\nendstream"
        )
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for object_number, value in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{object_number} 0 obj\n".encode("ascii"))
        output.extend(value.encode("latin-1"))
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        "trailer\n"
        f"<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n".encode(
            "ascii"
        )
    )
    return bytes(output)


def encrypted_pdf_bytes() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.encrypt("password")
    from io import BytesIO

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def extract(
    client: TestClient,
    headers: dict[str, str],
    workspace_id: str,
    project_id: str,
    paper_id: str,
    revision: str,
    *,
    reextract: bool = False,
):
    return client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/text-extraction",
        headers=headers,
        params={"expected_revision": revision, "reextract": str(reextract).lower()},
    )


def read_extraction(
    client: TestClient,
    headers: dict[str, str],
    workspace_id: str,
    project_id: str,
    paper_id: str,
):
    return client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/text-extraction",
        headers=headers,
    )


def test_extracts_deterministic_pages_persists_and_reopens(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    imported = upload(
        client,
        headers,
        workspace_id,
        project_id,
        content=pdf_bytes(["Page one café text", "Page two deterministic text"]),
        filename="known-text.pdf",
        revision=revision,
    )
    assert imported.status_code == 200, imported.text
    paper_revision = imported.json()["paper_revision"]
    not_run = read_extraction(client, headers, workspace_id, project_id, "paper-pdf")
    assert not_run.status_code == 200
    assert not_run.json()["status"] == "not_run"

    extracted = extract(client, headers, workspace_id, project_id, "paper-pdf", paper_revision)
    assert extracted.status_code == 200, extracted.text
    payload = extracted.json()
    assert payload["status"] == "completed"
    summary = payload["extraction"]
    assert summary["extraction_engine"] == "pypdf"
    assert summary["extraction_engine_version"] == "6.14.2"
    assert summary["page_count"] == 2
    assert summary["pages_with_text"] == 2
    assert summary["pages_without_text"] == 0
    assert summary["word_count"] == 8
    assert "pages" not in summary
    assert "full_text_relative_path" not in summary
    artifact = json.loads(
        (workspace_path / "papers/paper-pdf/extracted/text.json").read_text(encoding="utf-8")
    )
    assert artifact["pages"][0]["text"] == "Page one café text"
    assert artifact["pages"][1]["text"] == "Page two deterministic text"
    assert (workspace_path / "papers/paper-pdf/extracted/full.txt").is_file()

    reopened = client.post(
        "/api/v1/workspaces/open", headers=headers, json={"path": str(workspace_path)}
    )
    assert reopened.status_code == 200
    after_reopen = read_extraction(client, headers, workspace_id, project_id, "paper-pdf")
    assert after_reopen.status_code == 200
    assert after_reopen.json()["status"] == "completed"
    assert after_reopen.json()["extraction"]["extraction_id"] == summary["extraction_id"]


def test_extraction_is_auth_origin_and_scope_protected(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    imported = upload(client, headers, workspace_id, project_id, revision=revision)
    paper_revision = imported.json()["paper_revision"]
    unauthenticated = extract(
        client,
        {"Origin": VALID_ORIGIN},
        workspace_id,
        project_id,
        "paper-pdf",
        paper_revision,
    )
    assert unauthenticated.status_code == 401
    invalid_origin = read_extraction(
        client,
        {**headers, "Origin": "https://unconfigured.example"},
        workspace_id,
        project_id,
        "paper-pdf",
    )
    assert invalid_origin.status_code == 403
    missing_origin_headers = {
        key: value for key, value in headers.items() if key.lower() != "origin"
    }
    assert read_extraction(
        client, missing_origin_headers, workspace_id, project_id, "paper-pdf"
    ).status_code == 403
    mismatch = read_extraction(client, headers, workspace_id, "project-paper-b", "paper-pdf")
    assert mismatch.status_code == 400
    missing_source = read_extraction(client, headers, workspace_id, project_id, "missing-paper")
    assert missing_source.status_code == 404


def test_no_text_result_is_successful_and_does_not_claim_ocr(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    imported = upload(
        client,
        headers,
        workspace_id,
        project_id,
        content=pdf_bytes([""]),
        filename="blank-page.pdf",
        revision=revision,
    )
    extracted = extract(
        client, headers, workspace_id, project_id, "paper-pdf", imported.json()["paper_revision"]
    )
    assert extracted.status_code == 200, extracted.text
    summary = extracted.json()["extraction"]
    assert extracted.json()["status"] == "completed"
    assert summary["page_count"] == 1
    assert summary["pages_with_text"] == 0
    assert summary["pages_without_text"] == 1
    assert any("OCR was not run" in warning for warning in summary["warnings"])


def test_malformed_and_encrypted_pdfs_fail_without_partial_artifacts(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    malformed = upload(
        client,
        headers,
        workspace_id,
        project_id,
        content=b"%PDF-1.7\nnot a complete PDF",
        filename="malformed.pdf",
        revision=revision,
    )
    malformed_result = extract(
        client, headers, workspace_id, project_id, "paper-pdf", malformed.json()["paper_revision"]
    )
    assert malformed_result.status_code == 400
    assert malformed_result.json()["detail"]["code"] == "malformed_pdf"
    assert not (workspace_path / "papers/paper-pdf/extracted/text.json").exists()
    assert not list((workspace_path / ".research-intelligence/transactions").iterdir())

    encrypted = upload(
        client,
        headers,
        workspace_id,
        project_id,
        content=encrypted_pdf_bytes(),
        filename="encrypted.pdf",
        revision=malformed.json()["paper_revision"],
        replace=True,
    )
    encrypted_result = extract(
        client, headers, workspace_id, project_id, "paper-pdf", encrypted.json()["paper_revision"]
    )
    assert encrypted_result.status_code == 400
    assert encrypted_result.json()["detail"]["code"] == "encrypted_pdf"


def test_page_and_character_limits_reject_before_writing(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers, workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    imported = upload(
        client,
        headers,
        workspace_id,
        project_id,
        content=pdf_bytes(["one", "two"]),
        filename="two-pages.pdf",
        revision=revision,
    )
    monkeypatch.setattr(workspace_module, "MAX_EXTRACTION_PAGE_COUNT", 1)
    page_limited = extract(
        client, headers, workspace_id, project_id, "paper-pdf", imported.json()["paper_revision"]
    )
    assert page_limited.status_code == 413
    assert page_limited.json()["detail"]["code"] == "page_limit_exceeded"
    assert not (workspace_path / "papers/paper-pdf/extracted/text.json").exists()

    monkeypatch.setattr(workspace_module, "MAX_EXTRACTION_PAGE_COUNT", 500)
    monkeypatch.setattr(workspace_module, "MAX_EXTRACTED_CHARACTER_COUNT", 2)
    character_limited = extract(
        client, headers, workspace_id, project_id, "paper-pdf", imported.json()["paper_revision"]
    )
    assert character_limited.status_code == 413
    assert character_limited.json()["detail"]["code"] == "character_limit_exceeded"
    assert not (workspace_path / "papers/paper-pdf/extracted/text.json").exists()


def test_reextract_is_explicit_stale_safe_and_recoverable(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers, workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    first = upload(
        client,
        headers,
        workspace_id,
        project_id,
        content=pdf_bytes(["first source text"]),
        filename="first.pdf",
        revision=revision,
    )
    first_extract = extract(
        client, headers, workspace_id, project_id, "paper-pdf", first.json()["paper_revision"]
    )
    assert first_extract.status_code == 200
    first_id = first_extract.json()["extraction"]["extraction_id"]
    second = upload(
        client,
        headers,
        workspace_id,
        project_id,
        content=pdf_bytes(["second source text"]),
        filename="second.pdf",
        revision=first.json()["paper_revision"],
        replace=True,
    )
    current_revision = second.json()["paper_revision"]
    stale = read_extraction(client, headers, workspace_id, project_id, "paper-pdf")
    assert stale.status_code == 200
    assert stale.json()["status"] == "stale"
    assert stale.json()["extraction"]["extraction_id"] == first_id
    required = extract(
        client, headers, workspace_id, project_id, "paper-pdf", current_revision
    )
    assert required.status_code == 409
    assert required.json()["detail"]["code"] == "reextract_required"

    def inject(point: str) -> None:
        if point == "after_extraction_text_replacement_before_full":
            raise RuntimeError("injected extraction replacement failure")

    monkeypatch.setattr(workspace_module, "_transaction_fault_injector", inject)
    failed = extract(
        client,
        headers,
        workspace_id,
        project_id,
        "paper-pdf",
        current_revision,
        reextract=True,
    )
    assert failed.status_code == 400
    monkeypatch.setattr(workspace_module, "_transaction_fault_injector", None)
    reopened = client.post(
        "/api/v1/workspaces/open", headers=headers, json={"path": str(workspace_path)}
    )
    assert reopened.status_code == 200
    preserved = read_extraction(client, headers, workspace_id, project_id, "paper-pdf")
    assert preserved.status_code == 200
    assert preserved.json()["status"] == "stale"
    assert preserved.json()["extraction"]["extraction_id"] == first_id

    completed = extract(
        client,
        headers,
        workspace_id,
        project_id,
        "paper-pdf",
        current_revision,
        reextract=True,
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    assert completed.json()["extraction"]["extraction_id"] != first_id
    assert completed.json()["extraction"]["text_preview"] == "second source text"


def test_source_symlink_is_rejected_for_extraction(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    imported = upload(client, headers, workspace_id, project_id, revision=revision)
    pdf_path = workspace_path / "papers/paper-pdf/source/original.pdf"
    replacement = workspace_path / "papers/paper-pdf/source/real.pdf"
    replacement.write_bytes(pdf_path.read_bytes())
    pdf_path.unlink()
    try:
        pdf_path.symlink_to(replacement)
    except OSError:
        pytest.skip("Symlink creation is unavailable in this environment.")
    response = extract(
        client, headers, workspace_id, project_id, "paper-pdf", imported.json()["paper_revision"]
    )
    assert response.status_code == 400
