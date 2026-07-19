from __future__ import annotations

from collections.abc import Generator

import keyring
import pytest
from fastapi.testclient import TestClient
from keyring.backend import KeyringBackend

from research_intelligence_companion.app import create_app
from research_intelligence_companion.settings import CompanionSettings

VALID_ORIGIN = "http://127.0.0.1:4173"
PRODUCTION_ORIGIN = "https://emmywong0530.github.io"


class MemoryKeyring(KeyringBackend):
    priority = 1

    def __init__(self) -> None:
        self.values: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.values.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.values[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        self.values.pop((service, username), None)


@pytest.fixture
def fake_keyring() -> MemoryKeyring:
    backend = MemoryKeyring()
    keyring.set_keyring(backend)
    return backend


@pytest.fixture
def client() -> Generator[TestClient]:
    settings = CompanionSettings(
        host="127.0.0.1",
        allowed_origins=(VALID_ORIGIN, PRODUCTION_ORIGIN),
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def origin_headers() -> dict[str, str]:
    return {"Origin": VALID_ORIGIN}


def paired_headers(client: TestClient, origin_headers: dict[str, str]) -> dict[str, str]:
    started = client.post("/api/v1/pairing/start", headers=origin_headers)
    assert started.status_code == 200
    payload = started.json()
    approval_code = client.app.state.task0_state.security.pairings[
        payload["pairing_id"]
    ].approval_code
    completed = client.post(
        "/api/v1/pairing/complete",
        headers=origin_headers,
        json={"pairing_id": payload["pairing_id"], "approval_code": approval_code},
    )
    assert completed.status_code == 200
    token = completed.json()["session_token"]
    return {**origin_headers, "Authorization": f"Bearer {token}"}
