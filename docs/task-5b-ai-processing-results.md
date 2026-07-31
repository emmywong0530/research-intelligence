# Task 5B AI Processing Foundation Results

## Task and scope

- Task: Task 5B: bounded, transparent local AI processing foundation
- Branch: `feature/m5b-ai-processing-foundation`
- Implementation commit: 126df28 (local, not pushed)
- Explicitly excluded: paper summaries, classification, AI PDF/text
  extraction, Ask Library, search, embeddings, discovery execution/ranking,
  feedback-derived or autonomous learning, batch/background processing,
  cloud processing, export, collaboration and production deployment.

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Code-owned synthetic prompt registry | Companion connected | Immutable companion registry and safe metadata API | No |
| Strict processing records and safe provenance | Locally persisted | `m5b.v1` schema, atomic workspace files and reopen recovery tests | No |
| Deterministic fingerprints and cache | Locally persisted | Focused miss/hit/stale/invalidation tests | No |
| Explicit processing lifecycle | Locally persisted | Completion, invalid output, retry, cancellation and interruption tests | No |
| Processing settings test panel | Companion connected | React component with mocked API tests and no browser storage | No |
| HTTPS PWA-to-companion processing flow | Locally persisted | Loopback flow implemented; local status depends on Chromium availability | No |
| Research-content AI processing | Visual mock / unavailable | No paper, note, profile, PDF or full-text operation exists | No |

No capability is `Production ready`. The synthetic operation is not evidence
of model quality or external provider availability.

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Inspect the available synthetic operation | `apps/web/src/aiProcessing.tsx` | `GET .../ai/processing/operations`; `GET .../prompts` | `prompt_registry.py`; `processing.py` | Code-owned registry; no prompt-body response | `aiProcessing.test.tsx`; focused companion tests |
| Start one synthetic event | Processing settings panel | `POST .../ai/processing/start` | `ProcessingEngine.start`; fake generation adapter | `activity/processing/<processing-id>.json`; `processing-record.schema.json` | Focused companion/frontend tests; HTTPS spike |
| Observe output/provenance/cache | Processing result/history panel | `GET .../records`; `GET .../records/{id}`; `GET .../provenance` | Schema validation, bounded output and provenance | Same `m5b.v1` record | Focused tests |
| Cancel/retry/invalidate | Explicit buttons | `POST .../cancel`, `/retry`, `/invalidate` | Revision-aware state transitions | Same record, preserved history | Focused tests; HTTPS spike |
| Reopen workspace after interruption | No automatic resume UI | Workspace open | Interrupted queued/running records fail explicitly | Same durable record | Reopen recovery test |

## Prompt and source boundary

`companion/src/research_intelligence_companion/prompt_registry.py` is the
single code-owned registry. The initial operation is `provider_echo_test`,
prompt `task5b.provider_echo_test` version `1.0.0`, with output contract
`task5b.provider_echo_ack.v1`. Its only variable is a bounded synthetic input
version. The API returns safe identity/version/fingerprint metadata but not
system or user template bodies. No model, classifier, embedding, hidden
learning or remote prompt service is used.

## Durable and cache model

Records are stored at `activity/processing/<processing-id>.json` with strict
`m5b.v1` validation and `additionalProperties: false`. The existing atomic
record journal and workspace backup behavior are reused. Device-local provider
configuration, keychain entries and rebuildable indexes remain outside the
workspace.

Input, source, output and cache fingerprints are canonical JSON SHA-256 values
with separate domain prefixes. Cache keys exclude processing IDs, time,
sessions, paths and credentials. A completed valid non-stale non-invalidated
record is reusable; a cache hit creates a new event with an original-record
reference. Source-version changes mark older events stale. Explicit
invalidation prevents reuse without deleting the event.

## Recovery and security

The in-process scheduler allows one active event per cache key and persists
queued/running/terminal states. Cancellation is written before a late result
can be accepted. Retry is explicit and bounded. Workspace open converts
abandoned queued/running records to `failed` with
`processing_unavailable`; it does not resume provider work.

All processing routes require loopback access, exact configured Origin, paired
session authentication and an opened workspace. The synthetic record contains
no credential, API key, absolute path, raw prompt, raw provider response,
session token or private reasoning. The frontend uses React memory only; no
operation, output, workspace, prompt or token enters browser storage.

## Schema, API and migration impact

Created `packages/schemas/processing-record.schema.json` using JSON Schema Draft
2020-12. No existing schema was changed and no migration was required because
the record is additive under the approved `activity/processing/` directory and
does not modify `workspace.json`. `docs/migrations.md` records this boundary.

