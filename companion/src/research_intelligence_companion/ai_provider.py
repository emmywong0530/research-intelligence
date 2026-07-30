from __future__ import annotations

import asyncio
import hashlib
import json
import os
import ssl
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from research_intelligence_companion.device import device_data_root
from research_intelligence_companion.keychain import (
    KeychainCredentialUnavailable,
    delete_provider_credential,
    get_provider_credential,
    provider_credential_status,
    save_provider_credential,
)

PROVIDER_SETTINGS_SCHEMA_VERSION = "task5a.v1"
PROVIDER_SETTINGS_FILENAME = "ai-provider-settings.json"
SUPPORTED_PROVIDER = "openai"
TEST_SCENARIOS = {
    "success",
    "authentication_failed",
    "model_not_found",
    "rate_limited",
    "timeout",
    "cancelled",
    "unexpected_provider_error",
}
ProviderStateName = Literal[
    "unconfigured",
    "configured_without_credential",
    "ready_untested",
    "connection_verified",
    "connection_failed",
    "credential_removed",
    "configuration_invalid",
]
ErrorCategory = Literal[
    "credential_missing",
    "authentication_failed",
    "permission_denied",
    "model_not_found",
    "rate_limited",
    "timeout",
    "network_unavailable",
    "invalid_configuration",
    "provider_unavailable",
    "cancelled",
    "unexpected_provider_error",
]


def timestamp() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")


class ProviderConfigError(ValueError):
    pass


class ProviderConfigConflict(ProviderConfigError):
    def __init__(self, expected: str, current: str | None) -> None:
        self.expected = expected
        self.current = current
        super().__init__("The AI provider configuration changed elsewhere.")


class ProviderTestInProgress(RuntimeError):
    pass


class ProviderError(RuntimeError):
    def __init__(self, category: ErrorCategory, message: str) -> None:
        self.category = category
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class ProviderConfig:
    provider: str
    model: str
    timeout_seconds: int
    max_retries: int
    enabled: bool
    created_at: str
    updated_at: str
    revision: str

    def without_revision(self) -> dict[str, object]:
        return {
            "schema_version": PROVIDER_SETTINGS_SCHEMA_VERSION,
            "provider": self.provider,
            "model": self.model,
            "timeout_seconds": self.timeout_seconds,
            "max_retries": self.max_retries,
            "enabled": self.enabled,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def as_dict(self) -> dict[str, object]:
        return {**self.without_revision(), "revision": self.revision}


@dataclass(frozen=True)
class ConnectionTestResult:
    status: Literal["success", "failed"]
    provider: str
    model: str
    checked_at: str
    latency_ms: int | None
    error_category: ErrorCategory | None
    message: str

    def as_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "provider": self.provider,
            "model": self.model,
            "checked_at": self.checked_at,
            "latency_ms": self.latency_ms,
            "error_category": self.error_category,
            "message": self.message,
        }


class ProviderAdapter(Protocol):
    async def test_connection(self, config: ProviderConfig, credential: str) -> None: ...


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


