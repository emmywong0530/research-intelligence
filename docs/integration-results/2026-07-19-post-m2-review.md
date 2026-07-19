# Post-Task-2 Integration Review

## Verdict

**Blocked by missing load-bearing evidence.** The local API, companion security
tests, durable workspace lifecycle, transaction fault-injection suite, backup /
restore checks, frontend unit suite, schema validation, audits, and macOS
package smoke pass. The browser path that would connect the static PWA to the
loopback companion cannot launch successfully in this environment, and the
real macOS Keychain cannot be exercised here.

No feature is promoted to `End-to-end verified` or `Production ready`.

## Scope compliance

The checkpoint changes only the two dated documents in
`docs/integration-results/` and the evidence fields in
`docs/traceability-matrix.md`. No frontend, companion, schema, API, workflow,
test, packaging, or design behavior was changed. Task 3 was not started.

## Product and feature states

- **Interactive mock:** Task 1 discovery views, reading hub, focus reading,
  synthesis, research gaps, and other research-product surfaces remain typed
  in-memory prototype behavior.
- **Companion connected:** Task 0 pairing/security contracts and Task 2 API
  workspace operations exist, with local automated evidence.
- **Locally persisted:** Task 2 workspace metadata, schema-backed records,
  revisions, transactions, backups, and restore behavior write and reload from
  normal files in disposable local workspaces.
- **End-to-end verified:** none. The browser-to-companion path did not complete.
- **Production ready:** none. Cross-platform, real-keychain, accessibility,
  crash, and clean CI evidence are incomplete.

## Vertical-path verification

The strongest locally verified path is:

1. An authenticated client starts pairing and obtains a short-lived session.
2. The API creates a workspace in a disposable selected folder.
3. The companion writes a schema-valid project record through the allowlisted
   collection API and atomically updates `workspace.json`.
4. The record is read and listed by revision, then survives application-state
   recreation and workspace reopen.
5. A stale revision returns HTTP 409 without changing the current record.
6. A backup manifest is hash-verified, a stale restore is rejected, and a
   current restore retains a recovery backup.

This path covers API, companion, schema, durable files, conflict/recovery, and
reload/reopen evidence. The missing segment is the real static PWA browser path:
Chromium aborts during launch before UI status, capabilities, onboarding, or
browser pairing can be observed.

## Architecture and ADR compliance

The observed implementation remains consistent with accepted ADRs:

- static PWA plus loopback companion boundary;
- normal schema-versioned durable files and rebuildable device registry;
- exact origins, explicit companion-owned pairing, and keychain-only
  installation secret behavior;
- validation before writes, atomic files, recoverable multi-file transactions,
  staged restore, and stale revision protection;
- shared Discovery state remains an interactive mock.

The current API contract returns `session_token` once from pairing completion.
That is consistent with `docs/local-api.md` and the current implementation but
does not satisfy the literal stronger wording “session secrets never appear in
API responses.” This is a security/API clarification blocker, not a change made
inside this documentation checkpoint.

## Security and privacy review

Local tests and spikes pass for loopback binding, remote-interface rejection,
exact allowed origins, originless rejection, authentication, explicit pairing,
installation-secret non-exposure, path traversal, absolute paths, symlink
escape, workspace secret-field rejection, and packaged-artifact sentinels.

The direct HTTPS/CORS phase passes the configured GitHub Pages origin and rejects
invalid and missing origins. The browser phase is unverified. The fake-keyring
tests pass, but the real macOS Keychain attempt fails with sandbox OS status
`-67674`; no plaintext fallback was used.

No real workspace, private paper, API key, credential, or unpublished material
was used or committed.

## Data, schema, and API review

All 9 JSON Schemas validate under Draft 2020-12. The disposable API path
confirmed portable UUID identity, approved folder structure, metadata and
record revisions, stale conflicts, hash-verified backup manifests, staged
restore behavior, retained recovery backup, and device-local registry
separation. The existing 31 Task 2 foundation tests cover injected write,
cleanup, restore, and restart-recovery failures.

## Test quality and missing cases

Local unit and companion tests assert both positive and negative behavior. The
remaining high-value gaps are:

- successful browser execution on the static HTTPS PWA;
- clean GitHub Actions run evidence;
- real macOS Keychain access;
- Windows packaging and runtime;
- hard process-kill recovery and cross-platform filesystem/sync-provider tests;
- an explicit resolution of the session-token response contract.

## Visual fidelity and accessibility

Frontend unit tests pass and committed Task 1 captures remain available, but
Playwright visual/containment tests cannot run because Chromium aborts in this
local macOS sandbox. No new visual claim is made by this checkpoint.

## Traceability review

Updated rows: `SEC-001` through `SEC-005`, `WS-001` through `WS-019`, and the
Task 1 `UI-001` through `UI-003` rows. The updates record this checkpoint's
local API, schema, audit, packaging, fault-injection, and browser limitations.
No status was raised. In particular, no row is marked `End-to-end verified` or
`Production ready`.

## Required changes before merge

- Resolve the API/security wording and implementation decision for session-token
  exposure.
- Obtain a passing browser-to-companion integration run, locally or in a
  recorded GitHub Actions environment, before claiming complete vertical-path
  verification.

## Accepted limitations

The interactive mock product surfaces and locally persisted Task 2 foundation
are accurately represented at their current feature-completeness states. Real
keychain, Windows, hard-kill, and sync-provider limitations are accepted for
this checkpoint but block production-readiness claims.

## Follow-up improvements

Run a clean CI checkpoint with browser and packaging artifacts, add a supported
local browser runner, and extend recovery evidence to process termination and
cross-platform sync-folder behavior. Do not merge automatically.
