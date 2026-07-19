# Task 3A Project Lifecycle Implementation Report

## Task and scope
- Task: Task 3A, persisted project lifecycle
- Branch: `feature/m3a-project-lifecycle`
- Base implementation commit: `d1cca44` (`feat: implement persisted project lifecycle`)
- Review correction: conflict recovery now requires an explicit latest-versus-preserved choice, and dirty project switching/New actions retain their requested action behind confirmation.
- Review fix commit message: `fix: make project conflict recovery safe`
- Included: list, create, open, edit and revision-guarded save of project records through the existing authenticated generic durable-record API; frontend loading, empty, error, disconnected, conflict and unsaved-navigation states.
- Explicitly excluded: deletion, duplication, collaboration, cloud sync, accounts, AI feedback, papers, search, vectors, FTS, citations, synthesis, export and analytics.

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Companion project record API | Locally persisted | Local FastAPI integration tests use disposable workspaces and validate the real schema-backed routes, atomic revisions, conflict response and reopen persistence. | No |
| Projects screen with connected workspace | Companion connected | Local React tests cover the typed client and UI states with mocked fetch. The UI uses real companion routes when a healthy paired workspace is present. | Replaces the previous Projects-only mock path when connected |
| Complete browser form-to-companion project lifecycle | Companion connected | Not verified locally; Playwright cannot launch Chromium in this macOS sandbox. | No claim of end-to-end verification |

No capability is `End-to-end verified` or `Production ready` from this task.

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Open Projects with a healthy paired workspace | `apps/web/src/projects.tsx` calls `listProjects` | `GET /api/v1/workspaces/{workspace_id}/records/projects` | Existing session/origin middleware and `list_records` | `projects/*/project.json`, `project.schema.json` | `test_project_create_read_update_list_and_reopen_persisted_record`; project UI tests |
| Create project | `ProjectEditor` trims and validates three required fields, generates a cryptographically random ID and calls `writeProject` | Existing generic `PUT .../records/projects/{project_id}` | Existing schema validation and journaled record/index transaction | `projects/{project_id}/project.json` and `workspace.json` index | `test_project_schema_and_secret_rejection_happen_before_write`; frontend create test |
| Open and edit project | `openProject` reads the latest record and tracks its revision; clean forms do not enable save | Existing generic `GET .../records/projects/{project_id}` and `PUT` | Existing durable read/write and revision hash | Existing record remains schema-valid and ID-stable | frontend open/edit/save test; companion persistence test |
| Handle stale save | A `409` preserves the local draft, never adopts the server-reported revision, blocks Save, and offers reload-latest or fetched latest-versus-preserved reconciliation | Existing `409 workspace_conflict` response | Existing stale revision protection | Current durable record remains unchanged until an explicit choice and revisioned save | stale revision companion test; frontend conflict, disabled-save, reconciliation and revision tests |
| Leave with unsaved edits | App navigation guard opens an explicit confirmation modal | No API request until the user chooses to save | No hidden discard | Unsaved data is not silently written or destroyed by navigation | frontend dirty-state callback test |

## Files changed

Created:
- `apps/web/src/projects.tsx`
- `apps/web/src/projects.test.tsx`
- `companion/tests/test_task3a_project_lifecycle.py`
- `docs/task-3a-project-lifecycle-results.md`

Modified:
- `apps/web/src/App.tsx`
- `apps/web/src/companionClient.ts`
- `apps/web/src/styles.css`
- `docs/acceptance-tests.md`
- `docs/traceability-matrix.md`

Deleted: none.

## Contracts changed

No schema, workspace-format, API endpoint, or ADR changes were required. The
implementation reuses the approved `projects` collection and generic record
routes documented in `docs/local-api.md`. The existing `project.schema.json`
was sufficient and remains unchanged.

The typed frontend client adds wrappers for the existing list/read/write
contract and retains API error codes/details for conflict handling. It does not
add project-specific CRUD endpoints.

## Security and privacy

- All project operations continue through the loopback companion with existing exact-origin and short-lived pairing-session enforcement.
- The frontend keeps the session token in React component state only; no project code writes `localStorage` or `sessionStorage`.
- Project IDs use `crypto.getRandomValues`; there is no non-cryptographic fallback.
- A stale-save response never advances the expected revision from `current_revision`. Save remains blocked until the user reloads the latest record or explicitly chooses preserved local edits after comparing both versions.
- Switching projects or starting a new project while dirty opens an explicit confirmation and retains the requested action; a failed open leaves the current draft intact.
- Durable writes continue to use the existing JSON Schema validation, atomic record-plus-metadata transaction, revision conflict protection, backup behavior and restart recovery.
- Secret-looking fields are rejected before a project record is written. Tests use disposable temporary workspaces and sentinel values only.
- Device-local SQLite remains outside the workspace and is not addressed by the project client.
- No real user workspace, private paper, credential, API key, pairing code or session token was committed.

## Tests and exact results

### Local passes

