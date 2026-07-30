# Task 5A AI Provider Foundation Results

## Task and scope
- Task: Task 5A: transparent local AI provider foundation and secure credential management
- Branch: `feature/m5a-ai-provider-foundation`
- Commit: `ee5bd64` (`feat: implement ai provider foundation`)
- Explicitly excluded: summaries, classification, extraction, prompt/template registry, provenance generation, caching, Ask Library, search, embeddings, discovery scoring, automatic profile updates, paper feedback learning, cloud sync and production deployment.

## Feature status

| Capability | Exact status | Evidence scope | Regression from prior state? |
|---|---|---|---|
| OpenAI-compatible provider configuration | Companion connected | Authenticated FastAPI route, device-local settings store and frontend Settings tests | No |
| Keychain-only credential store/replace/remove | Companion connected | Fake-keyring API tests and redaction checks; real OS keychains remain platform evidence | No |
| Explicit provider connection test | Companion connected | Deterministic fake adapter success/failure tests; real external provider not called locally | No |
| Settings AI Provider surface | Companion connected | React tests with mocked fetch; no browser storage | No |
| HTTPS browser provider flow | Companion connected | Real spike is implemented with isolated fake mode; local Chromium is unavailable, so browser promotion is unverified | No |
| AI content processing | Visual mock / unavailable | No Task 5A implementation | No |

## Vertical-slice map

| User action | Frontend | API | Companion | Durable file/schema | Test |
|---|---|---|---|---|---|
| Read provider state | `apps/web/src/aiProvider.tsx` | `GET /api/v1/ai/provider/config` | `ProviderRuntime` and keychain presence check | Device-local `ai-provider-settings.json`; no workspace change | `apps/web/src/aiProvider.test.tsx`; `companion/tests/test_task5a_ai_provider.py` |
| Configure provider | Settings form | `PUT /api/v1/ai/provider/config` | Strict validation, atomic write, revision check | Internal `task5a.v1` device-local JSON | Settings/API tests |
| Store or replace credential | Keychain input cleared after action | `PUT /api/v1/ai/provider/credential` | Keychain write/readback and prior-value preservation | OS keychain only | Keychain failure and redaction tests |
| Explicit connection test | Test provider connection button | `POST /api/v1/ai/provider/test` | OpenAI adapter or isolated fake adapter; bounded safe result | Last test summary memory-only | Adapter/API/frontend tests |
| Remove credential | Remove credential action | `DELETE /api/v1/ai/provider/credential` | Keychain deletion and verified-state invalidation | OS keychain only | API/frontend tests |

## Provider and adapter boundary

`companion/src/research_intelligence_companion/ai_provider.py` defines the
typed adapter boundary, strict device-local configuration, bounded result and
error categories, OpenAI-compatible model check and deterministic fake
adapter. The production path uses Python standard-library HTTPS with default
TLS verification, no redirect following and the fixed OpenAI API origin. No
provider SDK or new runtime dependency was added. Standard-library proxy
environment behavior is inherited and documented; no custom endpoint is
accepted in Task 5A.

The connection test sends no project, paper, note, workspace or user content.
It uses the configured model and keychain credential only. Authentication and
invalid-configuration failures are not retried. At most one bounded retry is
used for transient failures under a total timeout. Raw provider bodies,
headers, stack traces, secrets and full sensitive URLs are not returned or
persisted.

## Credential and configuration model

Nonsecret configuration is outside the workspace at the device-data root in a
strict `task5a.v1` file. It includes provider, model, timeout, max retries,
enabled, timestamps and a SHA-256 content revision. It is fsynced, atomically
replaced and rejects unknown/future versions. A replacement failure preserves
the prior valid settings file. No package JSON Schema changed and no durable
workspace migration was required.

The OpenAI credential is stored under a provider-scoped OS keychain account.
The companion returns only `present`, `missing` or `unavailable`; it never
returns the key. Replacement verifies readback and attempts restoration of the
previous value if verification fails. Keychain failure is a blocked state with
no plaintext, environment, workspace or browser fallback.

## State and API behavior

The UI and API expose `unconfigured`, `configured_without_credential`,
`ready_untested`, `connection_verified`, `connection_failed`,
`credential_removed` and `configuration_invalid`. Configuration and credential
changes invalidate prior test state. Last test summaries are memory-only, so a
companion restart returns a configured credential to `ready_untested` and
never implies a verified result.

All provider routes require loopback companion access, exact allowed Origin,
and a paired short-lived bearer session. Provider configuration writes accept
an expected revision and return `409` for stale writes. The test-only scenario
control returns `404` unless `RI_AI_TEST_MODE=1`; it is not a production
provider option.

## Schema and migration

No workspace schema or migration changed. The device-local settings format is
versioned internally and covered by strict read/write tests, future-version
rejection, atomic replacement failure preservation and restart semantics.

## Files created and modified

Created:
- `companion/src/research_intelligence_companion/ai_provider.py`
- `companion/tests/test_task5a_ai_provider.py`
- `apps/web/src/aiProvider.tsx`
- `apps/web/src/aiProvider.test.tsx`
- `docs/adr/008-local-ai-provider-foundation.md`
- `docs/task-5a-ai-provider-foundation-results.md`

Modified:
- `companion/src/research_intelligence_companion/app.py`
- `companion/src/research_intelligence_companion/keychain.py`
- `companion/src/research_intelligence_companion/models.py`
- `companion/src/research_intelligence_companion/security.py`
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
- `docs/workspace-format.md`

