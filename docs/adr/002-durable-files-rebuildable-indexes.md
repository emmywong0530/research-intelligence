# ADR 002: Durable normal files and rebuildable device indexes

## Status
Accepted

## Decision
Store durable research records as schema-versioned normal files in a user workspace. Keep SQLite, FTS, caches, and vectors device-local and rebuildable.

Task 2 implements this decision in
[`companion/src/research_intelligence_companion/workspace.py`](../../companion/src/research_intelligence_companion/workspace.py)
and
[`companion/src/research_intelligence_companion/device.py`](../../companion/src/research_intelligence_companion/device.py).
The durable workspace ID is stored in `workspace.json`; the device registry
maps it to a local path and detects copied-ID collisions. Transaction journals
and staged restore bytes are operational recovery state, excluded from durable
workspace revisions and backup snapshots.

See [ADR 001](001-local-first-pwa-companion.md) for the overall local-first
boundary and [ADR 004](004-schema-versioning-and-migrations.md) for durable
record evolution.
