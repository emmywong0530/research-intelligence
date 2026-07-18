# Data Model

Research Intelligence records are local-first durable files where appropriate, with rebuildable device-local indexes for search and retrieval.

Every durable JSON record must include a `schema_version`. Durable records should use stable IDs and created/updated timestamps where appropriate.

## Workspace

A workspace contains:

- workspace metadata;
- projects;
- papers;
- notes;
- analyses;
- synthesis records;
- gap records;
- feedback;
- activity history;
- backups.

## Project

A project records:

- stable project ID;
- name;
- natural-language research idea;
- central research question;
- concepts;
- synonyms;
- theories;
- mechanisms;
- outcomes;
- contexts;
- populations;
- preferred disciplines;
- preferred evidence types;
- exclusions;
- foundational papers;
- watched authors;
- search queries;
- semantic reference papers;
- relevance configuration;
- automation configuration;
- privacy configuration;
- created and modified timestamps.

## Paper

A paper records:

- stable internal paper ID;
- title;
- authors;
- year;
- publication venue;
- DOI and external identifiers;
- publication status;
- research type;
- methodological subtype;
- evidence structure;
- abstract;
- PDF/access status;
- local PDF path;
- source/version type;
- assigned projects;
- project-specific relevance records;
- reading state;
- processing state;
- provenance and history.

## Study

Multi-study papers may contain study records with:

- study ID;
- parent paper ID;
- design;
- sample;
- manipulations or predictors;
- outcomes;
- measures;
- analyses;
- findings;
- limitations;
- source locations.

## Synthesis

A synthesis records:

- purpose;
- project;
- selected paper IDs;
- paper-type composition;
- schemas;
- extracted cells;
- verification status;
- interpretation;
- contradictions;
- evidence confidence;
- provenance.

## Gap Record

A gap record contains:

- gap ID;
- project ID;
- claim;
- importance;
- supporting papers;
- counter-evidence;
- status;
- recommended revision;
- assessment history;
- timestamps.

## Provenance

AI-derived records require provenance that stores:

- source document hash;
- source scope;
- abstract-only or full-text flag;
- provider;
- model;
- prompt-template ID and version;
- timestamp;
- source locations;
- user edits;
- verification state.
