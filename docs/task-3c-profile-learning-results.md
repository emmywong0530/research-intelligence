# Task 3C Implementation Report

## Task and scope

- Task: transparent, reversible Research Profile feedback learning
- Branch: `feature/m3c-profile-learning`
- Commit: final implementation commit is reported in the completion message; this report was amended after validation
- Explicitly excluded: autonomous or hidden learning, LLM-generated proposals,
  paper feedback collection, paper ingestion, search execution, ranking,
  semantic examples, synthesis, citations, export, cloud sync, collaboration,
  production deployment, and Task 3D Project Overview integration.

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| Persisted proposal review and decision history | Locally persisted | Companion generic profile API tests and frontend mocked-fetch tests | No |
| Proposal accept/modify/reject/reverse UI | Companion connected | Frontend state tests; real browser path requires the loopback harness | No |
| Deterministic proposal source | Companion connected | Explicit test fixtures and generic record writes; no autonomous source | No |
| Task 3C profile migration | Locally persisted | Disposable `m2.v1` migration, backup, rerun and future-version tests | No |
| Real browser-to-companion proposal flow | Unverified | Chromium/browser harness not run locally in this checkpoint | N/A |

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Review pending proposal | `apps/web/src/researchProfile.tsx` | `GET` generic research-profile record | authenticated record read | `research-profile.schema.json`, `proposals[]` | frontend proposal review tests |
| Accept or modify proposal | `apps/web/src/profileLearning.ts` | one `PUT` with `expected_revision` | schema/business validation and atomic transaction | profile field plus proposal history | frontend and companion Task 3C tests |
| Reject proposal | `apps/web/src/researchProfile.tsx` | one `PUT` with `expected_revision` | status/history validation | unchanged profile fields plus rejected history | frontend and companion Task 3C tests |
| Reverse proposal | `apps/web/src/profileLearning.ts` | one `PUT` with `expected_revision` | revision and schema validation | prior/applied snapshots and reversal history | safe and blocked reversal tests |
| Open old profile | existing workspace open flow | `POST /workspaces/open` | per-profile `m2.v1` to `m3c.v1` migration | atomic profile replacement and backup | migration tests |

## Files changed

Created: `apps/web/src/profileLearning.ts`,
`companion/src/research_intelligence_companion/profile_learning.py`,
`companion/tests/test_task3c_profile_learning.py`, and
`docs/adr/007-transparent-profile-proposals.md`.

Modified: `apps/web/src/companionClient.ts`,
`apps/web/src/researchProfile.tsx`, `apps/web/src/researchProfile.test.tsx`,
`apps/web/src/styles.css`, `companion/src/research_intelligence_companion/workspace.py`,
`packages/schemas/research-profile.schema.json`,
`docs/acceptance-tests.md`, `docs/data-model.md`, `docs/local-api.md`,
`docs/workspace-format.md`, `docs/workspace-atomic-writes.md`, and
`docs/traceability-matrix.md`, plus
`scripts/run_pwa_loopback_spike.mjs` to add the disposable companion-backed
profile browser journey to the existing HTTPS loopback spike, and
`pnpm-workspace.yaml` / `pnpm-lock.yaml` for the audited dependency override.

Deleted: none.

## Contracts changed

The Research Profile schema remains Draft 2020-12 and adds optional proposal
snapshots, target fields, decision metadata, history, reversal results, and
the `reversed` status. The durable profile version for migrated records is
`m3c.v1`. No new HTTP endpoint was added: proposal operations use the existing
authenticated generic record `PUT` with `expected_revision`.

The migration accepts existing `m2.v1` profiles, preserves all existing data,
and refuses unknown future or corrupt profile versions. Legacy proposal shells
without payload snapshots remain visible but are not actionable.

## Security and privacy

Task 0 and Task 2 security boundaries remain unchanged: loopback-only binding,
exact allowed origins, explicit pairing, short-lived in-memory sessions,
keychain-only installation secrets, schema validation, secret-field rejection,
path confinement, atomic writes, recoverable transactions, retained backup
recovery, and device-local index separation. Proposal explanations are
user-facing rationale only; no prompts, credentials, private model reasoning,
or paper content are generated or persisted. Browser storage is not used for
proposal IDs, workspace paths, session tokens, or secrets.

## Tests and exact results

The following commands were run locally on 2026-07-24. Frontend commands use
the bundled Node and pnpm runtime because the shell did not expose `node`
directly.

