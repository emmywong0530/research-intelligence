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
- authenticated test endpoint;
- strict allowed-origin configuration;
- versioned API response schema;
- secret write/read/delete test through `keyring`;
- workspace select/open endpoint;
- atomic JSON write test;
- path traversal protection.

Every API response must use an explicit schema and include useful errors rather than silent fallback.
