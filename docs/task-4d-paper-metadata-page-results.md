# Task 4D Results

## Task and scope
- Task: 4D structured local paper metadata and consolidated paper page
- Branch: `feature/m4d-paper-metadata-page`
- Commits: `d329598` (`feat: implement structured paper metadata page`); `606d153` (`fix: align loopback with paper view mode`)
- Explicitly excluded: remote metadata lookup, DOI verification, Crossref, OpenAlex, PubMed, Unpaywall, publisher scraping, citation/reference parsing, AI enrichment, summaries, embeddings, full-text search, OCR, PDF rendering, annotations, collaboration, accounts and cloud sync.

## Feature status
| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Structured `m4d.v1` local paper metadata | Locally persisted | Strict schema, companion validation/normalization and focused tests | No; extends `m2.v1` compatibility |
| `m2.v1` paper migration | Locally persisted | Fixture migration, idempotence, future-version refusal and disposable workspace reopen tests | No |
| Readable paper page and explicit metadata edit mode | Locally persisted | Frontend tests; real browser flow implemented but browser execution remains unverified locally | No; existing PDF/source/extraction/duplicate/note actions remain available |
| Derived metadata completeness | Locally persisted | Deterministic companion helper and UI coverage | No |
| Project Overview paper metrics | Locally persisted | Existing overview implementation and tests | No |
| Real browser-to-companion Task 4D flow | Locally persisted | HTTPS spike direct setup passed; local browser launch aborts before page assertions | Not promoted to End-to-end verified |
| Production readiness | Not implemented | Required cross-platform and browser evidence is not complete | No |

## Vertical-slice map
| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Open a paper | `apps/web/src/papers.tsx` readable view | Existing paper read route | `workspace.py` project association validation | `papers/<paper-id>/metadata.json` | `apps/web/src/papers.test.tsx` |
| Edit and save metadata | Explicit `Edit metadata` form | Existing authenticated generic paper PUT | Schema validation, normalization, expected revision and atomic record transaction | `paper.schema.json` `m4d.v1`; existing workspace journal | frontend and companion paper suites |
| Migrate existing paper | No special UI; migration occurs on open | Existing workspace open | `paper_metadata.py` and `_migrate_papers` | `m2.v1` to `m4d.v1`, pre-write backup | `companion/tests/test_task4d_paper_metadata.py` |
| Review local paper state | Readable metadata/source/extraction/duplicate/note sections | Existing source/extraction/duplicate/note routes | Existing Task 4A–4C and Task 3F services | Separate approved records; no duplicated PDF/text/note data | existing focused suites and browser spike |

## Contracts changed
- `packages/schemas/paper.schema.json` accepts `m4d.v1` and adds strict structured metadata fields while retaining `m2.v1` compatibility.
- No new API endpoint was added. Existing authenticated generic paper list/read/write routes remain project-scoped and revision-aware.
- `docs/migrations.md` documents migration behavior and backup/recovery expectations.

## Metadata and normalization
- Ordered author strings remain the source display list. Migration creates literal structured author entries without inferring names.
- Supported identifiers are DOI, PMID, PMCID, arXiv ID, ISBN, ISSN and `other`; normalization is local and shared with duplicate detection where applicable.
- Safe URL schemes are HTTP(S) without credentials; URLs are never fetched.
- `metadata_provenance.record_origin` is bounded to `manual`, `imported_record` or `system_derived`.
- Completeness is derived from seven equally weighted fields: title, authors, year, venue, abstract, identifiers and keywords. It is guidance, not bibliographic verification.

## Security and privacy
Loopback-only binding, exact allowed Origin, explicit pairing, short-lived in-memory sessions, keychain-only installation secrets, path confinement, schema validation, atomic writes, transaction recovery, backups, and device-local index separation remain unchanged. Paper metadata, workspace IDs, paths, selected papers, session tokens and drafts are not written to browser storage. No remote service is called, and paper URLs are displayed but not fetched by the companion.

