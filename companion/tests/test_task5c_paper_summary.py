from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient

from conftest import VALID_ORIGIN
from research_intelligence_companion import workspace as workspace_module
from test_task3e_paper_records import paper_record, write_paper
from test_task4a_pdf_import import create_paper, upload
from test_task4b_pdf_text_extraction import extract, pdf_bytes


def summary_client(client: TestClient) -> TestClient:
    runtime = client.app.state.task0_state.provider_runtime
    runtime.test_mode = True
    runtime.processing_scenario = "success"
    return client


def prepared_paper(client: TestClient, tmp_path: Path) -> tuple[dict[str, str], str, str, str]:
    headers, _workspace_path, workspace_id, project_id, revision = create_paper(client, tmp_path)
    configured = client.put(
        "/api/v1/ai/provider/config",
        headers=headers,
        json={
            "provider": "openai",
            "model": "gpt-4o-mini",
            "timeout_seconds": 15,
            "max_retries": 0,
            "enabled": True,
        },
    )
    assert configured.status_code == 200, configured.text
    imported = upload(
        client,
        headers,
        workspace_id,
        project_id,
        content=pdf_bytes(
            [
                "This is a local extracted paper introduction about advice and decision support.",
                "The second page describes a bounded deterministic study and its limitations.",
            ]
        ),
        filename="summary-paper.pdf",
        revision=revision,
    )
    assert imported.status_code == 200, imported.text
    extracted = extract(
        client, headers, workspace_id, project_id, "paper-pdf", imported.json()["paper_revision"]
    )
    assert extracted.status_code == 200, extracted.text
    return headers, workspace_id, project_id, imported.json()["paper_revision"]


def wait_for_terminal(
    client: TestClient,
    headers: dict[str, str],
    workspace_id: str,
    project_id: str,
    paper_id: str,
    processing_id: str,
) -> dict[str, object]:
    for _ in range(50):
        response = client.get(
            f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/records/{processing_id}",
            headers=headers,
        )
        assert response.status_code == 200, response.text
        record = response.json()["record"]
        if record["status"] in {"completed", "failed", "cancelled"}:
            return record
        time.sleep(0.03)
    raise AssertionError("paper summary did not reach a terminal state")


def test_summary_is_explicit_durable_scoped_and_cacheable(
    client: TestClient, tmp_path: Path
) -> None:
    summary_client(client)
    headers, workspace_id, project_id, paper_revision = prepared_paper(client, tmp_path)
    preflight = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/preflight",
        headers=headers,
    )
    assert preflight.status_code == 200, preflight.text
    assert preflight.json()["eligible"] is True
    assert preflight.json()["source_type"] == "local_extracted_text"
    assert "summary_input" not in preflight.text
    assert "original_filename" not in preflight.text

    started = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/start",
        headers=headers,
        json={"expected_paper_revision": paper_revision},
    )
    assert started.status_code == 200, started.text
    record = wait_for_terminal(
        client,
        headers,
        workspace_id,
        project_id,
        "paper-pdf",
        started.json()["record"]["processing_id"],
    )
    assert record["status"] == "completed"
    assert record["operation_id"] == "paper_summary"
    assert record["source_snapshot"]["source_type"] == "paper_extraction"
    assert record["output"]["contract_id"] == "paper-summary.v1"
    assert "This is a local extracted paper" not in str(record)

    cached = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/start",
        headers=headers,
        json={"expected_paper_revision": paper_revision},
    )
    assert cached.status_code == 200
    assert cached.json()["record"]["cache_disposition"] == "cache_hit"
    history = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/records",
        headers=headers,
    )
    assert history.status_code == 200
    assert len(history.json()["records"]) == 2


def test_summary_start_returns_queued_record_and_exact_record_completes(
    client: TestClient, tmp_path: Path
) -> None:
    summary_client(client)
    headers, workspace_id, project_id, paper_revision = prepared_paper(client, tmp_path)
    client.app.state.task0_state.provider_runtime.processing_scenario = "delayed"

    started_at = time.perf_counter()
    started = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/start",
        headers=headers,
        json={"expected_paper_revision": paper_revision},
    )
    elapsed = time.perf_counter() - started_at

    assert started.status_code == 200, started.text
    assert elapsed < 5.0
    assert started.json()["record"]["status"] == "queued"
    processing_id = started.json()["record"]["processing_id"]
    completed = wait_for_terminal(
        client,
        headers,
        workspace_id,
        project_id,
        "paper-pdf",
        processing_id,
    )
    assert completed["processing_id"] == processing_id
    assert completed["status"] == "completed"