class OpenAICompatibleAdapter:
    """Bounded model-availability check for the fixed OpenAI API origin."""

    def __init__(self, test_scenario: str | None = None) -> None:
        self._test_scenario = test_scenario

    async def test_connection(self, config: ProviderConfig, credential: str) -> None:
        if self._test_scenario is not None:
            await FakeProviderAdapter(self._test_scenario).test_connection(config, credential)
            return

        url = f"https://api.openai.com/v1/models/{quote(config.model, safe='')}"
        request = Request(  # noqa: S310 - URL is constructed from the fixed HTTPS provider origin.
            url,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {credential}",
                "User-Agent": "research-intelligence-companion/0.1",
            },
            method="GET",
        )
        context = ssl.create_default_context()
        opener = build_opener(_NoRedirectHandler(), HTTPSHandler(context=context))
        deadline = time.monotonic() + config.timeout_seconds * (config.max_retries + 1)
        attempt = 0
        while True:
            try:
                await asyncio.wait_for(
                    asyncio.to_thread(self._request, opener, request, config.timeout_seconds),
                    timeout=max(0.1, deadline - time.monotonic()),
                )
                return
            except HTTPError as exc:
                if exc.code == 401:
                    raise ProviderError(
                        "authentication_failed", "The provider rejected the credential."
                    ) from None
                if exc.code == 403:
                    raise ProviderError(
                        "permission_denied", "The credential cannot use this provider model."
                    ) from None
                if exc.code == 404:
                    raise ProviderError(
                        "model_not_found", "The configured provider model was not found."
                    ) from None
                category: ErrorCategory = (
                    "rate_limited"
                    if exc.code == 429
                    else "provider_unavailable"
                    if exc.code >= 500
                    else "unexpected_provider_error"
                )
                if attempt >= config.max_retries:
                    raise ProviderError(
                        category, "The provider could not complete the connection test."
                    ) from None
            except TimeoutError:
                if attempt >= config.max_retries:
                    raise ProviderError(
                        "timeout", "The provider connection test timed out."
                    ) from None
            except (URLError, OSError):
                if attempt >= config.max_retries:
                    raise ProviderError(
                        "network_unavailable", "The provider could not be reached."
                    ) from None
            except asyncio.CancelledError:
                raise ProviderError("cancelled", "The connection test was cancelled.") from None
            if time.monotonic() >= deadline:
                raise ProviderError("timeout", "The provider connection test timed out.")
            attempt += 1
            await asyncio.sleep(min(0.25 * (2**attempt), 1.0))

    @staticmethod
    def _request(opener, request: Request, timeout: int) -> None:  # type: ignore[no-untyped-def]
        with opener.open(request, timeout=timeout) as response:
            if response.status < 200 or response.status >= 300:
                raise HTTPError(
                    request.full_url, response.status, "provider error", response.headers, None
                )


class FakeProviderAdapter:
    """Deterministic adapter installed only by explicit companion test mode."""

    def __init__(self, scenario: str = "success") -> None:
        self.scenario = scenario

    async def test_connection(self, config: ProviderConfig, credential: str) -> None:
        _ = config, credential
        messages = {
            "authentication_failed": (
                "authentication_failed",
                "The test provider rejected the credential.",
            ),
            "model_not_found": ("model_not_found", "The test provider model was not found."),
            "rate_limited": ("rate_limited", "The test provider is rate limited."),
            "timeout": ("timeout", "The test provider connection test timed out."),
            "cancelled": ("cancelled", "The test provider connection test was cancelled."),
            "unexpected_provider_error": (
                "unexpected_provider_error",
                "The test provider returned an unexpected error.",
            ),
        }
        if self.scenario in messages:
            category, message = messages[self.scenario]
            raise ProviderError(category, message)  # type: ignore[arg-type]


class ProviderSettingsStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or device_data_root()).resolve()
        self.available = True
        try:
            self.root.mkdir(parents=True, exist_ok=True)
        except OSError:
            self.available = False
        self.path = self.root / PROVIDER_SETTINGS_FILENAME

    def read(self) -> ProviderConfig | None:
        if not self.available:
            return None
        if not self.path.exists():
            return None
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ProviderConfigError("The AI provider settings file is invalid.")
            self._validate(raw)
            return ProviderConfig(
                provider=raw["provider"],
                model=raw["model"],
                timeout_seconds=raw["timeout_seconds"],
                max_retries=raw["max_retries"],
                enabled=raw["enabled"],
                created_at=raw["created_at"],
                updated_at=raw["updated_at"],
                revision=raw["revision"],
            )
        except ProviderConfigError:
            raise
        except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
            raise ProviderConfigError("The AI provider settings file is invalid.") from exc

    def write(
        self,
        *,
        provider: str,
        model: str,
        timeout_seconds: int,
        max_retries: int,
        enabled: bool,
        expected_revision: str | None,
    ) -> ProviderConfig:
        if not self.available:
            raise ProviderConfigError("The device-local provider settings area is unavailable.")
        current = self.read()
        if expected_revision is not None and (
            current is None or current.revision != expected_revision
        ):
            raise ProviderConfigConflict(expected_revision, current.revision if current else None)
        now = timestamp()
        unsigned = {
            "schema_version": PROVIDER_SETTINGS_SCHEMA_VERSION,
            "provider": provider,
            "model": model,
            "timeout_seconds": timeout_seconds,
            "max_retries": max_retries,
            "enabled": enabled,
            "created_at": current.created_at if current else now,
            "updated_at": now,
        }
        self._validate(unsigned, allow_missing_revision=True)
        revision = self._revision(unsigned)
        config = ProviderConfig(
            provider=provider,
            model=model,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
            enabled=enabled,
            created_at=unsigned["created_at"],
            updated_at=now,
            revision=revision,
        )
        self._atomic_write(config.as_dict())
        return config

    @staticmethod
    def _revision(raw: dict[str, object]) -> str:
        canonical = json.dumps(raw, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(canonical).hexdigest()

    @classmethod
    def _validate(cls, raw: dict[str, object], allow_missing_revision: bool = False) -> None:
        allowed = {
            "schema_version",
            "provider",
            "model",
            "timeout_seconds",
            "max_retries",
            "enabled",
            "created_at",
            "updated_at",
            "revision",
        }
        if set(raw) - allowed or raw.get("schema_version") != PROVIDER_SETTINGS_SCHEMA_VERSION:
            raise ProviderConfigError("The AI provider settings contain unsupported fields.")
        if raw.get("provider") != SUPPORTED_PROVIDER:
            raise ProviderConfigError("Only the approved OpenAI-compatible provider is supported.")
        model = raw.get("model")
        if (
            not isinstance(model, str)
            or not 1 <= len(model) <= 80
            or any(char.isspace() for char in model)
        ):
            raise ProviderConfigError("The provider model is invalid.")
        timeout_seconds = raw.get("timeout_seconds")
        if (
            not isinstance(timeout_seconds, int)
            or isinstance(timeout_seconds, bool)
            or not 1 <= timeout_seconds <= 30
        ):
            raise ProviderConfigError("The provider timeout must be between 1 and 30 seconds.")
        if raw.get("max_retries") not in {0, 1}:
            raise ProviderConfigError("The provider retry limit must be 0 or 1.")
        if not isinstance(raw.get("enabled"), bool):
            raise ProviderConfigError("The provider enabled value is invalid.")
        if any(
            not isinstance(raw.get(field), str) or not raw[field]
            for field in ("created_at", "updated_at")
        ):
            raise ProviderConfigError("The provider timestamps are invalid.")
        if not allow_missing_revision and (
            not isinstance(raw.get("revision"), str) or len(raw["revision"]) != 64
        ):
            raise ProviderConfigError("The provider revision is invalid.")

    def _atomic_write(self, payload: dict[str, object]) -> None:
        temporary = self.path.with_name(f".{self.path.name}.tmp")
        encoded = json.dumps(payload, sort_keys=True, indent=2).encode("utf-8")
        try:
            with temporary.open("wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
        except OSError as exc:
            temporary.unlink(missing_ok=True)
            raise ProviderConfigError(
                "The AI provider settings could not be saved safely."
            ) from exc
        try:
            os.replace(temporary, self.path)
        except OSError as exc:
            temporary.unlink(missing_ok=True)
            raise ProviderConfigError(
                "The AI provider settings could not be saved safely."
            ) from exc
        try:
            directory_fd = os.open(self.root, os.O_RDONLY)
        except OSError:
            # Windows and some filesystems do not expose directory handles for fsync.
            return
        try:
            os.fsync(directory_fd)
        except OSError:
            return
        finally:
            os.close(directory_fd)


@dataclass
class ProviderRuntime:
    store: ProviderSettingsStore
    test_mode: bool = False
    fake_scenario: str = "success"
    last_test: ConnectionTestResult | None = None
    credential_was_removed: bool = False

    @classmethod
    def from_environment(cls) -> ProviderRuntime:
        test_mode = os.getenv("RI_AI_TEST_MODE") == "1"
        scenario = os.getenv("RI_AI_FAKE_PROVIDER_SCENARIO", "success")
        if scenario not in TEST_SCENARIOS:
            scenario = "unexpected_provider_error"
        return cls(ProviderSettingsStore(), test_mode=test_mode, fake_scenario=scenario)

    def adapter(self) -> ProviderAdapter:
        return OpenAICompatibleAdapter(self.fake_scenario if self.test_mode else None)

    def set_scenario(self, scenario: str) -> None:
        if not self.test_mode or scenario not in TEST_SCENARIOS:
            raise ProviderConfigError("The test provider scenario is not available.")
        self.fake_scenario = scenario

    def credential_state(self, provider: str) -> str:
        try:
            present = provider_credential_status(provider)
        except KeychainCredentialUnavailable:
            return "unavailable"
        return "present" if present else "missing"

    def credential(self, provider: str) -> str:
        try:
            value = get_provider_credential(provider)
        except KeychainCredentialUnavailable:
            raise
        if not value:
            raise ProviderError(
                "credential_missing",
                "No provider credential is stored in the operating-system keychain.",
            )
        return value

    def save_credential(self, provider: str, value: str) -> None:
        save_provider_credential(provider, value)
        self.credential_was_removed = False
        self.last_test = None

    def remove_credential(self, provider: str) -> None:
        delete_provider_credential(provider)
        self.credential_was_removed = True
        self.last_test = None

    def state(self, config: ProviderConfig | None) -> ProviderStateName:
        if not self.store.available:
            return "configuration_invalid"
        if config is None:
            return "unconfigured"
        credential_state = self.credential_state(config.provider)
        if credential_state == "unavailable":
            return "configuration_invalid"
        if credential_state == "missing":
            return (
                "credential_removed"
                if self.credential_was_removed
                else "configured_without_credential"
            )
        if self.last_test is None:
            return "ready_untested"
        return "connection_verified" if self.last_test.status == "success" else "connection_failed"

    async def run_test(self, config: ProviderConfig) -> ConnectionTestResult:
        started = time.monotonic()
        try:
            credential = self.credential(config.provider)
            await self.adapter().test_connection(config, credential)
        except KeychainCredentialUnavailable:
            result = ConnectionTestResult(
                "failed",
                config.provider,
                config.model,
                timestamp(),
                None,
                "unexpected_provider_error",
                "The operating-system keychain is unavailable.",
            )
        except ProviderError as exc:
            result = ConnectionTestResult(
                "failed",
                config.provider,
                config.model,
                timestamp(),
                int((time.monotonic() - started) * 1000),
                exc.category,
                exc.message,
            )
        except asyncio.CancelledError:
            result = ConnectionTestResult(
                "failed",
                config.provider,
                config.model,
                timestamp(),
                None,
                "cancelled",
                "The connection test was cancelled.",
            )
        except Exception:  # noqa: BLE001 - provider failures become bounded safe results.
            result = ConnectionTestResult(
                "failed",
                config.provider,
                config.model,
                timestamp(),
                None,
                "unexpected_provider_error",
                "The provider connection test failed unexpectedly.",
            )
        else:
            result = ConnectionTestResult(
                "success",
                config.provider,
                config.model,
                timestamp(),
                int((time.monotonic() - started) * 1000),
                None,
                "Provider connection verified.",
            )
        self.last_test = result
        return result
