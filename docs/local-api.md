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
| `GET` | `/api/v1/workspaces/{workspace_id}/records/{collection}` | List records from an approved schema-backed collection; `papers` accepts the required server-side `project_id` filter |
| `GET` | `/api/v1/workspaces/{workspace_id}/records/{collection}/{record_id}` | Read one validated record and its content hash |
| `PUT` | `/api/v1/workspaces/{workspace_id}/records/{collection}/{record_id}` | Validate and atomically write `{record, expected_revision?, parent_id?}` |
| `POST` | `/api/v1/workspaces/{workspace_id}/backups` | Create a timestamped snapshot from `{reason?}` |
| `GET` | `/api/v1/workspaces/{workspace_id}/backups` | List backup manifests |
| `POST` | `/api/v1/workspaces/{workspace_id}/backups/{backup_id}/restore` | Guarded restore from `{expected_workspace_revision}` |
| `POST` | `/api/v1/workspaces/{workspace_id}/conflicts` | Report the current revision for a record |

The Task 0 diagnostic `POST /api/v1/workspaces/resolve` remains read-only and exists for path-security verification. It does not provide a general file read or write API. The Task 0 atomic-write diagnostic remains under `/api/v1/spikes/atomic-write-test`.

## Task 3E Paper Records

Task 3E reuses the generic authenticated record API. Paper records use the
existing `papers` collection and are stored at
`papers/<paper-id>/metadata.json`. List requests for the Papers screen must use
`GET .../records/papers?project_id=<project-id>`; the companion performs the
filter rather than requiring the frontend to fetch another project's records.

Paper writes require `{record, parent_id, expected_revision?}`. The paper's
`paper_id` must match the URL, `assigned_project_ids` must contain exactly one
existing project ID, and that ID must equal `parent_id`. The companion rejects
missing projects, parent mismatches, reassignment attempts, empty titles or
authors, schema-invalid fields and stale revisions before the existing atomic
record/index transaction. A successful response includes the content revision
and relative durable path; no absolute path or secret is returned.

The approved Task 3E UI supports only manually supplied paper metadata. The
paper schema has no approved URL field, so URLs are not accepted. New records
use `pdf_access_status: "unavailable"`; no PDF or full-text operation is
implemented.

## Task 4A Local PDF Source Registration

Task 4A keeps the generic paper record API for metadata and adds one narrowly
scoped source-file contract. It does not accept arbitrary paths or multipart
filesystem references. The browser streams the selected bytes with
`Content-Type: application/pdf` and sends only the display filename in
`X-Original-Filename`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/source-file` | Read validated source metadata and verify the stored PDF hash/size |
| `POST` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/source-file?expected_revision=<paper-revision>&replace=false` | Stream, validate, atomically register or explicitly replace one local PDF |

Both endpoints require an allowed exact `Origin` and a short-lived paired
session. The POST destination is derived only from the path IDs. The companion
rejects project/paper mismatches, missing or unsafe filenames, non-PDF media,
empty content, a body over 50 MB, and content without a `%PDF-` signature. It
calculates SHA-256 locally and writes the canonical
`papers/<paper-id>/source/original.pdf`, `source.json`, and paper metadata as a
recoverable logical transaction. A pre-import backup is retained for
replacement or recovery. `replace=false` rejects an existing source rather
than silently overwriting it.

The import response returns `source`, the updated `paper`, `paper_revision`,
and `recovery_backup_id`; it never returns an absolute local path, PDF bytes,
session token, installation secret, or API key. A source read returns `404`
when no complete source exists and a validation error when the sidecar or PDF
hash/size is corrupted. This is local source registration only: there is no
viewer, parsing, OCR, extraction, search, AI, download, DOI lookup or
institutional-access operation.

## Task 4B Local PDF Text Extraction

Task 4B adds one paper-scoped contract over the registered Task 4A source:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/text-extraction` | Read `not_run`, `completed` or `stale` extraction summary |
| `POST` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/text-extraction?expected_revision=<paper-revision>&reextract=false` | Explicitly extract or explicitly re-extract local PDF text |

