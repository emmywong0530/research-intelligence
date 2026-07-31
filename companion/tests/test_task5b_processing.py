from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from research_intelligence_companion import workspace as workspace_module
from research_intelligence_companion.app import create_app
from research_intelligence_companion.settings import CompanionSettings
from research_intelligence_companion.workspace import open_workspace, write_record

ORIGIN = "http://127.0.0.1:4173"


@pytest.fixture
def processing_client(tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RI_AI_TEST_MODE", "1")
    monkeypatch.setenv("RI_AI_TEST_CREDENTIAL_STORE", "memory")
    monkeypatch.setenv("RI_DEVICE_DATA_ROOT", str(tmp_path_factory.mktemp("task5b-device")))
    monkeypatch.setenv(
        "RI_SCHEMA_ROOT",
        str(Path(__file__).resolve().parents[2] / "packages/schemas"),
    )
    with TestClient(
        create_app(CompanionSettings(host="127.0.0.1", allowed_origins=(ORIGIN,)))
    ) as test_client:
        yield test_client


def paired_headers(client: TestClient) -> dict[str, str]:
    headers = {"Origin": ORIGIN}
    started = client.post("/api/v1/pairing/start", headers=headers)
    assert started.status_code == 200
    pairing_id = started.json()["pairing_id"]
    approval_code = client.app.state.task0_state.security.pairings[pairing_id].approval_code
    completed = client.post(
        "/api/v1/pairing/complete",
        headers=headers,
        json={"pairing_id": pairing_id, "approval_code": approval_code},
    )
    assert completed.status_code == 200
    return {**headers, "Authorization": f"Bearer {completed.json()['session_token']}"}


def workspace_headers(client: TestClient, tmp_path: Path) -> tuple[dict[str, str], str]:
    headers = paired_headers(client)
    created = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(tmp_path), "name": "Task 5B disposable"},
    )
    assert created.status_code == 200, created.text
    workspace_id = created.json()["workspace_id"]
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
    return headers, workspace_id


def wait_for_terminal(
    client: TestClient, headers: dict[str, str], workspace_id: str, processing_id: str
) -> dict[str, object]:
    for _ in range(40):
        response = client.get(
            f"/api/v1/workspaces/{workspace_id}/ai/processing/records/{processing_id}",
            headers=headers,
        )
        assert response.status_code == 200, response.text
        record = response.json()["record"]
        if record["status"] in {"completed", "failed", "cancelled"}:
            return record
        time.sleep(0.05)
    raise AssertionError("processing did not reach a terminal state")


def start_processing(client: TestClient, headers: dict[str, str], workspace_id: str, version: str):
    return client.post(
        f"/api/v1/workspaces/{workspace_id}/ai/processing/start",
        headers=headers,
        json={"synthetic_input_version": version},
    )


def test_operations_prompts_and_durable_record_contract(processing_client, tmp_path: Path):
    headers, workspace_id = workspace_headers(processing_client, tmp_path)
    operations = processing_client.get(
        f"/api/v1/workspaces/{workspace_id}/ai/processing/operations", headers=headers
    )
    prompts = processing_client.get(
        f"/api/v1/workspaces/{workspace_id}/ai/processing/prompts", headers=headers
    )
    assert operations.status_code == prompts.status_code == 200
    assert operations.json()["operations"][0]["operation_id"] == "provider_echo_test"
    assert "system_template" not in prompts.json()["prompts"][0]
    started = start_processing(processing_client, headers, workspace_id, "v1")
    assert started.status_code == 200, started.text
    record = wait_for_terminal(
        processing_client, headers, workspace_id, started.json()["record"]["processing_id"]
    )
    assert record["status"] == "completed"
    assert record["output"]["acknowledgement"] == "Synthetic provider processing completed."
    assert record["provenance"]["source_type"] == "synthetic"
    assert "credential" not in started.text.lower()
    assert "api_key" not in started.text.lower()
    assert "user_message" not in started.text


