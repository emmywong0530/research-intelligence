# Acceptance Tests

Acceptance tests must prove the behavior required by the current milestone. Do not claim a spike has passed unless it was actually run and verified.

## Task 0 Technical-Spike Tests

Task 0 must include automated tests for:

- remote-interface binding is disallowed;
- unauthenticated requests fail;
- invalid origin fails;
- valid paired session succeeds;
- secrets are never returned through API responses;
- workspace paths outside the selected root fail;
- interrupted writes do not corrupt the prior file;
- schema-version fields are required.

## Task 0 CI Expectations

Task 0 CI must cover:

- frontend lint, typecheck, test, and build;
- companion lint and test;
- schema validation;
- dependency audit;
- macOS and Windows packaging smoke jobs.

## Packaging Checks

Task 0 packaging work must include:

- PyInstaller specification or configuration;
- macOS build workflow;
- Windows build workflow;
- documented signing and notarisation placeholders;
- proof that build artifacts do not contain test secrets.

## Milestone Definition of Done

A milestone is complete only when:

- acceptance tests pass;
- no high-severity security issue remains;
- schemas and API docs are updated;
- unit and integration tests are included;
- desktop layouts keep content within panels;
- loading, empty, error, and disconnected states exist;
- no secret is written to workspace or browser storage;
- user-facing activity is understandable;
- changes are documented.