Both routes require the same loopback, exact-Origin, paired-session and
project/paper association checks as source registration. The POST operation
requires an imported source, validates the expected paper revision, parses with
`pypdf 6.14.2`, enforces 500 pages and 5,000,000 characters, and commits the
`m4b.v1` JSON artifact plus `full.txt` through a recoverable transaction. An
existing result requires `reextract=true`; a source checksum change is reported
as `stale` until the user chooses re-extraction.

The response contains validated metadata, counts, warnings, source/full-text
hashes and a preview capped at 1,200 characters. It never returns page arrays,
full text, absolute paths, PDF bytes, credentials, API keys or session secrets.
Missing papers and missing PDF sources return `404`; malformed or incomplete
durable artifacts return a validation error. Extraction failures preserve the
prior valid result and do not write a failed partial artifact.

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
- `413` when a PDF import exceeds the bounded 50 MB request limit;
- `415` when a PDF import does not use `application/pdf`;
- `409` with `detail.code: "workspace_conflict"` when a supplied record or workspace revision is stale;
- `409` with `detail.code: "workspace_busy"` when a bounded revision scan cannot observe a stable durable file set; retry without changing the workspace;
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

## Task 3F Notes

Notes reuse the authenticated generic record API; no note-specific endpoint or
new authentication path exists:

- `GET /api/v1/workspaces/{workspace_id}/records/notes?project_id=<id>&scope_type=project`
  lists project notes.
- `GET /api/v1/workspaces/{workspace_id}/records/notes?project_id=<id>&scope_type=paper&paper_id=<id>`
  lists paper notes for one paper.
- `GET /api/v1/workspaces/{workspace_id}/records/notes/{note_id}` reads one
  note and returns its content revision and safe relative path.
- `PUT /api/v1/workspaces/{workspace_id}/records/notes/{note_id}` accepts
  `{record, parent_id, expected_revision?}` and writes a schema-validated
  `m3f.v1` note atomically.

Every notes list request must provide `project_id`; the companion rejects an
unscoped notes enumeration. `scope_type=paper` may omit `paper_id` when the
caller needs the complete paper-note count for that already selected project.

The server performs the scope filter and association checks. Project notes use
`parent_id == project_id`; paper notes use `parent_id == paper_id`, and the
paper's persisted project must equal the note's `project_id`. Scope and parent
identity are immutable after creation. The durable paths are
`projects/<project-id>/notes/<note-id>.json` and
`papers/<paper-id>/notes/<note-id>.json`. A stale revision returns `409`; the
current note remains unchanged and the frontend must explicitly reload the
latest revision or retry preserved edits. Note titles and bodies are plain
text and extra fields are rejected by `note.schema.json`.

## Task 4C Duplicate Detection

