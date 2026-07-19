# Task 2 Workspace Foundation Results

## Implemented

Task 2 replaces the Task 0 workspace spike with a guarded local data foundation:

- workspace creation and validated opening with stable IDs;
- approved workspace directory initialization and safe temp cleanup;
- Draft 2020-12 validation for the existing durable JSON schemas;
- stable content-hash revisions and stale-write conflict responses;
- temporary-file, file-`fsync`, atomic-replace writes with best-effort directory `fsync`;
- timestamped pre-write, manual, and pre-restore backups;
- aggregate-workspace-revision-guarded restore with a recovery backup;
- traversal, absolute-child-path, Windows-drive-path, and symlink-escape protection;
- a rebuildable SQLite workspace registry outside the workspace;
- authenticated, versioned workspace API routes;
- frontend workspace create/open controls, health status, and clear error states in the approved onboarding modal.

## File Layout

- `companion/src/research_intelligence_companion/workspace.py`: schema validation, path policy, durable records, writes, backups, conflicts, and restore.
- `companion/src/research_intelligence_companion/device.py`: device-local SQLite registry.
- `companion/src/research_intelligence_companion/models.py`: API request and response contracts.
- `companion/src/research_intelligence_companion/app.py`: protected versioned API endpoints.
- `apps/web/src/companionClient.ts`: authenticated workspace client operations.
- `apps/web/src/App.tsx`: workspace setup state inside the existing onboarding flow.
- `companion/tests/test_task2_workspace_foundation.py`: Task 2 storage and API coverage.
- `apps/web/src/App.test.tsx`: frontend workspace create/open and error-state coverage.

## API Endpoints

Implemented endpoints are documented in `docs/local-api.md` and include create/open, metadata, initialize, health, approved record read/write/list, backup create/list/restore, and conflict reporting. All workspace routes require a paired in-memory session and exact allowed origin. The frontend never supplies an arbitrary filename.

## Validation and Conflict Behavior

Records are validated before any file write. Schema validation is paired with explicit ISO 8601 timezone validation because JSON Schema format annotations are not assertions in the bundled validator. Secret-looking fields are rejected. Existing records require their current SHA-256 revision; stale writes return HTTP 409 and leave current data unchanged. No automatic semantic merge is attempted.

## Backup Behavior

Backups are full durable-workspace snapshots excluding the `backups/` directory and device-local data. Existing-record writes create pre-write backups, explicit backup requests create manual snapshots, and restores create a pre-restore recovery snapshot. There is no automatic retention policy in Task 2.

## Exact Verification Commands

The following commands were run locally. The Python commands used the repository companion virtual environment by prepending `companion/.venv/bin` to `PATH`.

| Command | Result |
| --- | --- |
| `python scripts/validate_schemas.py` | Passed; 9 Draft 2020-12 schemas validated |
| `pnpm frontend:lint` | Passed |
| `pnpm frontend:typecheck` | Passed |
| `pnpm frontend:test` | Passed; 11 tests |
| `pnpm frontend:build` | Passed |
| `python -m ruff check companion/src companion/tests` | Passed |
| `python -m pytest companion/tests` | Passed; 36 tests, 1 dependency deprecation warning |
| `pnpm frontend:e2e` | Not verified locally; preview server started after loopback permission was granted, but Playwright Chromium was unavailable. Five tests were blocked before assertions. |
| `pnpm audit --audit-level moderate` | Passed; no known vulnerabilities |
| `python -m pip_audit --requirement companion/requirements-dev.txt` | Passed with `--cache-dir /tmp/research-intelligence-pip-audit`; the default cache location was not writable in the sandbox |
| `PYINSTALLER_CONFIG_DIR=/tmp/research-intelligence-pyinstaller python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean` | Passed on macOS; packaged `--check` and artifact secret scan passed |
| `PYTHONPATH=companion/src python -m research_intelligence_companion.spikes binding` | Passed |
| `PYTHONPATH=companion/src python -m research_intelligence_companion.spikes workspace` | Passed |
| `PYTHONPATH=companion/src python -m research_intelligence_companion.spikes all` | Not fully verified; binding/workspace reached, keychain roundtrip was blocked by the sandbox macOS Keychain error `-67674` |
| `pnpm spike:pwa-loopback` | Not verified locally; health, configured/invalid/missing-origin, and CORS checks passed, but the Playwright browser phase was blocked by the missing Chromium executable |

Windows packaging was not run on this macOS host. Packaging and security workflows are attempted where the local host permits them. Any unavailable browser, keychain, network, or platform-specific dependency is reported explicitly rather than treated as a pass.

## Scope Boundary

No scholarly API calls, PDF parsing, AI calls, embeddings, full-text search, reading persistence, synthesis logic, gap automation, account authentication, or cloud database was added.
