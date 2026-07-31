from __future__ import annotations

from pathlib import Path

import keyring
import pytest
from fastapi.testclient import TestClient
from keyring.backend import KeyringBackend

from conftest import paired_headers
from research_intelligence_companion.ai_provider import (
    ProviderConfigError,
    ProviderRuntime,
    ProviderSettingsStore,
)
from research_intelligence_companion.app import create_app
from research_intelligence_companion.keychain import (
    InMemoryCredentialStore,
    OSKeychainCredentialStore,
)
from research_intelligence_companion.settings import CompanionSettings


def test_provider_routes_require_authentication_and_exact_origin(
    client: TestClient, origin_headers: dict[str, str]
) -> None:
    assert client.get("/api/v1/ai/provider/config", headers=origin_headers).status_code == 401
    headers = paired_headers(client, origin_headers)
    invalid = {**headers, "Origin": "https://unconfigured.example"}
    missing = {key: value for key, value in headers.items() if key.lower() != "origin"}
    assert client.get("/api/v1/ai/provider/config", headers=invalid).status_code == 403
    assert client.get("/api/v1/ai/provider/config", headers=missing).status_code == 403


def test_provider_config_and_credential_are_separate_and_never_revealed(
    client: TestClient,
    fake_keyring: KeyringBackend,
    origin_headers: dict[str, str],
    caplog,
) -> None:
    _ = fake_keyring
    secret = "TEST_PROVIDER_SECRET_DO_NOT_RETURN"  # noqa: S105
    headers = paired_headers(client, origin_headers)
    configured = client.put(
        "/api/v1/ai/provider/config",
        headers=headers,
        json={"provider": "openai", "model": "gpt-test", "timeout_seconds": 5, "max_retries": 1},
    )
    assert configured.status_code == 200
    revision = configured.json()["config"]["revision"]
    stored = client.put(
        "/api/v1/ai/provider/credential",
        headers=headers,
        json={"provider": "openai", "credential": secret},
    )
    assert stored.status_code == 200
    assert secret not in stored.text
    assert secret not in configured.text
    assert secret not in caplog.text
    settings_files = list(client.app.state.task0_state.provider_runtime.store.root.rglob("*"))
    assert all(
        secret.encode() not in path.read_bytes() for path in settings_files if path.is_file()
    )
    assert client.put(
        "/api/v1/ai/provider/config",
        headers=headers,
        json={"provider": "openai", "model": "gpt-new", "expected_revision": "0" * 64},
    ).status_code == 409
    assert revision != "0" * 64


def test_fake_provider_connection_results_are_bounded_and_stateful(
    origin_headers: dict[str, str],
    monkeypatch,
    tmp_path: Path,
    caplog,
) -> None:
    monkeypatch.setenv("RI_AI_TEST_MODE", "1")
    monkeypatch.setenv("RI_AI_TEST_CREDENTIAL_STORE", "memory")
    monkeypatch.setenv("RI_DEVICE_DATA_ROOT", str(tmp_path / "device"))
    # The fixture client was created before the environment change, so use a test-mode app directly.
    settings = CompanionSettings(host="127.0.0.1", allowed_origins=(origin_headers["Origin"],))
    with TestClient(create_app(settings)) as test_client:
        headers = paired_headers(test_client, origin_headers)
        assert test_client.put(
            "/api/v1/ai/provider/config",
            headers=headers,
            json={"provider": "openai", "model": "fake-model"},
        ).status_code == 200
        assert test_client.put(
            "/api/v1/ai/provider/credential",
            headers=headers,
            json={"provider": "openai", "credential": "synthetic-key"},
        ).status_code == 200
        success = test_client.post("/api/v1/ai/provider/test", headers=headers, json={})
        assert success.status_code == 200
        assert "synthetic-key" not in success.text
        assert "synthetic-key" not in caplog.text
        assert success.json()["result"]["status"] == "success"
        state = test_client.get("/api/v1/ai/provider/config", headers=headers).json()
        assert state["state"] == "connection_verified"

        scenario = test_client.post(
            "/api/v1/ai/provider/test-scenario",
            headers=headers,
            json={"scenario": "authentication_failed"},
        )
        assert scenario.status_code == 200
        failed = test_client.post("/api/v1/ai/provider/test", headers=headers, json={})
        assert failed.status_code == 200
        assert failed.json()["result"]["error_category"] == "authentication_failed"
        assert (
            test_client.get("/api/v1/ai/provider/config", headers=headers).json()["state"]
            == "connection_failed"
        )

        removed = test_client.request(
            "DELETE", "/api/v1/ai/provider/credential", headers=headers, json={"provider": "openai"}
        )
        assert removed.status_code == 200
        assert removed.json()["credential_state"] == "missing"
        assert (
            test_client.get("/api/v1/ai/provider/config", headers=headers).json()["state"]
            == "credential_removed"
        )