Duplicate reporting reuses the authenticated workspace session and does not
add a remote lookup or a paper-specific write endpoint:

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/api/v1/workspaces/{workspace_id}/duplicates` | Rebuild the bounded workspace-wide report |
| `GET` | `/api/v1/workspaces/{workspace_id}/duplicates/{group_fingerprint}` | Read one current evidence group |
| `POST` | `/api/v1/workspaces/{workspace_id}/duplicates/reviews` | Persist one explicit review state |

The report accepts optional server-side `project_id` and `paper_id` filters,
but computes evidence from the complete active workspace before filtering so a
project view can show cross-project evidence without allowing cross-workspace
access. It returns `report_schema_version: "m4c.v1"`, groups, bounded warning
strings and a summary. Groups are `exact_source`, `exact_identifier` or
`metadata_candidate`; each includes a group fingerprint, evidence fingerprint,
plain-language explanation and the owning project name. Exact-source details
expose only a short SHA-256 preview and original filenames, never a full path,
full hash or PDF bytes.

The review request is:

```json
{
  "group_fingerprint": "<64 hex characters>",
  "review_status": "reviewed_duplicate | reviewed_not_duplicate | ignored",
  "expected_revision": "<review revision, when updating>"
}
```

`reviewed_not_duplicate` is rejected for exact PDF evidence. A review is
validated against the current group fingerprint, active workspace ID, sorted
paper IDs and evidence fingerprint, then written atomically at
`feedback/duplicate-reviews/duplicate_review_<group-fingerprint>.json`. A
stale review revision returns `409`; a changed paper/source creates a new
group fingerprint. Reviews acknowledge or annotate evidence only: they never
merge, delete, hide or reassign paper records.

The companion skips malformed paper/project/source/review artifacts with a
bounded generic warning. Exact source evidence requires a complete canonical
source sidecar, matching PDF size and matching SHA-256. The analysis refuses a
workspace above the configured valid-paper bound with `413` and caps returned
groups and warnings. All duplicate routes retain loopback binding, exact
Origin enforcement, paired-session authentication, path confinement, schema
validation and secret redaction.

## Task 4D Paper Metadata

Task 4D reuses the authenticated generic paper record routes:

- `GET /api/v1/workspaces/{workspace_id}/records/papers?project_id=<id>` lists
  only validated papers assigned to the project;
- `GET /api/v1/workspaces/{workspace_id}/records/papers/{paper_id}` reads one
  paper and its revision;
- `PUT /api/v1/workspaces/{workspace_id}/records/papers/{paper_id}` accepts
  `{record, parent_id, expected_revision?}` and validates/normalizes
  `m4d.v1` metadata before the atomic write.

No paper-specific endpoint or remote lookup is added. The companion enforces
the project association, strict schema, bounded identifier/URL forms, exact
Origin, pairing/session authentication, path confinement and revision conflict
behavior. Completeness is derived by the clients and is not authoritative API
data. Source, extraction, notes and duplicate evidence continue to use their
separate records and routes.

## Task 5A AI Provider Foundation

Task 5A adds a device-local provider contract. These routes require an active
paired session and an exact configured `Origin`; they never use a workspace
path or workspace ID. The nonsecret settings file is outside the workspace at
the companion device-data root as `ai-provider-settings.json` and carries the
internal format version `task5a.v1`. It is atomically replaced and revision
checked. No workspace schema migration is required.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/ai/provider/config` | Read nonsecret provider configuration, credential presence/state, safe last-test summary and implemented provider capabilities |
| `PUT` | `/api/v1/ai/provider/config` | Save the strict OpenAI-compatible provider/model/timeout/retry/enabled configuration with optional `expected_revision` |
| `PUT` | `/api/v1/ai/provider/credential` | Store or replace a provider credential through the operating-system keychain; request body is never echoed |
| `DELETE` | `/api/v1/ai/provider/credential` | Remove the provider credential from the operating-system keychain |
| `POST` | `/api/v1/ai/provider/test` | Run one explicit bounded model-availability test using the stored keychain credential and current configuration |

The connection-test request contains no caller-supplied API key and no user or
research content. The production adapter sends only a fixed model-availability
request to `https://api.openai.com`; TLS certificate verification is enabled,
redirects are not followed and the standard-library proxy environment is
honoured. The test permits at most one bounded transient retry and has a total
deadline. Authentication, permission, model, timeout, network, rate-limit,
provider, cancellation and unexpected failures are returned only as bounded
categories and user-safe messages. Raw provider bodies, headers, URLs, stack
traces and credentials are never returned or persisted.

The response state is one of `unconfigured`,
`configured_without_credential`, `ready_untested`, `connection_verified`,
`connection_failed`, `credential_removed` or `configuration_invalid`.
Configuration and credential changes invalidate a prior verified result. A
keychain-unavailable state blocks storage and testing; the companion never
downgrades to plaintext. A test-only `/api/v1/ai/provider/test-scenario` route
returns `404` unless `RI_AI_TEST_MODE=1`; it is not available in normal
production mode and controls only the deterministic fake adapter used by the
HTTPS browser spike. The spike also starts the companion with
`RI_AI_TEST_CREDENTIAL_STORE=memory`, which selects an isolated process-local
credential store only when `RI_AI_TEST_MODE=1` is also present. This flag is
startup-only, is not accepted by provider API requests, never writes a
credential file and is not a production fallback.

`credential_removed` records explicit removal in the live companion runtime;
it is not durable provider state. A browser reload that reconnects to the same
companion retains `credential_removed`. A genuinely fresh runtime with the
persisted nonsecret configuration and no stored credential reports
`configured_without_credential`.

## Task 5B Synthetic Processing Framework