def test_processing_routes_require_session_and_exact_origin(processing_client, tmp_path: Path):
    headers, workspace_id = workspace_headers(processing_client, tmp_path)
    unauthenticated = processing_client.get(
        f"/api/v1/workspaces/{workspace_id}/ai/processing/operations",
        headers={"Origin": ORIGIN},
    )
    assert unauthenticated.status_code == 401
    missing_origin = processing_client.get(
        f"/api/v1/workspaces/{workspace_id}/ai/processing/operations",
        headers={"Authorization": headers["Authorization"]},
    )
    assert missing_origin.status_code == 403
    invalid_origin = processing_client.get(
        f"/api/v1/workspaces/{workspace_id}/ai/processing/operations",
        headers={"Origin": "https://example.invalid", "Authorization": headers["Authorization"]},
    )
    assert invalid_origin.status_code == 403


def test_cache_hit_stale_source_and_explicit_invalidation(processing_client, tmp_path: Path):
    headers, workspace_id = workspace_headers(processing_client, tmp_path)
    first = start_processing(processing_client, headers, workspace_id, "v1")
    first_record = wait_for_terminal(
        processing_client, headers, workspace_id, first.json()["record"]["processing_id"]
    )
    hit = start_processing(processing_client, headers, workspace_id, "v1")
    assert hit.status_code == 200
    assert hit.json()["record"]["cache_disposition"] == "cache_hit"
    changed = start_processing(processing_client, headers, workspace_id, "v2")
    assert changed.status_code == 200
    old = processing_client.get(
        f"/api/v1/workspaces/{workspace_id}/ai/processing/records/{first_record['processing_id']}",
        headers=headers,
    ).json()["record"]
    assert old["stale"] is True
    invalidated = processing_client.post(
        f"/api/v1/workspaces/{workspace_id}/ai/processing/records/{hit.json()['record']['processing_id']}/invalidate",
        headers=headers,
    )
    assert invalidated.status_code == 200, invalidated.text
    assert invalidated.json()["record"]["invalidated"] is True


