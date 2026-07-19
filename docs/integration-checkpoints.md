# Integration Checkpoints

Run after Task 2, every two later milestones, every durable migration,
security/storage changes, and before release hardening. Do not use a configured
workflow, unit-test-only path, mock fetch, or screenshot as a substitute for a
full-path result.

## Core checkpoint
1. Run packaged companion.
2. Open PWA from intended static origin.
3. Confirm loopback-only connectivity.
4. Pair through companion-owned approval.
5. Create workspace.
6. Restart frontend and companion.
7. Open workspace.
8. Create and reload one valid record.
9. Reject one invalid record.
10. Trigger stale-revision conflict.
11. Create backup.
12. Restore into safe test workspace.
13. Confirm no secrets in browser storage, workspace, logs, or API responses.
14. Confirm device-local indexes are outside workspace.
15. Run accessibility and containment checks.

Record results under `docs/integration-results/YYYY-MM-DD-milestone.md` with
environment, commit, commands, pass/fail evidence for every step, artifacts,
limitations, and follow-ups. Use the required fields in
[`docs/integration-results/README.md`](integration-results/README.md).

Use only disposable fixtures or an explicitly empty test workspace. Never
commit real user workspaces, API keys, credentials, private papers, unpublished
material, pairing/session secrets, or device-local indexes.
