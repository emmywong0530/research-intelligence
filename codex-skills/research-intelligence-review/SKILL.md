---
name: research-intelligence-review
description: Review a Research Intelligence PR for product fidelity, architecture, security, contracts, UI, tests, traceability, and honest completion claims.
---

# Research Intelligence Pull Request Review

1. Read task, PR, `AGENTS.md`, accepted ADRs under `docs/adr/`, relevant specs,
   `docs/feature-status-model.md`, and `docs/traceability-matrix.md`.
2. Classify changed files by layer.
3. Verify scope and prohibited behavior.
4. Trace at least one real user path end to end.
5. Review loopback-only binding, allowed-origin enforcement, explicit pairing,
   auth, keychain-only secrets, leaks, traversal, absolute paths, symlinks,
   atomic writes, portable workspace identity, transaction recovery,
   conflict, backup/restore, device-local index separation, and private data.
6. Verify frontend types, API, implementation, schemas, and migrations agree.
7. Review approved style, `docs/prototypes/design-tokens.json`, shared-state
   rules, accessibility, loading/empty/error/disconnected/health states, and
   containment.
8. Ensure tests assert behavior, cover negatives, and do not replace claimed E2E with mocks.
9. Check feature state and traceability.
10. Check that the feature state is honest and that every changed requirement
    has a traceability row with actual paths and verification scope.
11. Separate merge blockers, follow-up improvements, and accepted limitations.
12. Produce `docs/templates/review-report.md` with exact evidence and claims
    versus evidence.
13. Never recommend merge with failed checks or unverified load-bearing
    behavior. Never recommend automatic merge.
