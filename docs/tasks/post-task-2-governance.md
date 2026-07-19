# Post-Task-2 Governance Installation Task

Use only after Task 2 is reviewed and merged.

This task installs governance after the merged Task 2 commit. It must not
change frontend behavior, companion behavior, schemas, API implementation,
workflows, tests, packaging, or design assets. Governance must describe the
merged implementation honestly, including local-only evidence and any
unverified browser, keychain, platform, or deployment behavior.

## Branch
`chore/engineering-governance`

## Work
1. Copy governance files into repository.
2. Merge `AGENTS-addendum.md` into `AGENTS.md` without duplication.
3. Verify referenced paths.
4. Reconcile traceability matrix with actual Task 2 implementation/tests.
5. Add `docs/integration-results/README.md`.
6. Do not modify product behavior.
7. Validate Markdown links and JSON.
8. Commit `chore: add engineering governance and Codex skills`.
9. Do not merge automatically.

The completion report must list exact files created, modified, and deleted,
traceability rows corrected, exact validation commands and results, and any
remaining uncertainty. Keep installation-only files out of the final package.
