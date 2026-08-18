# AI Processing Operation Contract

Status: accepted engineering contract for M5B and later local AI operations.

This document is the implementation gate for any research-content AI operation.
Task 5C currently provides one deterministic, explicitly confirmed paper
summary. It does not make automatic learning, batch work, chat, search,
embeddings, synthesis or production readiness available.

Any new research-content AI operation **MUST** satisfy the invariants and
checklist below before it can be described as `End-to-end verified`.

## Lifecycle Map

The companion owns the following lifecycle. The browser supplies intent and
renders returned state; it is never the authority for scope, applicability,
cache validity or lineage.

| Stage | Authority and boundary | Durable/error rule |
|---|---|---|
| 1. Request scope and authorization | Authenticated loopback route; exact Origin and short-lived session | Reject before content reads; safe 401/403 |
| 2. Workspace, project and paper ownership | `resolve_paper_processing_scope()` | Workspace root, project record and paper parent association are proven before return |
| 3. Caller revision | Operation entry point and final pre-record guard | Caller revision mismatch is 409; no provider call or record |
| 4. Immutable source snapshot | Server-built `PaperSummarySource` plus bounded re-read of extraction/source identities | Mixed revisions become a bounded busy/conflict result |
| 5. Source allowlist | Operation-specific source builder | Only approved fields and extraction content enter the prompt |
| 6. Source budget | Central constants in `paper_summary.py`; prompt registry budget | Over-limit data is rejected or deterministically truncated before provider use |
| 7. Prompt rendering | Code-owned `PromptTemplate.render()` | No free prompt; variables and rendered size are checked before formatting |
| 8. Provider configuration | Device-local settings store and `ProviderRuntime` | Missing, disabled, malformed and unsupported config are safe states |
| 9. User confirmation | Paper page confirmation boundary | No content request and no processing record before confirmation |
| 10. Durable record creation | `write_record()` followed by `_commit_and_schedule()` | The queued record is the scheduling commit point; scheduling failure becomes a durable safe failure |
| 11. Active deduplication | Engine process-local active map plus durable record state | One queued/running event per cache key; terminal events do not block new work |
| 12. Cache lookup and lineage | `cache_candidate_is_usable()` and lineage resolver | Only completed, current, valid output with a provable non-invalidated lineage is reusable |
| 13. External provider request | Fixed OpenAI-compatible adapter | Fixed HTTPS destination, bounded timeout, bounded retry and bounded request |
| 14. Response size | Adapter bounded read of `MAX_PROVIDER_RESPONSE_BYTES + 1` | Oversized body is rejected before JSON parsing |
| 15. Output parsing and validation | Adapter parses JSON; operation validates its output contract | Invalid output becomes a safe failed record; raw provider payload is not persisted |
| 16. Cancellation | Engine event plus revision-aware terminal write | A late provider result cannot replace a durable cancelled state |
| 17. Retry | Explicit route/action with bounded attempt count | Retry creates a new linked event and preserves history |
| 18. Invalidation | Explicit action and lineage policy | Output remains auditable but the complete lineage is not reusable |
| 19. Stale applicability | Source snapshot fingerprint and stale marking | Changed result-affecting source cannot be presented as current or reused |
| 20. Persistence and restart | Workspace-open recovery | Abandoned queued/running records become interrupted failures; they never resume silently |
| 21. History and exact retrieval | Server-side scope check for list and exact summary routes | Bounded history and no cross-paper/project enumeration |
| 22. Frontend interpretation | React state renders companion fields | Generation guards prevent stale async responses from replacing newer state |
| 23. Provenance and fingerprints | Domain-separated canonical fingerprints | Fingerprints cover the actual bounded normalized input and safe result identity |
| 24. Errors, logging and privacy | Stable processing/provider taxonomy and safe messages | No raw source, provider body, credential, path or private reasoning crosses the boundary |

## Universal Invariants

