# Frontend Specification

The frontend is a desktop-first installable PWA. It must stay compatible with static hosting and communicate with the local companion through explicit pairing and authenticated local API calls.

## Approved Visual System

The approved style is:

- near-black application background;
- charcoal and dark-grey panels;
- mint-green primary accent;
- soft white primary text;
- muted grey secondary text;
- fine low-contrast borders;
- rounded panels and controls;
- compact typography;
- dense but orderly information;
- restrained glow and motion;
- vector-first visualisation.

## Layout Safeguards

Every implementation must include:

- `box-sizing: border-box`;
- `min-width: 0` on grid and flex children;
- bounded SVG `viewBox`;
- `width: 100%; height: auto` for vectors;
- wrapping for long titles and metadata;
- explicit grid tracks using `minmax(0, 1fr)`;
- horizontal scrolling only for genuinely dense tables;
- no uncontrolled absolute-positioned text;
- no fixed card width that can escape its container.

## Primary Navigation

The persistent desktop left navigation contains:

1. Home
2. Projects
3. Discovery
4. Library
5. Reading Hub
6. Ask Library
7. Synthesis
8. Research Gaps
9. Activity
10. Settings

Project-specific tabs are:

- Overview;
- Research Profile;
- Papers;
- Discovery;
- Synthesis;
- Gaps;
- Settings.

## Discovery Views

Table, card, and Paper Field views must display the same core paper fields:

- title;
- year;
- project;
- paper type;
- relevance percentage;
- relevance explanation;
- access state;
- estimated reading time;
- primary actions.

Table is the default for screening and batch work. Card supports richer browsing. Paper Field is an immersive spatial selection view. All three share filters, selection, and actions.

## Task 0 Frontend Shell

Task 0 may create only the shell needed for technical spikes:

- desktop-first page shell;
- persistent left navigation;
- dark design tokens;
- one companion connection-status component;
- one pairing screen;
- no production research features;
- no secrets in browser storage or source files.

## Task 3D Persisted Project Overview

When a user explicitly opens a persisted project from Projects, the default
destination is the read-only Project Overview route (`#project` in the
lightweight route model). The route is application-state scoped and requires a
paired companion, a healthy active workspace, and an active project selected
in memory. Direct navigation without those prerequisites shows the existing
connection, workspace, or project-required state.

The overview reads the latest project record and the deterministic
`research_profile_<project_id>` record through the authenticated generic record
API. It verifies both workspace association and project association before
rendering profile or proposal information. The overview displays persisted
project identity, question, idea, timestamps, safe workspace label, profile
completion state, bounded profile summaries, and counts derived from durable
proposal history. Legacy proposal shells without an actionable Task 3C payload
remain visible only as non-actionable legacy data and are not counted as
pending changes.

Project editing, Research Profile editing, and proposal review continue to use
their existing screens. Successful saves return to the overview and cause a
fresh read rather than relying on stale editor state. A successful workspace
change clears the active project; reopening a workspace therefore requires an
explicit project selection again. Project and profile dirty-state protections
continue to be owned by the application-level navigation guard and the
existing editors. The overview itself is read-only and never dirty.

Paper storage, notes, discovery, reading, AI processing, synthesis, export and
other later roadmap capabilities are omitted or clearly marked unavailable in
this milestone.

## Task 3E Project Papers

The project-specific Papers route (`#papers`) requires a paired companion, an
active workspace, and an explicitly selected project. It reads only the
server-filtered paper records assigned to that project. The list has a truthful
empty state and shows title, compact authors, year/venue, update time, and a
`Metadata only` status. It does not show citation counts, relevance scores,
reading progress, summaries, or PDF availability.

The Add paper record action opens an editor without creating a draft file. The
editor uses only fields permitted by `paper.schema.json`: title, authors, year,
venue, DOI, abstract, publication status, research type, methodological
subtype, evidence structure, and source/version type. New records are marked
PDF-unavailable. Saves use the authenticated generic record API with an
expected revision and preserve local input on validation, availability, or
409 conflict errors. A conflict requires an explicit latest-version reload or
user retry; no stale overwrite or silent merge occurs.

The editor registers with the application dirty-state guard. Leaving for the
paper list, Project Overview, Projects, another paper, or a workspace change
offers Keep editing or Discard changes. Paper and workspace IDs, paths,
selected records, session tokens, and unsaved drafts remain in memory only.
Project Overview derives a bounded recent-paper preview and count from the
same authenticated paper list and refreshes it on entry; PDFs, import, parsing,
enrichment, discovery, and reading actions remain unavailable.

### Task 4A Local PDF source registration

The selected paper editor exposes an explicit local PDF source section. A user
must save a paper record before selecting a file. The browser keeps the
selected `File` in React memory, shows a filename/size preview, and streams it
to the paired loopback companion; it never stores a host path, PDF bytes,
selected paper, draft, workspace ID or session in browser storage.

The editor shows either `No PDF imported` or the persisted original filename,
size, SHA-256, import time and `PDF stored; text not extracted` status. Import
has selected, uploading, completed and error states. A failed request preserves
the selected file and source metadata. An existing source can be replaced only
after an explicit confirmation; cancellation leaves the existing source and
selection unchanged. The source section participates in the existing dirty
navigation guard while a file is selected or importing.

