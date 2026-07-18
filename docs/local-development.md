# Local Development

Task 0 uses a static-compatible Vite PWA and a loopback-only Python companion.

## Frontend

```bash
pnpm install
pnpm frontend:lint
pnpm frontend:typecheck
pnpm frontend:test
pnpm frontend:build
```

Run the frontend shell locally:

```bash
pnpm --dir apps/web dev
```

If Playwright browsers cannot be downloaded locally but Google Chrome is already installed, pass an explicit executable path:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm frontend:e2e
```

## Companion

```bash
python3 -m venv companion/.venv
source companion/.venv/bin/activate
python -m pip install -e "companion[dev]"
python -m ruff check companion/src companion/tests
python -m pytest companion/tests
```

Run the companion on loopback:

```bash
RI_ALLOWED_ORIGINS=http://127.0.0.1:5173 research-intelligence-companion
```

## Schemas

```bash
python -m pip install jsonschema==4.26.0
python scripts/validate_schemas.py
```

## Task 0 Spikes

```bash
research-intelligence-spikes binding
research-intelligence-spikes keychain
research-intelligence-spikes workspace
pnpm spike:pwa-loopback
```

In restricted macOS sandboxes, PyInstaller may need a writable cache directory:

```bash
cd companion
PYINSTALLER_CONFIG_DIR=/tmp/research-intelligence-pyinstaller python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean
```
