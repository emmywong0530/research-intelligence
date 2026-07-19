# ADR 001: Local-first PWA plus loopback companion

## Status
Accepted

## Decision
Use a static installable PWA and a separately installed local companion for filesystem, keychain, PDF processing, indexes, jobs, scholarly APIs, and AI calls.

The current implementation boundary is the PWA shell in
[`apps/web/src/App.tsx`](../../apps/web/src/App.tsx) and the loopback FastAPI
companion in
[`companion/src/research_intelligence_companion/app.py`](../../companion/src/research_intelligence_companion/app.py).
Task 2 implements workspace files and a device-local registry; future PDF,
index, scholarly API, and AI capabilities remain outside the merged behavior.

## Consequences
No central user DB; loopback-only; exact Origin enforcement, explicit pairing,
short-lived sessions, keychain-only installation secrets, and GitHub hosts code
only. See [ADR 002](002-durable-files-rebuildable-indexes.md) for durable versus
device-local storage and [ADR 003](003-loopback-pairing-security.md) for the
companion security boundary.
