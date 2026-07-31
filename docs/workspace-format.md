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
|       |-- source/
|       |   |-- original.pdf
|       |   `-- source.json
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
| `notes` | `projects/<project-id>/notes/<note-id>.json` or `papers/<paper-id>/notes/<note-id>.json` | `note.schema.json` |
| `source-files` | `papers/<paper-id>/source/source.json` | `source-file.schema.json` |

Every record is validated against Draft 2020-12 before it is written. Records require the schema-defined `schema_version`, stable ID, and timestamps. Secret-looking fields such as API keys, tokens, passwords, credentials, cookies, and secrets are rejected even when a schema permits additional configuration fields.

The frontend supplies a collection and stable record ID, never an arbitrary filename. Parent IDs are accepted only where the approved nested layout requires one. The root `notes/` directory remains initialized as a reserved workspace folder. Task 3F durable notes are nested under their owning project or paper so the parent relationship is visible in the path and can be checked by the companion. Notes are not arbitrary filenames: the frontend supplies only a stable note ID and the approved parent ID.

Task 3E uses the existing `papers/<paper-id>/metadata.json` path for
metadata-only paper records. Each paper belongs to exactly one existing
project: `assigned_project_ids` contains one project ID and the authenticated
write `parent_id` must match it. The companion enforces this relationship and
the server-side `project_id` list filter. New records use
`pdf_access_status: "unavailable"`; no PDF file is created or claimed to be
available. Paper IDs are collision-resistant random stable IDs and remain
unchanged after metadata edits.

### Task 4A local PDF source files

Task 4A stores an explicitly selected local PDF at
`papers/<paper-id>/source/original.pdf` and its validated sidecar at
`papers/<paper-id>/source/source.json`. The sidecar's `relative_path` must be
exactly the canonical path for its paper, and `source_id` is
`source_<paper-id>`. The existing paper record remains the metadata source of
truth and is updated atomically with the sidecar and PDF so its
`pdf_access_status` and `local_pdf_path` cannot silently disagree with the
stored source.

Only replacement with an explicit `replace=true` request is allowed after a
source exists. A pre-import recovery backup is created and retained. The
`.research-intelligence/transactions/` journal stores prior PDF, sidecar and
paper bytes; failures before the committed marker roll back all three, and
workspace reopen deterministically recovers an abandoned import. The source
sidecar stores size and SHA-256 and the companion verifies both whenever the
source is read.

### Task 4B extracted text

After an explicit extraction request, the companion stores the validated
`m4b.v1` record at `papers/<paper-id>/extracted/text.json` and the complete
machine-extracted text at `papers/<paper-id>/extracted/full.txt`. The JSON
record is the durable extraction metadata source of truth; `full.txt` is
verified against its recorded SHA-256. It contains only text produced locally
by `pypdf 6.14.2`, not OCR output, summaries, embeddings or remote results.

Extraction is bounded to 500 pages and 5,000,000 extracted characters. The
source checksum is compared before commit and after parsing. A replaced source
therefore yields `stale` until the user explicitly re-extracts. The extraction
transaction journals both artifacts, preserves any previous result, rolls back
before commit, and recovers abandoned non-committed work on workspace open.
Failed parsing or limit checks do not create a partial extraction. No
migration is applied to existing workspaces; unknown future extraction schema
versions are rejected.

The browser transfers PDF bytes, not a host filesystem path. The companion
accepts only the approved paper-scoped endpoint and never accepts a client
destination filename. A 50 MB bound, filename validation and `%PDF-` signature
check are enforced before replacement. This does not establish semantic PDF
validity or full-text availability. Existing workspaces need no schema
migration; importing a source is an explicit new record/file operation.

Task 3F stores plain-text notes as `m3f.v1` records. Project notes omit
`paper_id`; paper notes require it. The strict `note.schema.json` limits the
title to 240 characters and the body to 100,000 characters and rejects extra
fields. Notes do not contain rendered HTML, prompts, credentials, or private
model reasoning.

For the `research-profiles` collection, the record ID is deterministically
`research_profile_<project-id>`. The companion requires the profile's
`project_id`, the API `parent_id` when provided, and the existing project
record to agree. This relationship is enforced without adding a new write
target or requiring a project metadata index entry.

### Research Profile proposal records

Task 3C uses the existing `proposals` array in
`projects/<project-id>/research-profile.json`; it does not create a second
proposal file or device-local proposal index. A new actionable proposal stores
its target field, current and proposed snapshots, status, decision timestamp,
applied source revision, applied value, reversal result, and append-only
history. The schema keeps the earlier proposal enum and adds `reversed` for a
successful reversal. Legacy proposals without these payload fields remain
readable but are explicitly non-actionable.

The bounded mappings are `changed_concept_weights` to `concepts`,
`new_search_terms` to `search_queries`, `exclusions` to `exclusions`, and
`preferred_methods` to the existing `preferred_evidence_types` field. List
values are appended after duplicate checks; concept weights use a complete
validated snapshot. Semantic examples and revised screening instructions are
unsupported in this milestone.

When a workspace opens, valid `m2.v1` Research Profile files are migrated to
`m3c.v1` one profile at a time through the same atomic record transaction and
with a pre-write backup. The migration preserves IDs, authored fields, and
legacy proposals without guessing payloads. Reopening is idempotent. A
corrupt or unknown future profile version is rejected without overwrite; an
interrupted individual migration is safe to retry because each profile is
committed atomically.

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

## Task 4C Duplicate Review Records

Duplicate analysis is a rebuildable report, not a new synchronized index. It
reads `papers/*/metadata.json`, the validated source sidecar and canonical PDF
bytes, then returns the current evidence groups. A source is eligible for
exact-PDF comparison only when the sidecar, PDF, size and SHA-256 agree and
the canonical paths stay inside the workspace. Malformed or symlinked source
data is excluded with a bounded warning.

The only new durable Task 4C artifact is an optional review record:

```text
feedback/
`-- duplicate-reviews/
    `-- duplicate_review_<group-fingerprint>.json
```

It uses `packages/schemas/duplicate-review.schema.json` and
`schema_version: "m4c.v1"`. Its workspace ID, evidence type, evidence
fingerprint and sorted paper IDs must match the current report. The companion
also requires the deterministic review ID and active workspace ID before an
atomic write. Review state can acknowledge, separate or ignore evidence; it
cannot merge records, delete records or suppress the evidence group.

No migration is needed: this is the first duplicate-review format and there
are no earlier review files to preserve. Rebuilding the report after a paper,
identifier or source change produces a new group fingerprint when the member
set or evidence changes, so stale review state is not silently reused.

## Task 4D Paper Metadata

Paper metadata remains at `papers/<paper-id>/metadata.json`. The record may
be `m2.v1` for an unopened legacy workspace or `m4d.v1` after explicit open
migration. Migration preserves the paper ID, project association, ordered
authors, prior metadata, timestamps and all separate source, extraction, note
and duplicate-review files. The migration writes through the existing backup
and recoverable record transaction.

The new structured fields are validated with bounded limits and strict
`additionalProperties: false` schema objects. Completeness, duplicate evidence,
PDF state and extraction state are derived or stored in their own approved
records; they are not copied into browser storage or used to replace the
paper metadata source of truth.

## Task 5A Device-Local Provider Settings

Provider settings are intentionally not workspace files. The companion stores
the strict `task5a.v1` nonsecret configuration at its device-data root as
`ai-provider-settings.json`; this directory is outside the selected workspace,
backups and sync scope. The file contains provider/model, bounded timeout and
retry settings, enabled state, timestamps and a content revision. It is not
listed in `workspace.json` and is not exposed through the workspace record API.

The credential is held only in the operating-system keychain. It has no JSON
representation in this format. Deleting or rebuilding device-local state does
not delete workspace records, but provider configuration and keychain setup
must be re-established on a new device. The device-local settings store
rejects future versions and preserves the prior valid file when an atomic
replacement fails.

## Task 5B Processing History

The synthetic Task 5B processing framework stores strict `m5b.v1` records at
`activity/processing/<processing-id>.json`. This is an approved activity
subdirectory, not a new top-level workspace collection and not a workspace
metadata index. Processing records carry the durable `workspace_id`; the
companion rejects a record whose ID does not match the opened workspace.

The record contains only safe operation, prompt identity, model/configuration
metadata, fingerprints, synthetic source version, bounded output, cache state,
timestamps, state, error and provenance. It never contains a credential, API
key, raw prompt or provider response, session token, absolute path or user
research content. Processing history is included in normal workspace backups
because it is a durable activity file; device-local settings and indexes are
not.

This additive record does not change `workspace.json` or require migration of
existing workspaces. Workspace open validates processing records and converts
abandoned `queued`/`running` events to explicit interrupted failures. It does
not resume provider work. Atomic record writes continue to use the existing
record transaction journal, backup and expected-revision conflict behavior.
