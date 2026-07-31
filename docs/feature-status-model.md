# Feature Completeness Model

Every significant capability has one state:

1. **Visual mock** — interface present; controls may not change meaningful state.
2. **Interactive mock** — typed in-memory mock behavior only.
3. **Companion connected** — authenticated local API operation exists; persistence may be incomplete.
4. **Locally persisted** — validated durable records write and reload.
5. **End-to-end verified** — complete user path passes automated E2E, including restart/reload where relevant.
6. **Production ready** — cross-platform packaging, recovery, accessibility, privacy, docs, and failures verified.

Rules:
- Record status in the traceability matrix.
- Do not call mock-backed behavior implemented without naming its state.
- A feature cannot skip directly from interactive mock to production ready.
- Any regression to a lower state must be reported.
- A status claim must identify its evidence scope: local, GitHub Actions, or
  unverified. A configured workflow is not a passing result.
- `End-to-end verified` requires an executable complete user path, including
  reload/restart where relevant; screenshots and mocked fetches do not qualify.
- `Production ready` also requires cross-platform packaging, recovery,
  accessibility, privacy, documentation, and failure-path evidence.

Task 4A local PDF import is `Locally persisted` while the companion-backed
schema, transaction, backup and API tests pass. It is not `End-to-end verified`
until the HTTPS static-host browser flow selects, imports, replaces and
reopens a disposable PDF in a browser-capable environment. Local source
registration also does not imply PDF parsing, extraction, search, AI or
production readiness.

Task 4B local PDF text extraction is `Locally persisted` while the schema,
bounded parser, recovery transaction, source-staleness handling and companion
tests pass. The PWA state is covered by frontend tests. It is not
`End-to-end verified` until the HTTPS static-host browser flow extracts,
re-extracts and reopens disposable PDFs in a browser-capable environment. It
does not imply OCR, semantic processing, search or production readiness.

Task 4C deterministic duplicate detection is `Locally persisted` while the
strict review schema, bounded report, authenticated API, workspace/project
scope checks, paper/source rebuild behavior and frontend tests pass. The
browser flow remains unverified until a browser-capable environment runs the
real HTTPS static PWA flow with disposable PDFs in two projects. It does not
imply automatic learning, remote metadata lookup, semantic similarity, global
scholarly uniqueness, merge/delete behavior or production readiness.

Task 4D structured local metadata, readable paper page, explicit metadata
editing, derived completeness and Project Overview paper metrics are
`Locally persisted` while companion, migration, schema and frontend tests
pass. The real browser metadata flow is not promoted to `End-to-end verified`
until a browser-capable environment runs the HTTPS static PWA path with
generated fixtures. Remote lookup, DOI verification, citation parsing, AI
enrichment, search, reading and production readiness remain unavailable.

Task 5A provider configuration and explicit connection testing are
`Companion connected` when the authenticated provider routes and Settings
state are covered by local tests. The deterministic fake-provider browser
spike can promote the isolated test path to `End-to-end verified` only when it
actually runs through HTTPS with Chromium. This does not promote any AI
content-processing capability: summaries, classification, extraction,
provenance generation, search, embeddings, discovery scoring and automatic
profile updates remain unavailable.

Task 5B's prompt registry, strict processing records, safe provenance,
deterministic fingerprints/cache, explicit cancellation/retry/invalidation and
synthetic settings panel are `Companion connected` when the explicit test
companion is running. The durable records are `Locally persisted`. The real
HTTPS browser flow is `End-to-end verified` only when a browser-capable CI run
passes; Chromium-unavailable local runs remain unverified. No research-content
processing operation and no production-ready AI feature exists.

Task 5C's explicit paper-summary operation, bounded source preparation,
strict output contract, cache/stale/invalidation lifecycle and authenticated
paper-scoped routes are `Companion connected`; the resulting processing
history is `Locally persisted`. The paper page confirmation and history UI are
also companion connected, but the real HTTPS browser flow remains unverified
until Chromium runs the complete disposable paper flow. A deterministic fake
provider is not evidence of model quality, external provider availability or
production readiness. Automatic summaries, batch work, feedback learning,
classification, Ask Library, search and embeddings remain unavailable.