| Command | Result |
|---|---|
| `companion/.venv/bin/python scripts/validate_schemas.py` | Passed; 9 Draft 2020-12 schemas |
| `PATH=<bundled-node>:$PATH pnpm frontend:lint` | Passed |
| `PATH=<bundled-node>:$PATH pnpm frontend:typecheck` | Passed |
| `PATH=<bundled-node>:$PATH pnpm frontend:test` | Passed; 21 tests in 2 files, including stale-draft preservation, conflict reconciliation, dirty project switching/New confirmation and failed-open preservation |
| `PATH=<bundled-node>:$PATH pnpm frontend:build` | Passed; Vite/PWA production build |
| `companion/.venv/bin/python -m ruff check companion/src companion/tests` | Passed |
| `PYTHONPATH=companion/src companion/.venv/bin/python -m pytest companion/tests` | Passed; 59 tests, 1 Starlette/httpx deprecation warning |
| `pnpm audit --audit-level moderate` | Baseline previously passed; this review rerun was not verified because the npm advisory endpoint returned `ENOTFOUND` after retries |
| `companion/.venv/bin/python -m pip_audit --requirement companion/requirements-dev.txt --cache-dir /tmp/research-intelligence-pip-audit` | Baseline previously passed; this review rerun was not verified because pip-audit could not upgrade its temporary environment without package-network access |
| `PYTHONPATH=companion/src companion/.venv/bin/python -m research_intelligence_companion.spikes binding` | Passed; loopback allowed and remote interface rejected |
| `PYTHONPATH=companion/src companion/.venv/bin/python -m research_intelligence_companion.spikes workspace` | Passed; interrupted write preserved the prior hash and traversal was rejected |
| `PYINSTALLER_CONFIG_DIR=/tmp/research-intelligence-pyinstaller-m3a .venv/bin/python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean` from `companion/` | Passed; macOS arm64 onedir package |
| `companion/dist/research-intelligence-companion/research-intelligence-companion --check` | Passed; loopback host `127.0.0.1` |
| `! rg -a -n "TEST_SECRET_DO_NOT_RETURN\|RI_INSTALLATION_SECRET_DO_NOT_RETURN\|session-token-only-in-memory" companion/dist/research-intelligence-companion` | Passed; no sentinel matches |
| `git diff --check` | Passed |

The first attempted `python3 scripts/validate_schemas.py` did not run because
the system Python lacks `jsonschema`. The same required validation passed with
the repository’s existing companion virtual environment, which contains the
declared dependency.

### Unverified or environment-blocked locally

| Command | Result |
|---|---|
| `PATH=<bundled-node>:$PATH pnpm frontend:e2e` | Review rerun failed before assertions because the sandbox rejected the Vite preview bind to `127.0.0.1:4173` with `EPERM`. A prior attempt with Chromium installed also failed at browser launch with macOS sandbox `SIGTRAP`/`kill EPERM`. |
| `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/research-intelligence-playwright ... pnpm spike:pwa-loopback` | Direct HTTPS/static-origin and CORS phase passed; browser phase failed at Chromium launch with the same macOS sandbox limitation. The real browser connected-state and project path are not claimed. |
| `PYTHONPATH=companion/src companion/.venv/bin/python -m research_intelligence_companion.spikes keychain` | Failed in this sandbox because the real macOS keychain returned `PasswordSetError: (-67674, 'Unknown Error')`. Existing fake-keyring tests pass; real OS keychain and Windows packaging remain environment-dependent. |

GitHub Actions has not run for this new commit, so no CI result is claimed for
Task 3A. Existing merged Task 0/Task 2 CI evidence remains documented in the
prior checkpoint reports and does not prove this new project UI path.

## Visual evidence

No new screenshots were added for Task 3A. The existing Task 1 captures under
`docs/prototypes/screenshots/task-1/` were produced with the Codex in-app
browser and cover the prototype, not a connected persisted project workspace.
No Playwright visual capture is claimed for this task.

## Traceability rows updated

Added `M3A-001` through `M3A-008` to `docs/traceability-matrix.md`, covering
list, create, stable IDs, open/read, edit/save, conflicts, UI states and
in-memory session handling. The rows distinguish local API persistence and
mocked frontend evidence from unverified browser evidence. This review
correction strengthens conflict recovery and adds dirty project-switch/New and
failed-open coverage without changing the feature-completeness status.

## Unverified behavior and limitations

- A real browser has not completed pairing, workspace setup, project creation, project edit, reload and stale-conflict interaction against a live companion locally.
- GitHub Actions verification for this branch is not available in this report.
- Windows behavior, a real macOS Keychain success path, Dropbox provider conflict behavior and production GitHub Pages deployment remain unverified.
- The frontend retains Task 1 mock project cards only when no healthy paired workspace is connected; they are explicitly labeled preview-only and are not mixed with durable records.
- Task 3A does not persist project UI state in browser storage and does not add a browser-side workspace registry.

## Merge blockers versus follow-up improvements

### Merge blockers

No code or local automated-test blocker was found for the bounded locally
persisted claim. The feature must not be described as end-to-end verified until
the browser path passes in a suitable environment.

### Follow-up improvements

- Add a CI/browser harness that pairs a disposable workspace and exercises the complete form-to-companion project path, including reload and conflict choices.
- Add connected-project visual captures and responsive containment checks once Chromium runs in CI.
- Verify real OS keychain behavior on supported macOS and Windows runners.

## Recommended follow-up

Use the next integration checkpoint after the next two milestones, or earlier
if project record migrations, security changes or durable storage behavior are
introduced.
