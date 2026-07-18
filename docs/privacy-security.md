# Privacy and Security

Research Intelligence is local-first and privacy-preserving by design. GitHub contains application source code, not user research data.

## Non-Negotiable Rules

- No central user database.
- No user research data in GitHub.
- No API key in browser storage, workspace files, logs, or source control.
- Companion binds only to loopback.
- Durable workspace data uses normal files and atomic writes.
- Device-local indexes are rebuildable and are not durable source of truth.
- Institutional credentials are never stored.
- Do not bypass paywalls.
- AI-derived records require provenance.
- Do not silently process unpublished material externally.
- No analytics by default.

## Secrets

Users bring their own AI keys. Secrets must be stored in the operating-system keychain through the local companion. The PWA must never receive or expose keychain values.

## Institutional Access

The platform may assist with institutional browser access and local PDF attachment, but it must never store institutional usernames, passwords, MFA codes, or publisher session cookies.

## Privacy Modes

Supported privacy modes are:

- Local only;
- Metadata and abstract only;
- Selected sections;
- Full paper;
- Exclude private notes;
- Confirm unpublished material;
- Preview outbound content.

The interface must always state when an external AI provider will receive paper content.

## File and Network Safety

The companion must validate all paths against the selected workspace root, prevent path traversal, and restrict outbound calls to configured providers and connectors.
