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