def test_credential_store_selection_requires_both_explicit_test_flags(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("RI_DEVICE_DATA_ROOT", str(tmp_path / "device"))
    monkeypatch.setenv("RI_AI_TEST_MODE", "1")
    monkeypatch.delenv("RI_AI_TEST_CREDENTIAL_STORE", raising=False)
    ai_test_only = ProviderRuntime.from_environment()
    assert isinstance(ai_test_only.credential_store, OSKeychainCredentialStore)

    monkeypatch.setenv("RI_AI_TEST_CREDENTIAL_STORE", "memory")
    explicit_test_store = ProviderRuntime.from_environment()
    assert isinstance(explicit_test_store.credential_store, InMemoryCredentialStore)

    monkeypatch.delenv("RI_AI_TEST_MODE", raising=False)
    production = ProviderRuntime.from_environment()
    assert isinstance(production.credential_store, OSKeychainCredentialStore)


def test_in_memory_credential_store_is_process_local_and_never_calls_keyring(
    monkeypatch, tmp_path: Path
) -> None:
    def keyring_must_not_be_called(*_args, **_kwargs):
        raise AssertionError("the in-memory credential store called keyring")

    monkeypatch.setattr(keyring, "get_password", keyring_must_not_be_called)
    monkeypatch.setattr(keyring, "set_password", keyring_must_not_be_called)
    monkeypatch.setattr(keyring, "delete_password", keyring_must_not_be_called)

    first = InMemoryCredentialStore()
    second = InMemoryCredentialStore()
    assert first.status("openai") == "missing"
    first.save("openai", "memory-secret")
    assert first.status("openai") == "present"
    assert first.get("openai") == "memory-secret"
    assert second.status("openai") == "missing"
    first.save("openai", "replacement-secret")
    assert first.get("openai") == "replacement-secret"
    first.remove("openai")
    assert first.status("openai") == "missing"
    assert list(tmp_path.iterdir()) == []


def test_fresh_runtime_reports_missing_credential_after_explicit_removal(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("RI_DEVICE_DATA_ROOT", str(tmp_path / "device"))
    settings_store = ProviderSettingsStore(tmp_path / "device")
    settings_store.write(
        provider="openai",
        model="gpt-test",
        timeout_seconds=5,
        max_retries=0,
        enabled=True,
        expected_revision=None,
    )
    live_store = InMemoryCredentialStore()
    live_runtime = ProviderRuntime(
        settings_store,
        credential_store=live_store,
        test_mode=True,
    )
    live_runtime.save_credential("openai", "memory-secret")
    live_runtime.remove_credential("openai")
    assert live_runtime.state(settings_store.read()) == "credential_removed"

    fresh_runtime = ProviderRuntime(
        settings_store,
        credential_store=InMemoryCredentialStore(),
        test_mode=True,
    )
    assert fresh_runtime.state(settings_store.read()) == "configured_without_credential"


class FailingProviderKeyring(KeyringBackend):
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


def test_device_local_provider_settings_reject_future_versions_and_preserve_prior_write(
    tmp_path: Path, monkeypatch
) -> None:
    store = ProviderSettingsStore(tmp_path)
    first = store.write(
        provider="openai", model="gpt-first", timeout_seconds=5,
        max_retries=0, enabled=True, expected_revision=None,
    )

    def fail_replace(*_args, **_kwargs):
        raise OSError("injected replace failure")

    monkeypatch.setattr("os.replace", fail_replace)
    with pytest.raises(ProviderConfigError):
        store.write(
            provider="openai", model="gpt-second", timeout_seconds=5,
            max_retries=0, enabled=True, expected_revision=first.revision,
        )
    monkeypatch.undo()
    assert store.read().model == "gpt-first"
    store.path.write_text('{"schema_version":"task5a.future"}', encoding="utf-8")
    with pytest.raises(ProviderConfigError):
        store.read()

def test_keychain_failure_blocks_credential_storage_without_plaintext_fallback(
    origin_headers: dict[str, str], monkeypatch, tmp_path: Path
) -> None:
    previous = keyring.get_keyring()
    keyring.set_keyring(FailingProviderKeyring())
    monkeypatch.setenv("RI_DEVICE_DATA_ROOT", str(tmp_path / "device"))
    try:
        settings = CompanionSettings(host="127.0.0.1", allowed_origins=(origin_headers["Origin"],))
        with TestClient(create_app(settings)) as test_client:
            headers = paired_headers(test_client, origin_headers)
            assert test_client.put(
                "/api/v1/ai/provider/config",
                headers=headers,
                json={"provider": "openai", "model": "gpt-test"},
            ).status_code == 200
            response = test_client.put(
                "/api/v1/ai/provider/credential",
                headers=headers,
                json={"provider": "openai", "credential": "NEVER_WRITE_PLAINTEXT"},
            )
            assert response.status_code == 503
            assert "NEVER_WRITE_PLAINTEXT" not in response.text
            assert not list((tmp_path / "device").rglob("*")) or all(
                b"NEVER_WRITE_PLAINTEXT" not in path.read_bytes()
                for path in (tmp_path / "device").rglob("*")
                if path.is_file()
            )
    finally:
        keyring.set_keyring(previous)
