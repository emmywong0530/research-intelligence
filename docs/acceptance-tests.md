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

## Task 3E Persisted Paper Record Tests

The Task 3E vertical slice must cover:

- require a paired companion, active workspace, and explicitly opened project
  before showing project papers;
- list only the active project's schema-valid `papers` records through the
  server-side `project_id` filter, with an honest empty state;
- create and update metadata-only records using only approved paper-schema
  fields, including title, authors, optional year/venue/DOI/abstract and
  optional descriptive metadata;
- reject empty titles/authors, schema-invalid fields, missing projects, missing
  or mismatched parent IDs, paper ID mismatches, and project reassignment
  before durable write;
- persist records at `papers/<paper-id>/metadata.json`, update the workspace
  index through the existing recoverable transaction, and reopen the same
  record after companion/workspace recreation;
- return `409` for stale revisions, keep local edits visible, fetch the latest
  record, and require explicit reconciliation without silent merge;
- register paper editor drafts with the existing dirty navigation guard and
  preserve input on cancel, discard, validation, availability, and conflict;
- derive Project Overview paper count and bounded recent metadata from the
  companion after create/update, without claiming PDF or full-text access;
- keep paper records, selected IDs, workspace/project context, paths, drafts
  and sessions out of browser storage and device-local indexes;
- keep PDF import, download, parsing, OCR, DOI lookup, enrichment, discovery,
  reading, notes, AI, search, embeddings, synthesis and export out of scope.

Frontend tests use mocked fetch for deterministic UI and dirty-state coverage.
Companion tests use disposable workspaces and authenticated generic record
routes. The required HTTPS static-host browser flow must create, edit, reopen
and verify a paper record through the real companion; if Chromium is
unavailable, that path is unverified.

## Task 4A Local PDF Import Tests

The Task 4A vertical slice must cover:

- require a paired companion, active workspace, explicitly opened project and
  persisted paper before showing the source-file controls;
- show no-source state, accept an explicit browser PDF selection, show an
  in-memory filename/size preview, and avoid any durable request before the
  user chooses Import PDF;
- stream raw PDF bytes to the authenticated loopback companion and validate
  the approved media type, sanitized filename, non-empty body, 50 MB bound and
  `%PDF-` signature before writing;
- write `papers/<paper-id>/source/original.pdf` and its validated
  `source.json` sidecar, update the existing paper's approved PDF status, and
  display filename, size, SHA-256 and `PDF stored; text not extracted` after
  success;
- reject missing/invalid paper association, invalid source metadata, stale
  paper revision, corrupted/incomplete source state and replacement without an
  explicit confirmation;
- preserve the selected file and source state after companion, validation,
  size or conflict errors and protect it with the existing dirty navigation
  guard;
- replace an existing source only after explicit confirmation, retain a
  recovery backup, verify source hash/size on read, and recover old-or-new
  state after injected failures and workspace reopen;
- keep PDFs, source metadata, selected files, paths, project/paper IDs, drafts
  and sessions out of browser storage and device-local indexes;
- keep PDF viewing, parsing, OCR, text extraction, download, DOI lookup,
  enrichment, search, embeddings, AI, citations, notes, discovery and
  institutional access out of scope.

Frontend tests use mocked fetch for deterministic selection, preview, dirty,
error and replacement UI coverage. Companion tests use disposable workspaces
and real authenticated raw-byte API requests. The required HTTPS static-host
browser flow must select generated disposable PDFs, import, reload, replace,
and verify source metadata through the real companion; if Chromium is
unavailable, the flow is unverified rather than inferred from unit tests.

## Task 3D Project Overview Tests

The Task 3D vertical slice must cover:

- open a persisted project from Projects and land on the project-scoped
  Project Overview route;
- require a connected, paired companion, an active workspace, and explicit
  project selection before loading overview data;
- read the latest project record and deterministic Research Profile record
  from the companion, rejecting workspace or project mismatches;
- show the persisted project header, timestamps, safe workspace label, profile
  summary counts and bounded previews without fabricating later-milestone
  statistics;
- distinguish a missing Research Profile from malformed or unsupported
  durable profile data;
- count only actionable Task 3C proposals as pending and preserve legacy
  proposal shells as explicitly non-actionable;
