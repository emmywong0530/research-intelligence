# Pairing Flow

Task 0 pairing is an explicit local-companion spike.

## Allowed Origins

The intended GitHub Pages deployment for `emmywong0530/research-intelligence` uses this exact browser origin:

```text
https://emmywong0530.github.io
```

The repository name, `/research-intelligence/`, is the GitHub Pages path, not part of the browser `Origin` header. Task 0 configures allowed origins through the companion `RI_ALLOWED_ORIGINS` environment variable or the default `DEFAULT_ALLOWED_ORIGINS` tuple in `companion/src/research_intelligence_companion/settings.py`. No wildcard origins are allowed.

Task 0 also includes `https://127.0.0.1:4443` as an explicit HTTPS static-host spike origin and local Vite development/preview origins.

## Browser Pairing

1. The PWA calls `POST /api/v1/pairing/start` with a configured `Origin` header.
2. The companion returns only `pairing_id`, expiry, `approval_required: true`, and the failed-attempt limit.
3. The companion independently displays the six-digit approval code in the local companion console.
4. The PWA shows the pairing screen and asks the user to enter the companion-displayed code.
5. The PWA calls `POST /api/v1/pairing/complete` with `pairing_id` and `approval_code`.
6. The companion returns a short-lived bearer session token.
7. Authenticated spike endpoints require `Authorization: Bearer <token>`.

The pairing-start response must not contain `pairing_code`, `approval_code`, session tokens, keychain values, or the per-installation secret.

## Replay and Expiry Rules

- Pairing attempts expire after five minutes.
- Pairing attempts are single-use and are deleted after successful completion.
- Five failed approval-code attempts invalidate the pairing attempt.
- Expired attempts are deleted on attempted completion.
- Session tokens are in-memory only for Task 0, expire after 15 minutes, and are invalid after companion restart.
- Browser-facing pairing endpoints reject requests with no `Origin` header.

The Task 0 frontend keeps the session token only in React component state. It does not write secrets or session tokens to localStorage or sessionStorage.