Deleted: none.

## Security and privacy review

Loopback binding, exact Origin enforcement, pairing/session authentication,
installation-secret behavior, workspace path confinement, atomic workspace
writes and device-local index separation are unchanged. Provider credentials
use a separate keychain service and never enter workspace data, browser
storage, logs, API responses or artifacts. The Settings UI clears credential
input and displays only presence. Test responses are bounded and contain no
raw provider data. The fake adapter is isolated by explicit test-mode startup.

## Tests and exact results

At implementation time the focused results are:
- `PYTHONPATH=companion/src companion/.venv/bin/python -m pytest companion/tests/test_task5a_ai_provider.py -q`: 5 passed.
- `companion/.venv/bin/python -m ruff check companion/src/research_intelligence_companion/ai_provider.py companion/src/research_intelligence_companion/keychain.py companion/src/research_intelligence_companion/app.py companion/src/research_intelligence_companion/models.py companion/tests/test_task5a_ai_provider.py`: passed.
- `pnpm frontend:test`: 92 tests passed in 7 files.
- `pnpm frontend:lint`: passed.
- `pnpm frontend:typecheck`: passed.
- `node --check scripts/run_pwa_loopback_spike.mjs`: passed with the bundled Node runtime.

Final validation matrix:
- `pnpm install --frozen-lockfile`: passed (`pnpm` 11.9.0; workspace already up to date).
- `PYTHONPATH=companion/src companion/.venv/bin/python scripts/validate_schemas.py`: passed; all 13 JSON Schemas validated as Draft 2020-12.
- `pnpm frontend:lint`: passed.
- `pnpm frontend:typecheck`: passed.
- `pnpm frontend:test`: passed; 92 tests in 7 files.
- `pnpm frontend:build`: passed; production Vite bundle generated.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m ruff check companion/src companion/tests`: passed.
- `PYTHONPATH=companion/src companion/.venv/bin/python -m pytest companion/tests -q`: passed; 120 tests, 1 existing Starlette/httpx deprecation warning.
- `pnpm audit --audit-level moderate`: passed; no known vulnerabilities.
- `companion/.venv/bin/python -m pip_audit --cache-dir /tmp/pip-audit --requirement companion/requirements-dev.txt`: passed; no known vulnerabilities.
- `node --check scripts/run_pwa_loopback_spike.mjs`: passed.
- Markdown relative-path validation: passed for repository Markdown, excluding generated/dependency directories.
- PyInstaller packaging: passed with isolated temporary PyInstaller cache; packaged `--check` returned `{"status":"ok","version":"0.1.0","loopback_host":"127.0.0.1"}`.
- Packaged-artifact secret scan: passed; no test credential or installation-secret sentinel was present.
- `pnpm frontend:e2e`: unverified locally; all 5 tests stopped before execution because the Playwright Chromium executable is not installed.
- `PYTHON_BIN=companion/.venv/bin/python PNPM_BIN=pnpm pnpm spike:pwa-loopback`: unverified locally; the real companion started and the pre-browser health, Origin, pairing and disposable workspace setup ran, then Chromium launch failed because the executable is unavailable. The spike's `finally` cleanup shut down the companion.
- `git diff --check`: passed.

The local browser phase is therefore explicitly unverified. No browser pass is
claimed, and a CI/browser-capable environment remains required for promotion
of the real HTTPS settings flow.

## Visual and browser evidence

No new screenshots are required for this settings-only milestone. The real
browser flow in `scripts/run_pwa_loopback_spike.mjs` uses HTTPS static hosting,
the real companion, an isolated fake provider and disposable device/workspace
roots. Its browser assertions prove explicit configuration, synthetic keychain
storage, success, controlled authentication failure, replacement, removal,
reload, re-pair and nonsecret configuration persistence when a
browser-capable environment runs. Those browser assertions were not executed
locally because Chromium is unavailable; the local run verified only the
pre-browser HTTP setup and cleanup path.

## Traceability rows updated

Added `M5A-001` through `M5A-008` to
`docs/traceability-matrix.md`. They remain `Companion connected` locally until
the real browser flow is verified; no capability is marked Production ready.

## Unverified behavior and limitations

- A real external OpenAI request and real provider credential were not used.
- A real macOS Keychain or Windows Credential Manager is not proven by the
  fake-keyring tests.
- Browser and HTTPS spike status remains unverified locally because Chromium is
  unavailable; CI/browser-capable evidence is still required.
- Directory fsync is best-effort where the platform does not expose a
  directory handle; file contents are fsynced before replacement.
- No custom OpenAI-compatible endpoint, proxy authentication contract or
  provider-specific SDK behavior is implemented.
- No AI content processing or provenance record is implemented.

## Merge blockers versus follow-up improvements
### Merge blockers

Any failed full validation command, leaked credential, failed keychain-only
behavior, missing exact-Origin/session enforcement, or unverified browser flow
that is claimed as passing is a blocker. This report intentionally does not
claim Production ready.

### Follow-up improvements

Add a platform-matrix provider smoke test using isolated test credentials,
expand adapter capability reporting when the next AI operation is approved,
and add a dedicated process-cancellation harness before long-running AI
content operations are introduced.

## Recommended follow-up

Task 5B may build the first content-processing slice only after a new approved
specification defines prompt templates, provenance, source scope and user
approval boundaries. Task 5A does not authorize those operations.
