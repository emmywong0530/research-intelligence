# Pairing Flow

Task 0 pairing is an explicit local-companion spike.

1. The PWA calls `POST /api/v1/pairing/start`.
2. The companion returns a `pairing_id`, a six-digit `pairing_code`, and an expiry timestamp.
3. The PWA shows the pairing screen.
4. The PWA calls `POST /api/v1/pairing/complete` with the pairing ID and code.
5. The companion returns a short-lived bearer session token.
6. Authenticated spike endpoints require `Authorization: Bearer <token>`.

The Task 0 frontend keeps the session token only in React component state. It does not write secrets or session tokens to localStorage or sessionStorage.
