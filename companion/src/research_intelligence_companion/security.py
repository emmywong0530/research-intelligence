from __future__ import annotations

import logging
import secrets
import socket
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

LOOPBACK_NAMES = {"localhost"}
LOOPBACK_LITERALS = {"127.0.0.1", "::1"}
MAX_PAIRING_FAILED_ATTEMPTS = 5
PAIRING_EXPIRES_AFTER = timedelta(minutes=5)
SESSION_EXPIRES_AFTER = timedelta(minutes=15)
ORIGIN_REQUIRED_PATH_PREFIXES = (
    "/api/v1/authenticated-test",
    "/api/v1/installation-secret",
    "/api/v1/pairing",
    "/api/v1/spikes",
    "/api/v1/workspaces",
)
PAIRING_LOGGER = logging.getLogger("research_intelligence_companion.pairing")


class SecurityError(ValueError):
    pass


def validate_bind_host(host: str) -> str:
    if host in {"0.0.0.0", "::", ""}:  # noqa: S104 - reject wildcard bind hosts.
        raise SecurityError("Companion must bind only to loopback interfaces.")
    if host in LOOPBACK_LITERALS or host in LOOPBACK_NAMES:
        return host

    try:
        addresses = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise SecurityError(f"Cannot resolve bind host {host!r}.") from exc

    if addresses and all(is_loopback_address(address[4][0]) for address in addresses):
        return host
    raise SecurityError("Remote-interface binding is disallowed.")


def is_loopback_address(address: str) -> bool:
    return address.startswith("127.") or address == "::1"


def require_allowed_origin(request: Request, allowed_origins: tuple[str, ...]) -> None:
    origin = request.headers.get("origin")
    if origin is None:
        if requires_browser_origin(request.url.path):
            raise HTTPException(status_code=403, detail="Origin header is required.")
        return
    if origin not in allowed_origins:
        raise HTTPException(status_code=403, detail="Origin is not allowed.")


def requires_browser_origin(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in ORIGIN_REQUIRED_PATH_PREFIXES)


def utc_now() -> datetime:
    return datetime.now(tz=UTC)


def iso_timestamp(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


@dataclass
class PairingAttempt:
    approval_code: str
    expires_at: datetime
    failed_attempts: int = 0


@dataclass
class Session:
    expires_at: datetime


class InMemorySecurityState:
    def __init__(self) -> None:
        self.pairings: dict[str, PairingAttempt] = {}
        self.sessions: dict[str, Session] = {}

    def start_pairing(self) -> tuple[str, PairingAttempt]:
        pairing_id = secrets.token_urlsafe(18)
        approval_code = f"{secrets.randbelow(1_000_000):06d}"
        attempt = PairingAttempt(
            approval_code=approval_code,
            expires_at=utc_now() + PAIRING_EXPIRES_AFTER,
        )
        self.pairings[pairing_id] = attempt
        PAIRING_LOGGER.warning(
            "Pairing approval code for %s: %s",
            pairing_id,
            approval_code,
        )
        return pairing_id, attempt

    def complete_pairing(self, pairing_id: str, approval_code: str) -> tuple[str, Session]:
        attempt = self.pairings.get(pairing_id)
        if attempt is None:
            raise HTTPException(status_code=401, detail="Pairing attempt is invalid or expired.")
        if attempt.expires_at <= utc_now():
            del self.pairings[pairing_id]
            raise HTTPException(status_code=401, detail="Pairing attempt is invalid or expired.")
        if not secrets.compare_digest(attempt.approval_code, approval_code):
            attempt.failed_attempts += 1
            if attempt.failed_attempts >= MAX_PAIRING_FAILED_ATTEMPTS:
                del self.pairings[pairing_id]
            raise HTTPException(status_code=401, detail="Pairing code is invalid.")
        token = secrets.token_urlsafe(32)
        session = Session(expires_at=utc_now() + SESSION_EXPIRES_AFTER)
        self.sessions[token] = session
        del self.pairings[pairing_id]
        return token, session

    def validate_session(self, token: str) -> None:
        session = self.sessions.get(token)
        if session is None or session.expires_at <= utc_now():
            raise HTTPException(status_code=401, detail="Session is invalid or expired.")


bearer_scheme = HTTPBearer(auto_error=False)


def require_bearer_token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Bearer session token is required.")
    return credentials.credentials