- navigate to project editing, Research Profile editing, pending proposals and
  back to Projects without duplicating the existing editors;
- refresh the overview after project, profile or proposal saves and show the
  latest persisted counts without requiring a full reload;
- clear active project context after a successful workspace change, preserve
  it after a failed workspace change, and prevent cross-workspace project or
  profile display;
- preserve the existing dirty project, profile and proposal-edit navigation
  protections;
- keep project IDs, profile IDs, workspace paths and session tokens out of
  browser storage;
- run a real browser-to-loopback-companion flow that creates disposable
  workspace data, opens the overview, completes one proposal decision, reloads,
  reopens the workspace and project, and verifies the durable overview state.

Frontend tests use mocked fetch for deterministic UI and state coverage. The
HTTPS spike is the required real browser evidence; if Chromium is unavailable,
the browser path must be reported as unverified rather than inferred from unit
tests or direct HTTP checks.

## Task 3F Persisted Notes Tests

The Task 3F vertical slice must cover:

- require a paired companion, active workspace and project before showing notes;
- list project notes and paper notes with server-side project/paper scope filters;
- create only after the user explicitly opens the form;
- validate non-empty bounded plain-text title/body values and preserve input on errors;
- persist project and paper notes at their approved nested paths and reopen them;
- enforce project existence, paper existence, parent/path association, immutable scope and workspace isolation;
- return `409` for stale note revisions without changing the current note;
- keep local edits visible and require an explicit reload or latest-revision reconciliation;
- show project overview note count/recent preview and a Paper notes action;
- protect dirty note drafts with the existing navigation and workspace-change guard;
- keep notes, IDs, paths, drafts, sessions and credentials out of browser storage;
- preserve existing atomic transaction, backup, restore, schema, authentication and Origin tests;
- run the real HTTPS static PWA flow for project-note and paper-note create/update/reopen when a browser is available.

Frontend note tests use mocked fetch for deterministic state coverage. Companion
note tests use disposable workspaces and real authenticated FastAPI routes. A
mocked-fetch test is not end-to-end persistence evidence.

## Task 4B Local PDF Text Extraction Tests

The Task 4B vertical slice must cover:

- require a registered local PDF and an authenticated active project before
  showing extraction controls;
- explicitly extract deterministic text with `pypdf`, persist the strict
  `m4b.v1` record and `full.txt`, and verify page, character and word counts;
- preserve Unicode text, report page-level no-text warnings, and state that OCR
  was not run without claiming a successful OCR result;
- reject malformed and encrypted PDFs, page/character limits, source checksum
  changes during parsing and extraction attempts without a PDF, without
  leaving partial artifacts;
- return only bounded summary/preview data to the PWA and keep full text local;
- require explicit `reextract=true` for an existing result, report a replaced
  source as stale, and verify a new source-linked checksum after re-extraction;
- exercise extraction transaction fault points, prior-result preservation and
  restart recovery without an old/new mixed pair;
- keep extracted text, PDFs, paths, session tokens, browser state and full text
  out of browser storage, logs, device-local indexes and source control;
- run the real HTTPS static-host browser flow with disposable generated PDFs,
  import, extract, replace, observe stale state, re-extract, reload and reopen.

Frontend tests may use mocked fetch for deterministic UI state coverage.
Companion tests must use disposable workspaces and authenticated API requests.
Only a passing real browser-to-companion flow may promote this path to
End-to-end verified.

## Task 4C Deterministic Duplicate Detection Tests

The Task 4C vertical slice must cover:

- compute the report from validated records in the active workspace only;
- create an exact-source group when two papers contain the same verified PDF
  bytes, including papers in different projects;
- remove exact-source evidence when one source is replaced and avoid matching
  different PDF bytes;
- compute exact-identifier groups only for the same supported normalized DOI,
  PMID or arXiv value, preserving identifier type and rejecting malformed or
  unsupported identifiers;
- compute conservative metadata candidates from normalized title, year and
  first-author surname without claiming identity, semantic similarity or
  global uniqueness;
- rebuild evidence after paper metadata/source changes and never rely on a
  stale browser cache or device-local index;
- scope project and paper filters server-side while retaining the owning
  project in cross-project evidence details;
