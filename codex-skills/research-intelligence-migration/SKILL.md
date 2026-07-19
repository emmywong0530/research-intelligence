---
name: research-intelligence-migration
description: Safely change durable schemas or workspace formats with versions, backup, idempotent migration, restore, fixtures, conflicts, and compatibility tests.
---

# Research Intelligence Durable Migration

1. Read `docs/adr/004-schema-versioning-and-migrations.md`,
   `docs/workspace-format.md`, `docs/workspace-atomic-writes.md`,
   `docs/data-model.md`, `docs/local-api.md`, `docs/privacy-security.md`, and
   all schemas under `packages/schemas/`.
2. Describe old/new versions, reason, compatibility, and data-loss risks.
3. Add old/new/partial/corrupt/conflict fixtures.
4. Build idempotent migration: detect version, refuse future versions, back up, write atomically, preserve IDs/provenance, record activity, avoid guessing.
5. Define failure and restore behavior.
6. Respect stale revisions and never overwrite newer data.
7. Rebuild device-local indexes after durable migration; never sync SQLite, FTS,
   cache, or vector indexes into the workspace.
8. Preserve loopback-only binding, exact allowed origins, explicit pairing,
   keychain-only secrets, path confinement, portable workspace identity,
   recoverable transactions, backup/restore safety, and no automatic merge.
9. Update schemas, contracts, docs, ADR if needed, feature status,
   `docs/traceability-matrix.md`, and the implementation report.
10. Run the integration checkpoint required after every durable migration.
11. Test old→new, rerun, interruption, restore, corrupt input, future version,
    stale conflict, cross-platform paths, and any affected approved prototype
    or design-token surface.
12. Complete `docs/templates/implementation-report.md` and a migration note.

## Merge blockers
No backup; no old fixture; no interruption test; silent data dropping; plaintext secret migration; unversioned durable change; no restore strategy.
