# Task 3B Research Profile Results

## Task and scope

- Task: Task 3B, persisted project-specific Research Profile lifecycle
- Branch: `feature/m3b-research-profile`
- Commit: containing implementation commit; final SHA is recorded in the completion report
- Explicitly excluded: Task 3C proposal or preference learning, automatic profile changes, AI-generated changes, paper feedback, ingestion, scholarly search, ranking, similarity, synthesis, export, and production authentication

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Project-scoped Research Profile editor | Companion connected | React state and typed-client tests with mocked fetch; real browser path unverified | No |
| Profile create/read/update/list persistence | Locally persisted | Real FastAPI API tests use disposable workspaces and reopen the workspace | No |
| Profile revisions and conflict recovery | Locally persisted | Real stale-write API test plus frontend draft-preservation and explicit reconciliation tests | No |
| Browser-to-companion Research Profile path | Companion connected | The generic authenticated API exists; Playwright and HTTPS browser execution were unavailable locally | No |

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Open Research Profile from a selected project | `apps/web/src/projects.tsx`; `apps/web/src/App.tsx` | Existing authenticated workspace session | Existing workspace session and allowlisted collection | Project context plus `projects/<project-id>/research-profile.json` | `apps/web/src/projects.test.tsx`; `apps/web/src/researchProfile.test.tsx` |
| Create an explicit profile | `apps/web/src/researchProfile.tsx`; `apps/web/src/companionClient.ts` | `PUT /api/v1/workspaces/{workspace_id}/records/research-profiles/{research_profile_id}` | Generic schema-backed record writer with relationship enforcement | Existing `research-profile.schema.json`; deterministic `research_profile_<project_id>` | `companion/tests/test_task3b_research_profile.py`; `apps/web/src/researchProfile.test.tsx` |
| Edit and save supported scope fields | Typed grouped editor and accessible list/chip controls | Same `PUT`, with `expected_revision` for edits | Existing atomic record/index transaction and revision conflict protection | `projects/<project-id>/research-profile.json` | Companion and frontend Task 3B suites |
| Reconcile a stale save | Conflict state preserves local draft; latest version is fetched explicitly | Existing `409 workspace_conflict` response | Current durable record remains unchanged; no automatic merge | Existing record and revision remain valid | `apps/web/src/researchProfile.test.tsx`; companion stale-write test |
| Reopen the profile after companion recreation | Load by active project context | Existing list/read endpoints | Workspace reopen and durable record read | Same profile file and schema | `companion/tests/test_task3b_research_profile.py` |

## Files changed

- `apps/web/src/App.tsx`
- `apps/web/src/companionClient.ts`
- `apps/web/src/projects.tsx`
- `apps/web/src/projects.test.tsx`
- `apps/web/src/researchProfile.tsx`
- `apps/web/src/researchProfile.test.tsx`
- `apps/web/src/styles.css`
- `companion/src/research_intelligence_companion/workspace.py`
- `companion/tests/test_task3b_research_profile.py`
- `docs/acceptance-tests.md`
- `docs/data-model.md`
- `docs/local-api.md`
- `docs/workspace-format.md`
- `docs/traceability-matrix.md`
- `docs/task-3b-research-profile-results.md`

## Contracts changed

No schema or new API endpoint was added. The existing
`packages/schemas/research-profile.schema.json` is reused unchanged. The typed
client adds wrappers for the existing generic list/read/write routes. The
companion adds collection-specific relationship checks: deterministic profile
ID, matching `project_id` and `parent_id`, and an existing project record.

No ADR was changed. The existing local-first, generic-record, transaction,
revision, and security decisions remain authoritative.

## Identity, relationship, and storage behavior

- Profile ID is `research_profile_<project_id>`.
- The profile is stored at `projects/<project-id>/research-profile.json`.
- The generic `research-profiles` collection remains the only API collection
  used; no arbitrary frontend path is accepted.
- Creation is explicit. The frontend re-lists before create, and the
  companion's existing record conflict prevents duplicate replacement.
- The device-local SQLite/index registry remains outside the workspace and is
  not changed by this milestone.
- The project record is not silently rewritten to add a relationship during
  profile save; the server validates the relationship from the profile record,
  request parent, and existing project.

