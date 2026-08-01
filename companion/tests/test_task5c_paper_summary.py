from __future__ import annotations

import asyncio
import threading
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
    assert record["output"]["summary"] == (
        "Deterministic test summary prepared from the approved local extraction."
    )
    assert set(record["output"]) == {
        "contract_id",
        "summary",
        "key_points",
        "limitations",
        "open_questions",
    }
    assert len(record["output"]["key_points"]) == 2
    assert len(record["output"]["limitations"]) == 1
    assert len(record["output"]["open_questions"]) == 1
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


def test_late_summary_completion_preserves_stale_source_marker(
    client: TestClient, tmp_path: Path, monkeypatch
) -> None:
    summary_client(client)
    headers, workspace_id, project_id, paper_revision = prepared_paper(client, tmp_path)
    runtime = client.app.state.task0_state.provider_runtime
    started_generating = threading.Event()
    release_generation = threading.Event()
    original_generate = runtime.generate

    async def blocked_generate(request):  # type: ignore[no-untyped-def]
        started_generating.set()
        if not await asyncio.to_thread(release_generation.wait, 5):
            raise AssertionError("test provider generation was not released")
        return await original_generate(request)

    monkeypatch.setattr(runtime, "generate", blocked_generate)
    first = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/start",
        headers=headers,
        json={"expected_paper_revision": paper_revision},
    )
    assert first.status_code == 200, first.text
    first_id = first.json()["record"]["processing_id"]
    assert started_generating.wait(timeout=5)

    current = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-pdf", headers=headers
    )
    assert current.status_code == 200, current.text
    changed = write_paper(
        client,
        headers,
        workspace_id,
        paper_record("paper-pdf", project_id, title="Changed while summary was running"),
        parent_id=project_id,
        expected_revision=current.json()["revision"],
    )
    assert changed.status_code == 200, changed.text
    second = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/start",
        headers=headers,
        json={"expected_paper_revision": changed.json()["revision"]},
    )
    assert second.status_code == 200, second.text
    second_id = second.json()["record"]["processing_id"]
    assert second_id != first_id
    release_generation.set()

    first_record = wait_for_terminal(
        client, headers, workspace_id, project_id, "paper-pdf", first_id
    )
    second_record = wait_for_terminal(
        client, headers, workspace_id, project_id, "paper-pdf", second_id
    )
    assert first_record["status"] == "completed"
    assert first_record["stale"] is True
    assert second_record["status"] == "completed"
    assert second_record["stale"] is False


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
    retry_started_at = time.perf_counter()
    retry = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/records/{record['processing_id']}/retry",
        headers=headers,
    )
    retry_elapsed = time.perf_counter() - retry_started_at
    assert retry.status_code == 200, retry.text
    retry_payload = retry.json()
    assert retry_payload["record"]["status"] == "queued"
    assert retry_payload["record"]["processing_id"] != record["processing_id"]
    assert retry_payload["record"]["retry_of_processing_id"] == record["processing_id"]
    assert retry_payload["record"]["cache_disposition"] == "cache_miss"
    assert retry_elapsed < 5.0
    retried = wait_for_terminal(
        client,
        headers,
        workspace_id,
        project_id,
        "paper-pdf",
        retry_payload["record"]["processing_id"],
    )
    assert retried["status"] == "completed"
    assert retried["output"]["contract_id"] == "paper-summary.v1"
    assert retried["retry_of_processing_id"] == record["processing_id"]
    assert retried["cache_disposition"] == "cache_miss"
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
    preserved_failed = next(
        item["record"]
        for item in history_records
        if item["record"]["processing_id"] == record["processing_id"]
    )
    assert preserved_failed["status"] == "failed"
    assert preserved_failed["error"]["category"] == "invalid_output"
    assert client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/preflight",
        headers={"Origin": VALID_ORIGIN},
    ).status_code == 401
    assert client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/preflight",
        headers={**headers, "Origin": "https://unconfigured.example"},
    ).status_code == 403


