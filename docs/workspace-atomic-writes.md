# Workspace Atomic Writes

Task 2 uses atomic files inside recoverable logical transactions for schema-backed workspace records and backup recovery.

## Strategy

Durable JSON writes use:

1. create a temporary file in the same directory as the target;
2. validate the record against its Draft 2020-12 schema and reject secret-looking fields;
3. write JSON with a required `schema_version`;
4. flush and fsync the temporary file;
5. replace the target with `os.replace`;
6. fsync the containing directory where the platform permits it;
7. remove abandoned temporary files when possible.

This avoids treating a cloud-synchronized monolithic database as durable source of truth and keeps normal workspace files as the durable records.

## Record Transaction

Writing a record also updates the corresponding ID list and `updated_at` in
`workspace.json`. Those two files are treated as one logical operation:

1. validate the record and calculate the current revision;
2. create a pre-write backup for an existing record;
3. stage the old and new record bytes and old and new metadata bytes under
   `.research-intelligence/transactions/<transaction-id>/`;
4. fsync a `transaction.v1` journal in `prepared` state;
5. replace the record and then metadata with atomic files;
6. fsync a `committed` journal marker;
7. remove staging only after commit.

If any step before the committed marker fails, both old byte images are restored
and the transaction is rolled back. If the process stops, opening the workspace
rolls back any non-committed journal. A committed journal means the new state
is authoritative and cleanup can safely resume. Cleanup failure therefore
cannot turn a complete new state into a partial one.

## Restore Transaction

Restore validates the manifest, approved relative paths, snapshot metadata, and
every SHA-256 file hash before touching live files. It creates and verifies a
pre-restore recovery backup, copies the selected snapshot into staging, then
records a `restore.v1` journal. Live file replacement is recoverable rather
than presented as an all-platform atomic directory swap: an uncommitted journal
is deterministically rolled back from the recovery backup on the next open, and
a committed journal only schedules idempotent staging cleanup. The recovery
backup is retained.

## Spike Verification

The automated tests write valid prior files, simulate interrupted temporary-file writes without replacement, inject failures before and after each record transaction replacement, interrupt cleanup, recover abandoned journals, validate missing and corrupted snapshots, interrupt restore before and during commit, recover on restart, verify stale revision rejection, preserve pre-write and pre-restore backups, and clean hidden companion `.tmp` files.

The remaining limitation is platform-level crash atomicity during a multi-file
commit: the implementation relies on the journal and deterministic rollback
after restart rather than assuming that replacing an entire directory is
portable across macOS, Windows, and sync-folder providers. A live process that
is forcibly terminated can briefly leave intermediate files until the next
workspace open, at which point the journal resolves to either the complete
prior or complete new state.

## Profile Migration and Decisions

Research Profile migration from `m2.v1` to `m3c.v1` reuses the record
transaction and creates a pre-write backup. It is idempotent per profile; a
failure before replacement or during cleanup leaves the prior file or a
recoverable committed state, and workspace reopen resumes the remaining
migrations. Proposal decisions also update the profile field and its proposal
history in one revision-aware record transaction. A stale revision is rejected
before the proposal transition, so no accepted or reversed status can be left
without the corresponding field update.

## Paper Metadata Records

Task 3E paper creation and update use the same record transaction as projects
and Research Profiles. The paper JSON and `workspace.json` paper ID index are
prepared, replaced, committed, or recovered together. The companion validates
the schema, exactly-one-project association, parent ID and expected revision
before staging bytes. A stale paper write returns `409` and leaves both the
durable paper and metadata index unchanged. The paper list is derived from
validated durable records and a server-side project filter; it does not use a
SQLite or browser cache as its source of truth.

## Notes

Task 3F project- and paper-scoped notes use the same schema validation,
revision hash, atomic replacement, workspace transaction journal, backup and
restart recovery as every other generic durable record. A note write carries
the approved project or paper `parent_id`; the companion validates the scope
and association before staging any bytes. The note record and the workspace
`updated_at` change therefore cannot be reported as a successful partial
write, and a stale note revision returns `409` without changing the durable
note.

## Local PDF Import Transaction

Task 4A uses a `pdf-import` journal under
`.research-intelligence/transactions/<transaction-id>/` for the three live
files involved in an import: `papers/<paper-id>/source/original.pdf`, its
`source.json` sidecar, and the paper `metadata.json`. The journal stages the
prior bytes for every existing target, validates the incoming PDF and sidecar,
creates a verified pre-import backup, and records the expected paper revision
before any live replacement.

The companion replaces each target with the existing fsynced atomic-file
primitive, writes a committed marker only after all three replacements, and
cleans staging last. An injected failure or an abandoned non-committed journal
restores the prior PDF, sidecar and paper bytes; a committed journal keeps the
new state and only needs cleanup. Replacing an existing PDF requires an
explicit request and retains the pre-import recovery backup. A source read
verifies the sidecar hash and size against the PDF before returning metadata.

The transfer is a bounded raw `application/pdf` request from the browser to the
loopback companion. No arbitrary host path crosses the browser boundary, no
PDF bytes enter browser storage, and no extraction or remote processing occurs.
The remaining platform limitation is the same as other multi-file journals:
hard process-kill behavior depends on deterministic restart recovery rather
than a portable atomic directory swap across every filesystem and sync
provider.
