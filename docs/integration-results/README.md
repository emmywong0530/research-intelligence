# Integration Results

Record an integration result when a checkpoint is required: after Task 2,
after every two later milestones, after a durable migration, after security or
storage changes, and before release hardening. Use the checklist in
[`docs/integration-checkpoints.md`](../integration-checkpoints.md).

## Filename

Use the format `YYYY-MM-DD-milestone.md`. Use a short lowercase milestone
identifier, for example `2026-07-19-task-2.md`. Do not overwrite an earlier
result; add a new dated record for a rerun.

## Required record

Every result must include:

- repository, branch, commit SHA, date, operator, and host/platform;
- runtime and dependency versions, including browser and companion versions;
- whether the run used local files, a fixture workspace, or a disposable test workspace;
- exact commands and their exit results;
- pass/fail evidence for every checkpoint step;
- links to logs, screenshots, traces, packaged artifacts, or other retained evidence;
- feature-completeness states supported by the evidence;
- behavior that was not run, could not run, or is only configured for GitHub Actions;
- merge blockers, follow-up improvements, and accepted limitations.

Do not call a capability end-to-end verified from unit tests, mocked fetches,
screenshots, or a configured workflow alone. Record the missing executable
full-path evidence explicitly. Distinguish local results from GitHub Actions
results and include the workflow/job URL or run identifier when CI evidence is
available.

## Privacy boundary

Never commit a real user workspace, API key, credential, keychain value,
session or pairing secret, private paper, unpublished material, institutional
access data, or logs containing any of these. Use disposable fixtures and
redacted evidence. Keep device-local SQLite, FTS, cache, vector, and queue
indexes outside the workspace and out of this directory.
