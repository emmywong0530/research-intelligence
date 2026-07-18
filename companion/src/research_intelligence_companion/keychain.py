from __future__ import annotations

import secrets

import keyring

SERVICE_NAME = "research-intelligence-task0"


def run_keychain_roundtrip(account: str | None = None) -> dict[str, object]:
    account_name = account or f"task0-{secrets.token_hex(8)}"
    secret_value = secrets.token_urlsafe(32)
    backend = keyring.get_keyring().__class__.__name__

    keyring.set_password(SERVICE_NAME, account_name, secret_value)
    read_value = keyring.get_password(SERVICE_NAME, account_name)
    keyring.delete_password(SERVICE_NAME, account_name)
    deleted_value = keyring.get_password(SERVICE_NAME, account_name)

    return {
        "backend": backend,
        "write_ok": True,
        "read_ok": read_value == secret_value,
        "delete_ok": deleted_value is None,
        "secret_returned": False,
    }
