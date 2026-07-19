# Engineering Governance

## Purpose
Research Intelligence spans frontend, local API, companion, durable files, privacy, and recovery. Governance prevents these layers from drifting apart.

## Delivery unit
Every implementation PR must represent one bounded vertical slice: user behavior, typed frontend state, versioned API, companion implementation, durable-file behavior, schema validation, security checks, tests, documentation, and traceability.

## Source-of-truth order
1. `AGENTS.md`
2. Accepted ADRs
3. Product, architecture, privacy, data, and feature specifications
4. JSON Schemas and API contracts
5. Approved prototype and design tokens
6. Implementation
7. Tests and screenshots

The governance package is operational guidance, not a product capability.
Feature claims must be grounded in implementation and test evidence. Use
`docs/traceability-matrix.md` for requirement-to-evidence mapping and
`docs/integration-results/` for checkpoint records.

## Mandatory PR gates
Merge only when scope is correct, CI passes, security boundaries remain intact, schemas/API match code, traceability is updated, feature status is honest, unverified behavior is documented, and the reviewer verifies the full vertical path.

## No false completion
Use `docs/feature-status-model.md`. UI affordances must not imply a capability is real when it is still mock-backed.

## Integration cadence
Run an integration checkpoint after Task 2, after every two later feature
milestones, after durable migrations or security/storage changes, and before
release hardening. Record local and GitHub Actions evidence separately;
configured workflows and screenshots do not replace executable full-path tests.
