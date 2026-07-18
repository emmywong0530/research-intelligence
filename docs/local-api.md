# Local API

The local API is exposed by the private companion running on the user's computer. It is versioned under `/api/v1`.

## Security Contract

The companion must:

- bind only to `127.0.0.1` and/or `::1`;
- reject remote network interfaces;
- use a per-installation secret;
- pair the PWA and companion explicitly;
- validate origin;
- require authenticated requests;
- use short-lived session tokens after pairing;
- validate all file paths against workspace roots;
- prevent path traversal;
- restrict outbound calls to configured providers and connectors;
- redact secrets from logs;
- never return API keys to the PWA;
- provide explicit health, version, and capability endpoints.

## Suggested API Groups

The approved build specification names these API groups:

```text
/api/v1/health
/api/v1/pairing
/api/v1/workspaces
/api/v1/projects
/api/v1/papers
/api/v1/discovery
/api/v1/reading
/api/v1/ai
/api/v1/synthesis
/api/v1/gaps
/api/v1/activity
/api/v1/settings
```

## Task 0 API Surface

Task 0 may create only the minimal API surface required for technical spikes:

- `/api/v1/health`;
- `/api/v1/capabilities`;
- pairing start/complete flow;
- installation secret status;
- authenticated test endpoint;
- strict allowed-origin configuration;
- versioned API response schema;
- secret write/read/delete test through `keyring`;
- workspace select/open endpoint;
- atomic JSON write test;
- path traversal protection.

Every API response must use an explicit schema and include useful errors rather than silent fallback.

## Task 0 Origin Configuration

The expected GitHub Pages deployment for `emmywong0530/research-intelligence` is allowed by exact origin:

```text
https://emmywong0530.github.io
```

The GitHub Pages project path is `/research-intelligence/`, but the path is not included in browser `Origin` headers. The companion stores allowed origins as exact strings through `RI_ALLOWED_ORIGINS` or `DEFAULT_ALLOWED_ORIGINS`; permissive wildcards are not allowed.

Browser-facing pairing endpoints reject requests with no `Origin` header in Task 0. Originless local clients require a future separate trusted-local-client authentication mechanism.

## Task 0 Pairing Contract

`POST /api/v1/pairing/start` returns `pairing_id`, expiry, `approval_required: true`, and `max_failed_attempts`. It does not return the approval code. The companion displays the approval code through a companion-owned console message for Task 0.

`POST /api/v1/pairing/complete` accepts `pairing_id` and `approval_code`. Pairing attempts expire, are single-use, reject replay, and are invalidated after the configured failed-attempt limit.

Task 0 session tokens are short-lived, stored only in PWA component state, and invalidated by companion restart because the Task 0 session store is in memory only.

## Task 0 Installation Secret

The per-installation secret is generated with cryptographically secure randomness, stored with the operating-system keychain through `keyring`, and verified by read-back. `/api/v1/installation-secret/status` reports availability and keychain backend status without returning the secret.

If keychain access fails, the companion reports `keychain_unavailable`; it does not write plaintext fallback files, workspace files, browser storage, or environment-variable fallbacks.
