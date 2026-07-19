# Feature Completeness Model

Every significant capability has one state:

1. **Visual mock** — interface present; controls may not change meaningful state.
2. **Interactive mock** — typed in-memory mock behavior only.
3. **Companion connected** — authenticated local API operation exists; persistence may be incomplete.
4. **Locally persisted** — validated durable records write and reload.
5. **End-to-end verified** — complete user path passes automated E2E, including restart/reload where relevant.
6. **Production ready** — cross-platform packaging, recovery, accessibility, privacy, docs, and failures verified.

Rules:
- Record status in the traceability matrix.
- Do not call mock-backed behavior implemented without naming its state.
- A feature cannot skip directly from interactive mock to production ready.
- Any regression to a lower state must be reported.
- A status claim must identify its evidence scope: local, GitHub Actions, or
  unverified. A configured workflow is not a passing result.
- `End-to-end verified` requires an executable complete user path, including
  reload/restart where relevant; screenshots and mocked fetches do not qualify.
- `Production ready` also requires cross-platform packaging, recovery,
  accessibility, privacy, documentation, and failure-path evidence.
