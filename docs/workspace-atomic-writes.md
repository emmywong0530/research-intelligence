# Workspace Atomic Writes

Task 0 implements the workspace atomic-write spike only.

## Strategy

Durable JSON writes use:

1. create a temporary file in the same directory as the target;
2. write JSON with a required `schema_version`;
3. flush and fsync the temporary file;
4. replace the target with `os.replace`;
5. remove abandoned temporary files when possible.

This avoids treating a cloud-synchronized monolithic database as durable source of truth and keeps normal workspace files as the durable records.

## Spike Verification

The automated test writes a valid prior file, simulates an interrupted temporary-file write without replacement, and verifies the prior file hash remains unchanged.