## Supported fields and product boundary

Task 3B writes the central question, concepts with optional finite weights,
synonyms, theories, mechanisms, outcomes, contexts, populations, preferred
disciplines, preferred evidence types, exclusions, watched authors, and search
queries. Empty optional lists are omitted from the durable JSON record.

The editor does not expose or write proposals, positive/negative paper labels,
foundational or semantic-reference paper selectors, paper feedback, or
automatic profile learning. The existing schema can describe future approved
fields, but their presence in the schema does not mean they are implemented in
Task 3B.

## Security and privacy

The feature reuses loopback-only binding, exact allowed-origin enforcement,
explicit pairing, short-lived in-memory sessions, keychain-only installation
secrets, path confinement, schema validation, atomic writes, recoverable
transactions, revision conflicts, backup/restore safety, and device-local index
separation. The browser client uses component state only; no profile data,
session token, API key, or installation secret is written to localStorage or
sessionStorage. Real user workspaces and private research material were not
used as fixtures.

## Tests and exact results

| Command | Result | Evidence |
|---|---|---|
| `companion/.venv/bin/python scripts/validate_schemas.py` | Pass, 9 schemas | All Draft 2020-12 schemas validated |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm frontend:lint` | Pass | ESLint completed with exit 0 |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm frontend:typecheck` | Pass | TypeScript build completed with exit 0 |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm frontend:test` | Pass, 32 tests | 3 test files passed |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm frontend:build` | Pass | Vite production build and PWA generation completed |
| `companion/.venv/bin/python -m ruff check companion/src companion/tests` | Pass | All checks passed |
| `PYTHONPATH=companion/src companion/.venv/bin/python -m pytest companion/tests -q` | Pass, 64 tests | One existing Starlette/httpx deprecation warning |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm audit --audit-level moderate` | Unverified/blocked | npm registry fetch failed with `ENOTFOUND` |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm frontend:e2e` | Unverified/blocked | Vite preview could not bind `127.0.0.1:4173` (`EPERM`) |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm spike:pwa-loopback` | Unverified/blocked | HTTPS server could not bind `127.0.0.1:4443` (`EPERM`); host Python also lacked `uvicorn` |
| `companion/.venv/bin/python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean` | Unverified/blocked | Local build reached collection but PyInstaller cache access was denied by the sandbox |
| `git diff --check` | Pass | No whitespace errors |

The targeted profile suite passed 11 tests before the full suite. The full
frontend suite includes the added project-to-profile action coverage.

## Visual evidence

No new screenshots were added. Existing Task 1 captures are in-app browser
captures and do not verify the connected profile lifecycle. No Playwright
profile capture was possible locally.

## Traceability rows updated

Added `M3B-001` through `M3B-010` to
`docs/traceability-matrix.md`. The rows distinguish mocked frontend state
coverage, real disposable-workspace API persistence, and unverified browser
execution. No capability is marked end-to-end verified or production ready.

## Unverified behavior and limitations

- No local browser-backed profile create/open/reload path was executed.
- No new GitHub Actions run exists for Task 3B in this checkpoint.
- Real macOS Keychain behavior remains an inherited environment limitation; the
  Task 3B tests do not weaken or bypass keychain-only behavior.
- Windows packaging, browser accessibility inspection, real Dropbox conflict
  behavior, and hard process-kill recovery were not rerun for this milestone.
- The profile editor is compact and token-aligned, but no new visual
  regression capture was generated.

## Merge blockers versus follow-up improvements

### Merge blockers

None found in the locally executable Task 3B API, schema, frontend unit, or
companion test paths. Browser and packaging limitations are recorded as
unverified rather than passed.

### Follow-up improvements

- Run the profile lifecycle through the HTTPS static PWA and loopback companion
  in GitHub Actions with Chromium available.
- Add browser-level conflict and dirty-navigation coverage when the sandbox can
  launch the required browser.
- Add visual captures for the profile empty, create, populated, and conflict
  states.

## Recommended follow-up

Task 3C may address explicit, reversible preference-learning proposals only
after a separately approved milestone. It must not be inferred from the
schema's reserved proposal fields or from this Task 3B implementation.
