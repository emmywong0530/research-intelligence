from __future__ import annotations

from fastapi.testclient import TestClient

from conftest import paired_headers
from research_intelligence_companion import keychain


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
