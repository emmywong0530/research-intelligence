# AGENTS.md

## Project purpose

Research Intelligence is a desktop-first, local-first literature discovery, reading and synthesis platform.

## Mandatory reading

Before implementation or review, read the task-relevant documents under `/docs`,
including accepted ADRs under `/docs/adr` and the relevant feature, migration,
or review playbook under `/codex-skills`.

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

## Engineering governance

- Read accepted ADRs before making architecture changes.
- Use `docs/feature-status-model.md`; never describe mock behavior as fully implemented.
- Update `docs/traceability-matrix.md` in every feature PR.
- Implement bounded vertical slices, not disconnected UI and API fragments.
- Use the feature, review, and migration playbooks under `codex-skills/` as appropriate.
- Run an integration checkpoint after every two milestones, after durable migrations,
  after security or storage changes, and before release hardening.
- Do not mark end-to-end behavior verified without an executable full-path test or
  recorded spike.
- Use `docs/templates/implementation-report.md` for completion reports.
- Use `docs/templates/review-report.md` for review reports.
