# Task 4C Implementation Report

## Task and scope

- Task: Task 4C deterministic local duplicate detection and explicit duplicate warnings
- Branch: `feature/m4c-duplicate-detection`
- Commit: final local commit for `feat: implement deterministic duplicate detection`
- Status: `Locally persisted`; the real browser path is implemented but remains unverified locally until Chromium runs
- Follow-up verification fix: the Task 3D overview spike now selects the
  level-3 Research Profile heading when its question text also appears as the
  project heading; no duplicate-detection behavior changed.
- Explicitly excluded: merge, delete, hide, reassignment, automatic metadata repair, DOI/remote metadata lookup, AI/LLM inference, semantic similarity, ranking, FTS, embeddings, discovery, ingestion, citations, export, collaboration, cloud sync and production deployment

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Exact imported-PDF evidence | Locally persisted | 108 companion tests and 13-schema validation; browser flow implemented, local Chromium unverified | No |
| Exact DOI/PMID/arXiv evidence | Locally persisted | Deterministic normalization and authenticated API tests | No |
| Conservative metadata candidates | Locally persisted | Normalization, rebuild and type-separation tests | No |
| Explicit duplicate review state | Locally persisted | Strict `m4c.v1` schema, atomic record writes, stale revision and reopen tests | No |
| Papers duplicate UI | Locally persisted | 81 frontend tests with mocked companion responses | No |
| Project Overview duplicate summary | Locally persisted | Overview implementation and regression tests | No |
| Real HTTPS PWA-to-companion duplicate flow | Locally persisted | Script includes disposable two-project flow; local browser phase is unverified | No |

No capability is `End-to-end verified` or `Production ready`.

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Open Papers and see duplicate indicators | `apps/web/src/papers.tsx` | `GET /api/v1/workspaces/{workspace_id}/duplicates?project_id=...` | `duplicate_detection.py` rebuilds the workspace report | Existing paper/source records; derived `m4c.v1` report | `apps/web/src/papers.test.tsx`; `companion/tests/test_task4c_duplicate_detection.py` |
| Inspect an exact or candidate group | Paper Duplicate check section | `GET .../duplicates/{group_fingerprint}` | Recomputes and returns only a current group | Fingerprints are derived, not separately indexed | Focused companion tests and frontend evidence tests |
| Acknowledge/separate/ignore evidence | Explicit review buttons | `POST .../duplicates/reviews` with expected review revision | Validates current group and writes via atomic record transaction | `feedback/duplicate-reviews/duplicate_review_<group-fingerprint>.json`; `duplicate-review.schema.json` | Review persistence/conflict tests and frontend review POST test |
| See project duplicate summary | Project Overview Duplicate evidence section | Same authenticated report endpoint with active-project filter | Workspace-wide report remains the source; overview counts only active-project papers | No browser/device index | Overview regression tests |
| Reopen after paper/source changes | React reload from companion | Same report endpoint | Rebuilds from current durable files | Stale fingerprints are not reused | Metadata/source invalidation tests |

## Detection and identity model

The report is recomputed from the active workspace's schema-valid project and
paper records. Exact-source evidence is allowed only when the canonical source
sidecar and PDF are complete, associated with the same project/paper, inside
the workspace, and have matching size and SHA-256. The report shows a short
hash preview and filenames only.

Titles are normalized with Unicode NFKC, case folding, whitespace collapse,
conservative punctuation spacing and terminal punctuation trimming. The first
author surname is taken only from the supplied name shape. Identifiers are
type-aware and limited to DOI, PMID and arXiv IDs. A metadata candidate matches
the normalized title, year and first-author surname tuple. A present year never
matches a missing year; two missing years can only match when the normalized
title and required author evidence also match. This is intentionally
conservative and is not an identity or global uniqueness decision.

Group fingerprints hash the evidence type/value and sorted paper IDs.
Evidence fingerprints hash only the evidence type/value. A paper/source edit
rebuilds the report, and changed membership or evidence produces a new group
fingerprint. Analysis is bounded at 2,000 valid papers, 500 returned groups
and 100 warnings.

## Review and migration model

