# Task 3E Paper Records Results

## Task and scope
- Task: Task 3E persisted, project-scoped paper-record lifecycle
- Branch: `feature/m3e-paper-records`
- Commit: `f394625` (final commit SHA is recorded after the documentation-only amendment)
- Explicitly excluded: PDF selection/storage/import, parsing, OCR, DOI lookup,
  OpenAlex, Crossref, enrichment, discovery, notes, reading, AI, search, FTS,
  embeddings, synthesis, export, deletion, bulk import, access automation,
  cloud sync, collaboration, accounts, and production deployment.

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Project-scoped paper metadata API | Locally persisted | Real authenticated FastAPI tests create, read, list, update, conflict, and reopen records | No |
| Project Papers list/editor | Locally persisted | React tests use mocked fetch; companion client uses the real generic API contract | No |
| Project Overview paper count/recent metadata | Locally persisted | Overview and paper UI tests cover derived summaries; browser path remains unverified locally | No |
| HTTPS static-host browser paper flow | Locally persisted | Real browser flow is implemented, but PR #12 CI run 31 failed at a locator assertion before the full paper path completed; the corrected flow is not yet CI-verified | No |
| PDF/full-text workflows | Interactive mock | Explicitly excluded from Task 3E | No |

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Open project Papers | `apps/web/src/App.tsx`; `apps/web/src/papers.tsx` | `GET .../records/papers?project_id=...` | `list_records(..., project_id=...)` | `papers/<paper-id>/metadata.json`; `paper.schema.json` | `apps/web/src/papers.test.tsx`; `companion/tests/test_task3e_paper_records.py` |
| Create metadata record | `PapersPage` draft/editor | `PUT .../records/papers/<paper-id>` with `parent_id` | schema, title/author, project and path validation | existing `paper.schema.json`, `pdf_access_status: unavailable` | frontend create/validation test; companion create test |
| Edit and save | revision-aware paper editor | expected revision in generic write | existing atomic record/index transaction | paper JSON plus `workspace.json` ID index | frontend conflict test; companion stale-write test |
| Return to overview | Project Overview paper section | filtered list read | association validation | derived count; no duplicate index | overview and spike coverage |
| Reopen and verify | route/context remains memory-only | open workspace then list/read | durable file is source of truth | same paper ID and metadata path | companion reopen test; browser spike unverified locally |

## Files changed

Created:
- `apps/web/src/papers.tsx`
- `apps/web/src/papers.test.tsx`
- `companion/tests/test_task3e_paper_records.py`
- `docs/task-3e-paper-records-results.md`

Modified:
- `apps/web/src/App.tsx`
- `apps/web/src/companionClient.ts`
- `apps/web/src/projectOverview.tsx`
- `apps/web/src/projectOverview.test.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/types.ts`
- `companion/src/research_intelligence_companion/app.py`
- `companion/src/research_intelligence_companion/workspace.py`
- `docs/acceptance-tests.md`
- `docs/data-model.md`
- `docs/frontend-specification.md`
- `docs/integration-checkpoints.md`
- `docs/local-api.md`
- `docs/roadmap.md`
- `docs/traceability-matrix.md`
- `docs/workspace-atomic-writes.md`
- `docs/workspace-format.md`

Deleted: none.

## Contracts changed

No JSON Schema or migration was required. The existing strict Paper schema
already supports the metadata fields and `assigned_project_ids`; Task 3E adds
no speculative fields and does not weaken `additionalProperties: false`.

The generic list endpoint now accepts `project_id` for `papers`, and paper
writes require the existing generic `parent_id` field. No paper-specific
endpoint or authentication path was added. The durable path remains the
approved `papers/<paper-id>/metadata.json` layout. No ADR was added because
this reuses the accepted record, transaction, and project-association
architecture.

## Identity, association, and conflict model

Paper IDs are generated from browser cryptographic randomness and remain stable
after edits. The companion requires exactly one `assigned_project_ids` value,
an existing project, a matching `parent_id`, and a matching URL record ID. It
rejects reassignment. The server applies the project filter before returning
records.

Creates and updates use the existing schema-backed record transaction, which
updates the paper JSON and workspace ID index together. An expected-revision
conflict returns HTTP 409. The editor retains local values, fetches the latest
paper on explicit reload, and does not silently merge or adopt a revision from
the error response. Unsaved editor values use the application dirty-state
guard and never enter browser storage.

## Security and privacy

Task 3E preserves loopback-only binding, exact allowed Origin checks,
companion-owned pairing, short-lived in-memory sessions, keychain-only
installation secrets, schema validation, path confinement, atomic writes,
transaction recovery, backups, and device-local index separation. Paper
records contain no API keys, session tokens, credentials or filesystem paths.
New metadata records explicitly report `pdf_access_status: "unavailable"`.
The schema's lack of an approved URL field is documented and respected.
Only disposable test workspaces are used by the tests and spike.

## Tests and exact results

## PR #12 CI correction

GitHub Actions run `30378365255`, job `90339705896` (`HTTPS Static PWA
Loopback Spike`), failed at
`verifyTask3DProjectOverviewFlow` in
`scripts/run_pwa_loopback_spike.mjs:361:42`. The exact assertion was:

```text
expect(page.getByRole("status")).toContainText("Paper metadata saved locally")
```

Playwright reported a strict-mode violation because the locator resolved to
two elements: the global connected companion status
(`data-testid="companion-connection-status"`) and the paper save message.
The expected substring was `Paper metadata saved locally`; the first received
status text was `ConnectedLoopback companion 0.1.0`. Immediately before the
failure, the browser had paired, opened the disposable workspace/project,
loaded the paper flow, and received HTTP 200 from the paper create write; the
save success message and connected companion status were both rendered. The
flow had not yet reached paper edit, overview refresh, or reopen assertions.

The correction adds the narrowly scoped accessible target
`data-testid="paper-save-status"` while retaining `role="status"`, and changes
the spike to assert that target. The frontend test also verifies the stable
selector and accessible role. No paper contract, schema, API security,
association, revision, storage, or cleanup behavior changed.

Final local validation results:
- `companion/.venv/bin/python scripts/validate_schemas.py`: passed, 9 Draft 2020-12 schemas.
- `pnpm frontend:lint`: passed.
- `pnpm frontend:typecheck`: passed.
- `pnpm frontend:test`: passed, 59 tests across 5 files.
- `pnpm frontend:build`: passed, Vite/PWA production build.
- `pnpm frontend:e2e`: unverified locally; all 5 Chromium tests terminated at
  browser launch with macOS `SIGTRAP` after the matching Playwright browser was
  installed.
- `companion/.venv/bin/python -m ruff check companion/src companion/tests`: passed.
- `companion/.venv/bin/python -m pytest companion/tests`: passed, 74 tests, one Starlette/httpx deprecation warning.
- `pnpm install --frozen-lockfile`: passed with pnpm 11.9.0.
- `pnpm audit --audit-level moderate`: passed, no known vulnerabilities.
- `companion/.venv/bin/python -m pip_audit --cache-dir /tmp/pip-audit`: passed with no known vulnerabilities; the local companion package is not published to PyPI and was skipped by the audit tool.
- `PYINSTALLER_CONFIG_DIR=/tmp/research-intelligence-pyinstaller-m3e companion/.venv/bin/python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean`: passed on macOS arm64/Python 3.14.6.
- `companion/dist/research-intelligence-companion/research-intelligence-companion --check`: passed.
- packaged-artifact sentinel scan: passed with no secret matches.
- `git diff --check`: passed.

The system-Python invocation of `python scripts/validate_schemas.py` was not
available because that interpreter lacks `jsonschema`; the same required
validation passed with `companion/.venv/bin/python`. No browser pass is inferred
from mocked tests.

## Visual evidence

No new screenshots were added by Task 3E. The existing approved prototype
captures remain reference evidence. The HTTPS static PWA spike was extended
with a real browser paper flow, but local Chromium availability is required to
claim execution.

## Traceability rows updated

Added `M3E-001` through `M3E-008` to `docs/traceability-matrix.md` with local
verification scope and an explicit unverified browser limitation.

## Unverified behavior and limitations

- `pnpm frontend:e2e`: previously unverified locally because Chromium was
  unavailable; after installing the matching browser, local macOS sandbox
  launch still terminated with `SIGTRAP`, so no local browser pass is claimed.
- `PYTHON_BIN=python PNPM_BIN=pnpm pnpm spike:pwa-loopback`: failed locally before
  the companion started because the system Python has no `uvicorn` module.
- With the repository companion environment and a temporary Playwright browser,
  the corrected spike passed the HTTPS/static-host and companion HTTP phase
  (health, exact-origin pairing, invalid/missing Origin rejection, preflight,
  and disposable project/profile seed writes), then Chromium terminated with
  `Target page, context or browser has been closed` / `SIGTRAP` in the local
  macOS sandbox. Its `finally` cleanup shut down the companion/static server
  and removed the disposable workspace/device state.
- GitHub Actions execution of the corrected browser flow remains pending; the
  PR #12 run recorded the pre-fix locator failure above.
- Real macOS/Windows keychain behavior, hard process-kill recovery and
  Dropbox-provider conflict behavior remain governed by prior checkpoint
  evidence and are not newly reverified here.
- Paper URLs, PDF bytes, full text, import, enrichment and all later research
  workflows remain out of scope.

## Merge blockers versus follow-up improvements

### Merge blockers

None identified in the local schema, frontend, or companion test suites. The
real browser flow remains a verification gap rather than a claimed pass.

### Follow-up improvements

- Run the HTTPS static-host spike in a browser-capable CI environment and
  attach its artifact to the Task 3E integration checkpoint.
- Add visual/containment captures for the new Papers route when browser capture
  infrastructure is available.
- Add later approved workflows for PDF/full-text state and paper deletion only
  under their separately scoped milestones.

## Recommended follow-up

Use the existing integration checkpoint harness to run the disposable paper
flow in CI before treating Task 3E as end-to-end verified. Do not commit real
user papers, private metadata, credentials, API keys, or local device indexes.
