# Task 0 Spike Results

This file records the local Task 0 verification run from the Codex sandbox after the PR #2 security fixes.

## Results

- Production-origin CORS spike: verified locally before browser launch. `pnpm spike:pwa-loopback` started the loopback companion, served the built PWA from `https://127.0.0.1:4443`, proved `https://emmywong0530.github.io` can call `POST /api/v1/pairing/start`, proved `https://example.invalid` is rejected, proved configured-origin CORS preflight returns 204, and proved invalid or missing-origin preflight returns 403.
- PWA browser loopback spike: not fully verified locally. The same `pnpm spike:pwa-loopback` run could not launch local Google Chrome in this sandbox; Chrome exited with `SIGABRT` and process cleanup hit `kill EPERM`. Because the browser did not run, full GitHub Pages/static-host browser compatibility is not claimed from this local run. GitHub Actions is configured to install Chromium and run this spike on a normal Linux runner.
- Pairing security tests: verified locally. Pairing start no longer returns the approval code, missing-origin pairing is rejected, valid local development origin succeeds, valid production origin succeeds, invalid origin fails, pairing attempts expire, pairing attempts are single-use, failed-attempt limits invalidate pairing, replay is rejected, and sessions are invalid after companion restart.
- Per-installation secret tests: verified with a fake keyring locally. The secret is generated with cryptographically secure randomness, stored through `keyring`, survives a simulated companion restart when the keyring permits, is not returned by API responses, is not written to logs or workspace files, and reports `keychain_unavailable` without plaintext downgrade when keychain access fails.
- Real OS keychain spike: not verified locally. The Python `keyring.backends.macOS.Keyring` backend failed with `PasswordSetError: Can't store password on keychain: (-67674, 'Unknown Error')`. A previous direct `security add-generic-password` probe also failed with `Unable to obtain authorization for this operation`. GitHub Actions is configured to run the keychain spike on macOS and Windows runners.
- Atomic workspace write spike: verified locally. The interrupted temporary-file write preserved the prior file hash, and path traversal was rejected.
- PyInstaller packaging spike: macOS onedir build verified locally with `--check`; artifact scan found no `TEST_SECRET_DO_NOT_RETURN` or `RI_INSTALLATION_SECRET_DO_NOT_RETURN` sentinel. Windows packaging is configured for GitHub Actions and was not run locally.
- Automated security tests: verified locally with `pytest`; 25 tests passed. Coverage includes remote-interface binding rejection, unauthenticated request rejection, invalid-origin rejection, missing-origin pairing rejection, production-origin pairing, configured-origin preflight, valid paired session success, secret non-disclosure through API/log/workspace/artifacts checks, path traversal rejection, interrupted-write preservation, replay/expiry/failed-attempt pairing behavior, restart session invalidation, and required `schema_version` checks.
- Frontend checks: lint, typecheck, unit tests, and static build passed locally. Playwright e2e did not pass locally because the browser could not launch in the sandbox.
- Dependency audits: `pnpm audit --audit-level moderate` and `pip-audit` both reported no known vulnerabilities.

## Commands Run Locally

The pnpm commands were run with the bundled Codex Node runtime prepended to `PATH` because this sandbox shell does not expose `node` by default. Browser commands used `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

```bash
companion/.venv/bin/python scripts/validate_schemas.py
pnpm frontend:lint
pnpm frontend:typecheck
pnpm frontend:test
pnpm frontend:build
companion/.venv/bin/python -m ruff check companion/src companion/tests
companion/.venv/bin/python -m pytest companion/tests
PYTHONPATH=companion/src companion/.venv/bin/python -m research_intelligence_companion.spikes binding
PYTHONPATH=companion/src companion/.venv/bin/python -m research_intelligence_companion.spikes workspace
PYTHONPATH=companion/src companion/.venv/bin/python -m research_intelligence_companion.spikes keychain
pnpm frontend:e2e
PYTHON_BIN=companion/.venv/bin/python pnpm spike:pwa-loopback
cd companion && PYINSTALLER_CONFIG_DIR=/tmp/research-intelligence-pyinstaller ../companion/.venv/bin/python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean
companion/dist/research-intelligence-companion/research-intelligence-companion --check
! grep -R -I -n "TEST_SECRET_DO_NOT_RETURN" companion/dist
! grep -R -I -n "RI_INSTALLATION_SECRET_DO_NOT_RETURN" companion/dist
pnpm audit --audit-level moderate
companion/.venv/bin/python -m pip_audit --cache-dir /tmp/research-intelligence-pip-audit --requirement companion/requirements-dev.txt
```
