# Task 0 Local API Contract

All Task 0 local API responses include `schema_version: "task0.v1"` and are defined by Pydantic response models in `companion/src/research_intelligence_companion/models.py`.

## Public Spike Endpoints

- `GET /api/v1/health`
- `GET /api/v1/capabilities`
- `POST /api/v1/pairing/start`
- `POST /api/v1/pairing/complete`
- `GET /api/v1/installation-secret/status`

## Production Origin

The intended GitHub Pages deployment for `emmywong0530/research-intelligence` is configured as this exact allowed origin:

```text
https://emmywong0530.github.io
```

GitHub Pages serves the project under `/research-intelligence/`, but browser CORS uses the scheme, host, and port only. The path is not part of the `Origin` header.

Allowed origins are configured by `RI_ALLOWED_ORIGINS` or the companion default allowlist. Wildcards are not permitted.

## Pairing Payloads

`POST /api/v1/pairing/start` returns:

```json
{
  "schema_version": "task0.v1",
  "pairing_id": "opaque-id",
  "expires_at": "2026-07-18T23:00:00Z",
  "approval_required": true,
  "max_failed_attempts": 5
}
```

The start response must not include `pairing_code`, `approval_code`, session tokens, keychain values, or the per-installation secret. The approval code is displayed by the companion-owned console mechanism for Task 0.

`POST /api/v1/pairing/complete` accepts:

```json
{
  "pairing_id": "opaque-id",
  "approval_code": "123456"
}
```

Successful completion returns a short-lived bearer session token. Pairing attempts expire after five minutes, are single-use, reject replay, and are invalidated after five failed approval-code attempts. Task 0 session tokens are in-memory only and are invalid after companion restart.

## Installation Secret Status

`GET /api/v1/installation-secret/status` reports whether the per-installation secret is available through the OS keychain:

```json
{
  "schema_version": "task0.v1",
  "backend": "KeyringBackendName",
  "available": true,
  "created": false,
  "error": null
}
```

When the keychain is unavailable, `available` is `false` and `error` is `keychain_unavailable`. The endpoint never returns the secret itself.

## Authenticated Spike Endpoints

The following endpoints require a bearer session token returned by the pairing flow:

- `GET /api/v1/authenticated-test`
- `POST /api/v1/spikes/keychain-test`
- `POST /api/v1/workspaces/open`
- `POST /api/v1/workspaces/resolve`
- `POST /api/v1/spikes/atomic-write-test`

## Security Constraints

- The companion binds only to loopback.
- Browser-facing endpoints require a configured `Origin` header.
- Requests with an `Origin` header must match configured allowed origins exactly.
- Originless browser-facing pairing requests are rejected unless a future trusted-local-client authentication mechanism is implemented.
- Keychain values are never returned by API responses.
- The per-installation secret is generated with cryptographically secure randomness and stored only through the OS keychain.
- Keychain failure reports an explicit error state and does not downgrade to plaintext storage.
- Workspace paths must be relative to the selected workspace root.
- Atomic write spike payloads require `schema_version`.
