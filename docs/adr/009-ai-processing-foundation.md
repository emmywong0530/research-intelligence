# ADR 009: Bounded Local AI Processing Foundation

- Status: Accepted
- Date: 2026-07-31
- Related: [ADR 001](001-local-first-pwa-companion.md), [ADR 002](002-durable-files-rebuildable-indexes.md), [ADR 003](003-loopback-pairing-security.md), [ADR 004](004-schema-versioning-and-migrations.md), [ADR 008](008-local-ai-provider-foundation.md)

## Context

Task 5A established a local provider configuration and keychain boundary but
did not authorize processing of user research content. Task 5B needs a
testable foundation for prompt identity, bounded output, provenance,
fingerprinting, caching, cancellation and recovery without creating a hidden
learning pipeline or implying that later paper operations exist.

## Decision

Implement one code-owned immutable synthetic operation,
`provider_echo_test`, available only when the companion is explicitly started
in test mode. Its prompt template stays in companion source. The API exposes
safe operation and prompt metadata, never raw template text. The operation
accepts only a bounded synthetic input version and returns a fixed validated
acknowledgement through the Task 5A adapter boundary.

Persist each event as a strict `m5b.v1` JSON record at
`activity/processing/<processing-id>.json`. The record stores prompt/provider
identity, safe model parameters, source snapshot, domain-separated canonical
fingerprints, cache disposition, state, timestamps, bounded output, usage,
safe provenance and bounded error. It contains no credentials, raw prompts,
raw provider bodies, absolute paths, session tokens or private reasoning.

Only completed, valid, non-stale and non-invalidated events are reusable. A
cache hit creates a new event linked to the original. Source-version changes
mark older events stale. Cache invalidation is explicit. One active event is
allowed per cache key; concurrent callers reuse that active event. Cancellation
is persisted and a late result cannot replace a cancelled event. Retry is
explicit and bounded. Workspace open converts abandoned queued/running events
to an interrupted failure and does not resume them.

The existing authenticated generic workspace transaction machinery remains the
durable write boundary. No workspace metadata index field, device-local index,
cloud service or new migration is introduced. The UI is a bounded test panel
under Settings and disappears when the normal production companion does not
advertise the test-only operation.

## Consequences

This provides a real local processing lifecycle and durable audit trail while
keeping later research-content features unavailable. The fake operation does
not prove model quality, external provider availability or production AI
processing. The provider generation interface is typed but the production
OpenAI-compatible adapter intentionally reports generation unavailable until a
later approved milestone defines content scope and user controls.

The durable processing record is included in workspace backup snapshots. The
device-local provider settings, keychain entries and rebuildable indexes remain
outside the workspace. Future content-processing operations must add an
approved output contract, source scope, privacy review and traceability before
they can reuse this foundation.

## Verification

The implementation is covered by the strict schema validator, focused
companion processing tests, frontend processing-panel tests and the real
HTTPS static PWA loopback flow. A browser-capable environment is required
before the loopback flow can be promoted beyond its local status; Chromium
unavailability is reported honestly in the Task 5B results document.
