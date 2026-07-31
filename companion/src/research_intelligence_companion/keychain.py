from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Literal, Protocol

import keyring

SERVICE_NAME = "research-intelligence-task0"
INSTALLATION_SECRET_SERVICE = "research-intelligence-installation-secret"  # noqa: S105
INSTALLATION_SECRET_ACCOUNT = "default"  # noqa: S105
AI_PROVIDER_CREDENTIAL_SERVICE = "research-intelligence-ai-provider"  # noqa: S105
CredentialState = Literal["present", "missing", "unavailable"]


class InstallationSecretUnavailable(RuntimeError):
    def __init__(self, backend: str, reason: str) -> None:
        super().__init__(reason)
        self.backend = backend
        self.reason = reason


class KeychainCredentialUnavailable(RuntimeError):
    """The OS keychain could not be used; callers must not fall back to plaintext."""

    def __init__(self, backend: str, reason: str) -> None:
        super().__init__(reason)
        self.backend = backend
        self.reason = reason


class CredentialStore(Protocol):
    """The narrow credential lifecycle used by the provider runtime."""

    def get(self, provider: str) -> str | None: ...

    def status(self, provider: str) -> CredentialState: ...

    def save(self, provider: str, credential: str) -> None: ...

    def remove(self, provider: str) -> None: ...


class OSKeychainCredentialStore:
    """Production credential store backed only by the operating-system keychain."""

    def get(self, provider: str) -> str | None:
        return get_provider_credential(provider)

    def status(self, provider: str) -> CredentialState:
        return "present" if provider_credential_status(provider) else "missing"

    def save(self, provider: str, credential: str) -> None:
        save_provider_credential(provider, credential)

    def remove(self, provider: str) -> None:
        delete_provider_credential(provider)


class InMemoryCredentialStore:
    """Process-local test store; it intentionally has no filesystem or keyring access."""

    def __init__(self) -> None:
        self._credentials: dict[str, str] = {}

    def get(self, provider: str) -> str | None:
        _provider_account(provider)
        return self._credentials.get(provider)

    def status(self, provider: str) -> CredentialState:
        return "present" if self.get(provider) is not None else "missing"

    def save(self, provider: str, credential: str) -> None:
        _provider_account(provider)
        if not credential.strip() or len(credential) > 500:
            raise ValueError("The provider credential is invalid.")
        self._credentials[provider] = credential

    def remove(self, provider: str) -> None:
        _provider_account(provider)
        self._credentials.pop(provider, None)


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


def _provider_account(provider: str) -> str:
    if provider != "openai":
        raise ValueError("Unsupported AI provider.")
    return f"provider:{provider}"


def get_provider_credential(provider: str) -> str | None:
    backend = keyring_backend_name()
    try:
        return keyring.get_password(AI_PROVIDER_CREDENTIAL_SERVICE, _provider_account(provider))
    except Exception as exc:  # noqa: BLE001 - preserve a truthful keychain-only failure state.
        raise KeychainCredentialUnavailable(
            backend, "The operating-system keychain is unavailable."
        ) from exc


def provider_credential_status(provider: str) -> bool:
    return get_provider_credential(provider) is not None


def save_provider_credential(provider: str, credential: str) -> None:
    if not credential.strip() or len(credential) > 500:
        raise ValueError("The provider credential is invalid.")
    backend = keyring_backend_name()
    account = _provider_account(provider)
    previous: str | None = None
    try:
        previous = keyring.get_password(AI_PROVIDER_CREDENTIAL_SERVICE, account)
        keyring.set_password(AI_PROVIDER_CREDENTIAL_SERVICE, account, credential)
        verified = keyring.get_password(AI_PROVIDER_CREDENTIAL_SERVICE, account)
        if verified != credential:
            raise RuntimeError("Keychain did not verify the replacement credential.")
    except Exception as exc:  # noqa: BLE001 - restore the prior key when replacement fails.
        if previous is not None:
            try:
                keyring.set_password(AI_PROVIDER_CREDENTIAL_SERVICE, account, previous)
                if keyring.get_password(AI_PROVIDER_CREDENTIAL_SERVICE, account) != previous:
                    raise RuntimeError("Prior keychain credential could not be restored.")
            except Exception as restore_exc:  # noqa: BLE001
                raise KeychainCredentialUnavailable(
                    backend, "The keychain could not preserve the existing credential."
                ) from restore_exc
        raise KeychainCredentialUnavailable(
            backend, "The keychain could not store the credential."
        ) from exc


def delete_provider_credential(provider: str) -> None:
    backend = keyring_backend_name()
    try:
        keyring.delete_password(AI_PROVIDER_CREDENTIAL_SERVICE, _provider_account(provider))
    except Exception as exc:  # noqa: BLE001 - no plaintext fallback.
        try:
            if (
                keyring.get_password(AI_PROVIDER_CREDENTIAL_SERVICE, _provider_account(provider))
                is None
            ):
                return
        except Exception as probe_exc:  # noqa: BLE001 - distinguish unavailable from absent.
            raise KeychainCredentialUnavailable(
                backend, "The keychain could not be checked while removing the credential."
            ) from probe_exc
        raise KeychainCredentialUnavailable(
            backend, "The keychain could not remove the credential."
        ) from exc


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
