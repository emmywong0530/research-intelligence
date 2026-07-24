# ADR 007: Transparent and reversible Research Profile proposals

## Status
Accepted

## Decision

Research Profile feedback learning is represented by explicit proposal records
inside the existing `proposals` array of
`projects/<project-id>/research-profile.json`. A proposal must identify its
target field, explain the proposed change, preserve current and proposed
snapshots, and append decision history. Accept, modify, reject, and reverse
operations update the profile field and proposal state in one expected-revision
record write. Reversal compares the current field with the applied snapshot and
records a blocked reconciliation instead of overwriting later edits.

Task 3C supports only deterministic, explicitly supplied proposals for
`changed_concept_weights`, `new_search_terms`, `exclusions`, and
`preferred_methods` (mapped to the existing `preferred_evidence_types` field).
There is no hidden inference or autonomous learning source, and semantic
examples and screening-instruction changes remain unsupported until an
approved durable destination and workflow exist.

Task 3B `m2.v1` profiles migrate idempotently to `m3c.v1` on workspace open,
with a pre-write backup and the existing record transaction. Legacy proposal
shells are preserved but not guessed into actionable payloads.

See [ADR 002](002-durable-files-rebuildable-indexes.md) for the durable-file
boundary, [ADR 003](003-loopback-pairing-security.md) for the authenticated
companion boundary, [ADR 004](004-schema-versioning-and-migrations.md) for the
migration requirements, and [ADR 006](006-discovery-shared-state.md) for the
current interactive-only discovery state.

## Consequences

Users can inspect and reverse profile changes, but every decision requires
explicit UI confirmation and the current revision. Proposal payloads increase
the durable profile size and require migration-aware schema validation. The
milestone does not claim automatic learning from papers or implement paper
feedback, ingestion, search, ranking, semantic references, synthesis, or
export.