| Command | Result | Evidence |
|---|---|---|
| `companion/.venv/bin/python scripts/validate_schemas.py` | Pass | 9 Draft 2020-12 schemas validated |
| `companion/.venv/bin/ruff check companion/src companion/tests` | Pass | All checks passed |
| `companion/.venv/bin/python -m pytest companion/tests -q` | Pass | 71 passed, 1 Starlette deprecation warning |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm install --frozen-lockfile` | Pass | pnpm 11.9.0 installed the final lockfile without changes |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm audit --audit-level moderate` | Pass | No known vulnerabilities found |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm why fast-uri --recursive` | Pass | `fast-uri@3.1.4` only, via `vite-plugin-pwa > workbox-build > ajv` |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm frontend:lint` | Pass | ESLint completed successfully |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm frontend:typecheck` | Pass | TypeScript completed successfully |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm frontend:test` | Pass | 3 files, 44 tests passed |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm frontend:build` | Pass | Vite/PWA production build completed |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH pnpm frontend:e2e` | Unverified locally | 5 tests could not launch because the Playwright Chromium executable was not installed; no browser assertions ran |
| `PATH=/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/emmywong/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH PYTHON_BIN=companion/.venv/bin/python pnpm spike:pwa-loopback` | Unverified locally | HTTPS server, companion, Origin checks, pairing, and disposable record seeding passed; browser launch stopped because the local Chromium executable was missing; cleanup ran |
| `cd companion && PYINSTALLER_CONFIG_DIR=/tmp/pyinstaller-ri .venv/bin/python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean` | Pass | macOS arm64 PyInstaller build completed |
| `companion/dist/research-intelligence-companion/research-intelligence-companion --check` | Pass | Reported `status: ok`, version `0.1.0`, loopback host `127.0.0.1` |
| Packaged artifact sentinel scan with `rg -a` | Pass | No installation-secret test sentinels found |
| Markdown relative-path validator | Pass | All repository-relative Markdown links resolved |
| `git diff --check` | Pass | No whitespace errors |

The first frontend command attempt omitted the bundled Node directory from
`PATH` and failed with `node: not found`; the commands above were rerun with
the correct runtime path and are the authoritative results.

The existing spike now seeds a disposable workspace, project and explicit
pending proposal through authenticated companion APIs, then asks the browser
to pair, open the workspace, accept the proposal, reload and pair again,
verify the accepted history, reverse the proposal, reload and verify the
reversed history. This is a real browser-to-companion persistence check when
the HTTPS server and Chromium are available. It was not locally verified in
this sandbox.

## PR #10 CI blocker investigation

GitHub Actions CI run number `26` corresponds to workflow run ID
`30122109957` for PR #10. The failed `HTTPS Static PWA Loopback Spike` job was
`89576986451`. Its exact Playwright failure was:

`locator.waitFor: Timeout 10000ms exceeded` while waiting for
`getByTestId('companion-capabilities')` to be visible at
`scripts/run_pwa_loopback_spike.mjs:369:24` in `verifyBrowserLoopback`.

The correction opens the Onboarding modal immediately after the top-level
connection-status assertions, checks capabilities inside that open modal, and
passes explicit modal ownership into the first pairing call so the modal is
not opened twice. Subsequent reloads open Onboarding once before pairing.
The browser, companion/static-server shutdown, and disposable workspace
cleanup remain protected by `finally` blocks.

The audit job failed on transitive package `fast-uri@3.1.3`, a high-severity
host-confusion advisory `GHSA-v2hh-gcrm-f6hx`, affecting versions `>=3.0.0 <=3.1.3`
and fixed in `>=3.1.4`. The dependency path was:

`apps__web > vite-plugin-pwa > workbox-build > @apideck/better-ajv-errors > ajv > fast-uri`

and

`apps__web > vite-plugin-pwa > workbox-build > ajv > fast-uri`.

It is transitive, not a direct dependency. Because the current upstream range
resolved the vulnerable version, the smallest justified remediation is the
pnpm 11 workspace override `fast-uri: 3.1.4` in `pnpm-workspace.yaml`, with the
lockfile refreshed. No unrelated packages were upgraded. Local audit and the
full frontend validation now pass; the post-fix GitHub Actions run remains
pending after this branch is pushed.

## Visual evidence

No new screenshot claim is made for Task 3C. The proposal review uses the
existing Task 1 visual system. Any browser capture must identify whether it
came from Playwright or the in-app browser.

## Traceability rows updated

Added `M3C-001` through `M3C-010` in
`docs/traceability-matrix.md`; updated `M3B-006` to reflect the schema-backed
proposal-aware write path.

## Unverified behavior and limitations

- No autonomous proposal generation exists; deterministic fixtures or future
  explicit integrations are the only proposal source in Task 3C.
- Real browser-to-companion proposal persistence is unverified until the
  HTTPS static PWA harness can run with Chromium.
- PR #10 CI run 26 failed before reaching the Task 3C browser flow; this fix
  has not yet been verified by a post-fix GitHub Actions run.
- Local browser verification remains unavailable because the Playwright
  Chromium executable is not installed in the sandbox; the loopback harness
  itself now reaches companion pairing and disposable workspace seeding.
- Windows, Dropbox conflict behavior, real OS keychains, forced process-kill
  migration recovery, and production deployment are not inferred from local
  tests.
- Task 3C does not make semantic examples or screening instructions actionable.

## Merge blockers versus follow-up improvements

### Merge blockers

- The required real browser-to-companion proposal flow remains unverified
  locally because the sandbox has no Playwright Chromium executable. CI or
  another environment with Chromium must run
  the updated HTTPS spike before this path is treated as end-to-end verified.
- Post-fix CI verification remains required; PR #10 run 26 failed before the
  corrected modal ordering and Task 3C browser journey could complete.
- No deterministic schema, companion, frontend unit, build, or packaging
  blocker was found locally.

### Follow-up improvements

Task 3D Project Overview integration and all excluded research features remain
future work. A later milestone may add a real proposal source after its
durable destination, privacy review, and provenance requirements are approved.

## Recommended follow-up

Run the real companion-backed browser proposal flow in CI or a supported local
environment, then update this report and the traceability verification scope
with that artifact. Do not raise the feature above `Locally persisted` or
`Companion connected` without that evidence.
