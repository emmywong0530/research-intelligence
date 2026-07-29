# Implementation Report

## Task and scope
- Task: Task 4B deterministic local PDF text extraction.
- Branch: `feature/m4b-pdf-text-extraction`.
- Commit: implementation commit; final SHA is reported with this report.
- Explicitly excluded: OCR, PDF rendering/viewer, paper ingestion, metadata
  lookup, discovery, search, FTS, embeddings, AI processing, summaries,
  citations, notes changes, reading workflows, export, access automation,
  cloud sync, collaboration and production deployment.

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Bounded local text extraction from an imported PDF | Locally persisted | Real authenticated companion API, strict schema, limits, hashes and reopen/recovery tests pass locally | No |
| Paper editor extraction states and bounded preview | Locally persisted | React tests cover not-run, completed, stale and failed retry states; no browser storage is used | No |
| HTTPS static-host extraction/re-extraction flow | Locally persisted | Real Playwright flow is implemented with valid disposable PDFs; local Chromium is unavailable, so it is not End-to-end verified | No |
| OCR, semantic processing, search and full-text indexing | Not implemented | Explicitly out of scope for Task 4B | No |

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Open an imported paper and inspect extraction state | `apps/web/src/papers.tsx` | `GET .../text-extraction` | Source checksum, association and artifact validation | `papers/<paper-id>/source/original.pdf`; optional `extracted/text.json` and `extracted/full.txt` | `apps/web/src/papers.test.tsx`; `companion/tests/test_task4b_pdf_text_extraction.py` |
| Explicitly extract text | `PaperExtractionSection` | `POST .../text-extraction` | `pypdf 6.14.2`, page/character limits, source recheck | `extracted-text.schema.json`; `text.json`; `full.txt` | Focused companion and frontend tests |
| Replace source and re-extract | Existing Task 4A source controls plus Re-extract text | Source import then `POST ...?reextract=true` | Stale detection, explicit re-extraction, recoverable extraction journal | Source SHA-256 linked in `m4b.v1` | Focused recovery/re-extraction tests; HTTPS spike implementation |
| Reopen and verify | Paper editor reloads summary/preview | Authenticated GET after workspace reopen | Reads and verifies both extraction artifacts | Durable workspace files only | Companion reopen test; browser evidence unverified locally |

## Files changed

Created:

- `packages/schemas/extracted-text.schema.json`
- `companion/tests/test_task4b_pdf_text_extraction.py`
- `docs/task-4b-pdf-text-extraction-results.md`

Modified:

- `companion/pyproject.toml`
- `companion/requirements-dev.txt`
- `companion/src/research_intelligence_companion/app.py`
- `companion/src/research_intelligence_companion/models.py`
- `companion/src/research_intelligence_companion/workspace.py`
- `apps/web/src/companionClient.ts`
- `apps/web/src/papers.tsx`
- `apps/web/src/papers.test.tsx`
- `apps/web/src/styles.css`
- `packages/api-contract/task0-local-api.md`
- `scripts/run_pwa_loopback_spike.mjs`
- `docs/architecture.md`
- `docs/data-model.md`
- `docs/frontend-specification.md`
- `docs/workspace-format.md`
- `docs/workspace-atomic-writes.md`
- `docs/local-api.md`
- `docs/privacy-security.md`
- `docs/acceptance-tests.md`
- `docs/roadmap.md`
- `docs/feature-status-model.md`
- `docs/integration-checkpoints.md`
- `docs/traceability-matrix.md`

Deleted: none.

## Contracts changed

Added `packages/schemas/extracted-text.schema.json`, Draft 2020-12, strict
`additionalProperties: false`, with schema version `m4b.v1`, stable
extraction/project/paper/source IDs, source and full-text hashes, parser
engine/version, bounded page records, counts, warnings and timestamps. The
existing paper, source-file and Task 2 schemas are unchanged.

Added authenticated, exact-Origin-protected text read/extract routes under
`/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/text-extraction`.
The GET route reports `not_run`, `completed` or `stale`. POST performs explicit
local extraction and requires `reextract=true` for an existing result. The
response contains summary and a 1,200-character preview only; full page arrays,
full text, PDF bytes and absolute paths remain local.

The runtime dependency is pinned to `pypdf==6.14.2` (BSD-3-Clause). No schema
migration is required because `m4b.v1` is a new artifact and no existing
durable record is changed. Unsupported future extraction records are rejected
by the normal strict schema path.

## Source boundary and payload model

Task 4B does not infer anything from reading feedback and does not call an AI
or remote processing service. It parses only the explicitly registered local
PDF in the active project/paper scope. Page text is stored in the workspace
record and `full.txt`; the PWA receives only validated metrics, warnings, the
source checksum and a bounded preview. A no-text page is successful but says
that OCR was not run. Encrypted, malformed, oversized or over-limit inputs do
not create a failed partial artifact.

The limits are 500 pages, 5,000,000 extracted characters and a 30-second
cooperative page-boundary timeout. The timeout is intentionally cooperative
and cross-platform; a hard process interrupt is not claimed.

## Atomicity, stale state and recovery

