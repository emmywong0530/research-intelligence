# AGENTS.md

## Project purpose

Research Intelligence is a desktop-first, local-first literature discovery, reading and synthesis platform.

## Mandatory reading

Before implementation, read the task-relevant documents under `/docs`.

## Non-negotiable rules

- No central user database.
- No user research data in GitHub.
- No API key in browser storage, workspace files, logs or source control.
- Companion binds only to loopback.
- Durable workspace data uses normal files and atomic writes.
- Device-local indexes are rebuildable and must not be treated as the durable source of truth.
- Institutional credentials are never stored.
- Do not bypass paywalls.
- AI-derived records require provenance.
- Different paper types require different extraction schemas.
- Desktop layout must keep text, vectors and controls within their panels.
- Do not silently change research-profile preferences.
- Do not silently process unpublished material externally.
- No analytics by default.

## Work style

- Implement one milestone at a time.
- Do not broaden scope without approval.
- Add tests with each feature.
- Update schemas and documentation with code changes.
- Report anything not actually tested.
- Prefer small, reviewable pull requests.
