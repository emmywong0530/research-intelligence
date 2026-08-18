# Roadmap

Implementation is staged by milestone. Do not broaden scope without approval.

## M0: Repository and Contracts

- monorepo structure;
- development environments;
- product docs;
- schemas;
- API contract;
- design tokens;
- CI;
- basic security model.

## M1: Frontend Shell

- PWA;
- navigation;
- routes;
- mock screens;
- responsive desktop safeguards;
- component library;
- accessibility baseline.

## M2: Companion Foundation

- local server;
- pairing;
- workspace selection;
- keychain;
- health/version;
- file APIs;
- packaging proof of concept.

## M3: Project and Paper Storage

- workspace manifest;
- project CRUD;
- research profile;
- metadata-only paper records and project-scoped paper lifecycle (Task 3E);
- notes;
- migrations;
- backups.

Task 3C adds only transparent, deterministic, reversible Research Profile
proposals over existing profile fields. Task 3D Project Overview integration
consolidates Tasks 3A-3C over persisted project and profile records. Proposal
generation from real paper feedback, PDFs, full text, notes and all enrichment
workflows remain reserved work. Task 3E does not implement deletion, import,
lookup, parsing, reading state, discovery, AI processing or search.

Task 3F implements only project- and paper-scoped plain-text note records and
their project/paper UI. Attachments, annotations, Markdown rendering, reading
notes, search, AI and export remain later work.

## M4: Library and PDF

- Task 4A local PDF import and durable source-file registration;
- Task 4B deterministic local PDF text extraction with bounded durable output;
- metadata;
- hashing;
- duplicate detection;
- PDF extraction;
- paper page.

Task 4A implements only explicit local PDF byte transfer, bounded validation,
SHA-256 source metadata, replacement backups and project/paper-scoped source
registration. Task 4B adds explicit local `pypdf` extraction with strict
page/character limits, durable page text and bounded preview/metrics. Task 4C
adds deterministic local duplicate evidence and explicit review annotations;
it does not merge or delete records and does not claim scholarly uniqueness.
OCR, rendering, full-text search, download and access workflows remain later
M4/M8 work.

## M5: AI Processing

- provider abstraction;
- prompt/template registry;
- classification;
- summary;
- extraction;
- provenance;
- caching.

Task 5A is the first bounded M5 slice. It adds only the companion-side
OpenAI-compatible provider adapter, device-local nonsecret configuration,
keychain-only credential lifecycle, explicit connection testing and the
Settings surface. It does not process user content or implement summaries,
classification, extraction, prompts, provenance records, caching, search,
embeddings or profile learning. Those remain later M5 work.

## Task 5B — AI Processing Foundation

Task 5B implements only the foundation needed to verify an explicit local
processing lifecycle: a code-owned immutable prompt registry, strict durable
processing/provenance records, deterministic fingerprints/cache semantics,
recovery, cancellation, retry, invalidation and a synthetic fake-provider
test surface. The operation is unavailable in normal production mode and does
not process user research content.

Still unavailable after Task 5B: paper summaries, classification, PDF/text
extraction by AI, Ask Library, search, discovery ranking, embeddings,
feedback-derived or autonomous profile learning, batch/background work,
cloud processing, export, collaboration and production deployment.

## Task 5C — Explicit Paper Summary

Task 5C adds one user-confirmed `paper_summary` operation over a completed
local PDF extraction. It uses deterministic server-side source preparation,
an immutable prompt registry entry, strict `paper-summary.v1` validation and
the existing revision-aware durable processing records. Cache hits, stale
source detection, bounded retry, cancellation, invalidation and reloadable
history are explicit and auditable. The production adapter is bounded to the
approved OpenAI-compatible operation; test-mode browser evidence uses the
deterministic fake provider.

Still unavailable after Task 5C: automatic or batch summaries, summaries on
import, feedback-derived proposals, classification, structured extraction,
Ask Library, search, discovery ranking, embeddings, synthesis, export, cloud
processing, collaboration and production deployment. No summary feature is
marked Production ready until the required browser and provider evidence
exists.

## M6: Discovery

- OpenAlex;
- Crossref;
- search profiles;
- scoring;
- inbox;
- three display modes.

## M7: Reading

- Reading Hub;
- quests;
- streak;
- focus mode;
- notes and progress.

## M8: Access Workflow

- open-access lookup adapter;
- institutional links;
- download watcher;
- PDF matching;
- abstract-only upgrade.

## M9: Feedback

- labels;
- profile update proposals;
- relevance adjustments;
- audit history.

## M10: Advanced Intelligence

- Ask Library;
- synthesis;
- gap tracker;
- citation monitoring.

## M11: Hardening

- signed installers;
- macOS and Windows tests;
- security review;
- recovery tests;
- Dropbox conflict tests;
- performance;
- documentation.

## Task 4D: Structured Paper Metadata

Task 4D adds structured, manually maintained local paper metadata, explicit
read/edit paper pages, derived completeness guidance, bounded list sorting and
filtering, and consolidated source/extraction/duplicate/note summaries. It
does not add remote metadata lookup, DOI verification, citation parsing, AI
enrichment, search, reading, or production readiness.
