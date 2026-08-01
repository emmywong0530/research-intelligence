# Task 5C Paper Summary Results

## Task and scope

- Task: Task 5C: explicit, bounded paper summaries
- Branch: `feature/m5c-paper-summary`
- Commit: `5778c04` (`feat: implement explicit paper summaries`)
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

## PR #20 loopback correction

The failed CI browser assertion was caused by shared disposable-fixture state,
not by the Task 5C summary implementation. Earlier Task 3D/4C/4D flows mutate
the shared `Task 3D browser project` paper, so Task 5C could no longer assume
that the title `Updated browser-persisted paper record` identified the intended
summary source.

The loopback spike now creates and cleans up a dedicated disposable fixture:

- project ID `project-task5c-browser`, named `Task 5C browser summary project`;
- paper ID `paper-task5c-browser`, initially named `Task 5C browser summary paper`;
- generated PDF `task5c-summary.pdf`, imported through the real paper UI and
  verified by SHA-256 and local extraction before summary actions begin.

Task 5C opens its paper by the immutable paper-row test ID and verifies the
exact title inside that row. Summary title changes, reload, workspace reopen
and history assertions continue to use the same stable paper ID. The existing
Task 3D/4C/4D shared-paper flow remains unchanged. No production code,
schemas, APIs or durable summary behavior changed.

The dedicated workspace and all three generated PDF fixtures are removed in
the existing `finally` cleanup. The local browser result remains unverified:
the expected Playwright Chromium executable is unavailable locally, and the
older installed headless shell exits with macOS `SIGTRAP`. CI run 58 reached
the Task 5C flow before failing on the shared-fixture assumption; this
correction has not been promoted to a browser pass locally.

CI run 59 confirmed the dedicated fixture and summary lifecycle through cache
reuse, metadata invalidation and a new summary request. Its remaining failure
was a stale loopback expectation for the Task 5B wording “outside the
registered contract”. Task 5C’s accepted internal category is
`invalid_output`, and its canonical bounded user message is “The provider
returned an unsupported paper summary contract.” The loopback now asserts that
message in the existing semantic `role="status"` region, separately verifies
the failed state, `cache_miss` history, Retry action and absence of the raw
synthetic output/provider diagnostic. The companion and frontend regression
tests cover the same safe mapping and retry behavior. No production wording or
validation behavior changed.

## CI run 60 workspace-revision correction

The remaining run 60 failure was a real filesystem race in the preceding Task
5B cancellation stage, not a Task 5C timeout or summary assertion issue.
`workspace_revision()` enumerated an atomic-write temporary file such as
`.processing_<id>.json.<random>.tmp`; the writer then replaced or removed that
temporary path before the revision scanner called `sha256_file()`. The
resulting `FileNotFoundError` escaped the cancellation endpoint as HTTP 500,
leaving the later Task 5C request queued as a downstream symptom.

The production correction centralizes the companion temporary-file rule
(hidden names ending in `.tmp`, including interrupted-write variants), excludes
those files from durable revision input and record discovery, and retains safe
cleanup of abandoned files. A revision scan now checks file identity and
size/mtime before and after hashing, re-scans the complete durable file set
when a file changes, disappears or is added, and stops after three attempts.
Exhausted retries return a controlled `409` `workspace_busy` response without
paths or stack traces. Processing worker and cancellation transitions now use
the existing short-lived engine lock around read/check/write mutations;
provider execution remains outside the lock, so cancellation cannot be
overwritten by a late completion and later queue work continues.

Focused regression coverage verifies temporary exclusion, disappearing files,
valid old/new atomic states, deterministic stable revisions, bounded retry
failure, safe API mapping, record-list filtering and cancellation followed by
later processing. No schema or durable record contract changed.

## PR #20 CI run 61 exact-record wait correction

Run 61 reached the Task 5C invalid-output scenario after the Task 5B delayed
start and cancellation flow completed. The companion returned HTTP 200 for the
summary start request, but the browser waited only 15 seconds for the generic
status text while the start response and durable transition consumed most of
that window. The resulting `queued` assertion was an observation/timing
failure, not evidence that invalid output was accepted or that the summary
worker was stuck.

The loopback now captures the exact `processing_id` from the browser's
authenticated `POST .../ai-summary/start` response. It polls the scoped
browser-to-companion
`GET .../workspaces/<workspace>/projects/<project>/papers/<paper>/ai-summary/records/<processing-id>`
endpoint in the page context until `completed`, `failed` or `cancelled`, with a
60-second overall bound. A timeout reports the last durable status and last
read error without exposing credentials or source text. Only after the exact
record reports `failed` does the spike assert the UI message, `invalid_output`
category, `cache_miss` history, retry action and absence of raw synthetic output
or provider diagnostics.