No PDF viewer, download, extraction, OCR, annotation, AI, search, citation or
institutional-access control is shown. The paper list reports `PDF stored`
only when the persisted paper and source operation confirm it; otherwise it
reports `Metadata only`.

### Task 4B Local PDF text extraction

When a registered PDF is open, the paper editor shows a separate Text
extraction section. It reports `Not extracted`, `Extracting text locally`,
`Text extracted locally`, `Stale`, or an explicit error. The user must choose
Extract text; re-extraction is a separate explicit action after a source
replacement. The completed state shows bounded page/text/word metrics, parser
engine/version, source checksum, warnings and a bounded text preview. A
machine-unreadable PDF reports that no text was found and that OCR has not been
run. The browser keeps no extracted text, PDF bytes, path, session or selected
paper in browser storage. Full-text viewing, OCR, search and semantic features
remain unavailable.

## Task 3F Notes

The `#notes` route reuses one typed Notes screen for project and paper scope.
It requires a paired companion, active workspace, active project, and for
paper notes an explicitly opened paper. It lists only the selected scope using
server-side filters, has a truthful empty state, and supports explicit create,
read and update of plain-text notes. Project Overview shows the combined count
of project and paper notes plus a bounded recent preview. Paper detail exposes
a Paper notes action.

The editor validates non-empty titles and bodies, preserves line breaks, and
shows a metadata-only durable status. A stale revision leaves local text
visible, disables Save until the user chooses to reload and discard or load
the latest revision while preserving their edits, and never silently merges.
The existing application-level dirty guard protects note drafts during
navigation and workspace changes. Note IDs, scope IDs, paths, sessions and
drafts remain in memory; browser storage is not used. No Markdown HTML
rendering, file attachment, PDF, annotation, search, AI, export or
collaboration workflow is included.

## Task 4C Duplicate Evidence

The persisted Papers screen performs a workspace-wide duplicate check after
loading the active project's paper list. The list shows bounded indicators for
any current evidence involving a paper. Opening a paper shows a Duplicate
check section with the evidence label, plain-language explanation, matched
fields or source filenames, the other paper's title and owning project, and
the current review state.

The UI distinguishes:

- `Exact PDF duplicate`: verified identical imported PDF bytes;
- `Matching identifier`: the same supported normalized DOI, PMID or arXiv ID;
- `Possible metadata duplicate`: a conservative title/year/first-author
  candidate that requires human review.

Review actions are explicit and do not merge, delete or hide either paper.
Exact-source evidence can be acknowledged or ignored; identifier and metadata
evidence can be marked reviewed duplicate, marked as separate, or ignored. A
project overview requests only groups involving the active project and counts
only that project's affected papers, while Papers retains the workspace-wide
cross-project evidence. The overview has a bounded Duplicate evidence summary
and an Inspect in Papers action. It does not show a global uniqueness score or
fake intelligence.

Duplicate checking is a local capability, not a claim of automatic learning,
remote scholarly lookup or semantic similarity. The report is refreshed after
paper/source changes and is treated as unavailable independently of the paper
list if the companion cannot compute it. No duplicate IDs, source paths,
hashes, reports or review drafts are stored in browser storage.

## Task 4D Paper Page

The project Papers screen now opens a readable paper record page by default.
View mode groups Overview, bibliographic metadata, abstract, keywords,
identifiers/links, local PDF, extraction, duplicate evidence, paper notes and
provenance/timestamps. `Edit metadata` is the explicit transition into the
validated form; saving returns to view mode. `Manage local PDF` enters the
existing source editor and does not imply a PDF exists.

The list uses the same active-project records for bounded in-memory sorting by
updated time, title or year and filtering by PDF, extracted text, duplicate
evidence or incomplete metadata. Controls are not persisted in browser storage.
The Project Overview shows paper count, PDFs stored, extracted text, incomplete
metadata and duplicate-evidence counts, plus a bounded recent-paper preview.
No remote enrichment, citation, reading, search or AI controls are presented.

## Task 5A AI Provider Settings

The Settings `AI & budgets` category contains a real companion-connected AI
Provider section. It is available only after the browser is paired and the
companion is online. On entry it reads nonsecret device-local configuration;
it never runs a provider request or connection test automatically.

The unconfigured state says `No AI provider configured` and explains that
credentials are stored through the operating-system keychain. Configuration,
credential storage/replacement/removal and connection testing are separate
explicit actions. The form exposes only the approved OpenAI-compatible
provider, model, bounded timeout and transient retry limit. After a credential
is stored the input is cleared, and the UI shows presence rather than a key
fragment. The UI never displays raw provider responses, headers, URLs, stack
traces or secrets.

Provider status is shown as `No AI provider configured`, `Provider configured,
credential missing`, `Ready to test`, `Connection verified`, `Connection test
failed`, `Credential removed` or `Provider configuration unavailable`. A
keychain-unavailable response is a blocked state with no plaintext fallback.
Changing configuration or the credential invalidates a prior verified state.
Revision conflicts preserve the edited model and show a reconciliation error;
they do not silently adopt a server revision. No provider configuration,
credential presence, model, test result, workspace ID or session token is
stored in browser storage.

Task 5A's provider foundation does not render controls for summaries,
classification, extraction, Ask Library, embeddings, search, discovery,
profile learning or other later AI workflows.