The optional review record uses strict Draft 2020-12 schema `m4c.v1`, stable
review/group/evidence identifiers, sorted paper IDs, status and timestamps. It
is stored at:

`feedback/duplicate-reviews/duplicate_review_<group-fingerprint>.json`

The only review states are `reviewed_duplicate`, `reviewed_not_duplicate` and
`ignored`. Exact PDF evidence cannot be marked `reviewed_not_duplicate`.
Review state annotates evidence only; it never merges, deletes, hides or edits
paper records. The record ID and workspace ID are checked by the generic
atomic writer as well as the dedicated endpoint. A stale review revision
returns `409`.

No migration was required. There were no prior duplicate-review records or
schema version to migrate, and existing paper, source-file and extraction
records remain unchanged. `additionalProperties: false` is preserved.

## Files changed

Created:

- `packages/schemas/duplicate-review.schema.json`
- `companion/src/research_intelligence_companion/duplicate_detection.py`
- `companion/tests/test_task4c_duplicate_detection.py`
- `docs/task-4c-duplicate-detection-results.md`

Modified:

- `companion/src/research_intelligence_companion/app.py`
- `companion/src/research_intelligence_companion/models.py`
- `companion/src/research_intelligence_companion/workspace.py`
- `apps/web/src/companionClient.ts`
- `apps/web/src/papers.tsx`
- `apps/web/src/papers.test.tsx`
- `apps/web/src/projectOverview.tsx`
- `apps/web/src/projectOverview.test.tsx`
- `apps/web/src/styles.css`
- `scripts/run_pwa_loopback_spike.mjs`
- `docs/architecture.md`
- `docs/acceptance-tests.md`
- `docs/data-model.md`
- `docs/feature-status-model.md`
- `docs/frontend-specification.md`
- `docs/integration-checkpoints.md`
- `docs/local-api.md`
- `docs/privacy-security.md`
- `docs/roadmap.md`
- `docs/traceability-matrix.md`
- `docs/workspace-atomic-writes.md`

Deleted: none.

## Contracts changed

- Added `duplicate-review.schema.json` with `schema_version: "m4c.v1"`.
- Added three authenticated exact-Origin API routes for report, group and
  review operations. No paper lifecycle endpoint changed.
- Added `duplicate-reviews` to the companion's approved durable descriptor and
  path map, with workspace and deterministic review-ID enforcement.
- Added `DuplicateReportResponse`, group and review response/request models.
- No project, paper, source-file or extracted-text schema migration occurred.
- No ADR was added; this is a bounded implementation of the accepted
  local-first and durable-file architecture, with the contract recorded here
  and in the existing architecture/data-model documents.

## Security and privacy

Loopback-only binding, exact allowed origins, missing-Origin rejection,
companion-owned pairing, short-lived in-memory sessions and keychain-only
installation secrets are unchanged. Duplicate routes require the paired
session and active workspace. Project filters are enforced by the companion;
the frontend rejects responses with another workspace or project.

No external lookup or AI processing is performed. Full filesystem paths, full
source hashes, PDF bytes, extracted text, credentials, API keys, session tokens
and hidden prompts are not returned by duplicate responses or written to the
review record. Browser storage is not used. The report is not copied into the
device-local SQLite registry or any future FTS/vector index. Malformed or
symlinked source data is excluded rather than guessed.

## Tests and exact results

Local results recorded for this implementation pass:

- `pnpm install --frozen-lockfile` -> passed with pnpm 11.9.0.
- `pnpm audit --audit-level moderate` -> passed; no known vulnerabilities found.
- `companion/.venv/bin/pip-audit --cache-dir /tmp/research-intelligence-pip-audit --requirement companion/requirements-dev.txt` -> passed; no known vulnerabilities found.
- `companion/.venv/bin/python scripts/validate_schemas.py` -> passed, 13 JSON Schemas.
- `companion/.venv/bin/ruff check companion/src companion/tests` -> passed.
- `companion/.venv/bin/pytest -q companion/tests/test_task4c_duplicate_detection.py` -> passed, 20 tests, 1 existing Starlette/httpx deprecation warning; includes missing/corrupt source, group read, review persistence and metadata-missing regressions.
- `companion/.venv/bin/pytest -q companion/tests` -> passed, 108 tests, 1 existing Starlette/httpx deprecation warning.
- `pnpm --dir apps/web lint` -> passed.
- `pnpm --dir apps/web typecheck` -> passed.
- `pnpm --dir apps/web exec vitest run src/projectOverview.test.tsx` -> passed,
  11 tests, including the duplicate project/profile question locator
  regression against `overview-profile-title`.