The test-only `POST /api/v1/ai/processing/test-scenario` control remains paired
and test-mode-only; the focused companion test starts the same paper-summary
operation after selecting `invalid_output` and verifies the exact processing
record reaches its terminal state. No production summary behavior, schema,
API contract or atomic-write handling changed in this correction.

The correction is not yet promoted to a browser pass locally. The local
environment has no Playwright Chromium executable; CI run 61 supplied the
failure evidence, but a post-correction CI pass is still required for the real
browser-to-companion claim.

## PR #20 CI run 62 record-list and status-locator correction

Run 62 confirmed that the exact-processing-ID wait works: the invalid-output
operation reached `failed`, the canonical bounded error rendered, and the exact
durable processing record was polled successfully. The remaining browser issue
was a strict-mode ambiguity because the summary section temporarily contained
both the source-check live region (`Checking summary source…`) and the
processing-result live region (`Latest request: failed`). The frontend now gives
the latter the dedicated `data-testid="paper-summary-processing-status"`
locator, and the spike uses it without weakening the separate source status.

The same run exposed a real list-read race: a durable processing JSON path was
enumerated and disappeared before its hash was read. Processing records were
not intentionally deleted. Retry creates a new historical record; stale,
cancelled and invalidated transitions update existing records; cache reuse
creates a new event while retaining the original. The correction makes
`list_records()` perform a complete three-attempt consistent snapshot using
eligible filename-set checks and per-file identity/size/mtime checks around
validated reads and SHA-256 revisions. Disappearance or concurrent replacement
restarts the scan; exhaustion raises the existing safe `workspace_busy` 409.
Summary preflight now uses the existing project-and-paper-scoped summary list
instead of scanning all processing records.

Focused regressions cover disappearing records, changing eligible filename
sets, atomic temporary exclusion, complete snapshots, bounded busy errors,
history retention after retry/invalidation/cancellation, and summary preflight
during a deterministic processing-record replacement. No schema or API
contract changed.

## PR #20 CI run 63 completed-output rendering correction

Run 63 completed the first Task 5C paper-summary request and returned a valid
`paper-summary.v1` record. The durable record, history event and invalidate
control were present, but the browser still showed `Not applied` and did not
render the summary output. No record-listing exception occurred. The cause was
an incorrect frontend gate: output rendering required
`preflight.cache_available`, even though that flag only reports whether a
future explicit request may reuse a matching cache event.

The frontend now renders a scoped, completed, schema-shaped summary record
when it is not invalidated. It does not require preflight cache availability,
so a completed `cache_miss` result remains visible while preflight is false or
being refreshed. The companion preflight and cache behavior are unchanged.
The active record is retained when a concurrent refresh temporarily returns an
older list snapshot; history ordering remains deterministic by `updated_at`
and processing ID. A response from another workspace, project or paper is not
rendered.

Stale completed output remains readable and is labeled `Stale source`, while
the Generate action remains explicit and stale output is not eligible for
cache reuse. Invalidated, failed, cancelled, malformed and wrong-contract
records remain out of the output surface and stay represented in bounded
history/status state. The accepted meaning is documented in ADR 010 and the
Task 5C local API section.

Focused frontend coverage now includes completed cache-miss/cache-hit output,
preflight refresh visibility, stale readability/non-reuse, invalidated and
malformed output suppression, and protection against replacing a newly
completed active record with an older refresh result. The frontend suite now
passes 117 tests across 9 files; the companion suite remains 145 tests. No
backend, API, schema or migration change was required.

CI run 63 supplied the browser failure evidence. Local browser verification
remains unverified because the required Playwright Chromium executable is not
available in the sandbox; direct API and unit-test passes do not promote the
real HTTPS browser flow to an end-to-end pass.

## PR #20 CI run 64 exact-retry waiting correction

Run 64 verified the run 63 output-rendering correction and progressed through
import, extraction, the initial completed summary, cache reuse, stale-source
regeneration and the invalid-output flow. The remaining failure was the retry
assertion: after clicking `Retry summary`, the spike waited directly for UI
output with a 15-second timeout. CI evidence showed the retry POST consumed
approximately 10.406 seconds, returned a queued record, and the browser then
had too little time left for the asynchronous worker to complete. No
companion exception, `FileNotFoundError` or HTTP 500 occurred.

