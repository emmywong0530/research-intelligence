# Implementation Report

## Task and scope
- Task: Task 3F persisted project- and paper-scoped plain-text notes.
- Branch: `feature/m3f-notes`.
- Commit: `d9f6ef9` (`feat: implement persisted project and paper notes`).
- Explicitly excluded: attachments, Markdown rendering, PDF import, reading
  workflows, search, AI processing, discovery, synthesis, export, cloud sync,
  collaboration, and production deployment.

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Project and paper note records | Locally persisted | Real authenticated companion tests and schema validation; local browser path depends on unavailable Chromium | No |
| Project Overview note counts and recent preview | Locally persisted | Frontend tests with mocked fetch plus companion-backed list contract | No |
| Paper detail note entry point | Locally persisted | Frontend tests and real API note association tests | No |
| HTTPS static-host browser note flow | Locally persisted | Spike is implemented; local browser execution is reported separately and is not promoted without a passing browser run | No |

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Open project notes | `apps/web/src/App.tsx`; `apps/web/src/notes.tsx` | Authenticated generic notes list with `project_id` and `scope_type` | Server-side project/scope filtering | `projects/<project-id>/notes/<note-id>.json`; `note.schema.json` | `apps/web/src/notes.test.tsx`; `companion/tests/test_task3f_notes.py` |
| Create project note | `apps/web/src/notes.tsx`; `apps/web/src/companionClient.ts` | Generic `PUT .../records/notes/<note-id>` | Parent and project association validation, schema validation, atomic write | `m3f.v1` project note | Frontend create/validation tests; companion create/path tests |
| Create and edit paper note | `apps/web/src/papers.tsx`; `apps/web/src/notes.tsx` | Generic list/read/write with `paper_id` | Paper existence and exact project association enforcement | `papers/<paper-id>/notes/<note-id>.json` | Frontend paper-scope tests; companion cross-project tests |
| Reconcile stale note edit | `apps/web/src/notes.tsx` | Expected revision and `409` conflict | Existing journaled revision-aware write | Current note remains unchanged | Frontend conflict test; companion stale-revision test |
| Refresh Project Overview | `apps/web/src/projectOverview.tsx` | Two server-filtered note lists | Authenticated workspace/project checks | Durable note records | Overview note-count and recent-preview test |

## Files changed

Created:

- `packages/schemas/note.schema.json`
- `apps/web/src/notes.tsx`
- `apps/web/src/notes.test.tsx`
- `apps/web/src/papers.test.tsx`
- `companion/tests/test_task3f_notes.py`
- `docs/task-3f-notes-results.md`

Modified:

- `companion/src/research_intelligence_companion/workspace.py`
- `companion/src/research_intelligence_companion/app.py`
- `apps/web/src/companionClient.ts`
- `apps/web/src/types.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`
- `apps/web/src/papers.tsx`
- `apps/web/src/projectOverview.tsx`
- `apps/web/src/projectOverview.test.tsx`
- `apps/web/src/styles.css`
- `scripts/run_pwa_loopback_spike.mjs`
- `docs/data-model.md`
- `docs/workspace-format.md`
- `docs/workspace-atomic-writes.md`
- `docs/local-api.md`
- `docs/frontend-specification.md`
- `docs/acceptance-tests.md`
- `docs/roadmap.md`
- `docs/integration-checkpoints.md`
- `docs/traceability-matrix.md`

Deleted: none.

## Contracts changed

`note.schema.json` is a new Draft 2020-12 schema. It defines strict project
and paper note variants with `additionalProperties: false`, `m3f.v1` durable
records, stable IDs, timestamps, bounded title/body fields, and plain text
only. No migration is required because no prior durable note schema exists.

The generic record list API accepts `project_id`, `paper_id`, and `scope_type`
filters. Notes require `project_id`, so the companion never serves an
unscoped note enumeration. No note-specific endpoint or authentication path
was added. The existing atomic record transaction, backups, path confinement,
revision hashes, authentication, exact Origin enforcement, and recovery journal
remain the source of write safety.

## Security and privacy

Notes remain behind loopback-only companion binding, the exact Origin allowlist,
paired short-lived in-memory sessions, and schema validation. The frontend
stores only current drafts and selection in React memory. It does not use
localStorage, sessionStorage, IndexedDB, cookies, or durable device indexes for
notes, IDs, paths, drafts, or sessions. Parent IDs and project/paper
associations are checked by the companion; cross-project paper notes are
rejected. Note content is plain text and does not accept credentials, prompts,
private model reasoning, or secret-looking fields.

## Tests and exact results

The final validation section below records the exact commands and results run
for this branch. Focused Task 3F evidence before the full suite included:

- `companion/.venv/bin/python -m pytest companion/tests/test_task3f_notes.py`:
  3 passed, one existing Starlette/httpx deprecation warning.
- bundled pnpm frontend run covering the notes, papers, and overview tests: 69 passed.

## CI browser correction

