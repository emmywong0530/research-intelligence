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
page/character limits, durable page text and bounded preview/metrics. OCR,
rendering, full-text search, duplicate detection, download and access workflows
remain later M4/M8 work.

## M5: AI Processing

- provider abstraction;
- prompt/template registry;
- classification;
- summary;
- extraction;
- provenance;
- caching.

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
