# Implementation Report

## Task and scope
- Task: Task 3D persisted Project Overview integration and consolidation of Tasks 3A, 3B and 3C.
- Branch: `feature/m3d-project-overview`
- Commit: working tree at report creation; final commit recorded after validation.
- Explicitly excluded: paper storage, notes, PDF import, discovery execution,
  AI processing, real feedback-derived proposal generation, semantic search,
  synthesis, export, cloud sync, collaboration, accounts and later roadmap
  milestones.

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Persisted Project Overview route and summaries | Locally persisted | Local frontend tests with mocked fetch; existing authenticated companion record contracts; browser flow unverified locally | No |
| Project/profile/proposal navigation and save callbacks | Locally persisted | Local App, Projects, Research Profile and Project Overview tests | No |
| HTTPS static PWA to companion Project Overview flow | Companion connected | Origin/CORS checks, companion seed and durable API setup passed; Chromium browser phase failed locally before UI assertions | No |
| Production readiness | Not claimed | Cross-platform browser, packaging and complete Task 3D browser persistence evidence remain incomplete | No |

The feature is not `End-to-end verified` or `Production ready` because the
real browser-to-companion flow could not execute in this local sandbox.

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Open a persisted project | `apps/web/src/projects.tsx`; `apps/web/src/App.tsx` | Existing authenticated project read | Existing workspace record read and association checks | Existing `projects/<project_id>.json`; `project.schema.json` | `apps/web/src/App.test.tsx`; `apps/web/src/projectOverview.test.tsx` |
| View Project Overview | `apps/web/src/projectOverview.tsx` | Existing project/profile reads | Existing authenticated generic record API | Existing project and Research Profile JSON | `apps/web/src/projectOverview.test.tsx` |
| Review proposal summary | `apps/web/src/projectOverview.tsx` | Existing Research Profile read | Existing Task 3C proposal validation and persistence | Existing `research-profile.json` proposal data | `apps/web/src/projectOverview.test.tsx`; `apps/web/src/researchProfile.test.tsx` |
| Edit and return to overview | `apps/web/src/projects.tsx`; `apps/web/src/researchProfile.tsx`; `apps/web/src/App.tsx` | Existing revision-aware writes | Existing atomic record writes | Existing project/profile schemas | `apps/web/src/App.test.tsx`; `apps/web/src/projects.test.tsx`; `apps/web/src/researchProfile.test.tsx` |
| Reload and explicitly reopen context | `apps/web/src/App.tsx`; `apps/web/src/projects.tsx` | Existing open/read calls | Existing workspace lifecycle | Existing durable records; no browser storage | `apps/web/src/App.test.tsx`; `scripts/run_pwa_loopback_spike.mjs` (browser unverified locally) |

## Files changed

Created:

- `apps/web/src/projectOverview.tsx`
- `apps/web/src/projectOverview.test.tsx`
- `docs/task-3d-project-overview-results.md`

Modified:

- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`
- `apps/web/src/projects.tsx`
- `apps/web/src/researchProfile.test.tsx`
- `apps/web/src/researchProfile.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/types.ts`
- `scripts/run_pwa_loopback_spike.mjs`
- `docs/acceptance-tests.md`
- `docs/frontend-specification.md`
- `docs/roadmap.md`
- `docs/integration-checkpoints.md`
- `docs/traceability-matrix.md`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`

Deleted: none.

## Contracts changed

No schema, API endpoint, workspace-format, migration or ADR changes were
required. The overview reuses authenticated project and Research Profile read
operations, existing revision-aware writes, and Task 3C proposal records.

The dependency lockfile was updated for one security remediation. The
transitive `brace-expansion` advisory `GHSA-mh99-v99m-4gvg` affected installed
versions `2.1.2` and `5.0.7` through Workbox/`vite-plugin-pwa` and ESLint
tooling. The repository workspace override pins the patched `5.0.8`; no
application dependency or product contract was changed.

## Architecture and data loading

The application owns workspace and active-project context in React state only.
The Project Overview route is represented by the existing lightweight `#project`
route and is selected after an explicit project open. On entry it verifies the
paired companion, healthy workspace and active project, reads the latest project
record, then reads the deterministic Research Profile record. Workspace and
project association are checked before profile or proposal data is rendered.

The overview is read-only. It displays the project header, safe workspace label,
timestamps, bounded profile summaries and counts derived from durable proposal
records. Actionable pending proposals are counted separately from legacy
proposal shells that lack a Task 3C payload. Existing editor callbacks return to
the overview after a successful save, causing the overview to read fresh data.
Successful workspace changes clear active project context; failed changes keep
the current context. Existing dirty project, profile and proposal protections
remain application/editor-owned.

## Security and privacy

