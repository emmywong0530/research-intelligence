from __future__ import annotations

import secrets
from dataclasses import dataclass

import keyring

SERVICE_NAME = "research-intelligence-task0"
INSTALLATION_SECRET_SERVICE = "research-intelligence-installation-secret"  # noqa: S105
INSTALLATION_SECRET_ACCOUNT = "default"  # noqa: S105


class InstallationSecretUnavailable(RuntimeError):
    def __init__(self, backend: str, reason: str) -> None:
        super().__init__(reason)
        self.backend = backend
        self.reason = reason


@dataclass(frozen=True)
class InstallationSecret:
    backend: str
    secret: str
    created: bool


def keyring_backend_name() -> str:
    return keyring.get_keyring().__class__.__name__


def get_or_create_installation_secret() -> InstallationSecret:
    backend = keyring_backend_name()
    try:
        existing = keyring.get_password(INSTALLATION_SECRET_SERVICE, INSTALLATION_SECRET_ACCOUNT)
        if existing:
            return InstallationSecret(backend=backend, secret=existing, created=False)

        secret_value = secrets.token_urlsafe(48)
        keyring.set_password(
            INSTALLATION_SECRET_SERVICE,
            INSTALLATION_SECRET_ACCOUNT,
            secret_value,
        )
        verified = keyring.get_password(INSTALLATION_SECRET_SERVICE, INSTALLATION_SECRET_ACCOUNT)
    except Exception as exc:  # noqa: BLE001 - surface backend-specific keychain errors.
        raise InstallationSecretUnavailable(backend, str(exc)) from exc

    if verified != secret_value:
        raise InstallationSecretUnavailable(
            backend,
            "Keychain did not return the generated installation secret after storage.",
        )

    return InstallationSecret(backend=backend, secret=secret_value, created=True)


def installation_secret_status() -> dict[str, object]:
    try:
        secret = get_or_create_installation_secret()
    except InstallationSecretUnavailable as exc:
        return {
            "backend": exc.backend,
            "available": False,
            "created": False,
            "error": "keychain_unavailable",
        }

    return {
        "backend": secret.backend,
        "available": True,
        "created": secret.created,
        "error": None,
    }


def run_keychain_roundtrip(account: str | None = None) -> dict[str, object]:
    account_name = account or f"task0-{secrets.token_hex(8)}"
    secret_value = secrets.token_urlsafe(32)
    backend = keyring_backend_name()

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
