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

### Task 3E metadata-only paper records

Task 3E implements only the persisted metadata subset of the paper schema. A
new record requires `schema_version`, `paper_id`, `title`, `authors`,
`assigned_project_ids`, `created_at`, and `updated_at`. The companion requires
`assigned_project_ids` to contain exactly one existing project ID and requires
the API `parent_id` to match it. Paper IDs are generated in the browser with
cryptographically secure random bytes and do not depend on titles or paths.

The durable path is `papers/<paper-id>/metadata.json`, using the existing
`papers` collection and `paper.schema.json`. The UI supports title, authors,
year, publication venue, DOI, abstract, publication status, research type,
methodological subtype, evidence structure, and source/version type. New
records use `pdf_access_status: "unavailable"`; no PDF, full text, source URL,
download, parsing, lookup, or enrichment workflow exists. The schema has no
approved URL field, so URLs are intentionally not accepted.

Paper list requests use the authenticated generic record API with the
server-side `project_id` query filter. The companion validates the association,
schema and author/title invariants before writing, rejects reassignment, and
uses the existing record-plus-workspace metadata transaction, backup, path
confinement and expected-revision conflict behavior. Paper metadata is never
stored in browser storage or device-local indexes.

### Task 4A local PDF source registration

Task 4A adds a separate `source-file.schema.json` sidecar for one explicitly
imported local PDF. The existing paper schema is unchanged: a successful
import updates the paper's approved `pdf_access_status` to `pdf_ready` and
sets `local_pdf_path` to the workspace-relative source path. No PDF bytes are
stored in the paper JSON record.

The sidecar is stored at
`papers/<paper-id>/source/source.json`, beside the PDF at
`papers/<paper-id>/source/original.pdf`. It requires `schema_version: "m4a.v1"`,
the stable `source_<paper-id>` ID, exactly one project association, the local
file/media type, a sanitized original filename, relative path, byte size,
SHA-256, and created/imported/updated timestamps. The companion rechecks the
paper association and exact canonical relative path; the frontend never sends
an arbitrary destination path.

The browser keeps the selected `File` only in React memory and streams raw
`application/pdf` bytes to the authenticated loopback endpoint. The companion
checks the filename, size limit, non-empty content and `%PDF-` signature,
calculates SHA-256 locally, and atomically updates the PDF, sidecar and paper
record through a recoverable `pdf-import` transaction. This is registration
only: the application does not parse, render, OCR, search, embed, summarize or
send the PDF to a remote service. There is no migration because Task 4A is the
first durable source-file representation; existing paper records remain valid
and import-free.

### Task 4B local PDF text extraction

Task 4B adds the strict Draft 2020-12 `extracted-text.schema.json` contract
(`schema_version: "m4b.v1"`). It stores one extraction artifact per paper at
`papers/<paper-id>/extracted/text.json`, plus the canonical full text at
`papers/<paper-id>/extracted/full.txt`. The JSON record contains stable
extraction/project/paper/source IDs, the source SHA-256, pinned engine name and
version, timestamps, page-level text and warnings, page/text/word counts, and
the SHA-256 of the full-text file. It is associated with exactly the requested
project and paper and rejects extra fields or unsafe paths.

Extraction is explicit and deterministic. A source with no extraction is
`not_run`; a source replacement makes an existing result `stale`; re-extraction
requires an explicit request. A no-text result is successful but reports that
OCR was not run. The API returns only a bounded preview and summary, never the
full text or an absolute path. The existing paper schema is unchanged and no
migration is required because this is the first durable extraction format;
unsupported future `m4b` versions are rejected rather than rewritten.

## Notes

Task 3F adds a strict, metadata-only plain-text `notes` record. A note has a
stable `note_id`, `schema_version: "m3f.v1"`, `scope_type` (`project` or
`paper`), the owning `project_id`, a title, a body, and `created_at` /
`updated_at`. Paper-scoped notes also require `paper_id`; project-scoped notes
do not contain that field. Titles are limited to 240 characters and bodies to
100,000 characters. Bodies are stored as plain text; the frontend does not
render Markdown as HTML.

