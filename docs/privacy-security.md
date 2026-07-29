# Privacy and Security

Research Intelligence is local-first and privacy-preserving by design. GitHub contains application source code, not user research data.

## Non-Negotiable Rules

- No central user database.
- No user research data in GitHub.
- No API key in browser storage, workspace files, logs, or source control.
- The companion binds only to loopback.
- Durable workspace data uses normal files and atomic writes.
- Device-local indexes and registries are rebuildable and are not the durable source of truth.
- Institutional credentials are never stored.
- Do not bypass paywalls.
- AI-derived records require provenance.
- Do not silently process unpublished material externally.
- No analytics by default.

## Workspace Access

The frontend can request create/open, metadata, health, approved record, backup, restore, and conflict operations only after pairing. It cannot submit arbitrary workspace filenames or unrestricted filesystem paths for reading or writing. The companion allowlists collections, validates stable IDs, resolves symlinks, rejects traversal and absolute child paths, and rejects symlink targets outside the selected workspace root.

Workspace metadata and every schema-backed durable JSON record are validated before writing. Failed writes leave the previous valid file in place. Existing-record updates require the content revision returned by a prior read; stale writes return a conflict instead of overwriting newer data. Record and metadata index changes use one recoverable journal, so a failure cannot leave an orphaned record or an index pointing to a missing record.

## Durable and Device-Local Data

Projects, papers, PDFs, notes, metadata, analyses, reading progress, syntheses, gaps, feedback, and activity are user-owned workspace data. They remain normal files and may sync through a user-controlled folder service.

The companion's rebuildable SQLite registry lives in the operating-system application-data directory outside the workspace. It contains local workspace registration metadata and a local `workspace.json` file identity only. It is not placed under the workspace, copied into backups, exposed as a durable record, or treated as a sync source. A moved workspace updates the path mapping when the prior path disappears or its local file identity matches; a copied duplicate ID with the original copy still present is rejected with a collision warning. Full-text, vector, and queue indexes are not implemented in Task 2.

Task 4A stores an explicitly selected PDF as user-owned workspace data at
`papers/<paper-id>/source/original.pdf` with a schema-validated
`source.json` sidecar. The browser streams bytes to the loopback companion and
never sends an arbitrary host path. The companion enforces the active
workspace/project/paper association, a bounded size, a sanitized filename,
PDF signature, atomic replacement and a sidecar SHA-256/size check. No PDF
bytes or drafts enter localStorage, sessionStorage, IndexedDB, cookies, logs,
the device registry, or source control. Task 4A does not parse or send PDFs to
remote services.

Task 4B parses only a PDF already registered inside the active workspace. The
companion uses the pinned `pypdf 6.14.2` parser locally, enforces 500-page and
5,000,000-character limits, checks the source SHA-256 before and after parsing,
and writes extraction artifacts through the recoverable atomic journal. Full
text is never returned by the API, logged, placed in browser storage or copied
to the device-local registry. The PWA receives only validated counts, warnings,
the source checksum and a bounded preview. Encrypted or malformed PDFs fail
without a partial artifact; image-only pages report no text and do not claim
OCR.

## Secrets

Users bring their own AI keys. Secrets must be stored in the operating-system keychain through the local companion. The PWA never receives or exposes keychain values.

The per-installation companion secret is generated with cryptographically secure randomness, stored through `keyring`, verified by read-back, and never returned by an API response. It is never written to a workspace, browser storage, logs, source control, or packaged artifacts. If keychain access fails, the companion reports `keychain_unavailable`; it does not silently downgrade to plaintext files, workspace files, browser storage, logs, or environment-variable fallbacks.

PDF source metadata contains only user-selected filename and local file facts
(relative path, byte size, SHA-256 and timestamps). It must not contain API
keys, session tokens, credentials, hidden prompts or private model reasoning.

## Pairing and Sessions

The browser receives a pairing ID but not the approval code. The local companion independently displays the code. Pairing attempts expire, are single-use, reject replay, and are deleted after the failed-attempt limit. Short-lived session tokens remain in companion memory and PWA component state only; companion restart invalidates them.

## Backups and Conflicts

Backups are timestamped under the user workspace and each file is hash-verified. Existing-record writes create a pre-write snapshot and restore creates and verifies a pre-restore recovery snapshot. Restore stages all validated files and uses a recoverable journal; restart rolls back any uncommitted restore and retains the recovery backup. Restore requires the current aggregate workspace revision, so newer durable state is not silently overwritten. No semantic merge is attempted in Task 2, and no automatic backup deletion policy exists yet.

## Institutional Access and Outbound Processing

The platform may assist with institutional browser access and local PDF attachment, but it never stores institutional usernames, passwords, MFA codes, publisher session cookies, or publisher tokens. AI processing remains out of scope for Task 2. Future AI-derived records must preserve source hashes, scope, provider/model, prompt version, source locations, user edits, and verification state.
