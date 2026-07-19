# Screenshots

## Task 1 Captures

The approved capture set is under [`task-1/`](task-1/). All of the following images were captured successfully through the Codex in-app browser against the built local PWA at `1440 × 1000`:

- `home-1440x1000.png`
- `discovery-table-1440x1000.png`
- `discovery-cards-1440x1000.png`
- `paper-field-1440x1000.png`
- `reading-hub-1440x1000.png`
- `focus-reading-1440x1000.png`
- `research-profile-1440x1000.png`
- `synthesis-1440x1000.png`
- `research-gaps-1440x1000.png`
- `settings-1440x1000.png`

Containment captures were also produced through the in-app browser:

- `containment-discovery-1280x800.png`
- `containment-discovery-1024x768.png`

At both containment sizes, the browser measurement reported document width equal to viewport width and zero overflowing elements in the application shell, panels, buttons and SVGs.

## Capture Method and Limits

These committed images were produced through the Codex in-app browser, not Playwright. The local Playwright e2e suite remains unverified because the required Chromium executable was unavailable in this environment; the installed Chrome fallback aborted before test execution. The Playwright capture suite remains available at [`apps/web/e2e/prototype.spec.ts`](../../../apps/web/e2e/prototype.spec.ts) and writes to `test-results/prototype-captures` when a compatible browser is installed.