Project notes are stored at
`projects/<project-id>/notes/<note-id>.json`. Paper notes are stored at
`papers/<paper-id>/notes/<note-id>.json`. The companion requires the parent
ID on writes, confirms the project and paper exist, confirms a paper belongs
to the note's project, and prevents scope/project/paper reassignment on
update. Notes are listed with server-side `project_id`, `scope_type`, and
optional `paper_id` filters. They are durable workspace records, not browser
storage, SQLite, FTS, vector-index or device-registry data.

There is no migration for Task 3F: no prior note schema or durable note
records existed. Unsupported future note schema versions are rejected by the
normal schema-backed write/read path.

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

## Task 4C Duplicate Evidence

Task 4C adds deterministic, derived duplicate evidence over the current
workspace paper records. The report is rebuilt from validated durable paper
records, validated source-file sidecars and imported PDF bytes; it is not a
second paper source of truth and is not stored in SQLite, FTS or a vector
index.

The report has `report_schema_version: "m4c.v1"` and groups evidence into:

- `exact_source`: two or more complete, canonical source sidecars whose PDF
  bytes have the same SHA-256;
- `exact_identifier`: two or more papers with the same conservatively
  normalized DOI, PMID or arXiv identifier, retaining identifier type;
- `metadata_candidate`: two or more papers whose normalized title, year and
  first-author surname tuple matches. A present optional value never matches a
  missing value; a missing year can match another missing year only when the
  normalized title and required author evidence also match. Valid paper
  records require a non-empty author, so a missing surname is not a valid
  candidate input. This avoids broad matches based on one-sided missing data.

Title normalization uses Unicode NFKC, case folding, whitespace collapse,
conservative punctuation spacing and terminal punctuation trimming. Author
normalization uses only the supplied surname position; it does not infer
identity. Identifier normalization accepts only the approved DOI, PMID and
arXiv forms and rejects malformed or unsupported values. Every group has a
stable SHA-256 evidence fingerprint and a group fingerprint that also includes
the sorted paper IDs. The API exposes only a short source-hash preview and
never an absolute path or full source bytes.

User review state is optional and stored as a strict `m4c.v1`
`duplicate-review.schema.json` record at
`feedback/duplicate-reviews/duplicate_review_<group-fingerprint>.json`. A
review can acknowledge duplicate evidence, mark a metadata candidate as
separate, or ignore a warning. Reviews never merge, delete, hide, or rewrite
paper records. A changed paper or source causes the current report to rebuild;
old review state is not applied to a different fingerprint. No migration is
required because no previous duplicate-review durable format existed.

## Task 4D Structured Paper Metadata

`m4d.v1` extends the existing paper record without replacing its durable
identity or project association. The record keeps `paper_id`,
`assigned_project_ids`, ordered `authors`, timestamps, source/extraction
references, notes and duplicate-review relationships. New bounded metadata
fields are `author_details`, `publisher`, `volume`, `issue`, `page_start`,
`page_end`, `article_number`, `edition`, `language`, `publication_type`,
`publication_status`, `identifiers`, `keywords`, `url` and
`metadata_provenance`.

`author_details` preserves one entry per ordered author and supports
`literal_name`, `given_name`, `family_name`, `suffix` and a locally validated
ORCID. Legacy names migrate as literal names; no name parsing is performed.
Identifiers are restricted to DOI, PMID, PMCID, arXiv ID, ISBN, ISSN and
`other`. The companion normalizes accepted forms without network calls.

Metadata completeness is derived, never stored: title, authors, year, venue,
abstract, at least one identifier, and keywords are scored as seven equally
weighted fields. The UI reports the percentage and missing fields as record
completeness, not bibliographic accuracy.

## Task 5A Device-Local Provider Settings

Task 5A deliberately adds no workspace record or package schema. Provider
configuration is device-local because a provider credential and transient
connection state must not sync with a user workspace. The companion stores a
strict `task5a.v1` JSON object at its device-data root as
`ai-provider-settings.json`:

- provider (`openai` only);
- model identifier;
- timeout in the bounded range 1-30 seconds;
- transient retry limit (`0` or `1`);
- enabled flag;
- created and updated timestamps;
- content revision.

The file is validated, fsynced and atomically replaced. Unknown or future
versions are rejected. The provider credential is not represented in this
object at all; its presence is derived from the OS keychain. Last connection
test results are held in companion memory and contain only provider, model,
timestamp, bounded latency, status, error category and a user-safe message.

The initial adapter performs only a fixed OpenAI-compatible model-availability
test. It does not create summaries, classifications, extracted fields,
embeddings, search results, profile proposals or provenance records. Future
AI-derived durable records must use the existing provenance contract before
those later milestones begin.

## Task 5B AI Processing Records

Task 5B adds one strict `m5b.v1` processing record for the bounded synthetic
operation `provider_echo_test`. It is stored at
`activity/processing/<processing-id>.json` and is part of the durable workspace
files, but is intentionally absent from the workspace metadata ID arrays.
The approved `activity/` directory therefore requires no workspace metadata
schema migration.

The record includes stable processing/workspace IDs, operation and prompt
identity/version/fingerprint, provider type, model, bounded numeric
parameters, canonical input fingerprint, synthetic source snapshot,
canonical source-snapshot fingerprint, domain-separated cache key and disposition,
state, timestamps, attempt count,
bounded output, output fingerprint, usage summary, safe provenance and bounded
error. The initial synthetic operation contains no project or paper content.

The code-owned prompt registry keeps raw system and user templates inside
companion source. The API returns safe metadata and a prompt fingerprint, not
template text. The only registered operation uses a fixed acknowledgement and
an explicitly bounded synthetic input version. No paper, note, profile, PDF,
full text, credential, raw prompt, raw provider response, absolute path or
hidden reasoning is accepted or persisted.

Processing states are `queued`, `running`, `completed`, `failed` and
`cancelled`. Only a completed, valid, non-stale, non-invalidated record is
reusable. A cache hit creates a new durable event referencing the original
processing ID; it never overwrites the source event. Explicit invalidation
marks an event unavailable for reuse. A changed synthetic source version
marks prior events stale. Queued/running events found during workspace open
become an explicit `processing_unavailable` failure and are never resumed
automatically. Retry is an explicit bounded action.

No migration of existing records was required: this is an additive schema and
approved activity path. Existing `m2.v1` workspace/project/paper/profile
records remain unchanged and continue through the existing open/migration
validation path.

## Task 5C Paper Summary Records

Task 5C extends the same strict `m5b.v1` processing-record contract with one
`paper_summary` operation. It does not add a second summary file or a browser
cache. Records remain at `activity/processing/<processing-id>.json` and are
scoped by `workspace_id`, `project_id` and `paper_id`. The paper and its
extraction must be validated before a request can start.

The source snapshot stores only safe preparation metadata: source and
extraction IDs/hashes, extraction status, preparation version, page counts,
included character count, truncation state and metadata/prepared-input
fingerprints. The actual bounded prompt input is held only while the companion
request runs. The metadata allowlist is limited to user-authored paper fields
such as title, authors, year, venue, publication type/status, abstract,
keywords and safe identifiers. It excludes notes, Research Profiles, project
text, paths, filenames, credentials and provider response bodies.

The output is strict `paper-summary.v1`: a bounded summary, one to eight key
points and bounded optional limitations/open questions. Output is validated
before the completed state is written. The UI requires explicit confirmation;
there is no summary-on-import or automatic feedback pipeline. Cache identity
includes the immutable prompt identity, source snapshot, provider/model,
bounded parameters and output contract. Metadata or extraction changes make
older records stale; explicit invalidation preserves history while blocking
reuse. Failed, cancelled and retried events remain separate durable history.

No schema migration is required. Existing Task 5B echo records and all earlier
workspace records remain valid under `m5b.v1`; the schema uses explicit
operation branches and continues to reject unknown fields.
