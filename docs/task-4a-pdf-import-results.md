# Implementation Report

## Task and scope
- Task: Task 4A local PDF import and durable source-file registration.
- Branch: `feature/m4a-pdf-import`.
- Commit: implementation commit; the final SHA is reported with this report.
- Explicitly excluded: PDF parsing, OCR, page rendering, text extraction,
  annotations, reading workflows, search, FTS, embeddings, AI processing,
  citations, discovery, DOI lookup, remote downloads, institutional access,
  duplicate detection, notes changes, cloud sync, collaboration and production
  deployment.

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Paper-scoped local PDF source registration | Locally persisted | Real authenticated companion API writes the PDF, source sidecar and paper status; schema and reopen tests pass locally | No |
| Explicit browser file selection, preview and replacement UI | Locally persisted | Frontend tests with mocked fetch cover selection, preview, cancel, import, error preservation, dirty state and replacement confirmation | No |
| HTTPS static-host browser PDF import flow | Locally persisted | The real Playwright flow is implemented with disposable generated fixtures; local Chromium is unavailable, so it is not promoted to End-to-end verified | No |
| PDF parsing, OCR, extraction, viewer and search | Not implemented | Explicitly out of scope for Task 4A; no misleading controls are added | No |

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Open a persisted paper and inspect source state | `apps/web/src/papers.tsx` | `GET .../source-file` | Paper/project association and source hash/size verification | `papers/<paper-id>/metadata.json`; optional `source.json` and `original.pdf` | `apps/web/src/papers.test.tsx`; `companion/tests/test_task4a_pdf_import.py` |
| Select and preview a PDF | `PapersPage` file input and in-memory `File` state | No request until Import | None until explicit import | No durable file is created by selection | `apps/web/src/papers.test.tsx` |
| Import a new local PDF | `importPaperPdf` and source section | `POST .../source-file` raw `application/pdf` body | Bound, signature/filename/schema/hash/project checks | `papers/<paper-id>/source/original.pdf`; `source.json`; paper status update | `companion/tests/test_task4a_pdf_import.py`; frontend import test |
| Explicitly replace a PDF | Replacement confirmation modal | `POST ...?replace=true&expected_revision=...` | Pre-import backup and recoverable three-file transaction | Prior recovery backup plus new source bytes/metadata | Companion fault-injection tests; frontend replacement test |
| Reopen and verify source metadata | Source display in paper editor | Authenticated source read after paper read | Hash/size verification and workspace recovery | Durable PDF and `m4a.v1` sidecar | Companion reopen test; browser spike implementation |

## Files changed

Created:

- `packages/schemas/source-file.schema.json`
- `companion/tests/test_task4a_pdf_import.py`
- `docs/task-4a-pdf-import-results.md`

Modified:

- `companion/src/research_intelligence_companion/workspace.py`
- `companion/src/research_intelligence_companion/app.py`
- `companion/src/research_intelligence_companion/models.py`
- `apps/web/src/companionClient.ts`
- `apps/web/src/papers.tsx`
- `apps/web/src/papers.test.tsx`
- `apps/web/src/styles.css`
- `scripts/run_pwa_loopback_spike.mjs`
- `docs/architecture.md`
- `docs/data-model.md`
- `docs/frontend-specification.md`
- `docs/local-api.md`
- `docs/privacy-security.md`
- `docs/acceptance-tests.md`
- `docs/workspace-format.md`
- `docs/workspace-atomic-writes.md`
- `docs/roadmap.md`
- `docs/feature-status-model.md`
- `docs/integration-checkpoints.md`
- `docs/traceability-matrix.md`

Deleted: none.

## Contracts changed

Added `packages/schemas/source-file.schema.json`, Draft 2020-12, strict
`additionalProperties: false`, with `schema_version: "m4a.v1"`, stable
source/paper/project IDs, local PDF media facts, canonical relative path,
size, SHA-256 and timestamps. The existing paper schema is unchanged. No
migration is required because no previous durable source-file representation
exists; existing Task 3E paper records remain valid and import-free.

Added authenticated, exact-Origin-protected source read/import routes under
`/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/source-file`.
The POST route accepts only a bounded raw `application/pdf` body and a
sanitized `X-Original-Filename` header. It returns source metadata, the updated
paper, the paper revision and the retained recovery backup ID. No absolute path
or file bytes are returned.

The workspace transaction journal now supports `pdf-import`, coordinating the
PDF, source sidecar and paper metadata. It stages prior bytes, verifies the
incoming signature and hash, retains a pre-import backup, rolls back before
commit and recovers abandoned journals on workspace open.

No ADR or migration was added. The implementation follows the accepted
local-first durable-files/device-local-index separation decisions.

## Security and privacy