## Tests and exact results
The focused frontend paper suite passed 21/21 tests; the full frontend suite passed 86/86 tests. The focused Task 4D companion suite passed 7/7 tests and the full companion suite passed 115/115 tests. Companion runs show one existing Starlette/httpx deprecation warning.

## PR #17 loopback correction
The CI failure was a browser-flow regression caused by the intentional Task 4D readable paper view. `verifyTask4APdfFlow` and `importPdfOnly` waited for editor-only source controls while the paper was still showing `Edit metadata`, `Manage local PDF`, `Paper notes` and `Back to Papers`.

The loopback script now uses an idempotent `openLocalPdfManagement` helper. It confirms the `Local PDF source` heading is visible, clicks `Manage local PDF` only when that surface is not already open, and then allows source-file and extraction assertions to run. Replacement and reload/reopen paths use the same helper. Production paper behavior was not changed.

## Validation commands and results
| Command | Result |
|---|---|
| `companion/.venv/bin/python scripts/validate_schemas.py` | Passed: all 13 Draft 2020-12 schemas validated |
| `pnpm frontend:lint` | Passed |
| `pnpm frontend:typecheck` | Passed |
| `pnpm frontend:test` | Passed: 86 tests |
| `pnpm frontend:build` | Passed |
| `companion/.venv/bin/python -m ruff check companion/src companion/tests` | Passed |
| `companion/.venv/bin/python -m pytest companion/tests -q` | Passed: 115 tests, 1 existing deprecation warning |
| `pnpm audit --audit-level moderate` | Passed: no known vulnerabilities |
| `companion/.venv/bin/python -m pip_audit --requirement companion/requirements-dev.txt --cache-dir /tmp/research-intelligence-pip-audit-cache` | Passed: no known vulnerabilities |
| bundled Node syntax check for `scripts/run_pwa_loopback_spike.mjs` | Passed |
| PyInstaller package build | Passed on local macOS arm64 using temporary build/dist paths |
| packaged companion `--check` | Passed: loopback host `127.0.0.1` |
| packaged-artifact secret scan | Passed |
| `git diff --check` | Passed |
| `pnpm frontend:e2e` | Unverified locally: all 5 tests stopped at browser launch because the expected Chromium 1228 executable is absent |
| `PYTHON_BIN=companion/.venv/bin/python PNPM_BIN=pnpm pnpm spike:pwa-loopback` | Unverified locally: HTTPS/static serving, health, exact-Origin CORS, pairing, workspace creation and seed API calls passed; Chromium launch then failed because the expected 1228 executable is absent |

## Visual evidence
No new screenshot set is required for this task. The HTTPS static PWA spike is the intended browser evidence. It uses generated disposable PDF fixtures and cleanup in `finally`; it is not a mocked-fetch test.

## Traceability rows updated
Added M4D-001 through M4D-008 to `docs/traceability-matrix.md` with local persistence status and an explicit unverified browser boundary.

## Unverified behavior and limitations
- The local environment includes an older Playwright Chromium headless shell, but the configured 1228 executable is absent. Retrying with the available 1217 shell aborts with macOS `SIGTRAP`. The HTTPS browser flow is therefore unverified locally; its loopback setup and cleanup did run. GitHub Actions remains required for final browser verification of this correction.
- Packaging was verified locally on macOS arm64. Windows packaging, cross-platform keychain behavior and CI browser verification are not claimed by this implementation report.
- Completeness does not establish bibliographic correctness or global identifier validity.
- Author details remain bounded literal rows in the UI; the companion accepts structured name fields and validates ORCID format locally.

## Merge blockers versus follow-up improvements
### Merge blockers
None identified from the focused implementation work. Full validation and browser execution evidence remain required before any feature-status promotion.

### Follow-up improvements
- Run the real HTTPS metadata flow in Chromium-capable CI and record the result.
- Add richer author row controls only if the approved product specification requires name-part editing beyond literal preservation.

## Recommended follow-up
Review the recorded validation counts and local browser limitation, then decide whether Task 4D is ready for integration review. Keep remote enrichment and later M4/M5 work out of this branch.