| ID | Invariant | Current enforcement | Classification |
|---|---|---|---|
| A | Workspace -> project -> paper scope is established before any paper processing read or response | `resolve_paper_processing_scope()` is used by source preparation, summary list and exact routes; start/retry use the same engine path | Centrally enforced for paper routes; synthetic processing is intentionally workspace-scoped |
| B | A request for paper revision `R` uses a consistent bounded snapshot or returns a conflict; it never silently upgrades to `R+1` | Caller checks, source paper re-read, extraction/source re-read and final pre-record revision check | Centrally enforced for Task 5C; future operations must reuse the same pattern |
| C | Untrusted data is bounded before expensive processing | Schema/Pydantic fields, source budgets, prompt preflight, provider request/response limits, output validation and bounded history | Centrally enforced for current entry points; a future binary/body endpoint must add its own pre-read cap |
| D | Fingerprints describe exactly the bounded normalized input used | Prepared-text fingerprint and cache key use the server-built bounded source; prompt/provider parameters are included | Centrally enforced for current operations |
| E | Cache eligibility follows one complete lineage policy | `cache_candidate_is_usable()` and shared lineage resolver are used by synthetic and paper operations | Centrally enforced |
| F | Provider I/O is fixed, bounded and sanitized | Adapter fixed HTTPS origin, timeout, one bounded transient retry, bounded request/response and safe error mapping | Centrally enforced for the production adapter; real provider execution remains unverified |
| G | Provider configuration failures are normal safe states | Settings read-size bound, preflight mapping and runtime generation mapping | Centrally enforced for Task 5 routes |
| H | Durable record creation has a precise commit point and scheduling failure is recoverable | Atomic record write is followed by the shared scheduling guard; workspace reopen recovers abandoned work | Centrally enforced for current engine |
| I | Backend owns truth; frontend renders returned state | Companion-owned applicability/cache fields, scoped responses, frontend generation/poll guards and bounded response reader | Centrally enforced for current UI; future operations must not rebuild policy in the browser |
| J | Expected processing errors have stable bounded codes/messages | `ProcessingError`, `ProviderGenerationError`, `PaperSummarySourceError`, route mapping and strict durable error schema | Centrally enforced for current operations; new operation codes require schema/API/test review |

## Resource Budget

Limits are character counts unless stated otherwise. A lower source-specific
limit remains in force even when a later envelope has a larger limit.

| Boundary | Limit | Enforcement |
|---|---:|---|
| Synthetic input version | 40 characters | Pydantic request model and prompt registry |
| Paper title | 500 characters | Summary source allowlist |
| Paper abstract | 3,000 characters | Summary source allowlist |
| Other short metadata fields | 300 characters | Summary source allowlist |
| Authors | 100 items, 300 characters/item, 1,200 combined | Summary source allowlist |
| Keywords | 100 items, 120 characters/item, 300 combined | Summary source allowlist |
| Identifiers | 256 characters/item, 600 combined | Summary source allowlist |
| Metadata rendering | 8,000 characters | Summary source builder |
| Extracted pages | 60 pages and 48,000 text characters | Summary source builder |
| Combined bounded summary source | 56,000 characters | Summary source builder |
| Rendered summary prompt | 62,000 characters | Prompt registry before and after formatting |
| Provider request envelope | 128 KiB | Production adapter before request |
| Provider message | 64,000 characters/message | Production adapter |
| Provider response body | 64 KiB, read with one-byte overflow check | Production adapter before JSON parsing |
| Browser companion JSON response | 2 MiB, content-length checked and streamed with one-byte overflow check | `apps/web/src/companionClient.ts` before JSON parsing |
| Summary output | 12,000 summary characters; bounded list counts/items | Output validator and `paper-summary.v1` schema |
| Provider usage | 200,000 input and 4,096 output tokens | Adapter and durable schema |
| Returned processing history | 200 records | Processing engine; it fails closed rather than silently truncating |
| Provider transient retries | At most 1 under a total deadline | Provider adapter and settings validation |
| Processing retry attempts | At most 3 linked attempts | Durable processing record and engine |

