# Workspace Atomic Writes

Task 2 uses the same atomic-write strategy for schema-backed workspace records and backup recovery.

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

## Spike Verification

The automated tests write valid prior files, simulate interrupted temporary-file writes without replacement, and verify the prior file hash remains unchanged. Task 2 also verifies stale revision rejection, pre-write backups, guarded restore, and cleanup of hidden companion `.tmp` files.