- `pnpm --dir apps/web test -- --run` -> passed, 81 tests across 6 files.
- `pnpm --dir apps/web build` -> passed; production PWA generated.
- `node --check scripts/run_pwa_loopback_spike.mjs` -> passed.
- `pnpm frontend:e2e` -> unverified locally; all 5 Playwright tests could not
  launch because the Chromium executable is not installed at
  `/Users/emmywong/Library/Caches/ms-playwright/chromium_headless_shell-1228/`.
- `PYTHON_BIN=companion/.venv/bin/python PNPM_BIN=pnpm pnpm spike:pwa-loopback`
  -> unverified locally; the static HTTPS server, companion, health, pairing
  and Origin checks passed, then the real browser phase stopped at the missing
  Chromium executable at
  `/Users/emmywong/Library/Caches/ms-playwright/chromium_headless_shell-1228/`.
  The Task 3D and Task 4C browser flows are not claimed as passes.
- `PYINSTALLER_CONFIG_DIR=/tmp/research-intelligence-pyinstaller companion/.venv/bin/python -m PyInstaller companion/packaging/research-intelligence-companion.spec --noconfirm --clean` -> passed on macOS arm64.
- `dist/research-intelligence-companion/research-intelligence-companion --check` -> passed.
- packaged-artifact sentinel scan for `TEST_SECRET_DO_NOT_RETURN` and `RI_INSTALLATION_SECRET_DO_NOT_RETURN` -> passed.
- repository Markdown relative-link/path validator, excluding generated
  environments -> passed.
- `git diff --check` -> passed.

No GitHub Actions pass is inferred from workflow configuration. Windows
packaging and a browser-capable CI run remain unverified locally.

## Visual evidence

No new screenshots are required for this bounded data/UI addition. Existing
Task 1 captures are not evidence of Task 4C browser persistence. The real
browser spike uses Playwright and generated disposable PDFs; it is not a
mocked-fetch substitute. Local Chromium availability is reported separately.

## Traceability rows updated

Added `M4C-001` through `M4C-011` in `docs/traceability-matrix.md`. Current
repository-wide validation counts are 13 schemas, 81 frontend tests and 108
companion tests; historical milestone snapshots remain identified as such.

## Unverified behavior and limitations

- Local Chromium/Playwright launch is an environment limitation; the browser
  phase of the HTTPS spike is not claimed as a pass from source inspection.
- The macOS package, packaged `--check` and sentinel scan passed locally;
  Windows packaging and real user keychain behavior are not represented by
  this local run.
- Hard process-kill behavior, Dropbox provider semantics and large-workspace
  performance are not newly verified here.
- Metadata candidates are deliberately conservative and can miss duplicates;
  they do not establish identity.
- Review state is an annotation, not a canonicalization or merge system.

## Merge blockers versus follow-up improvements

### Merge blockers

- A passing real HTTPS browser-to-companion Task 4C flow is still required for
  `End-to-end verified`; until then the capability must remain
  `Locally persisted`.
- No schema, security, full-suite, audit or macOS packaging blocker remains in
  the completed local validation. The missing local Chromium executable is an
  evidence limitation, not a duplicate-detection implementation claim.

### Follow-up improvements

- Add a dedicated duplicate-results integration artifact after a browser-capable
  CI run.
- Revisit configurable performance limits only with measured disposable
  workspaces.
- Design a later canonicalization/merge milestone separately; it is not part of
  Task 4C.

## Recommended follow-up

Run the HTTPS static PWA spike in GitHub Actions, review its generated
artifacts, and update `M4C-011` only from the actual result. Keep duplicate
evidence and review files local to disposable workspaces during validation.