def test_cancelled_summary_retry_preserves_cancelled_record_and_creates_completed_record(
    client: TestClient, tmp_path: Path
) -> None:
    summary_client(client)
    headers, workspace_id, project_id, paper_revision = prepared_paper(client, tmp_path)
    delayed_scenario = client.post(
        "/api/v1/ai/processing/test-scenario",
        headers=headers,
        json={"scenario": "delayed"},
    )
    assert delayed_scenario.status_code == 200
    started = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/start",
        headers=headers,
        json={"expected_paper_revision": paper_revision},
    )
    assert started.status_code == 200, started.text
    original_id = started.json()["record"]["processing_id"]
    cancelled = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/records/{original_id}/cancel",
        headers=headers,
    )
    assert cancelled.status_code == 200, cancelled.text
    original = wait_for_terminal(
        client, headers, workspace_id, project_id, "paper-pdf", original_id
    )
    assert original["status"] == "cancelled"
    assert original["cache_disposition"] == "cache_miss"

    success_scenario = client.post(
        "/api/v1/ai/processing/test-scenario",
        headers=headers,
        json={"scenario": "success"},
    )
    assert success_scenario.status_code == 200
    retry = client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/records/{original_id}/retry",
        headers=headers,
    )
    assert retry.status_code == 200, retry.text
    retry_record = retry.json()["record"]
    assert retry_record["processing_id"] != original_id
    assert retry_record["retry_of_processing_id"] == original_id
    assert retry_record["cache_disposition"] == "cache_miss"

    completed = wait_for_terminal(
        client,
        headers,
        workspace_id,
        project_id,
        "paper-pdf",
        retry_record["processing_id"],
    )
    assert completed["status"] == "completed"
    assert completed["retry_of_processing_id"] == original_id
    assert completed["cache_disposition"] == "cache_miss"
    history = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/records",
        headers=headers,
    )
    assert history.status_code == 200, history.text
    history_by_id = {
        item["record"]["processing_id"]: item["record"] for item in history.json()["records"]
    }
    assert history_by_id[original_id]["status"] == "cancelled"
    assert history_by_id[retry_record["processing_id"]]["status"] == "completed"
    assert history_by_id[retry_record["processing_id"]]["retry_of_processing_id"] == original_id


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


def test_summary_preflight_retries_transient_paper_metadata_disappearance(
    client: TestClient, tmp_path: Path, monkeypatch
) -> None:
    summary_client(client)
    headers, workspace_id, project_id, _paper_revision = prepared_paper(client, tmp_path)
    workspace_path = client.app.state.task0_state.workspace_roots[workspace_id]
    target = workspace_path / "papers" / "paper-pdf" / "metadata.json"
    original_read_json = workspace_module._read_json
    disappeared = False

    def disappear_once(path: Path) -> dict[str, object]:
        nonlocal disappeared
        if path == target and not disappeared:
            disappeared = True
            raise FileNotFoundError(2, "metadata replaced while opening", str(path))
        return original_read_json(path)

    monkeypatch.setattr(workspace_module, "_read_json", disappear_once)

    response = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/preflight",
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert disappeared is True
    assert response.json()["eligible"] is True


def test_summary_preflight_maps_persistent_metadata_disappearance_without_traceback(
    client: TestClient, tmp_path: Path, monkeypatch
) -> None:
    summary_client(client)
    headers, workspace_id, project_id, _paper_revision = prepared_paper(client, tmp_path)
    workspace_path = client.app.state.task0_state.workspace_roots[workspace_id]
    target = workspace_path / "papers" / "paper-pdf" / "metadata.json"
    original_read_json = workspace_module._read_json
    read_attempts = 0

    def always_missing(path: Path) -> dict[str, object]:
        nonlocal read_attempts
        if path.name == target.name and path.parent.name == target.parent.name:
            read_attempts += 1
            raise FileNotFoundError(2, "metadata remains unavailable", str(path))
        return original_read_json(path)

    monkeypatch.setattr(workspace_module, "_read_json", always_missing)

    response = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/preflight",
        headers=headers,
    )

    assert read_attempts > 0
    assert response.status_code == 409, response.text
    assert "metadata.json" not in response.text
    assert str(workspace_path) not in response.text
    assert "Traceback" not in response.text


def test_summary_preflight_missing_paper_is_bounded_not_found_state(
    client: TestClient, tmp_path: Path
) -> None:
    summary_client(client)
    headers, workspace_id, project_id, _paper_revision = prepared_paper(client, tmp_path)

    response = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/missing-paper/ai-summary/preflight",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["eligible"] is False
    assert response.json()["reason_code"] == "paper_missing"
    assert str(client.app.state.task0_state.workspace_roots[workspace_id]) not in response.text
    assert "Traceback" not in response.text


def test_summary_preflight_retries_when_paper_revision_changes_during_source_read(
    client: TestClient, tmp_path: Path, monkeypatch
) -> None:
    summary_client(client)
    headers, workspace_id, project_id, _paper_revision = prepared_paper(client, tmp_path)
    workspace_path = client.app.state.task0_state.workspace_roots[workspace_id]
    paper_path = workspace_path / "papers" / "paper-pdf" / "metadata.json"
    original_sha256_file = workspace_module.sha256_file
    paper_reads = 0

    def report_one_unstable_paper_revision(path: Path) -> str:
        nonlocal paper_reads
        if path == paper_path:
            paper_reads += 1
            if paper_reads == 2:
                return "a" * 64
        return original_sha256_file(path)

    monkeypatch.setattr(workspace_module, "sha256_file", report_one_unstable_paper_revision)

    response = client.get(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/paper-pdf/ai-summary/preflight",
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert paper_reads >= 4
    assert response.json()["eligible"] is True
