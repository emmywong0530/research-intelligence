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

## Research Profile

A Research Profile is an explicit, user-authored scope record for exactly one
persisted project. It is stored at
`projects/<project-id>/research-profile.json` through the generic
`research-profiles` collection.

The durable identity is deterministic: `research_profile_<project_id>`. The
companion validates that the record ID, `project_id`, optional API `parent_id`,
and existing project record all agree before writing. Task 3B profiles migrate
from `m2.v1` to the Task 3C profile format `m3c.v1` on workspace open. The
migration is idempotent, atomic per profile, backs up the prior file, and
preserves legacy proposal shells without guessing missing values.

The profile's supported user-authored fields are:

- central research question;
- concepts with optional finite weights;
- synonyms, theories, mechanisms, outcomes, contexts, and populations;
- preferred disciplines and evidence types;
- exclusions, watched authors, and search queries.

`schema_version`, the deterministic stable ID, `created_at`, and `updated_at`
are always present on a durable profile record. Task 3C reuses the existing
`proposals` array for explicit profile-change proposals. A complete actionable
proposal contains a stable ID, supported type, explanation, status, target
field, current snapshot, proposed snapshot, and decision history. Accepted or
modified proposals also retain the applied snapshot and the expected source
revision used for the atomic write. Reversal records retain the original
proposal and either a restored value or a blocked-reversal event.

Task 3C supports only `changed_concept_weights`, `new_search_terms`,
`exclusions`, and `preferred_methods`. The latter maps to the existing
`preferred_evidence_types` field; it does not create a new durable field.
List proposals append case-insensitive unique values. Concept-weight proposals
replace the complete concepts snapshot after finite-number and duplicate
validation. Positive/negative semantic examples and revised screening
instructions remain unsupported because no approved durable destination or
paper-feedback workflow exists. Proposals are prepared by deterministic test
fixtures or explicit future integrations; there is no autonomous learning
pipeline in Task 3C.

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
