# Task 0 Local API Contract

All Task 0 local API responses include `schema_version: "task0.v1"` and are defined by Pydantic response models in `companion/src/research_intelligence_companion/models.py`.

## Public Spike Endpoints

- `GET /api/v1/health`
- `GET /api/v1/capabilities`
- `POST /api/v1/pairing/start`
- `POST /api/v1/pairing/complete`

## Authenticated Spike Endpoints

The following endpoints require a bearer session token returned by the pairing flow:

- `GET /api/v1/authenticated-test`
- `POST /api/v1/spikes/keychain-test`
- `POST /api/v1/workspaces/open`
- `POST /api/v1/workspaces/resolve`
- `POST /api/v1/spikes/atomic-write-test`

## Security Constraints

- The companion binds only to loopback.
- Requests with an `Origin` header must match configured allowed origins.
- Keychain values are never returned by API responses.
- Workspace paths must be relative to the selected workspace root.
- Atomic write spike payloads require `schema_version`.
