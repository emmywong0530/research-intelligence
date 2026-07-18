# Task 0 Spike Results

This file records the local Task 0 verification run from the Codex sandbox.

## Results

- PWA loopback spike: not fully verified locally. The static preview server and companion server started, and `/api/v1/health` returned 200 from loopback. Playwright could not launch local Google Chrome in this sandbox; Chrome exited with `SIGABRT` and process cleanup hit `kill EPERM`. GitHub Actions is configured to install Chromium and run this spike on a normal Linux runner.
- Keychain spike: not verified locally. The Python `keyring.backends.macOS.Keyring` backend failed with `PasswordSetError: Can't store password on keychain: (-67674, 'Unknown Error')`. A direct `security add-generic-password` probe also failed with `Unable to obtain authorization for this operation`. GitHub Actions is configured to run the keychain spike on macOS and Windows runners.
- Atomic workspace write spike: verified locally. The interrupted temporary-file write preserved the prior file hash, and path traversal was rejected.
- PyInstaller packaging spike: macOS onedir build verified locally with `--check`; artifact scan found no `TEST_SECRET_DO_NOT_RETURN` sentinel. Windows packaging is configured for GitHub Actions and was not run locally.
- Automated security tests: verified locally with `pytest`; 13 tests passed. Coverage includes remote-interface binding rejection, unauthenticated request rejection, invalid-origin rejection, valid paired session success, secret non-disclosure through API responses, path traversal rejection, interrupted-write preservation, and required `schema_version` checks.

## Commands Run Locally

```bash
python scripts/validate_schemas.py
pnpm frontend:lint
pnpm frontend:typecheck
pnpm frontend:test
pnpm frontend:build
python -m ruff check companion/src companion/tests
python -m pytest companion/tests
python -m research_intelligence_companion.spikes binding
python -m research_intelligence_companion.spikes workspace
python -m research_intelligence_companion.spikes keychain
pnpm frontend:e2e
pnpm spike:pwa-loopback
python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean
companion/dist/research-intelligence-companion/research-intelligence-companion --check
pnpm audit --audit-level moderate
python -m pip_audit --cache-dir /tmp/research-intelligence-pip-audit --requirement companion/requirements-dev.txt
```
