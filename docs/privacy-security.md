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

Workspace metadata and every schema-backed durable JSON record are validated before writing. Failed writes leave the previous valid file in place. Existing-record updates require the content revision returned by a prior read; stale writes return a conflict instead of overwriting newer data.

## Durable and Device-Local Data

Projects, papers, PDFs, notes, metadata, analyses, reading progress, syntheses, gaps, feedback, and activity are user-owned workspace data. They remain normal files and may sync through a user-controlled folder service.

The companion's rebuildable SQLite registry lives in the operating-system application-data directory outside the workspace. It contains local workspace registration metadata only. It is not placed under the workspace, copied into backups, exposed as a durable record, or treated as a sync source. Full-text, vector, and queue indexes are not implemented in Task 2.

## Secrets

Users bring their own AI keys. Secrets must be stored in the operating-system keychain through the local companion. The PWA never receives or exposes keychain values.

The per-installation companion secret is generated with cryptographically secure randomness, stored through `keyring`, verified by read-back, and never returned by an API response. It is never written to a workspace, browser storage, logs, source control, or packaged artifacts. If keychain access fails, the companion reports `keychain_unavailable`; it does not silently downgrade to plaintext files, workspace files, browser storage, logs, or environment-variable fallbacks.

## Pairing and Sessions

The browser receives a pairing ID but not the approval code. The local companion independently displays the code. Pairing attempts expire, are single-use, reject replay, and are deleted after the failed-attempt limit. Short-lived session tokens remain in companion memory and PWA component state only; companion restart invalidates them.

## Backups and Conflicts

Backups are timestamped under the user workspace. Existing-record writes create a pre-write snapshot and restore creates a pre-restore recovery snapshot. Restore requires the current aggregate workspace revision, so newer durable state is not silently overwritten. No semantic merge is attempted in Task 2, and no automatic backup deletion policy exists yet.

## Institutional Access and Outbound Processing

The platform may assist with institutional browser access and local PDF attachment, but it never stores institutional usernames, passwords, MFA codes, publisher session cookies, or publisher tokens. AI processing remains out of scope for Task 2. Future AI-derived records must preserve source hashes, scope, provider/model, prompt version, source locations, user edits, and verification state.
