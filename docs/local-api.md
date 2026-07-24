# Local API

The local API is exposed by the private companion running on the user's computer. It is versioned under `/api/v1`, binds only to loopback, and is intended to be called by the paired static PWA.

## Security Contract

The companion must:

- bind only to `127.0.0.1` and/or `::1`;
- reject remote network interfaces;
- validate exact configured browser origins;
- reject missing `Origin` on browser-facing pairing, session, spike, and workspace endpoints;
- require a short-lived bearer session for workspace operations;
- store the per-installation secret only through the operating-system keychain;
- validate all workspace paths against the selected workspace root;
- expose only allowlisted collections and stable record IDs to the frontend;
- redact secrets from logs and never return API keys, installation secrets, or pairing approval codes.

The expected production origin is the exact string `https://emmywong0530.github.io`. The GitHub Pages path `/research-intelligence/` is not part of the browser `Origin` header. Additional local origins are configured through `RI_ALLOWED_ORIGINS`; wildcards are not accepted.

## Public Endpoints

| Method | Endpoint | Purpose | Session |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | Companion version and loopback status | No |
| `GET` | `/api/v1/capabilities` | Versioned capability list | No |
| `POST` | `/api/v1/pairing/start` | Start an expiring pairing request; never returns approval code | No, origin required |
| `POST` | `/api/v1/pairing/complete` | Exchange the independently displayed approval code for an in-memory session | No, origin required |
| `GET` | `/api/v1/installation-secret/status` | Report keychain availability without the secret | No, origin required |

## Task 2 Workspace Endpoints

All endpoints below require `Authorization: Bearer <short-lived session token>` and an allowed `Origin`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/workspaces/create` | Create, initialize, validate, and open a workspace from `{path, name?}` |
| `POST` | `/api/v1/workspaces/open` | Validate and open an existing workspace from `{path}`; trust its stored durable ID and update the device-local path mapping |
| `GET` | `/api/v1/workspaces/{workspace_id}/metadata` | Read validated metadata and its revision |
| `POST` | `/api/v1/workspaces/{workspace_id}/initialize` | Repair approved directories and clean safe abandoned temp files |
| `GET` | `/api/v1/workspaces/{workspace_id}/health` | Report metadata, structure, record-count, and device-registry health |
| `GET` | `/api/v1/workspaces/{workspace_id}/records/{collection}` | List records from an approved schema-backed collection |
| `GET` | `/api/v1/workspaces/{workspace_id}/records/{collection}/{record_id}` | Read one validated record and its content hash |
| `PUT` | `/api/v1/workspaces/{workspace_id}/records/{collection}/{record_id}` | Validate and atomically write `{record, expected_revision?, parent_id?}` |
| `POST` | `/api/v1/workspaces/{workspace_id}/backups` | Create a timestamped snapshot from `{reason?}` |
| `GET` | `/api/v1/workspaces/{workspace_id}/backups` | List backup manifests |
| `POST` | `/api/v1/workspaces/{workspace_id}/backups/{backup_id}/restore` | Guarded restore from `{expected_workspace_revision}` |
| `POST` | `/api/v1/workspaces/{workspace_id}/conflicts` | Report the current revision for a record |

The Task 0 diagnostic `POST /api/v1/workspaces/resolve` remains read-only and exists for path-security verification. It does not provide a general file read or write API. The Task 0 atomic-write diagnostic remains under `/api/v1/spikes/atomic-write-test`.

## Task 3B and Task 3C Research Profile Usage

Research Profiles use the existing generic record endpoints; no new endpoint
or authentication path is introduced. Task 3C uses one generic profile write
for each proposal decision so the profile field and proposal history share one
revision-aware transaction:

1. `GET .../records/research-profiles` lists validated profile envelopes.
2. `GET .../records/research-profiles/{research_profile_id}` reads the
   selected project's profile and its content revision.
3. `PUT .../records/research-profiles/{research_profile_id}` accepts
   `{record, parent_id?, expected_revision?}` and validates the record before
   the existing journaled record/index transaction.

For this collection, the companion enforces that the ID is exactly
`research_profile_<project_id>`, the record's `project_id` equals `parent_id`
when supplied, and the referenced project already exists. A second create for
the same project is rejected by the existing durable-record conflict behavior;
the frontend also re-lists before an explicit create to avoid silently
replacing an existing profile. The project profile is therefore selected by
project context, not by arbitrary frontend filesystem paths.

The profile write accepts only the schema-defined record. New Task 3C proposal
payloads are additionally checked for supported type-to-field mappings,
non-empty case-insensitive-unique values, finite concept weights, required
snapshots, valid status transitions, and preserved history. Legacy proposal
shells from `m2.v1` remain readable but are not actionable. A stale
`expected_revision` returns `409` before any proposal transition is accepted;
the frontend keeps the local decision uncommitted until it fetches the latest
profile and the user explicitly retries or abandons it. Reversal checks the
current field against the applied snapshot and records a blocked reconciliation
event instead of overwriting later user edits.

Task 3B did not send proposals, paper feedback, automatic-learning changes,
foundational-paper selectors, or semantic-reference selectors. Task 3C's
supported proposals are explicit deterministic review data, not claims that a
model learned from reading history. All requests retain loopback binding,
exact allowed-origin enforcement, paired session authentication, revision
checking, schema validation, atomic writes, and secret redaction.

## Responses and Errors

Every response envelope includes `schema_version: "task0.v1"`. Workspace metadata and durable records carry their own durable schema versions. Successful record reads and writes include `record`, `record_id`, `relative_path`, and a SHA-256 `revision`; absolute filesystem paths are not used to address records.

Common errors are:

- `400` for invalid workspace metadata, schema records, path traversal, absolute paths, symlink escape, or unsupported collections;
- `401` for missing, expired, or invalid pairing/session credentials;
- `403` for missing or unconfigured origins;
- `404` for a workspace or record that is not open or present;
- `409` with `detail.code: "workspace_conflict"` when a supplied record or workspace revision is stale;
- `409` with `detail.code: "workspace_identity_collision"` when a copied workspace reuses a durable ID already registered for a different local file identity;
- `503` when the device-local registry is unavailable for a create/open registration.

Conflict responses include the expected, current, and where available incoming content revisions. The companion leaves the current durable version in place and does not automatically merge records.

Record writes update the durable record and the related `workspace.json` index
through one journaled transaction. The journal is recoverable at workspace open;
failures before its committed marker roll back both files, while cleanup after a
committed marker is idempotent. The API never reports a successful partial
record/index update.

Backup restore validates all manifest paths and snapshot hashes before live
changes, creates a verified pre-restore recovery backup, stages the new state,
and uses a restore journal. An uncommitted restore is rolled back from that
recovery backup on open. The recovery backup is returned as
`recovery_backup_id` and is retained.

## Pairing and Secrets

Pairing codes are displayed by the local companion and are single-use, expiring, rate-limited, and replay-protected. Sessions are held in memory and are invalidated by companion restart. The PWA keeps the session token only in component state. The installation secret is generated with cryptographically secure randomness and stored/read back through `keyring`; keychain failure reports `keychain_unavailable` and never falls back to plaintext.
