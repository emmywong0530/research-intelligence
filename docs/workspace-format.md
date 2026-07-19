# Workspace Format

The user workspace is a normal folder selected by the user. It is not part of this repository and must never be committed. Task 2 creates and validates this structure through the loopback companion.

## Durable Folder Structure

```text
Research Intelligence Workspace/
|-- workspace.json
|-- projects/
|   `-- <project-id>/
|       |-- project.json
|       |-- research-profile.json
|       |-- search-profile.json
|       |-- feedback-profile.json
|       `-- settings.json
|-- papers/
|   `-- <paper-id>/
|       |-- metadata.json
|       |-- paper.pdf
|       |-- extracted-text.json
|       |-- classification.json
|       |-- studies.json
|       |-- summary.json
|       |-- extraction.json
|       |-- project-connections.json
|       |-- reading-progress.json
|       |-- notes.md
|       `-- provenance.json
|-- notes/
|-- syntheses/
|-- gaps/
|-- feedback/
|-- activity/
`-- backups/
    `-- backup_<UTC timestamp>_<random id>/
        |-- manifest.json
        `-- snapshot/
```

Task 2 initializes every directory above. Only the existing JSON Schemas are writable through the Task 2 record API. Future milestones may add the other paper and project files without changing the root structure.

The companion may also create the operational directory
`.research-intelligence/transactions/` while a write or restore is in progress.
It contains only recovery journal state and staged bytes, is excluded from the
durable workspace revision and all backup snapshots, and is removed after a
successful commit or deterministic recovery. It is not an application data
collection or a frontend write target.

## Workspace Metadata

`workspace.json` is validated against `packages/schemas/workspace.schema.json`. It contains `schema_version: "m2.v1"`, a stable `workspace_id` generated once with UUID4 randomness at creation time, a name, created/updated timestamps, and stable ID lists for projects, papers, syntheses, and gaps.

Opening a folder requires valid metadata and trusts the schema-valid stored workspace ID; the ID is never recalculated from the current path. Creating a workspace creates the directory, initializes the approved folders, and writes metadata atomically. Opening a valid workspace repairs missing approved directories, recovers abandoned transactions, and removes abandoned companion temporary files.

The device-local registry maps the durable ID to the current resolved local
path. A rename or move updates the mapping when the previous registered path no
longer exists; a same-device rename can also be confirmed by the stored
`workspace.json` file identity. A copied workspace with the same durable ID
while the registered copy still exists has a different local file identity and
produces a `workspace_identity_collision` warning/HTTP 409; the existing
registry entry is never silently overwritten. A separate device-local registry
can register the same durable workspace at its current path.

## Schema-Backed Records

The protected API exposes only these allowlisted collections:

| Collection | Durable path | Schema |
| --- | --- | --- |
| `projects` | `projects/<project-id>/project.json` | `project.schema.json` |
| `research-profiles` | `projects/<project-id>/research-profile.json` | `research-profile.schema.json` |
| `papers` | `papers/<paper-id>/metadata.json` | `paper.schema.json` |
| `studies` | `papers/<paper-id>/studies.json` | `study.schema.json` |
| `reading-progress` | `papers/<paper-id>/reading-progress.json` | `reading-progress.schema.json` |
| `syntheses` | `syntheses/<synthesis-id>.json` | `synthesis.schema.json` |
| `gaps` | `gaps/<gap-id>.json` | `gap.schema.json` |
| `provenance` | `papers/<paper-id>/provenance.json` | `provenance.schema.json` |

Every record is validated against Draft 2020-12 before it is written. Records require the schema-defined `schema_version`, stable ID, and timestamps. Secret-looking fields such as API keys, tokens, passwords, credentials, cookies, and secrets are rejected even when a schema permits additional configuration fields.

The frontend supplies a collection and stable record ID, never an arbitrary filename. Parent IDs are accepted only where the approved nested layout requires one. Notes, feedback, activity, PDFs, and future auxiliary files are initialized but are not arbitrary-write API targets in Task 2.

## Revisions, Writes, and Conflicts

The companion uses the SHA-256 hash of the exact durable file bytes as the record revision. Reads and lists return the revision. An update must supply the revision that was read. A stale update returns HTTP 409 with the current and incoming revisions; the current file is left untouched and no automatic semantic merge is attempted.

Writes use a temporary file in the target directory, JSON serialization, file `fsync`, atomic replacement, and a best-effort directory `fsync`. Abandoned companion temporary files are removed only when they match the companion's hidden `.tmp` naming pattern. A failed replacement does not replace the prior valid file.

## Backups and Recovery

Backups are timestamped directories under `backups/`. Each manifest includes
the relative file list and a SHA-256 hash for every snapshot file. The API can
create and list snapshots. Updating an existing record creates a pre-write
snapshot; restoring creates and verifies a pre-restore recovery snapshot.
Restore validates all manifest paths, files, hashes, and snapshot metadata
before changing live data. It stages the selected snapshot and uses a restore
journal. An uncommitted restore rolls back from the recovery backup on restart;
a committed restore only needs idempotent staging cleanup. Restore requires
the caller's current aggregate workspace revision, computed from the relative
paths and hashes of all durable files, and returns HTTP 409 rather than
overwriting newer workspace data. Task 2 has no automatic retention or deletion
policy; backups, including recovery backups, remain until a later policy or
explicit user file management removes them.

Record writes use the same journal for the record file and `workspace.json`.
Both new byte images and both prior byte images are staged before the journal is
marked prepared. The companion replaces the record, replaces metadata, writes
a committed marker, and only then cleans up. Any failure before the committed
marker restores both prior images; startup performs the same rollback for an
abandoned journal. This prevents an orphaned record or metadata index from
surviving a failed logical update.

## Durable Versus Device-Local Data

Durable files above are the source of truth and may be synchronized by a user-controlled folder service such as Dropbox. The companion's SQLite registry is rebuildable device-local data stored in the operating-system application-data directory, outside the workspace. It stores only local workspace registration metadata and is never copied into `backups/`, synced, or returned as a durable record. Full-text, vector, queue, thumbnail, and search indexes remain out of scope for Task 2.

## Path Safety

The companion resolves all internal paths beneath the resolved workspace root, rejects absolute paths and traversal components, rejects Windows drive paths on all platforms, and resolves symlinks before checking containment. A symlink that resolves outside the workspace is rejected. There is no frontend endpoint that accepts an arbitrary filename for writing.