Loopback binding, exact Origin allowlisting, explicit companion-owned pairing,
short-lived in-memory sessions and keychain-only installation secrets are
unchanged. The browser transfers bytes rather than a host path and stores the
selected `File` only in React memory. Source metadata contains no credentials,
tokens, API keys, prompts or private model reasoning. Workspace path
confinement, schema validation, atomic writes, backups, transaction recovery
and device-local separation remain enforced.

## Tests and exact results

The final validation section records the complete command set and results. The
focused implementation counts are:

- frontend: 6 files, 75 tests passed locally;
- companion: 81 tests passed locally, with the existing Starlette/httpx
  deprecation warning;
- new Task 4A companion coverage: 4 tests passed, including invalid source
  input, size rejection, explicit replacement, reopen persistence and fault
  injection.

No migration test was required because the durable source-file schema is new.

## Visual evidence

No screenshots were added. The source section uses the existing approved dark
visual system and the real HTTPS spike contains the browser evidence path. The
browser flow is not claimed as passed locally because the Playwright Chromium
executable is unavailable in this environment.

## Traceability rows updated

Added `M4A-001` through `M4A-007` to `docs/traceability-matrix.md` and updated
the current schema count in `M3F-001` to include the additive source-file
schema.

## Unverified behavior and limitations

- Local Playwright frontend E2E and the HTTPS static PWA PDF flow are
  unverified because Chromium is not installed at the configured Playwright
  executable path.
- Real macOS Keychain behavior, Windows packaging and cross-platform
  sync-provider crash semantics are not proven by this local run.
- A `%PDF-` signature is checked, but semantic PDF validity and extraction are
  intentionally not implemented.
- Hard process termination during a multi-file commit is covered by journal
  fault injection and restart recovery, not by a portable atomic directory
  swap.

## Merge blockers versus follow-up improvements

### Merge blockers

None identified in the locally runnable schema, frontend, companion, API,
transaction or packaging checks. The browser evidence gap remains a status
limitation, not a claim of end-to-end success.

### Follow-up improvements

- Run the disposable HTTPS browser flow in GitHub Actions or another
  browser-capable environment and attach the result.
- Add PDF parsing and page-aware reading behavior only in the approved later
  milestone.
- Add cross-platform packaged import verification when the corresponding
  environments are available.

## Recommended follow-up

Keep PDF extraction, OCR, viewer, search, AI and access workflows separate from
this source registration contract. Do not promote Task 4A to Production ready
until the browser flow, cross-platform packaging and failure evidence are
verified.

## Validation run

The following commands were run locally from the repository root unless noted:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS; lockfile unchanged |
| `companion/.venv/bin/python scripts/validate_schemas.py` | PASS; all 11 JSON Schemas validated |
| `pnpm frontend:lint` | PASS |
| `pnpm frontend:typecheck` | PASS |
| `pnpm frontend:test` | PASS; 6 files, 75 tests |
| `pnpm frontend:build` | PASS; Vite production build and PWA service worker generated |
| `pnpm frontend:e2e` | UNVERIFIED; all 5 tests could not launch because the configured Playwright Chromium executable is unavailable |
| `companion/.venv/bin/ruff check companion/src companion/tests` | PASS |
| `companion/.venv/bin/python -m pytest companion/tests -q` | PASS; 81 tests, 1 existing deprecation warning |
| `pnpm audit --audit-level moderate` | PASS; no known vulnerabilities |
| `HOME=/tmp/research-intelligence-home companion/.venv/bin/python -m pip_audit --requirement companion/requirements-dev.txt --cache-dir /tmp/research-intelligence-pip-audit` | PASS; no known vulnerabilities |
| `HOME=/tmp/research-intelligence-home ../companion/.venv/bin/python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean` from `companion/` | PASS; macOS arm64 package built, with PyInstaller runtime warnings |
| `HOME=/tmp/research-intelligence-home companion/dist/research-intelligence-companion/research-intelligence-companion --check` | PASS; loopback host `127.0.0.1` |
| packaged-artifact secret scan with `rg -a` | PASS; no test secrets found |
| `PYTHON_BIN=companion/.venv/bin/python pnpm spike:pwa-loopback` | UNVERIFIED browser flow; static HTTPS, companion health, Origin checks, pairing, workspace/project/profile setup and fixture creation passed, but Chromium was unavailable before browser launch |
| `node --check scripts/run_pwa_loopback_spike.mjs` | PASS |
| Markdown relative-link/path validator excluding `.git`, `.venv`, `node_modules`, `dist`, `build` and `test-results` | PASS; 36 paths checked |
| `git diff --check` | PASS |
| `git status` | PASS; changes are limited to Task 4A implementation and documentation files listed above |

The local browser limitation is recorded as unverified rather than as an
end-to-end pass. No real user workspace or private paper was used.
