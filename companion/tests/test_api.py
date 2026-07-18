from __future__ import annotations

from fastapi.testclient import TestClient

from conftest import VALID_ORIGIN, paired_headers


def test_invalid_origin_fails(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"Origin": "https://example.invalid"})
    assert response.status_code == 403


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