The loopback now registers the exact scoped retry response before clicking the
button, verifies HTTP success and a new queued processing ID, then polls that
same ID through `waitForPaperSummaryTerminal`. It requires a completed
`paper-summary.v1` record, the deterministic summary, `cache_miss`, and
`retry_of_processing_id` pointing to the failed or cancelled source event
before asserting browser output. It separately reads the failed record to
prove it remains failed and preserved in history. The later cancellation
scenario uses the same exact-ID start, cancellation and retry checks.

Focused companion coverage now measures the retry route and asserts it returns
the queued durable record before provider execution; the provider worker stays
asynchronous. Source preparation, scoped stale recalculation, cache/history
lookup and atomic queued-record creation are synchronous request work. No
workspace-wide scan or provider call is performed by the retry endpoint, and
no production code changed. The frontend now has 118 passing tests across 9
files, including 13 focused paper-summary tests; the companion suite remains
145 tests.

Run 64 itself did not produce a browser pass locally or in the retained CI
evidence after this correction. Local browser verification remains unverified
when Chromium is unavailable; direct API, unit-test and packaging results do
not promote the real HTTPS flow to end-to-end verified.

Correction validation run locally on 2026-08-01:

- `pnpm --dir apps/web exec vitest run src/paperSummary.test.tsx`: passed; 13
  focused tests.
- `pnpm frontend:test`: passed; 118 tests in 9 files.
- `pnpm frontend:lint`, `pnpm frontend:typecheck` and `pnpm frontend:build`:
  passed.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m ruff check companion/src companion/tests`:
  passed; focused and full companion suites passed with 5 focused and 145
  total tests. The existing Starlette/httpx deprecation warning remains.
- `PYTHONPATH=companion/src companion/.venv/bin/python scripts/validate_schemas.py`:
  passed; all 14 schemas.
- Node syntax validation passed. The latest `pnpm audit --audit-level
  moderate` and `pip_audit --requirement companion/requirements-dev.txt`
  attempts were blocked by unavailable npm/PyPI DNS access; no new local audit
  pass is claimed here. Earlier audit passes remain historical evidence.
- PyInstaller packaging, packaged companion `--check`, packaged-artifact
  sentinel scan, repository credential-shaped scan, Markdown relative-path
  validation and `git diff --check`: passed.
- `pnpm frontend:e2e`: unverified locally. The latest attempt stopped before
  browser launch because Vite preview could not bind `127.0.0.1:4173` with
  `EPERM`; an earlier attempt also found the Playwright Chromium executable
  unavailable.
- `PYTHON_BIN=companion/.venv/bin/python PNPM_BIN=pnpm pnpm spike:pwa-loopback`:
  the latest attempt stopped before companion/browser setup because the static
  HTTPS server could not bind `127.0.0.1:4443` with `EPERM`. No local
  browser-to-companion pass is claimed. Earlier setup-only evidence remains
  historical, and existing cleanup completed on the prior attempt.

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
- `pnpm frontend:test`: passed; 117 tests in 9 files, including 12 focused
  paper-summary tests.
- `pnpm frontend:build`: passed; Vite production/PWA bundle generated.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m ruff check companion/src companion/tests`:
  passed.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m pytest companion/tests/test_workspace.py -q`:
  passed; 16 workspace and record-list concurrency tests, with the existing
  Starlette/httpx deprecation warning.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m pytest companion/tests/test_task5b_processing.py -q`:
  passed; 6 processing lifecycle and history tests, with the existing
  Starlette/httpx deprecation warning.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m pytest companion/tests/test_task5c_paper_summary.py -q`:
  passed; 5 focused Task 5C tests, with the existing Starlette/httpx
  deprecation warning. This includes the bounded delayed-start, exact
  processing-record and preflight replacement regressions.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m pytest companion/tests -q`:
  passed; 145 tests, with the existing Starlette/httpx deprecation warning.
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
- Repository-relative Markdown link/path validation: passed; 74 Markdown files checked.
- `git diff --check`: passed.
- `git status --short --branch`: showed only the intended files before the
  correction commit.

`pnpm frontend:e2e` remains unverified locally because the required Playwright
Chromium executable is absent. The same environment ran
`PYTHON_BIN=companion/.venv/bin/python PNPM_BIN=pnpm pnpm spike:pwa-loopback`:
companion health, configured/invalid/missing Origin checks, pairing and
disposable seed setup passed, then Playwright could not launch. The spike's
`finally` cleanup shut down the companion, HTTPS server and disposable
workspace. An earlier local attempt with an older installed shell ended in
macOS `SIGTRAP`; no browser assertion is claimed. CI run 61, as supplied for
this correction, failed only at the old Task 5C observation and is not a
post-correction browser pass. Direct API or mocked-fetch results do not promote
the real Task 5C browser-to-companion flow to `End-to-end verified`.

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
