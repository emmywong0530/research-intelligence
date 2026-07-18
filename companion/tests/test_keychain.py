from __future__ import annotations

from pathlib import Path

import keyring
import pytest
from fastapi.testclient import TestClient
from keyring.backend import KeyringBackend

from conftest import paired_headers
from research_intelligence_companion import keychain
from research_intelligence_companion.app import create_app
from research_intelligence_companion.settings import CompanionSettings

INSTALLATION_SECRET_SENTINEL = "RI_INSTALLATION_SECRET_DO_NOT_RETURN"  # noqa: S105


class FailingKeyring(KeyringBackend):
    priority = 1

    def get_password(self, service: str, username: str) -> str | None:
        _ = service, username
        raise RuntimeError("keychain locked")

    def set_password(self, service: str, username: str, password: str) -> None:
        _ = service, username, password
        raise RuntimeError("keychain locked")

    def delete_password(self, service: str, username: str) -> None:
        _ = service, username
        raise RuntimeError("keychain locked")


def test_secrets_are_never_returned_through_api_responses(
    client: TestClient,
    fake_keyring: object,
    monkeypatch,
    origin_headers: dict[str, str],
) -> None:
    _ = fake_keyring
    monkeypatch.setattr(
        keychain.secrets,
        "token_urlsafe",
        lambda _length: "TEST_SECRET_DO_NOT_RETURN",
    )
    headers = paired_headers(client, origin_headers)

    response = client.post("/api/v1/spikes/keychain-test", headers=headers)

    assert response.status_code == 200
    body = response.text
    assert "TEST_SECRET_DO_NOT_RETURN" not in body
    payload = response.json()
    assert payload["write_ok"] is True
    assert payload["read_ok"] is True
    assert payload["delete_ok"] is True
    assert payload["secret_returned"] is False


def test_installation_secret_survives_restart_when_keychain_permits(
    fake_keyring: object,
    monkeypatch,
) -> None:
    _ = fake_keyring
    monkeypatch.setattr(
        keychain.secrets,
        "token_urlsafe",
        lambda _length: INSTALLATION_SECRET_SENTINEL,
    )
    first = keychain.get_or_create_installation_secret()
    monkeypatch.setattr(keychain.secrets, "token_urlsafe", lambda _length: "DIFFERENT_SECRET")
    second = keychain.get_or_create_installation_secret()

    assert first.secret == INSTALLATION_SECRET_SENTINEL
    assert first.created is True
    assert second.secret == INSTALLATION_SECRET_SENTINEL
    assert second.created is False


def test_installation_secret_is_not_exposed_through_api_logs_workspace_or_artifacts(
    client: TestClient,
    fake_keyring: object,
    monkeypatch,
    caplog: pytest.LogCaptureFixture,
    origin_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    _ = fake_keyring
    monkeypatch.setattr(
        keychain.secrets,
        "token_urlsafe",
        lambda _length: INSTALLATION_SECRET_SENTINEL,
    )
    caplog.set_level("INFO")

    status = client.get("/api/v1/installation-secret/status", headers=origin_headers)
    assert status.status_code == 200
    assert status.json()["available"] is True
    assert INSTALLATION_SECRET_SENTINEL not in status.text
    assert INSTALLATION_SECRET_SENTINEL not in caplog.text

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    headers = paired_headers(client, origin_headers)
    opened = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(workspace)},
    )
    assert opened.status_code == 200
    written = client.post(
        "/api/v1/spikes/atomic-write-test",
        headers=headers,
        json={"workspace_id": opened.json()["workspace_id"]},
    )
    assert written.status_code == 200

    for path in workspace.rglob("*"):
        if path.is_file():
            assert INSTALLATION_SECRET_SENTINEL.encode() not in path.read_bytes()

    dist = Path(__file__).parents[1] / "dist"
    if dist.exists():
        for path in dist.rglob("*"):
            if path.is_file():
                assert INSTALLATION_SECRET_SENTINEL.encode() not in path.read_bytes()


def test_installation_secret_keychain_failure_has_no_plaintext_downgrade(
    origin_headers: dict[str, str],
) -> None:
    previous_keyring = keyring.get_keyring()
    keyring.set_keyring(FailingKeyring())
    settings = CompanionSettings(host="127.0.0.1", allowed_origins=(origin_headers["Origin"],))

    try:
        with pytest.raises(keychain.InstallationSecretUnavailable):
            keychain.get_or_create_installation_secret()

        with TestClient(create_app(settings)) as client:
            status = client.get("/api/v1/installation-secret/status", headers=origin_headers)
    finally:
        keyring.set_keyring(previous_keyring)

    assert status.status_code == 200
    payload = status.json()
    assert payload["available"] is False
    assert payload["error"] == "keychain_unavailable"
    assert "secret" not in status.text.lower()