- reject unauthenticated, invalid-Origin and missing-Origin requests and keep
  the report free of full paths, PDF bytes, full hashes and secrets;
- skip malformed records and unverifiable/symlinked source files with bounded
  warnings, and enforce bounded paper/group/warning work;
- persist only explicit review annotations through the strict `m4c.v1`
  duplicate-review schema; reject stale reviews and prevent `reviewed_not_duplicate`
  for exact-source evidence;
- preserve evidence and both paper records after every review action: no
  merge, delete, hide, reassign or automatic metadata rewrite exists;
- show exact, identifier and metadata evidence distinctly in Papers, while the
  bounded Project Overview summary uses the active-project filter and counts
  each affected project paper once, with clear review state and owning project
  available in Papers;
- keep reports, review state, paper IDs, paths, source bytes and session tokens
  out of browser storage and device-local indexes;
- run the real HTTPS static PWA flow with disposable generated PDFs in two
  projects, verify exact-source evidence, replace one PDF, verify its removal,
  create a metadata/identifier candidate, record an explicit review, reload,
  reopen and verify the review state.

Frontend tests may use mocked fetch for deterministic report and review UI
coverage. Companion tests must use disposable workspaces and authenticated
FastAPI routes. A mocked-fetch test or direct HTTP report request is not
end-to-end browser evidence. If Chromium is unavailable, the browser path is
unverified and the feature remains `Locally persisted`.

## Task 4D Structured Paper Metadata

Verify with disposable workspaces that a minimal paper opens in readable view,
enters explicit edit mode, preserves ordered literal authors, accepts bounded
manual metadata, normalizes supported identifiers, rejects unsafe URLs and
unknown fields, reports derived completeness, saves through an expected
revision, and reloads with the same data. Verify local PDF, extraction,
duplicate and paper-note summaries remain separate and truthful. Verify list
sorting/filtering, Project Overview counts, dirty-state protection, project
and workspace isolation, no browser storage, and a stale revision conflict.

The HTTPS static PWA spike must use the real companion and disposable generated
fixtures. It must create/open the workspace and paper, update structured
metadata, import/extract the local PDF, inspect note and duplicate summaries,
reload/reopen and verify persistence. A mocked-fetch test or direct API test is
not browser evidence. Chromium-unavailable runs remain unverified.

## Task 5A AI Provider Foundation

The Task 5A vertical slice must cover:

- expose only the approved OpenAI-compatible provider adapter and bounded
  configuration fields;
- store nonsecret provider settings in the device-local, versioned settings
  file outside the workspace with atomic replacement and stale-revision
  protection;
- store, replace and remove credentials through the OS keychain only;
- preserve the previous valid credential when replacement cannot be verified;
- report a blocked keychain-unavailable state without a plaintext fallback;
- keep credentials out of API responses, logs, workspace files, browser
  storage, snapshots, source control and packaged artifacts;
- require pairing, a valid short-lived session and an exact allowed Origin for
  every provider route, while rejecting missing or invalid Origin;
- run a connection test only after explicit user action, without user or
  research content, raw provider bodies, headers, stack traces or key input;
- map authentication, permission, model, rate-limit, timeout, network,
  cancellation, provider and unexpected failures to bounded safe results;
- apply no retry to authentication/invalid configuration failures and at most
  one bounded transient retry under a total deadline;
- invalidate a verified state after provider/model/timeout/retry/credential
  changes and after companion restart;
- preserve edited configuration input after a `409` conflict and require an
  explicit reload/retry decision;
- keep the deterministic fake adapter and scenario controls available only in
  explicit test mode, never as a production provider choice;
- keep provider configuration, credential state, test results, workspace IDs,
  project IDs, paths and session tokens out of localStorage, sessionStorage,
  IndexedDB and cookies;
- run the real HTTPS static PWA flow with an isolated fake provider: configure,
  store a synthetic credential, explicitly test success, switch to an auth
  failure, replace and remove the credential, reload, re-pair and verify that
  nonsecret configuration persists while the credential does not appear.

Frontend tests may use mocked fetch for deterministic Settings state coverage.
Companion tests must use an isolated keyring fixture and authenticated API
requests. Only the real HTTPS browser-to-companion flow can claim
End-to-end verified; a local run without Chromium remains unverified.
