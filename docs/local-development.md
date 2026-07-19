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

The default Task 0 allowed origins include the intended GitHub Pages production origin:

```text
https://emmywong0530.github.io
```

GitHub Pages serves this project under `/research-intelligence/`, but CORS uses only the origin. If you override `RI_ALLOWED_ORIGINS`, include every exact origin that should be allowed; do not use wildcards.

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

`pnpm spike:pwa-loopback` serves the built PWA from an HTTPS static origin at `https://127.0.0.1:4443`, verifies the exact GitHub Pages production origin CORS contract against the loopback companion, and then runs a Playwright browser check that the PWA can reach `http://127.0.0.1:8765` under browser security rules. Run `pnpm frontend:build` first.

In restricted macOS sandboxes, PyInstaller may need a writable cache directory:

```bash
cd companion
PYINSTALLER_CONFIG_DIR=/tmp/research-intelligence-pyinstaller python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean
```