def test_summary_source_changes_mark_old_result_stale_and_conflicts_are_safe(
    client: TestClient, tmp_path: Path
) -> None:
    summary_client(client)
    headers, workspace_id, project_id, paper_revision = prepared_paper(client, tmp_path)
    first = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/start",
        headers=headers,
        json={"expected_paper_revision": paper_revision},
    )
    assert first.status_code == 200, first.text
    wait_for_terminal(
        client,
        headers,
        workspace_id,
        project_id,
        "paper-pdf",
        first.json()["record"]["processing_id"],
    )

    stale = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/start",
        headers=headers,
        json={"expected_paper_revision": "0" * 64},
    )
    assert stale.status_code == 409
    updated = paper_record("paper-pdf", project_id, title="Changed summary metadata")
    changed = write_paper(
        client,
        headers,
        workspace_id,
        updated,
        parent_id=project_id,
        expected_revision=paper_revision,
    )
    assert changed.status_code == 200, changed.text
    next_start = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/start",
        headers=headers,
        json={"expected_paper_revision": changed.json()["revision"]},
    )
    assert next_start.status_code == 200
    old = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/records/{first.json()['record']['processing_id']}",
        headers=headers,
    ).json()["record"]
    assert old["stale"] is True


def test_summary_rejects_invalid_output_requires_auth_and_exact_origin(
    client: TestClient, tmp_path: Path
) -> None:
    summary_client(client)
    headers, workspace_id, project_id, paper_revision = prepared_paper(client, tmp_path)
    scenario = client.post(
        "/api/v1/ai/processing/test-scenario",
        headers=headers,
        json={"scenario": "invalid_output"},
    )
    assert scenario.status_code == 200
    failed = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/start",
        headers=headers,
        json={"expected_paper_revision": paper_revision},
    )
    assert failed.status_code == 200, failed.text
    record = wait_for_terminal(
        client,
        headers,
        workspace_id,
        project_id,
        "paper-pdf",
        failed.json()["record"]["processing_id"],
    )
    assert record["status"] == "failed"
    assert record["error"]["category"] == "invalid_output"
    assert record["error"]["message"] == (
        "The provider returned an unsupported paper summary contract."
    )
    assert record["cache_disposition"] == "cache_miss"
    assert "unexpected" not in str(record)
    success_scenario = client.post(
        "/api/v1/ai/processing/test-scenario",
        headers=headers,
        json={"scenario": "success"},
    )
    assert success_scenario.status_code == 200
    retry = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/records/{record['processing_id']}/retry",
        headers=headers,
    )
    assert retry.status_code == 200, retry.text
    retried = wait_for_terminal(
        client,
        headers,
        workspace_id,
        project_id,
        "paper-pdf",
        retry.json()["record"]["processing_id"],
    )
    assert retried["status"] == "completed"
    assert retried["output"]["contract_id"] == "paper-summary.v1"
    history = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/records",
        headers=headers,
    )
    assert history.status_code == 200
    history_records = history.json()["records"]
    assert {item["record"]["status"] for item in history_records} >= {
        "failed",
        "completed",
    }
    assert {item["record"]["processing_id"] for item in history_records} >= {
        record["processing_id"],
        retried["processing_id"],
    }
    assert client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/preflight",
        headers={"Origin": VALID_ORIGIN},
    ).status_code == 401
    assert client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/preflight",
        headers={**headers, "Origin": "https://unconfigured.example"},
    ).status_code == 403


def test_summary_preflight_retries_during_processing_record_replacement(
    client: TestClient, tmp_path: Path, monkeypatch
) -> None:
    summary_client(client)
    headers, workspace_id, project_id, paper_revision = prepared_paper(client, tmp_path)
    started = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/start",
        headers=headers,
        json={"expected_paper_revision": paper_revision},
    )
    assert started.status_code == 200, started.text
    processing_id = started.json()["record"]["processing_id"]
    wait_for_terminal(client, headers, workspace_id, project_id, "paper-pdf", processing_id)
    root = client.app.state.task0_state.workspace_roots[workspace_id]
    processing_path = root / "activity" / "processing" / f"{processing_id}.json"
    original_sha256_file = workspace_module.sha256_file
    replaced = False

    def replace_processing_record_once(path: Path) -> str:
        nonlocal replaced
        if path == processing_path and not replaced:
            replaced = True
            _bytes = path.read_bytes()
            workspace_module._atomic_write_bytes(path, _bytes)
        return original_sha256_file(path)

    monkeypatch.setattr(workspace_module, "sha256_file", replace_processing_record_once)

    preflight = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/preflight",
        headers=headers,
    )

    assert preflight.status_code == 200, preflight.text
    assert replaced is True