GitHub Actions run `30400937438`, job `90415300186` (`HTTPS Static PWA
Loopback Spike`), failed at
`scripts/run_pwa_loopback_spike.mjs:441:58`. The failing locator was the
second global `page.getByRole("button", { name: "Open paper" }).click()` after
returning from Paper Notes. Playwright resolved the button, then the list row
was detached while the click waited for stability.

The cause was confirmed in the React flow: returning to `papers` remounted
`PapersPage` with `initialPaperId`; after `loadList` completed, an effect
called `openPaper(initialPaperId)` and replaced the list with the editor while
the spike was still trying to click the list action. The correction removes
that implicit reopen race. The browser flow now waits for the known persisted
paper title, scopes `Open paper` to that row, waits for the editor title/value,
and then opens Paper Notes. A frontend regression test remounts Papers after
the Paper Notes transition and verifies the same persisted paper can be
reopened through its stable row action.
- `companion/.venv/bin/python -m ruff check` on touched companion files: passed.
- `companion/.venv/bin/python scripts/validate_schemas.py`: all 10 schemas
  validated.

### Validation run

All commands below ran locally on macOS arm64 unless noted otherwise.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed; pnpm 11.9.0, lockfile unchanged |
| `companion/.venv/bin/python scripts/validate_schemas.py` | Passed; 10 Draft 2020-12 schemas |
| `pnpm frontend:lint` | Passed |
| `pnpm frontend:typecheck` | Passed |
| `pnpm frontend:test` | Passed; 6 files, 69 tests |
| `pnpm frontend:build` | Passed; Vite/PWA production build generated `apps/web/dist` |
| `pnpm audit --audit-level moderate` | Passed; no known vulnerabilities |
| `HOME=/tmp/research-intelligence-home companion/.venv/bin/python -m pip_audit --requirement companion/requirements-dev.txt --cache-dir /tmp/research-intelligence-pip-audit` | Passed; no known vulnerabilities |
| `companion/.venv/bin/python -m ruff check companion/src companion/tests` | Passed |
| `companion/.venv/bin/python -m pytest companion/tests` | Passed; 77 tests, 1 existing Starlette/httpx deprecation warning |
| `pnpm frontend:e2e` | Unverified locally; 5 tests could not launch because the Playwright Chromium executable was absent |
| `pnpm spike:pwa-loopback` | Unverified locally; HTTP health, Origin/CORS checks, pairing, and disposable seed passed, then Chromium launch failed before browser assertions; cleanup completed |
| `HOME=/tmp/research-intelligence-home companion/.venv/bin/python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean` | Passed; macOS arm64 package built |
| `companion/dist/research-intelligence-companion/research-intelligence-companion --check` | Passed; status `ok`, loopback host `127.0.0.1` |
| Packaged artifact sentinel scan for `TEST_SECRET_DO_NOT_RETURN` and `RI_INSTALLATION_SECRET_DO_NOT_RETURN` | Passed; no matches |
| Bundled Node `--check scripts/run_pwa_loopback_spike.mjs` | Passed |
| Markdown relative-link/path validation | Passed; 62 repository Markdown files checked |
| `git diff --check` | Passed |

## Visual evidence

No new screenshots are committed for Task 3F. The required real browser spike
uses the built PWA over HTTPS; mocked-fetch frontend tests are not treated as
browser-to-companion evidence.

## Traceability rows updated

Added `M3F-001` through `M3F-008` to
`docs/traceability-matrix.md`. They identify the schema, durable paths,
association enforcement, generic API, atomic/conflict behavior, frontend
integration, privacy/dirty-state behavior, and the real browser spike.

## Unverified behavior and limitations

- The local Codex environment does not provide a system `node` binary and the
  bundled Playwright Chromium launch failed because the expected headless
  executable was absent; no browser pass is inferred from unit tests. The
  exact spike failure was `browserType.launch: Executable doesn't exist` at
  `scripts/run_pwa_loopback_spike.mjs:464:34`.
- GitHub Actions post-fix verification has not yet run for this correction;
  the prior CI failure is recorded above and no End-to-end verified status is
  claimed.
- Real macOS Keychain, Windows keychain, Dropbox synchronization conflicts,
  hard process-kill timing, and production deployment remain outside this
  local Task 3F evidence unless a command below records them as run.
- Notes are plain text only. Attachments, rendering, annotations, reading
  state, search, and AI workflows remain unimplemented.

## Merge blockers versus follow-up improvements

### Merge blockers

Any failed required validation command or an unverified browser path where the
repository policy requires real browser evidence must remain visible to review;
this report does not promote the feature to End-to-end verified.

### Follow-up improvements

- Run the HTTPS static PWA note flow in a browser-capable CI environment and
  attach its output to an integration result.
- Add later reading-specific note behavior only under the approved roadmap
  milestone.

## Recommended follow-up

Task 3G may build on the persisted note contract only after review. Task 3D
overview consolidation and Task 3E paper metadata remain the current integrated
foundation; no later product capability is claimed here.