Task 5B adds a bounded, test-only processing surface under an already opened
workspace. Every route retains loopback binding, exact allowed-Origin checks,
paired short-lived bearer authentication, active-workspace lookup,
schema-backed writes, path confinement and atomic record transactions.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/workspaces/{workspace_id}/ai/processing/operations` | List the code-owned synthetic operation metadata |
| `GET` | `/api/v1/workspaces/{workspace_id}/ai/processing/prompts` | List safe prompt identity/version/fingerprint metadata; template bodies are never returned |
| `POST` | `/api/v1/workspaces/{workspace_id}/ai/processing/start` | Start `provider_echo_test` for one bounded synthetic input version |
| `GET` | `/api/v1/workspaces/{workspace_id}/ai/processing/records` | List validated processing history for the opened workspace |
| `GET` | `/api/v1/workspaces/{workspace_id}/ai/processing/records/{processing_id}` | Read one record and its revision |
| `POST` | `/api/v1/workspaces/{workspace_id}/ai/processing/records/{processing_id}/cancel` | Explicitly cancel queued/running work |
| `POST` | `/api/v1/workspaces/{workspace_id}/ai/processing/records/{processing_id}/retry` | Explicitly retry a failed/cancelled event within the bounded limit |
| `POST` | `/api/v1/workspaces/{workspace_id}/ai/processing/records/{processing_id}/invalidate` | Explicitly invalidate a completed cache entry |
| `GET` | `/api/v1/workspaces/{workspace_id}/ai/processing/records/{processing_id}/provenance` | Read the safe provenance subset for one event |

These routes return `404` unless the companion was started with explicit
`RI_AI_TEST_MODE=1`. The synthetic scenario control
`POST /api/v1/ai/processing/test-scenario` is also test-mode-only and accepts
only the fixed scenarios used by the local browser spike. It is not a
production operation selector, free-prompt endpoint or provider bypass.

The start request is `{ "synthetic_input_version": "v1" }`; it cannot supply
an operation ID, prompt body, model, cache key, fingerprint, credential or
path. Cache keys are derived from operation, prompt/version, source snapshot,
provider/model, bounded parameters and output contract. A cache hit returns a
new completed event with `original_processing_id`. A stale, invalidated,
failed, cancelled or unavailable event is never reused. A second caller for an
active cache key receives the existing active event rather than starting a
second provider request.

Errors use stable codes including `processing_unavailable`,
`provider_not_ready`, `invalid_output`, `retry_limit`, `invalid_state` and
`workspace_conflict`. No response includes a credential, raw prompt,
provider response, absolute path, session token or hidden model reasoning.

## Task 5C Explicit Paper Summary

Task 5C reuses the authenticated processing record API boundary for one
explicit paper operation. The routes below require the same loopback binding,
exact configured Origin, paired session and opened workspace as the other
workspace routes. The server verifies that the project and paper belong to the
opened workspace before preparing or reading any record.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/preflight` | Report whether a summary can be requested, with safe source counts, metadata field names, provider/model and cache availability |
| `POST` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/start` | Start an explicitly confirmed `paper_summary` request, optionally with `expected_paper_revision` |
| `GET` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/records` | List paper-scoped summary history |
| `GET` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/records/{processing_id}` | Read one scoped summary record |
| `POST` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/records/{processing_id}/cancel` | Cancel queued/running summary work |
| `POST` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/records/{processing_id}/retry` | Retry a failed or cancelled summary within the bounded limit |
| `POST` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/records/{processing_id}/invalidate` | Mark a completed summary unavailable for cache reuse while retaining history |

Preflight returns no extracted text. It exposes source type, source checksum,
extraction ID/status, bounded page and character counts, truncation state,
allowlisted metadata field names, provider/model and cache state. The start
request accepts no prompt, source text, path, credential or provider choice.
The companion prepares the source, renders the immutable `paper.summary`
prompt and validates the `paper-summary.v1` output before saving it in the
existing `activity/processing/<processing-id>.json` record.

A changed paper revision returns `409` and does not start a decision. A source
snapshot change marks prior summaries stale. Only a completed, valid,
non-stale and non-invalidated event is reusable; a cache hit creates a new
history event. Failed output, cancellation, retry and invalidation retain
bounded status and error history. Responses contain no raw source, notes,
profiles, paths, credentials, provider bodies or private reasoning.
