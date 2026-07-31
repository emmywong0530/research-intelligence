# ADR 010: Explicit Paper Summary Boundary

- Status: Accepted
- Date: 2026-07-31
- Related: [ADR 001](001-local-first-pwa-companion.md), [ADR 003](003-loopback-pairing-security.md), [ADR 008](008-local-ai-provider-foundation.md), [ADR 009](009-ai-processing-foundation.md)

## Context

Task 5B established a durable, revision-aware processing lifecycle but
deliberately accepted only synthetic input. Task 5C needs one useful research
content operation without turning provider access into automatic processing,
hidden learning or an unrestricted prompt surface.

## Decision

Add exactly one explicit `paper_summary` operation. The companion prepares a
bounded source from the selected paper's validated local extraction and a
small allowlist of paper metadata. Notes, Research Profiles, project text,
filesystem paths, filenames, credentials and private provider reasoning are
excluded. Source preparation is deterministic, page-aware, length-bounded and
represented in durable records by hashes and safe counts rather than raw text.

The operation uses the existing `m5b.v1` processing record and transaction
journal. Its immutable prompt identity is `paper.summary` version `1.0.0` and
its strict output contract is `paper-summary.v1`. A request is started only
after the UI displays the source boundary and the user confirms. Completed
results are reusable only for the same source snapshot, prompt, provider,
model, parameters and contract. Metadata or extraction changes make the old
event stale; invalidation is explicit and history is retained.

The fake provider is deterministic and available only in explicit companion
test mode. The production adapter sends only the server-built prompt to the
fixed OpenAI-compatible HTTPS endpoint, requires a keychain credential and
accepts only the registered paper-summary operation. Output is schema
validated before persistence. Cancellation, bounded retry, stale revision
checks and workspace/project/paper scope reuse the Task 5B lifecycle.

## Consequences

The feature is transparent, reversible at the processing-record level through
invalidate and regenerate, and auditable without storing raw extracted text.
The summary is not generated on import, reload or paper selection. There is no
automatic feedback loop, batch job, search, embedding, classification,
structured extraction or claim of model quality. External provider execution,
platform keychain behavior and browser end-to-end status still require the
corresponding environment evidence.

No schema migration is required: `processing-record.schema.json` remains
`m5b.v1` and accepts the new operation through explicit conditional branches;
existing Task 5B echo records remain valid. The record path remains
`activity/processing/<processing-id>.json`.

## Verification

The strict schema validator, focused companion tests, focused frontend tests,
full local suites and Node syntax check cover the implementation. The real
HTTPS browser flow is implemented with disposable workspace/PDF setup and
cleanup in `finally`; it is promoted beyond local unverified status only when
Chromium actually runs the full flow.
