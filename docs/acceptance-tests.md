# Acceptance Tests

Acceptance tests must prove the behavior required by the current milestone. Do not claim a milestone has passed unless the command was actually run and its result is reported.

## Task 0 Technical-Spike Tests

Task 0 tests cover remote-interface rejection, unauthenticated requests, exact origin enforcement, pairing lifecycle, secret non-exposure, workspace path containment, interrupted writes, and schema-version fields. The HTTPS static PWA loopback spike separately verifies browser access to the loopback companion.

## Task 2 Workspace Foundation Tests

Task 2 automated tests cover:

- create workspace and initialize the approved durable folder structure;
- open an existing valid workspace and return the same stable workspace ID;
- move or rename a workspace and reopen it using the stored portable ID;
- update the device-local path mapping and reject copied duplicate IDs without overwriting it;
- reject missing, malformed, or mismatched workspace metadata;
- validate all schema-backed records before writing;
- reject secret-looking record fields;
- read/list records from the allowlisted collection map;
- preserve the prior file when an interrupted atomic write leaves a temp file;
- fsync and atomic replace behavior at the write layer;
- clean abandoned companion temporary files safely;
- record hashes and stale-revision conflict responses;
- preserve current data during conflicts without semantic merging;
- commit record and metadata index changes as one recoverable transaction;
- recover record transactions after injected replacement and cleanup failures;
- create timestamped backups before existing-record writes;
- hash-verify complete backup snapshots and reject incomplete/corrupted snapshots;
- stage and recover interrupted backup restores while retaining the recovery backup;
- reject path traversal, absolute child paths, Windows drive paths, and symlink escape;
- reject unauthenticated workspace operations and retain origin enforcement;
- keep the device-local SQLite registry outside the durable workspace;
- report workspace health and clear frontend create/open/error states;
- keep API keys, installation secrets, pairing codes, and session secrets out of responses, logs, workspace files, browser storage, and source control.

## Task 3A Project Lifecycle Tests

Task 3A adds a bounded project vertical slice over the generic allowlisted
durable-record API. Tests cover:

- list projects from the active authenticated workspace;
- create a project from trimmed name, research idea and central question fields;
- generate a stable project ID with browser cryptographic randomness;
- validate the existing `project.schema.json` before durable write;
- open the latest project record and retain its content revision;
- save edits only when the form is dirty and include the expected revision;
- preserve edits after validation, companion, and unexpected save failures;
- reject stale saves with HTTP `409` without overwriting the current record;
- explicitly reload the latest record or keep unsaved edits after a conflict;
- reload the same project after companion/application recreation;
- keep project-session state in memory without browser storage;
- show loading, empty, disconnected, unavailable, populated, selected and
  error states without representing mock preview cards as saved records;
- retain a navigation confirmation when a project form has unsaved edits.

The companion integration test uses disposable temporary workspaces and the
real FastAPI routes. Frontend project tests use mocked fetch for deterministic
UI state coverage; they are not browser end-to-end evidence.

## Required Local Commands

```bash
python scripts/validate_schemas.py
pnpm frontend:lint
pnpm frontend:typecheck
pnpm frontend:test
pnpm frontend:build
python -m ruff check companion/src companion/tests
python -m pytest companion/tests
pnpm frontend:e2e
```

Packaging and security workflows should be run locally where the host supports them. GitHub Actions remains authoritative for clean macOS and Windows packaging environments and for browser tests requiring downloaded Chromium.

## Out of Scope

Task 2 does not implement OpenAlex, Crossref, PDF parsing, AI summaries, embeddings, full-text search, reading persistence, synthesis logic, gap automation, account authentication, or cloud databases.

## Task 3B Research Profile Tests

The Task 3B vertical slice must cover:

- require an active persisted project before showing a profile;
- list and read the profile for the active project through typed client
  wrappers and the authenticated generic API;
- create explicitly at `research_profile_<project_id>` without silent creation;
- write the profile at the approved nested durable path and reload it after
  companion/application recreation;
- enforce the project ID, profile ID, parent ID, and existing-project
  relationship on the companion;
- prevent duplicate profiles and isolate profiles when the active project
  changes;
- edit the supported user-authored fields, including concepts with optional
  finite weights and duplicate-free accessible list/chip controls;
- validate before writing, preserve invalid input after validation or network
  errors, and retain `schema_version`, stable IDs, and timestamps;
- return `409` for a stale profile revision, preserve the local draft, block
  Save, fetch the latest version explicitly, and require an explicit choice
  before saving with the fetched revision;
- protect dirty profile drafts during reload, navigation, project-context
  changes, and companion errors;
- block workspace Create/Open before any API request when a project or profile
  editor is dirty, with explicit Keep editing and Discard edits and change
  workspace actions;
- preserve the requested workspace operation, path, and name through the
  confirmation flow, preserve drafts and the current workspace on failure,
  and clear workspace-scoped project context only after successful change;
- require explicit project reopening after every successful workspace change,
  including a reopen of the same durable workspace ID;
- keep session and profile state in memory only, with no browser storage use;
- keep proposal fields, paper feedback, selectors, and automatic profile
  learning out of the Task 3B write path.

Frontend tests use mocked fetch for deterministic state coverage. Companion
tests use disposable workspaces and the real FastAPI generic record routes.
They do not constitute browser end-to-end evidence; a browser-backed profile
path must be reported separately when executable.

## Task 3C Transparent Profile Proposal Tests

The Task 3C vertical slice must cover:

- migrate an existing `m2.v1` profile to `m3c.v1` on open, preserve all fields
  and legacy proposal shells, refuse future/corrupt versions, and rerun safely;
- display pending proposals only for the active project and workspace, with
  plain-language explanation, current value, proposed value, and Not applied;
- accept, modify, reject, and reverse through one expected-revision profile
  write, preserving original proposed values and decision history;
- validate supported proposal types, target mappings, duplicate-free values,
  finite concept weights, and unsupported proposal payloads before writing;
- require explicit confirmation for apply, modified apply, reject, and reverse;
- reject duplicate decisions or handle exact repeats idempotently without
  changing the original proposal identity or history;
- return `409` for stale decisions, preserve local modifications, fetch the
  latest profile before retry, and never adopt a revision from the error;
- restore a prior value only when it still matches the applied snapshot, and
  record a blocked reconciliation event when a later edit makes reversal
  unsafe;
- persist decisions across profile reload, companion recreation, and workspace
  reopen; keep proposal state out of SQLite, FTS, vector indexes, and browser
  storage;
- protect dirty proposal edits and unconfirmed decisions during navigation,
  reload, project changes, and workspace changes;
- keep semantic examples, screening-instruction changes, paper feedback,
  ingestion, search, ranking, synthesis, export, and automatic learning out
  of scope.

Frontend tests use mocked fetch for UI and dirty-state coverage. Companion
tests use disposable workspaces and generic authenticated API writes. A real
browser-to-companion proposal flow is separate evidence and must be marked
unverified when Chromium or the companion harness is unavailable.
