# ADR 004: Explicit schema versioning and reversible migrations

## Status
Accepted

## Decision
Every durable record has a schema version. Durable changes require backup, idempotent migration, fixtures, rollback/restore, and compatibility tests.

The current schemas are under
[`packages/schemas/`](../../packages/schemas/), and Task 2 validates records
before atomic writes in
[`companion/src/research_intelligence_companion/workspace.py`](../../companion/src/research_intelligence_companion/workspace.py).
Task 2 corrected the pre-merge workspace format directly; it did not introduce
a migration. Future durable format changes must use this ADR's reversible
migration process and the backup/restore behavior in
[`docs/workspace-atomic-writes.md`](../workspace-atomic-writes.md).

See [ADR 002](002-durable-files-rebuildable-indexes.md) for the durable-file
boundary and [ADR 005](005-paper-type-specific-extraction.md) for paper-type
schema implications.