FastAPI request models bound current JSON operation fields. A future operation
accepting arbitrary text or binary data MUST add a route-level content-length
and streaming limit before request materialization; it may not rely only on a
later schema validator.

## Cache and Commit Rules

The cache candidate must be completed, non-stale, non-invalidated, have a
validated output, match the full cache key and have a complete lineage. A
missing or cyclic parent chain fails closed. Cache hits are new durable events
linked to their source event. Invalidation preserves every record but blocks
the whole reusable lineage. Restart recovery treats queued/running records as
interrupted and never resumes provider work automatically.

The processing record's atomic workspace write is the commit point. Before it,
scope, revision, source, prompt, provider configuration and cache checks must
complete without a provider call or history event. After it, scheduling failure
is converted into a durable terminal error where possible; normal execution
transitions are revision-aware and cancellation wins over a late result.

## Error Contract

Expected errors use a stable code, safe message, HTTP status and retry meaning:

| Code family | Typical status | Retry guidance | Durable record |
|---|---:|---|---|
| `project_missing`, `paper_missing`, `project_mismatch`, `record_scope_mismatch` | 403/404 | Correct scope; do not retry unchanged | No new record |
| `stale_revision`, `paper_unavailable`, source busy | 409 | Reload current paper and explicitly retry | No new record before commit |
| `source_invalid`, `source_insufficient`, `extraction_required` | 400/409 | Correct or rerun local extraction | No new record before commit |
| `provider_not_ready`, `provider_configuration_invalid`, `prompt_unavailable` | 400/503 | Fix local configuration or code availability | No new record before commit |
| `authentication_failed`, `rate_limited`, `timeout`, `network_unavailable`, `provider_unavailable` | Durable operation failure | Retry only through explicit bounded action | Failed/cancelled record after commit |
| `invalid_output` | Durable operation failure | Inspect contract/provider and explicitly retry | Failed record after commit |
| `cancelled`, `invalid_state`, `retry_limit` | 400 or durable terminal state | Follow explicit state rules | Existing/new record as defined by action |

Unexpected exceptions are sanitized to `unexpected_provider_error`; raw
exception text, response bodies and source content are not returned or logged.

## Future-Operation Checklist

Before adding an M5D or later research-content operation, the implementation
and tests MUST demonstrate:

- [ ] authenticated loopback route, exact Origin, workspace/project/paper scope;
- [ ] immutable caller revision and a consistent source snapshot;
- [ ] outbound allowlist and documented source/resource budgets;
- [ ] explicit user confirmation before research content leaves the companion;
- [ ] exact bounded-input fingerprints and canonical cache key;
- [ ] atomic processing-record commit point and active-work deduplication;
- [ ] shared cache-lineage eligibility, invalidation and restart policy;
- [ ] bounded provider request, timeout, retries, response read and error body;
- [ ] strict output contract validation before completed persistence;
- [ ] stable error codes/status/safe messages and retryability tests;
- [ ] safe provenance without raw prompt, source, response, credential or path;
- [ ] cancellation, explicit retry, invalidation and late-result protection;
- [ ] restart/reopen behavior and durable history tests;
- [ ] frontend authority and out-of-order response tests;
- [ ] security/privacy, scope-isolation, size-bound and no-browser-storage tests;
- [ ] updated traceability rows, acceptance criteria and feature status;
- [ ] real browser-to-companion evidence, with local/CI/provider scope stated honestly.

Related decisions: [ADR 009](adr/009-ai-processing-foundation.md),
[ADR 010](adr/010-explicit-paper-summary.md),
[Task 5C acceptance tests](acceptance-tests.md#task-5c-explicit-paper-summary),
and [local API](local-api.md).
