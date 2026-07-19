from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient

from conftest import PRODUCTION_ORIGIN, VALID_ORIGIN, paired_headers
from research_intelligence_companion.app import create_app
from research_intelligence_companion.security import utc_now
from research_intelligence_companion.settings import CompanionSettings


def test_invalid_origin_fails(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"Origin": "https://example.invalid"})
    assert response.status_code == 403


def test_missing_origin_fails_for_pairing_start(client: TestClient) -> None:
    response = client.post("/api/v1/pairing/start")
    assert response.status_code == 403
    assert response.json()["detail"] == "Origin header is required."


def test_invalid_origin_fails_for_pairing_start(client: TestClient) -> None:
    response = client.post(
        "/api/v1/pairing/start",
        headers={"Origin": "https://example.invalid"},
    )
    assert response.status_code == 403


def test_valid_local_development_origin_can_start_pairing(client: TestClient) -> None:
    response = client.post("/api/v1/pairing/start", headers={"Origin": VALID_ORIGIN})
    assert response.status_code == 200
    payload = response.json()
    assert payload["pairing_id"]
    assert payload["approval_required"] is True
    assert "pairing_code" not in payload
    assert "approval_code" not in payload


def test_valid_production_origin_can_start_pairing(client: TestClient) -> None:
    response = client.post("/api/v1/pairing/start", headers={"Origin": PRODUCTION_ORIGIN})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == PRODUCTION_ORIGIN
    assert "pairing_code" not in response.text
    assert "approval_code" not in response.text


def test_unauthenticated_requests_fail(client: TestClient, origin_headers: dict[str, str]) -> None:
    response = client.get("/api/v1/authenticated-test", headers=origin_headers)
    assert response.status_code == 401


def test_valid_paired_session_succeeds(client: TestClient, origin_headers: dict[str, str]) -> None:
    headers = paired_headers(client, origin_headers)
    response = client.get("/api/v1/authenticated-test", headers=headers)
    assert response.status_code == 200
    assert response.json()["schema_version"] == "task0.v1"
    assert response.json()["status"] == "authenticated"


def test_cors_allows_configured_origin(client: TestClient) -> None:
    response = client.options("/api/v1/health", headers={"Origin": VALID_ORIGIN})
    assert response.status_code == 204
    assert response.headers["access-control-allow-origin"] == VALID_ORIGIN


def test_cors_preflight_only_allows_configured_browser_origins(client: TestClient) -> None:
    allowed = client.options(
        "/api/v1/pairing/start",
        headers={
            "Origin": PRODUCTION_ORIGIN,
            "Access-Control-Request-Method": "POST",
        },
    )
    assert allowed.status_code == 204
    assert allowed.headers["access-control-allow-origin"] == PRODUCTION_ORIGIN

    invalid = client.options(
        "/api/v1/pairing/start",
        headers={
            "Origin": "https://example.invalid",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert invalid.status_code == 403

    missing = client.options(
        "/api/v1/pairing/start",
        headers={"Access-Control-Request-Method": "POST"},
    )
    assert missing.status_code == 403


def test_pairing_attempt_is_single_use(client: TestClient, origin_headers: dict[str, str]) -> None:
    started = client.post("/api/v1/pairing/start", headers=origin_headers)
    assert started.status_code == 200
    pairing_id = started.json()["pairing_id"]
    approval_code = client.app.state.task0_state.security.pairings[pairing_id].approval_code

    completed = client.post(
        "/api/v1/pairing/complete",
        headers=origin_headers,
        json={"pairing_id": pairing_id, "approval_code": approval_code},
    )
    assert completed.status_code == 200

    replayed = client.post(
        "/api/v1/pairing/complete",
        headers=origin_headers,
        json={"pairing_id": pairing_id, "approval_code": approval_code},
    )
    assert replayed.status_code == 401


def test_pairing_failed_attempt_limit_blocks_later_success(
    client: TestClient,
    origin_headers: dict[str, str],
) -> None:
    started = client.post("/api/v1/pairing/start", headers=origin_headers)
    assert started.status_code == 200
    pairing_id = started.json()["pairing_id"]
    approval_code = client.app.state.task0_state.security.pairings[pairing_id].approval_code
    wrong_code = "000000" if approval_code != "000000" else "111111"

    for _ in range(5):
        failed = client.post(
            "/api/v1/pairing/complete",
            headers=origin_headers,
            json={"pairing_id": pairing_id, "approval_code": wrong_code},
        )
        assert failed.status_code == 401

    blocked = client.post(
        "/api/v1/pairing/complete",
        headers=origin_headers,
        json={"pairing_id": pairing_id, "approval_code": approval_code},
    )
    assert blocked.status_code == 401


def test_expired_pairing_attempt_fails_and_cannot_be_replayed(
    client: TestClient,
    origin_headers: dict[str, str],
) -> None:
    started = client.post("/api/v1/pairing/start", headers=origin_headers)
    assert started.status_code == 200
    pairing_id = started.json()["pairing_id"]
    attempt = client.app.state.task0_state.security.pairings[pairing_id]
    approval_code = attempt.approval_code
    attempt.expires_at = utc_now() - timedelta(seconds=1)

    expired = client.post(
        "/api/v1/pairing/complete",
        headers=origin_headers,
        json={"pairing_id": pairing_id, "approval_code": approval_code},
    )
    assert expired.status_code == 401

    replayed = client.post(
        "/api/v1/pairing/complete",
        headers=origin_headers,
        json={"pairing_id": pairing_id, "approval_code": approval_code},
    )
    assert replayed.status_code == 401


def test_sessions_are_invalid_after_companion_restart(origin_headers: dict[str, str]) -> None:
    settings = CompanionSettings(host="127.0.0.1", allowed_origins=(VALID_ORIGIN,))
    with TestClient(create_app(settings)) as first_client:
        headers = paired_headers(first_client, origin_headers)

    with TestClient(create_app(settings)) as restarted_client:
        response = restarted_client.get("/api/v1/authenticated-test", headers=headers)

    assert response.status_code == 401
