# Task 0 Security Assumptions

Task 0 validates only the architectural assumptions named in the bootstrap task.

## Assumptions Under Test

- The PWA can communicate with a local companion while remaining static-host compatible.
- The companion can bind only to loopback and reject remote-interface hosts.
- API requests from browser contexts can be restricted by an explicit allowed-origin list.
- The intended GitHub Pages deployment for `emmywong0530/research-intelligence` uses exact origin `https://emmywong0530.github.io`; `/research-intelligence/` is a path and is not included in the `Origin` header.
- Pairing can create a short-lived authenticated session without exposing keychain values or browser-side approval secrets.
- Keychain values can be written, read, and deleted through the operating-system keychain interface.
- A per-installation secret can be generated with cryptographically secure randomness and stored only through the operating-system keychain.
- Workspace file writes can use atomic temporary-file plus rename behavior.
- Workspace paths can be resolved relative to the selected workspace root and reject traversal.

## Origin Policy

Browser-facing Task 0 endpoints require an explicit configured `Origin` header. Pairing endpoints reject missing `Origin` headers because Task 0 has not implemented a separate trusted-local-client authentication mechanism for originless clients.

Configured origins are exact strings. There are no wildcard origins. The default companion configuration includes:

```text
https://emmywong0530.github.io
https://127.0.0.1:4443
http://127.0.0.1:5173
http://localhost:5173
http://127.0.0.1:4173
http://localhost:4173
```

`RI_ALLOWED_ORIGINS` may override this list with a comma-separated explicit allowlist.

## Per-Installation Secret

The per-installation secret is generated with Python `secrets.token_urlsafe(48)`, stored with `keyring`, and verified by reading it back from the OS keychain. The companion exposes only `/api/v1/installation-secret/status`, which reports availability, backend name, whether the secret was newly created, and a stable error code.

The secret is never returned by API responses, never written to the workspace, never stored in browser localStorage or sessionStorage, and must not appear in logs or packaged artifacts.

If keychain access fails, the companion reports `keychain_unavailable`. Task 0 does not silently downgrade to plaintext files, environment variables, workspace files, or browser storage.

## Pairing Policy

The browser may receive a `pairing_id`, but it must not receive the approval code in the pairing-start response. The companion displays the approval code through a companion-owned console message for Task 0. This is intentionally minimal and is not the final production approval UI.

Pairing attempts expire after five minutes, allow at most five failed approval-code attempts, are single-use, and cannot be replayed after success or expiry. Session tokens are in memory only and are invalid after companion restart.

## Out of Scope

Task 0 does not implement production AI processing, OpenAlex discovery, PDF processing, reading quests, synthesis, research-gap tracking, analytics, a central backend, or a cloud database.
