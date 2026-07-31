# Task 5C Paper Summary Results

## Task and scope

- Task: Task 5C: explicit, bounded paper summaries
- Branch: `feature/m5c-paper-summary`
- Commit: to be recorded after validation
- Scope: one user-confirmed `paper_summary` operation over a completed local
  PDF extraction
- Excluded: automatic or batch summaries, summaries on import, classification,
  structured extraction, Ask Library, search, discovery, embeddings,
  synthesis, export, cloud processing, collaboration and production
  deployment

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Bounded source preparation and immutable prompt identity | Companion connected | Companion implementation and focused tests | No |
| `paper-summary.v1` validated output and `m5b.v1` durable history | Locally persisted | Schema validation, atomic processing records and focused companion tests | No |
| Explicit confirmation and paper-page summary UI | Companion connected | React tests and authenticated API integration | No |
| Cache hit, stale source, cancellation, retry and invalidation | Locally persisted | Focused Task 5C tests and Task 5B regression tests | No |
| Real HTTPS PWA summary flow | Locally persisted | Flow is implemented; local browser status is recorded below | No |
| Model quality, automatic learning and production AI | Visual mock / unavailable | Deliberately outside Task 5C | No |

No capability is `Production ready`. The deterministic provider is test
evidence for lifecycle behavior, not evidence of summary quality or external
provider availability.

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Inspect whether a summary can be requested | `apps/web/src/paperSummary.tsx` | `GET .../ai-summary/preflight` | `paper_summary.py`; `processing.py` | Safe source snapshot fields only | `paperSummary.test.tsx`; Task 5C companion tests |
| Confirm and start a summary | Paper summary confirmation modal | `POST .../ai-summary/start` | `ProcessingEngine.start_paper_summary`; prompt registry; provider runtime | `activity/processing/<processing-id>.json`; `processing-record.schema.json` | Focused companion/frontend tests; HTTPS spike |
| Read output/history and poll lifecycle | Paper summary section | `GET .../ai-summary/records`; scoped record read | Schema validation and bounded polling | Same `m5b.v1` record | Focused tests |
| Cancel/retry/invalidate | Explicit summary controls | Scoped action routes | Revision-aware lifecycle transitions | Same record with preserved history | Focused companion/frontend tests; HTTPS spike |
| Reload/reopen paper | Existing readable paper route | Authenticated reads | Workspace scope and persisted record validation | Same durable processing files | Reopen companion test; HTTPS spike |

## Source and privacy boundary

The source is prepared only after the selected paper and project are validated
and the paper has a completed local extraction. Preparation is deterministic,
page-aware and bounded to 60 pages and 48,000 characters. The metadata
allowlist covers user-authored paper fields such as title, authors, year,
venue, publication type/status, abstract, keywords and safe identifiers. It
does not include notes, Research Profiles, project ideas, paths, filenames,
credentials or browser state. Raw prepared text is held only in companion
memory while the request runs and is not written to the workspace or returned
by preflight/API responses.

The fake adapter is available only when `RI_AI_TEST_MODE=1` and is used by the
disposable browser spike. The production adapter is limited to the registered
paper-summary operation, retrieves credentials from the OS keychain and sends
the server-built request to the fixed HTTPS OpenAI-compatible endpoint. No
real user key or private paper was used for local validation.

## Durable and decision model

No new schema version or migration was required. `processing-record.schema.json`
remains `m5b.v1` with explicit branches for the prior synthetic echo and the
new `paper_summary` operation. Summary output is strict `paper-summary.v1`.
Records remain at `activity/processing/<processing-id>.json`; source snapshot
hashes/counts and safe provenance are durable, raw text is not. Cache identity
includes prompt, source, provider/model, parameters and output contract. A
source change marks older records stale, cache hits create a new event, retry
is bounded, cancellation prevents late replacement, and invalidation retains
history while blocking reuse.

## Files created and modified

Created:

- `companion/src/research_intelligence_companion/paper_summary.py`
- `companion/tests/test_task5c_paper_summary.py`
- `apps/web/src/paperSummary.tsx`
- `apps/web/src/paperSummary.test.tsx`
- `docs/adr/010-explicit-paper-summary.md`
- `docs/task-5c-paper-summary-results.md`

Modified:

- `companion/src/research_intelligence_companion/ai_provider.py`
- `companion/src/research_intelligence_companion/app.py`
- `companion/src/research_intelligence_companion/fingerprints.py`
- `companion/src/research_intelligence_companion/models.py`
- `companion/src/research_intelligence_companion/processing.py`
- `companion/src/research_intelligence_companion/prompt_registry.py`
- `companion/src/research_intelligence_companion/workspace.py`
- `packages/schemas/processing-record.schema.json`
- `apps/web/src/aiProcessing.tsx`
- `apps/web/src/companionClient.ts`
- `apps/web/src/papers.tsx`
- `apps/web/src/styles.css`
- `scripts/run_pwa_loopback_spike.mjs`
- `docs/acceptance-tests.md`
- `docs/data-model.md`
- `docs/feature-status-model.md`
- `docs/frontend-specification.md`
- `docs/integration-checkpoints.md`
- `docs/local-api.md`
- `docs/migrations.md`
- `docs/privacy-security.md`
- `docs/roadmap.md`
- `docs/traceability-matrix.md`
- `docs/workspace-atomic-writes.md`
- `docs/workspace-format.md`

Deleted: none.

## Validation results

Validation run locally on 2026-07-31:

- `pnpm install --frozen-lockfile`: passed; lockfile was already current.
- `PYTHONPATH=companion/src companion/.venv/bin/python scripts/validate_schemas.py`:
  passed; all 14 Draft 2020-12 schemas validated.
- `pnpm frontend:lint`: passed.
- `pnpm frontend:typecheck`: passed.
- `pnpm frontend:test`: passed; 110 tests in 9 files.
- `pnpm frontend:build`: passed; Vite production/PWA bundle generated.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m ruff check companion/src companion/tests`:
  passed.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m pytest companion/tests -q`:
  passed; 131 tests, with the existing Starlette/httpx deprecation warning.
- `pnpm audit --audit-level moderate`: passed; no known vulnerabilities.
- `companion/.venv/bin/python -m pip_audit --cache-dir /tmp/ri-task5c-pip-audit --requirement companion/requirements-dev.txt`:
  passed; no known vulnerabilities.
- `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH node --check scripts/run_pwa_loopback_spike.mjs`: passed.
- `PYINSTALLER_CONFIG_DIR=/tmp/ri-task5c-pyinstaller companion/.venv/bin/python -m PyInstaller companion/packaging/research-intelligence-companion.spec --noconfirm --clean`:
  passed on macOS arm64.
- `dist/research-intelligence-companion/research-intelligence-companion --check`:
  passed with `status: ok` and loopback host `127.0.0.1`.
- Packaged-artifact sentinel scan for `TEST_SECRET_DO_NOT_RETURN`,
  `RI_INSTALLATION_SECRET_DO_NOT_RETURN` and the synthetic summary credential:
  passed; no matches.
- Repository-relative Markdown link/path validation: passed; 52 links checked.
- `git diff --check`: passed.

`pnpm frontend:e2e` ran all 5 tests but could not launch the expected
Playwright Chromium executable. A second attempt using the installed older
headless shell reached the browser process but macOS terminated it with
`SIGTRAP`; no E2E assertion is claimed. The same older-shell override was used
for `pnpm spike:pwa-loopback`: companion health, configured/invalid/missing
Origin checks, pairing and disposable seed setup passed, then Chromium exited
with `SIGTRAP` before page assertions. The spike's `finally` cleanup shut down
the companion, HTTPS server and disposable workspace. The real Task 5C
browser-to-companion flow therefore remains unverified locally; direct API and
mocked-fetch results do not promote it to `End-to-end verified`.

## Security review

Loopback-only binding, exact allowed Origin, explicit pairing, short-lived
in-memory sessions, keychain-only production credentials, schema validation,
path confinement, atomic workspace transactions and device-local index
separation remain unchanged. Summary records contain no credentials, API keys,
session tokens, paths, raw prompt/provider bodies or private reasoning. The
browser stores no summary or source state in localStorage, sessionStorage,
IndexedDB or cookies.

## Unverified behavior and limitations

- External provider execution and model quality were not tested.
- Real macOS Keychain and Windows credential-manager behavior remains platform
  evidence rather than local test-mode evidence.
- A hard process-kill during an in-process summary worker remains outside this
  milestone's scheduler proof; workspace reopen handles abandoned durable
  queued/running records through the existing Task 5B recovery behavior.
- Browser end-to-end status depends on Chromium availability and must not be
  inferred from direct HTTP or unit tests.

## Merge blockers versus follow-up improvements

### Merge blockers

Any schema failure, raw-source or credential leakage, failed scope/origin/
authentication enforcement, stale overwrite, cancellation overwrite, or
browser pass claimed without actual Chromium execution is a blocker.

### Follow-up improvements

Add a cross-platform real-provider test harness only after provider-network
policy is approved; define future summary editing/export semantics separately;
and add later AI operations only with their own source boundaries, contracts,
privacy review and traceability rows.

## Work reserved for later milestones

Task 5D and later work remain responsible for any additional AI operations,
search or Ask Library behavior, structured extraction, embeddings, synthesis,
citations, export, collaboration, cloud processing and production deployment.
No automatic paper feedback or profile learning is included here.
