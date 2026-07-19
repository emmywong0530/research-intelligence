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
| `POST` | `/api/v1/workspaces/open` | Validate and open an existing workspace from `{path}` |
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

## Responses and Errors

Every response envelope includes `schema_version: "task0.v1"`. Workspace metadata and durable records carry their own durable schema versions. Successful record reads and writes include `record`, `record_id`, `relative_path`, and a SHA-256 `revision`; absolute filesystem paths are not used to address records.

Common errors are:

- `400` for invalid workspace metadata, schema records, path traversal, absolute paths, symlink escape, or unsupported collections;
- `401` for missing, expired, or invalid pairing/session credentials;
- `403` for missing or unconfigured origins;
- `404` for a workspace or record that is not open or present;
- `409` with `detail.code: "workspace_conflict"` when a supplied record or workspace revision is stale.

Conflict responses include the expected, current, and where available incoming content revisions. The companion leaves the current durable version in place and does not automatically merge records.

## Pairing and Secrets

Pairing codes are displayed by the local companion and are single-use, expiring, rate-limited, and replay-protected. Sessions are held in memory and are invalidated by companion restart. The PWA keeps the session token only in component state. The installation secret is generated with cryptographically secure randomness and stored/read back through `keyring`; keychain failure reports `keychain_unavailable` and never falls back to plaintext.
