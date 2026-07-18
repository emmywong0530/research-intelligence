# Codex Task 0 — Repository Bootstrap and Technical Spikes

You are working on a new open-source project called **Research Intelligence**.

Do not attempt to build the full product in this task.

## Read first

Read these repository documents completely before changing code:

- `AGENTS.md`
- `docs/product-overview.md`
- `docs/architecture.md`
- `docs/frontend-specification.md`
- `docs/data-model.md`
- `docs/workspace-format.md`
- `docs/local-api.md`
- `docs/privacy-security.md`
- `docs/acceptance-tests.md`
- `docs/roadmap.md`

If any required document is absent, report it and stop rather than inventing product behaviour.

## Goal

Create the repository foundation and validate the four highest-risk architectural assumptions:

1. A GitHub-Pages-compatible React/Vite PWA can communicate with a loopback-only local companion.
2. The companion can store secrets through the operating-system keychain without exposing them to the PWA.
3. The companion can safely read and atomically update a normal workspace folder that may be inside Dropbox.
4. The companion can be packaged on macOS and Windows using PyInstaller.

## Expected stack

Frontend:

- React
- TypeScript
- Vite
- Vite PWA integration
- Vitest
- React Testing Library
- Playwright

Companion:

- Python
- FastAPI
- Uvicorn
- Pydantic
- keyring
- PyInstaller
- pytest

Do not replace this stack without documenting a blocking technical reason.

## Repository structure

Create or validate:

```text
apps/web
companion/src
companion/tests
companion/packaging
packages/schemas
packages/design-tokens
packages/api-contract
docs
.github/workflows
```

## Required outputs

### A. Frontend shell

- Desktop-first page shell
- Persistent left navigation
- Dark design tokens
- One companion connection-status component
- One pairing screen
- No production research features yet
- No secrets in localStorage, sessionStorage or source files

### B. Companion shell

- Loopback-only server
- `/api/v1/health`
- `/api/v1/capabilities`
- pairing start/complete flow
- authenticated test endpoint
- strict allowed-origin configuration
- versioned API response schema
- secret write/read/delete test through `keyring`
- workspace select/open endpoint
- atomic JSON write test
- path traversal protection

### C. Technical-spike tests

Include automated tests for:

- remote-interface binding is disallowed
- unauthenticated requests fail
- invalid origin fails
- valid paired session succeeds
- secrets are never returned through API responses
- workspace paths outside the selected root fail
- interrupted writes do not corrupt the prior file
- schema-version fields are required

### D. Packaging

- PyInstaller specification/configuration
- macOS build workflow
- Windows build workflow
- documented signing/notarisation placeholders
- build artifacts must not contain test secrets

### E. CI

- frontend lint/typecheck/test/build
- companion lint/test
- schema validation
- dependency audit
- macOS and Windows packaging smoke jobs

### F. Documentation

Create:

- local development instructions
- security assumptions
- pairing flow
- workspace atomic-write strategy
- known limitations
- results of each spike

## Implementation rules

- Keep the PWA static-host compatible.
- Bind companion only to loopback.
- Never expose API keys or keychain values to the browser.
- Use explicit schemas for every local API response.
- Use atomic temporary-file plus rename writes.
- Use content hashes where appropriate.
- Add useful errors rather than silent fallback.
- Keep dependencies minimal and pinned.
- Do not implement OpenAlex, PDF processing, AI summaries, reading quests, synthesis or gap tracking in Task 0.
- Do not add analytics.
- Do not add a central backend.
- Do not use a cloud database.

## Completion report

At the end, provide:

1. Files changed
2. Commands run
3. Test results
4. Packaging results by OS
5. Security checks completed
6. Unresolved blockers
7. Recommendation on whether the architecture is safe to continue
8. The smallest sensible next Codex task

Do not claim success for any spike that was not actually run and verified.
