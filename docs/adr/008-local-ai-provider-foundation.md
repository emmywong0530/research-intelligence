# ADR 008: Local AI Provider Foundation

- Status: Accepted
- Date: 2026-07-30
- Related: [ADR 001](001-local-first-pwa-companion.md), [ADR 002](002-durable-files-rebuildable-indexes.md), [ADR 003](003-loopback-pairing-security.md), [ADR 005](005-paper-type-specific-extraction.md)

## Decision

Task 5A introduces a companion-side `ProviderAdapter` boundary. The initial
production adapter is a narrowly scoped OpenAI-compatible model-availability
check against the fixed HTTPS OpenAI API origin. It uses Python's standard
library HTTPS client, the default certificate verification context, no custom
provider URL, no raw response persistence and no provider SDK telemetry.

Nonsecret provider configuration is stored as a versioned, atomically replaced
JSON file in the device-local data root, outside every user workspace and
outside the rebuildable SQLite registry. The current local format is
`task5a.v1`; unsupported versions are rejected. The workspace schemas and
workspace migration chain are unchanged.

Provider credentials are stored only in the operating-system keychain under a
provider-scoped account. The companion exposes presence and bounded status,
never the credential. Replacement verifies the new value and attempts to
restore the previous value if the replacement cannot be verified. Keychain
failure is a blocked state; plaintext files, environment variables, browser
storage and logs are not fallbacks.

The provider runtime uses a narrow credential-store abstraction. The production
implementation delegates to the operating-system keychain. A process-local
in-memory implementation exists only for the HTTPS browser spike and requires
both `RI_AI_TEST_MODE=1` and `RI_AI_TEST_CREDENTIAL_STORE=memory` at companion
startup. AI test mode alone still uses the OS keychain, and no API or frontend
request can select the in-memory implementation.

Connection tests are explicit, authenticated and Origin-protected. They send
no project, paper, note, prompt or research content. The adapter maps provider
failures to bounded categories, allows no retry for authentication or invalid
configuration errors, and permits at most one bounded retry for transient
failures. A deterministic fake adapter is available only when the companion is
started with the explicit test-mode environment flag; it is not selectable in
normal production mode.

## Consequences

- Task 5A provides provider configuration and credential/connection lifecycle,
  not summaries, extraction, classification, search, embeddings or automatic
  proposal learning.
- Provider settings are device-local and do not sync with a workspace. A user
  must configure each device separately.
- The fixed provider origin avoids custom-endpoint SSRF and redirect policy in
  this milestone. Proxy environment behavior is delegated to the standard
  library opener and is documented as an operational dependency.
- Last connection-test results are memory-only and are invalidated after
  configuration, credential or companion restart changes.
- `credential_removed` is a live-runtime state after explicit removal. A
  browser reload does not restart the companion and therefore retains that
  state. A genuinely fresh runtime with the persisted nonsecret configuration
  and an absent credential reports `configured_without_credential`.
