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
