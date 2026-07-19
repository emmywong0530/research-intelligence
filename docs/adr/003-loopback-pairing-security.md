# ADR 003: Companion-owned pairing and keychain identity

## Status
Accepted

## Decision
Pairing approval is independently shown by the companion. The browser never receives everything needed to approve itself. Per-installation secret is OS-keychain only.

The implementation is in
[`companion/src/research_intelligence_companion/security.py`](../../companion/src/research_intelligence_companion/security.py),
[`companion/src/research_intelligence_companion/keychain.py`](../../companion/src/research_intelligence_companion/keychain.py),
and
[`companion/src/research_intelligence_companion/app.py`](../../companion/src/research_intelligence_companion/app.py).
Task 0 uses a companion console display for the approval code, in-memory
sessions, exact allowed origins, and no plaintext fallback. The fake-keyring
tests pass locally; the real OS keychain and browser E2E remain environment-
dependent checks.

See [ADR 001](001-local-first-pwa-companion.md) for the PWA/companion boundary
and [ADR 002](002-durable-files-rebuildable-indexes.md) for workspace storage.
