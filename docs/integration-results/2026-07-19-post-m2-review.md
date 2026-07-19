# Post-Task-2 Integration Review

## Verdict

**Ready to merge this documentation-only checkpoint.** The local API,
companion security tests, durable workspace lifecycle, transaction
fault-injection suite, backup / restore checks, frontend unit suite, schema
validation, audits, and macOS package smoke pass. The recorded GitHub Actions
runs also pass the browser-to-companion path, frontend E2E, both platform
keychain spikes, and macOS/Windows packaging. The local Codex sandbox still
cannot run Chromium or the real macOS Keychain.

No feature is promoted to `Production ready`. Existing feature statuses remain
unchanged; the recorded browser spike supports the integration checkpoint, but
does not by itself promote every individual feature to `End-to-end verified`.

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
- **End-to-end verified:** no individual feature status was raised. GitHub
  Actions verified the frontend E2E and HTTPS loopback spike; the Task 2
  workspace browser path is not separately exercised.
- **Production ready:** none. Local browser/keychain limitations, hard-kill
  recovery, cross-platform sync behavior, and broader production evidence are
  incomplete.

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
reload/reopen evidence. Separately, GitHub Actions CI run `29698614152` passed
the frontend E2E suite and the HTTPS static PWA loopback browser spike,
including browser-connected companion verification. The only missing execution
environment is local Chromium in the Codex sandbox, which aborts during launch
before its UI can be inspected locally.

## Architecture and ADR compliance

The observed implementation remains consistent with accepted ADRs:

- static PWA plus loopback companion boundary;
- normal schema-versioned durable files and rebuildable device registry;
- exact origins, explicit companion-owned pairing, and keychain-only
  installation secret behavior;
- validation before writes, atomic files, recoverable multi-file transactions,
  staged restore, and stale revision protection;
- shared Discovery state remains an interactive mock.

The current API contract returns one short-lived `session_token` from pairing
completion. That is consistent with `docs/local-api.md` and the implementation.
The installation secret, API keys, and companion-owned approval code remain
non-returned; the session token is held only in frontend memory, expires, and is
invalidated on companion restart. The broader checkpoint wording is clarified
here; it is not a product implementation blocker or a reason to redesign the
pairing exchange.

## Security and privacy review

Local tests and spikes pass for loopback binding, remote-interface rejection,
exact allowed origins, originless rejection, authentication, explicit pairing,
installation-secret non-exposure, path traversal, absolute paths, symlink
escape, workspace secret-field rejection, and packaged-artifact sentinels.

The direct HTTPS/CORS phase passes the configured GitHub Pages origin and rejects
invalid and missing origins. GitHub Actions CI run `29698614152` passed the
HTTPS static PWA loopback browser spike and frontend E2E. GitHub Actions Task 0
run `29698614143` passed keychain spikes on `macos-latest` and `windows-latest`.
The fake-keyring tests pass, while the real macOS Keychain attempt fails only in
the local sandbox with OS status `-67674`; no plaintext fallback was used.

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

- local browser execution on the static HTTPS PWA;
- local real macOS Keychain access;
- hard process-kill recovery and cross-platform filesystem/sync-provider tests;
- no production-readiness claim for the current milestone.

## Visual fidelity and accessibility

Frontend unit tests pass and committed Task 1 captures remain available.
Playwright visual/containment tests remain unavailable in the local macOS
sandbox because Chromium aborts, while the GitHub Actions frontend E2E suite
passed in run `29698614152`. No production visual-fidelity claim is made.

## Traceability review

Updated rows: `SEC-001` through `SEC-005`, `WS-001` through `WS-019`, and the
Task 1 `UI-001` through `UI-003` rows. The updates record local and GitHub
Actions verification scope, including CI runs `29698614152`, `29698614143`, and
`29698614146`, against commit
`5899255e5a75235aa96fc47f6c3b31d3c4ac4a7f`. No status was raised. No row is
marked `Production ready`; individual rows retain their existing states.

## Required changes before merge

None for this documentation-only checkpoint. The supplied GitHub Actions runs
provide recorded browser, keychain, companion, and packaging evidence. The
local sandbox limitations remain documented and do not block this checkpoint.

## Accepted limitations

The interactive mock product surfaces and locally persisted Task 2 foundation
are accurately represented at their current feature-completeness states. Local
browser and real-Keychain limitations, hard-kill recovery, and sync-provider
coverage are accepted for this checkpoint but block production-readiness claims.

## Follow-up improvements

Keep the successful CI run IDs attached to the PR, add a supported local browser
runner, and extend recovery evidence to process termination and cross-platform
sync-folder behavior. Do not merge automatically.