def test_invalid_output_retry_and_delayed_cancellation(processing_client, tmp_path: Path):
    headers, workspace_id = workspace_headers(processing_client, tmp_path)
    scenario = processing_client.post(
        "/api/v1/ai/processing/test-scenario",
        headers=headers,
        json={"scenario": "invalid_output"},
    )
    assert scenario.status_code == 200
    failed_start = start_processing(processing_client, headers, workspace_id, "invalid")
    failed = wait_for_terminal(
        processing_client, headers, workspace_id, failed_start.json()["record"]["processing_id"]
    )
    assert failed["status"] == "failed"
    assert failed["error"]["category"] == "invalid_output"
    processing_client.post(
        "/api/v1/ai/processing/test-scenario", headers=headers, json={"scenario": "success"}
    )
    retry = processing_client.post(
        f"/api/v1/workspaces/{workspace_id}/ai/processing/records/{failed['processing_id']}/retry",
        headers=headers,
    )
    assert retry.status_code == 200
    assert wait_for_terminal(
        processing_client, headers, workspace_id, retry.json()["record"]["processing_id"]
    )["status"] == "completed"
    processing_client.post(
        "/api/v1/ai/processing/test-scenario", headers=headers, json={"scenario": "delayed"}
    )
    delayed = start_processing(processing_client, headers, workspace_id, "cancel-me")
    delayed_id = delayed.json()["record"]["processing_id"]
    cancelled = processing_client.post(
        f"/api/v1/workspaces/{workspace_id}/ai/processing/records/{delayed_id}/cancel",
        headers=headers,
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["record"]["status"] == "cancelled"
    assert (
        wait_for_terminal(processing_client, headers, workspace_id, delayed_id)["status"]
        == "cancelled"
    )
    later = start_processing(processing_client, headers, workspace_id, "after-cancel")
    assert later.status_code == 200, later.text
    assert (
        wait_for_terminal(
            processing_client,
            headers,
            workspace_id,
            later.json()["record"]["processing_id"],
        )["status"]
        == "completed"
    )


def test_cancellation_succeeds_while_another_record_is_atomically_written(
    processing_client, tmp_path: Path
):
    headers, workspace_id = workspace_headers(processing_client, tmp_path)
    processing_client.post(
        "/api/v1/ai/processing/test-scenario", headers=headers, json={"scenario": "delayed"}
    )
    first = start_processing(processing_client, headers, workspace_id, "cancel-during-write")
    assert first.status_code == 200, first.text
    first_id = first.json()["record"]["processing_id"]

    workspace_root = processing_client.app.state.task0_state.workspace_roots[workspace_id]
    processing_directory = workspace_root / "activity" / "processing"
    original_atomic_write = workspace_module._atomic_write_bytes
    write_started = threading.Event()
    release_write = threading.Event()
    blocked = False
    second_result: dict[str, object] = {}

    def block_second_record(path: Path, content: bytes) -> str:
        nonlocal blocked
        if (
            not blocked
            and path.parent == processing_directory
            and path.name.endswith(".json")
            and path.name != f"{first_id}.json"
        ):
            blocked = True
            write_started.set()
            if not release_write.wait(timeout=5):
                raise AssertionError("test atomic write was not released")
        return original_atomic_write(path, content)

    workspace_module._atomic_write_bytes = block_second_record

    def start_second_record() -> None:
        try:
            second_result["response"] = start_processing(
                processing_client, headers, workspace_id, "second-record"
            )
        except BaseException as exc:  # noqa: BLE001 - propagate thread failures below.
            second_result["error"] = exc

    thread = threading.Thread(target=start_second_record)
    thread.start()
    try:
        assert write_started.wait(timeout=5)
        cancelled = processing_client.post(
            f"/api/v1/workspaces/{workspace_id}/ai/processing/records/{first_id}/cancel",
            headers=headers,
        )
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["record"]["status"] == "cancelled"
        processing_client.post(
            "/api/v1/ai/processing/test-scenario", headers=headers, json={"scenario": "success"}
        )
    finally:
        release_write.set()
        thread.join(timeout=5)
        workspace_module._atomic_write_bytes = original_atomic_write

    assert "error" not in second_result
    assert second_result["response"].status_code == 200
    assert wait_for_terminal(processing_client, headers, workspace_id, first_id)["status"] == (
        "cancelled"
    )


def test_interrupted_running_record_is_failed_on_workspace_reopen(
    processing_client, tmp_path: Path
):
    headers, workspace_id = workspace_headers(processing_client, tmp_path)
    engine = processing_client.app.state.task0_state.processing_engine
    root = processing_client.app.state.task0_state.workspace_roots[workspace_id]
    prompt = __import__(
        "research_intelligence_companion.prompt_registry", fromlist=["get_operation_prompt"]
    ).get_operation_prompt("provider_echo_test")
    record = engine._record(  # noqa: SLF001 - fault-recovery fixture intentionally uses the durable builder.
        workspace_id=workspace_id,
        processing_id="processing_interrupted_fixture",
        model="gpt-4o-mini",
        prompt=prompt,
        source_version="restart",
        input_hash="a" * 64,
        key="b" * 64,
        status="running",
        cache_disposition="cache_miss",
        now="2026-07-31T01:00:00Z",
    )
    write_record(root, "processing", record["processing_id"], record, expected_revision=None)
    open_workspace(str(root))
    reopened = processing_client.get(
        f"/api/v1/workspaces/{workspace_id}/ai/processing/records/processing_interrupted_fixture",
        headers=headers,
    )
    assert reopened.status_code == 200
    assert reopened.json()["record"]["status"] == "failed"
    assert reopened.json()["record"]["error"]["category"] == "processing_unavailable"