No companion security behavior was changed. Loopback-only binding, exact Origin
allowlisting, explicit pairing, short-lived in-memory session tokens,
keychain-only installation secrets, schema validation, path confinement,
atomic writes, recovery journals, backup/restore safety and device-local index
separation remain provided by the existing Task 0-3C companion implementation.

The overview does not use `localStorage`, `sessionStorage`, IndexedDB or cookies
for project, profile, workspace or session context. It does not render the full
workspace path in the normal view. It does not add secrets, hidden model
reasoning, analytics or paper data to project/profile records.

## Tests and exact results

### Passed locally

- `pnpm install --frozen-lockfile`: passed; lockfile up to date.
- `pnpm audit --audit-level moderate`: passed; no known vulnerabilities after
  the `brace-expansion` `5.0.8` override.
- `companion/.venv/bin/python scripts/validate_schemas.py`: passed; 9 Draft
  2020-12 schemas validated.
- `PATH=companion/.venv/bin:$PATH pnpm schemas:validate`: passed; 9 Draft
  2020-12 schemas validated.
- `pnpm frontend:lint`: passed.
- `pnpm frontend:typecheck`: passed.
- `pnpm frontend:test`: passed; 52 tests in 4 files.
- `pnpm frontend:build`: passed; Vite production build generated the PWA.
- `companion/.venv/bin/python -m ruff check companion/src companion/tests`:
  passed.
- `companion/.venv/bin/python -m pytest companion/tests`: passed; 71 tests,
  with one existing Starlette/httpx deprecation warning.
- `PYINSTALLER_CONFIG_DIR=/tmp/research-intelligence-pyinstaller companion/.venv/bin/python -m PyInstaller companion/packaging/research-intelligence-companion.spec --noconfirm --clean`: passed on local macOS arm64.
- `dist/research-intelligence-companion/research-intelligence-companion --check`:
  passed and reported loopback host `127.0.0.1`.
- packaged-artifact sentinel scan for `TEST_SECRET_DO_NOT_RETURN` and
  `RI_INSTALLATION_SECRET_DO_NOT_RETURN`: passed; no matches.
- `git diff --check`: passed.

### Browser and HTTPS evidence

- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=... PYTHON_BIN=companion/.venv/bin/python pnpm spike:pwa-loopback`: the static HTTPS server, configured/invalid/missing Origin checks, CORS preflight checks, companion pairing seed, disposable workspace creation and durable project/profile seed passed. The available Chromium headless shell exited with `SIGTRAP` at browser launch, before the PWA UI flow, so the Project Overview browser path is unverified locally.
- `pnpm frontend:e2e`: unverified locally; all 5 Playwright tests failed at
  browser launch because the expected Chromium `1228` executable was not
  installed. A manually selected older headless shell also exited with
  `SIGTRAP` in the local sandbox.

No GitHub Actions run for this Task 3D branch is available in this checkpoint.
No browser test, screenshot, or mocked-fetch test is being represented as
real end-to-end evidence.

## Visual evidence

No new screenshot artifacts were created for Task 3D. The overview reuses the
approved dark-charcoal, mint-accent design tokens and existing shared controls;
visual browser inspection remains unverified locally because Chromium could not
run.

## Traceability rows updated

Added `M3D-001` through `M3D-007` in `docs/traceability-matrix.md`, covering:

- route prerequisites and explicit project selection;
- latest persisted project/profile loading and association checks;
- durable proposal summary and legacy-shell handling;
- editor navigation and overview refresh;
- missing/malformed/error/isolation states;
- dirty-state and browser-storage behavior;
- the required real HTTPS browser flow and its unverified local status.

## Unverified behavior and limitations

- Chromium browser execution is unavailable in this local sandbox because the
  expected Playwright executable is missing and the available older headless
  shell exits with `SIGTRAP`.
- The complete browser-to-companion project/profile/proposal flow, reload and
  workspace reopen path is therefore unverified locally and has no recorded
  Task 3D GitHub Actions result yet.
- Windows packaging, real macOS Keychain behavior and cross-platform recovery
  remain prior-task limitations; this task did not change them.
- The overview does not implement any paper, note, discovery, AI, synthesis,
  export, cloud or collaboration behavior.

## Merge blockers versus follow-up improvements

### Merge blockers

- Run the real `scripts/run_pwa_loopback_spike.mjs` browser flow in a
  browser-capable CI environment and confirm the Project Overview assertions,
  proposal decision refresh, reload and reopen checks. Until then, Task 3D
  must not be marked End-to-end verified.

### Follow-up improvements

- Add a CI artifact or recorded result for the Task 3D browser flow.
- Add browser-level visual and accessibility evidence once Chromium is
  available.
- Consider a dedicated stable test fixture name for future milestone spikes.

## Recommended follow-up

Run the existing CI browser and packaging workflows on this branch, review the
Task 3D traceability rows against those results, and only then decide whether
the overview capability can be promoted beyond `Locally persisted`.
