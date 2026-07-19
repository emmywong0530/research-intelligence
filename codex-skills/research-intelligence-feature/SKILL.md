---
name: research-intelligence-feature
description: Implement a bounded Research Intelligence feature as a secure, traceable vertical slice.
---

# Research Intelligence Feature Implementation

## Workflow
1. Read `AGENTS.md`, accepted ADRs under `docs/adr/`,
   `docs/traceability-matrix.md`, `docs/feature-status-model.md`, and relevant
   product, privacy, data, API, workspace, prototype, and integration specs.
2. Restate user outcome, included scope, prohibited scope, current state, target state.
3. Inspect and reuse established components, services, schemas, middleware, and tokens.
4. Map: user action → frontend → API → companion → durable record/index → response → reload/restart → test.
5. Identify API, schema, migration, ADR, privacy, backup/restore, and
   traceability changes before coding.
6. Stop for explicit decision if an ADR conflict or undocumented architecture change is required.
7. Implement the smallest coherent slice.
8. Preserve loopback-only binding, exact allowed-origin enforcement, explicit
   companion-owned pairing, short-lived sessions, keychain-only secrets, path
   confinement, schema validation, atomic writes, portable workspace identity,
   recoverable transactions, backup/restore safety, device-local index
   separation, and no central user data.
9. Preserve the approved prototype at `docs/prototypes/`, including
   `design-tokens.json`, shared state rules, typed reusable components, and
   loading, empty, error, disconnected, conflict, and health states.
10. Durable writes validate first, use schema version/stable IDs/revisions,
    back up destructive changes, recover interrupted transactions, and never
    sync device-local indexes.
11. Add unit, integration, and executable E2E/spike tests proportionate to the
    claimed feature state. Do not claim end-to-end verification from mocks or
    screenshots alone.
12. Update docs, contracts, schemas/migrations, ADRs when decisions change,
    `docs/traceability-matrix.md`, and the feature status.
13. Run the required integration checkpoint after every two milestones, after
    migrations or security/storage changes, and before release hardening.
14. Run the validation matrix and record exact commands, results, artifacts,
    and unverified behavior in `docs/templates/implementation-report.md`.
15. Commit only to the task branch; never merge automatically. Separate merge
    blockers from follow-up improvements in the report.