Added authenticated processing routes documented in `docs/local-api.md` and
the typed frontend client. The production OpenAI-compatible adapter exposes a
typed generation boundary but returns `provider_unavailable` for generation;
only the explicit fake test mode can execute the initial operation.

## Files created and modified

Created:

- `packages/schemas/processing-record.schema.json`
- `companion/src/research_intelligence_companion/fingerprints.py`
- `companion/src/research_intelligence_companion/prompt_registry.py`
- `companion/src/research_intelligence_companion/processing.py`
- `companion/tests/test_task5b_processing.py`
- `apps/web/src/aiProcessing.tsx`
- `apps/web/src/aiProcessing.test.tsx`
- `docs/adr/009-ai-processing-foundation.md`
- `docs/task-5b-ai-processing-results.md`

Modified:

- `companion/src/research_intelligence_companion/ai_provider.py`
- `companion/src/research_intelligence_companion/app.py`
- `companion/src/research_intelligence_companion/models.py`
- `companion/src/research_intelligence_companion/workspace.py`
- `apps/web/src/App.tsx`
- `apps/web/src/companionClient.ts`
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

## Tests and exact results

Validation run locally on 2026-07-31:

- `PYTHONPATH=companion/src companion/.venv/bin/python scripts/validate_schemas.py`:
  passed; all 14 JSON Schemas validated as Draft 2020-12.
- `pnpm frontend:lint`: passed.
- `pnpm frontend:typecheck`: passed.
- `pnpm frontend:test`: passed; 95 tests in 8 files.
- `pnpm frontend:build`: passed; Vite production/PWA bundle generated.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m ruff check companion/src companion/tests`:
  passed.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m pytest companion/tests -q`:
  passed; 128 tests, 1 existing Starlette/httpx deprecation warning.
- `pnpm audit --audit-level moderate`: passed; no known vulnerabilities.
- `companion/.venv/bin/python -m pip_audit --cache-dir /tmp/ri-task5b-pip-audit --requirement companion/requirements-dev.txt`:
  passed; no known vulnerabilities.
- `node --check scripts/run_pwa_loopback_spike.mjs`: passed.
- PyInstaller packaging with `PYINSTALLER_CONFIG_DIR=/tmp/ri-task5b-pyinstaller`:
  passed on macOS arm64; packaged `--check` returned `status: ok` and both
  packaged-artifact sentinel scans passed. The first unscoped local invocation
  was blocked by the sandbox's default PyInstaller cache location; the rerun
  used the writable temporary cache and passed.
- Markdown relative-link validation: passed for 77 repository Markdown files,
  excluding `.venv`, generated build output and dependency directories. The
  first unfiltered scan found only a dependency README link, not a repository
  document failure.
- `git diff --check`: passed.
- `git status`: run before final commit; final output is recorded in the
  completion report.

`pnpm frontend:e2e` was run and all 5 tests were unverified locally because
the Playwright Chromium executable is unavailable. The command failed at
browser launch before test execution. The HTTPS static PWA loopback spike was
also run; static HTTPS serving, companion startup, health, Origin checks,
pairing and disposable seed setup passed, then browser launch failed for the
same missing Chromium executable. Its `finally` cleanup shut down the
companion, static server and disposable workspace. No browser end-to-end pass
is claimed from direct HTTP or mocked-fetch evidence.

## Visual evidence

No new visual-regression screenshots are required for this settings-only
foundation. The loopback script is the real browser artifact when Chromium is
available; no local Playwright pass is claimed without that executable.

## Traceability rows updated

Added `M5B-001` through `M5B-008` in `docs/traceability-matrix.md`. They remain
at Companion connected or Locally persisted status until the required browser
evidence exists.

## Unverified behavior and limitations

- No real external provider request or real user credential was used.
- Real macOS Keychain and Windows credential-manager behavior remains outside
  the synthetic test store evidence.
- Chromium/browser and HTTPS loopback status is unverified locally if the
  executable is unavailable.
- The scheduler is in-process and intentionally test-only; hard process kill,
  distributed workers and background queues are later work.
- The production adapter does not process research content.
- No production readiness or model-quality claim is made.

## Merge blockers versus follow-up improvements

### Merge blockers

Any schema failure, secret leakage, failed Origin/session enforcement, stale
write that overwrites a current record, cancellation overwrite, unverified
browser flow claimed as passing, or scope expansion into research-content AI is
a blocker.

### Follow-up improvements

Define the next approved content operation with source scope and user approval,
add a cross-platform process-restart harness, and expand provider capability
reporting only when the next milestone authorizes those behaviors.

## Recommended follow-up

Keep Task 5B as the foundation. Do not add summaries, classification,
extraction, semantic search, embeddings, Ask Library or automatic learning
until a separate approved milestone defines their data contracts and privacy
review.