Extraction is committed by a `pdf-extraction` transaction journal. The journal
stages previous `text.json` and `full.txt`, validates the new pair, replaces
both through the existing atomic-file primitive, writes a commit marker, and
cleans up last. Faults before commit roll back the previous valid pair; an
abandoned journal is recovered on workspace open. Cleanup faults retain a safe
committed journal for later cleanup.

The source checksum is checked before and after parsing. Replacing a source
therefore returns `stale` until the user explicitly re-extracts. An existing
result cannot be silently overwritten. Prior valid extraction data remains
available after parser errors or injected replacement faults.

## Security and privacy

Loopback binding, exact Origin allowlisting, explicit companion-owned pairing,
short-lived in-memory sessions, keychain-only installation secrets, schema
validation, path confinement, backups, transaction recovery and device-local
separation are unchanged. No API keys, credentials, session tokens, hidden
prompts, private model reasoning or full-text logs are added. No PDF or text is
written to browser storage, the device registry or source control.

## Tests and exact results

The final validation table records the exact commands. The implementation
specific additions are:

- companion: 7 focused Task 4B tests; the full suite passes with 88 tests;
- frontend: 3 focused extraction tests added to the existing paper coverage;
  the full suite passes with 78 tests.

## Visual evidence

No screenshots were added. The extraction section reuses the approved paper
editor visual system. The real HTTPS spike contains the browser evidence path;
it is not claimed as passed locally without Chromium.

## Traceability rows updated

Added `M4B-001` through `M4B-008` and refreshed relevant Task 4A/schema-count
evidence in `docs/traceability-matrix.md`.

## Unverified behavior and limitations

- Local Playwright frontend E2E and the HTTPS browser extraction flow are
  unverified because the configured Chromium executable is unavailable.
- Real macOS Keychain behavior, Windows packaging and cross-platform
  sync-provider crash semantics are not proven by this local run.
- The parser timeout is cooperative at page boundaries, not a hard process
  kill; process termination and every filesystem/sync provider combination are
  not independently verified.
- OCR, PDF rendering, semantic processing, search, indexing and AI remain out
  of scope.

## Merge blockers versus follow-up improvements

### Merge blockers

None identified in the locally runnable schema, frontend, companion, API,
recovery or packaging checks. The browser evidence gap remains an explicit
feature-status limitation, not a passing E2E claim.

### Follow-up improvements

- Run the disposable HTTPS browser flow in GitHub Actions and record the result.
- Add OCR and later reading/search behavior only in an approved milestone.
- Add hard-interrupt and cross-platform packaged extraction coverage when those
  environments are available.

## Recommended follow-up

Keep full-text extraction separate from OCR, indexing, semantic search and AI
processing. Do not promote Task 4B to End-to-end verified or Production ready
until the browser, cross-platform and hard-interruption evidence exists.

## Validation run

Commands were run from the repository root unless noted:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS; pnpm 11.9.0, workspace already up to date |
| `companion/.venv/bin/python scripts/validate_schemas.py` | PASS; all 12 Draft 2020-12 schemas validated |
| `pnpm frontend:lint` | PASS |
| `pnpm frontend:typecheck` | PASS |
| `pnpm frontend:test` | PASS; 6 files, 78 tests |
| `pnpm frontend:build` | PASS; Vite/PWA production build generated |
| `pnpm frontend:e2e` | UNVERIFIED; 5 tests could not launch because the configured Playwright Chromium executable is unavailable |
| `companion/.venv/bin/ruff check companion/src companion/tests` | PASS |
| `companion/.venv/bin/pytest -q companion/tests` | PASS; 88 tests, one existing Starlette/httpx deprecation warning |
| `pnpm audit --audit-level moderate` | PASS; no known vulnerabilities |
| `HOME=/tmp/research-intelligence-task4b-home companion/.venv/bin/python -m pip_audit --requirement companion/requirements-dev.txt --cache-dir /tmp/research-intelligence-task4b-pip-audit` | PASS; no known vulnerabilities |
| `HOME=/tmp/research-intelligence-task4b-home .venv/bin/python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean` from `companion/` | PASS; macOS arm64 package built |
| `HOME=/tmp/research-intelligence-task4b-home companion/dist/research-intelligence-companion/research-intelligence-companion --check` | PASS; loopback host `127.0.0.1` |
| packaged-artifact scan with `rg` for known test secret values | PASS; no known test secret values found |
| `PYTHON_BIN=companion/.venv/bin/python pnpm spike:pwa-loopback` | UNVERIFIED browser phase; static HTTPS, companion health, configured/invalid/missing Origin checks, pairing and disposable workspace seed passed, but Chromium was unavailable before browser launch |
| `PATH=... node --check scripts/run_pwa_loopback_spike.mjs` | PASS |
| Markdown relative-link/path validator | PASS; 36 relative links checked |
| `git diff --check` | PASS |
| `git status --short` | PASS; only Task 4B implementation/docs plus generated ignored build outputs present |

No real user workspace, API key, credential, private paper or unpublished
material was used. No GitHub Actions result is claimed in this report because
no post-Task-4B CI run was available during this local pass.
