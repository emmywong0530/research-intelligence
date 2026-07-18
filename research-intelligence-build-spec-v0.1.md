# Research Intelligence Platform
## Product and Build Specification v0.1

**Status:** Frontend concept approved; ready for repository planning and staged implementation  
**Primary surface:** Desktop-first installable PWA  
**Architecture:** Public static frontend + private local companion + user-owned workspace  
**Initial user model:** One researcher across one or more personal computers

---

# 1. Product statement

A local-first research intelligence platform that helps researchers define projects, discover literature, obtain lawful full text, process and classify papers, complete structured reading quests, ask questions across their library, synthesise evidence, and track whether proposed research gaps remain defensible.

The platform must feel like a premium research command centre rather than a traditional reference manager.

---

# 2. Non-negotiable principles

1. **Local-first ownership**
   - User research data is stored in a normal user-selected folder.
   - No central user database is required.
   - GitHub contains application source code, not user data.

2. **Bring-your-own AI**
   - Users provide their own API key.
   - Secrets are stored in the operating-system keychain.
   - AI results are cached and saved locally.

3. **Transparent intelligence**
   - Distinguish source-extracted, AI-interpreted and user-edited content.
   - Preserve page or section grounding where possible.
   - Keep model, prompt-template and document-hash provenance.

4. **Paper-type-aware processing**
   - Classify papers before extraction and synthesis.
   - Use different schemas for empirical, qualitative, conceptual, review, meta-analytic and computational papers.

5. **Meaningful reading**
   - Reading progress is based on completed reading quests, not PDF opening or scrolling.
   - Daily streaks count completed papers according to user-defined reading modes.

6. **Lawful access**
   - Never bypass paywalls.
   - Never store institutional login credentials.
   - Assist with open-access lookup, institutional browser access and local PDF attachment.

7. **Desktop-first interface**
   - Persistent left navigation across all pages.
   - Data, text, vectors and controls must stay within their panels.
   - Mobile may support simplified reading and notes, but is not the primary design target.

---

# 3. Approved visual system

## 3.1 Style

- Near-black application background
- Charcoal and dark-grey panels
- Mint-green primary accent
- Soft white primary text
- Muted grey secondary text
- Fine low-contrast borders
- Rounded panels and controls
- Compact typography
- Dense but orderly information
- Restrained glow and motion
- Vector-first visualisation

## 3.2 Layout safeguards

Every implementation must include:

- `box-sizing: border-box`
- `min-width: 0` on grid and flex children
- bounded SVG `viewBox`
- `width: 100%; height: auto` for vectors
- wrapping for long titles and metadata
- explicit grid tracks using `minmax(0, 1fr)`
- horizontal scrolling only for genuinely dense tables
- no uncontrolled absolute-positioned text
- no fixed card width that can escape its container

## 3.3 Navigation

Persistent desktop left navigation:

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

Project-specific tabs:

- Overview
- Research Profile
- Papers
- Discovery
- Synthesis
- Gaps
- Settings

---

# 4. Main user journey

1. Install/open PWA.
2. Install and connect local companion.
3. Create or open workspace.
4. Configure AI provider and key.
5. Configure institutional access.
6. Select automation and privacy defaults.
7. Create project from a natural-language research idea.
8. Review AI-generated structured research profile.
9. Run scheduled or manual literature discovery.
10. Screen candidates in table, card or Paper Field view.
11. Obtain or attach lawful full text.
12. Classify and process paper.
13. Complete quick, standard or deep reading quest.
14. Provide relevance feedback.
15. Build synthesis.
16. Track and revise research gaps.

---

# 5. Core domain objects

## 5.1 Workspace

Contains:

- workspace metadata
- projects
- papers
- notes
- analyses
- synthesis records
- gap records
- feedback
- activity history
- backups

## 5.2 Project

Required fields:

- stable project ID
- name
- natural-language research idea
- central research question
- concepts
- synonyms
- theories
- mechanisms
- outcomes
- contexts
- populations
- preferred disciplines
- preferred evidence types
- exclusions
- foundational papers
- watched authors
- search queries
- semantic reference papers
- relevance configuration
- automation configuration
- privacy configuration
- created and modified timestamps

## 5.3 Paper

Required fields:

- stable internal paper ID
- title
- authors
- year
- publication venue
- DOI and external identifiers
- publication status
- research type
- methodological subtype
- evidence structure
- abstract
- PDF/access status
- local PDF path
- source/version type
- assigned projects
- project-specific relevance records
- reading state
- processing state
- provenance and history

## 5.4 Study

For multi-study papers:

- study ID
- parent paper ID
- design
- sample
- manipulations or predictors
- outcomes
- measures
- analyses
- findings
- limitations
- source locations

## 5.5 Synthesis

- purpose
- project
- selected paper IDs
- paper-type composition
- schemas
- extracted cells
- verification status
- interpretation
- contradictions
- evidence confidence
- provenance

## 5.6 Gap record

- gap ID
- project ID
- claim
- importance
- supporting papers
- counter-evidence
- status
- recommended revision
- assessment history
- timestamps

---

# 6. Workspace storage structure

```text
Research Intelligence Workspace/
├── workspace.json
├── projects/
│   └── <project-id>/
│       ├── project.json
│       ├── research-profile.json
│       ├── search-profile.json
│       ├── feedback-profile.json
│       └── settings.json
├── papers/
│   └── <paper-id>/
│       ├── metadata.json
│       ├── paper.pdf
│       ├── extracted-text.json
│       ├── classification.json
│       ├── studies.json
│       ├── summary.json
│       ├── extraction.json
│       ├── project-connections.json
│       ├── reading-progress.json
│       ├── notes.md
│       └── provenance.json
├── syntheses/
├── gaps/
├── feedback/
├── activity/
└── backups/
```

## 6.1 Durable versus rebuildable data

**Durable and synchronised:**

- projects
- PDFs
- notes
- metadata
- summaries
- extractions
- reading progress
- project relevance
- synthesis
- gap assessments
- settings excluding secrets

**Device-local and rebuildable:**

- SQLite index
- full-text index
- vector index
- task queue
- temporary files
- thumbnails
- logs
- machine role
- API credentials

## 6.2 File-safety rules

- Atomic write to temporary file followed by rename.
- Content hashes for PDFs and generated analyses.
- Schema version on every durable JSON record.
- Optimistic concurrency metadata.
- Conflict detection before write.
- Versioned backups.
- Never use one cloud-synchronised monolithic database as the durable source of truth.

---

# 7. Recommended technology stack

## 7.1 Frontend

- React
- TypeScript
- Vite
- Vite PWA integration
- React Router
- TanStack Query for companion request state
- Zustand or equivalent small local UI state store
- SVG and CSS for functional vectors
- Vitest
- React Testing Library
- Playwright for end-to-end tests

## 7.2 Local companion

Recommended first implementation:

- Python
- FastAPI
- Uvicorn
- Pydantic
- Python `keyring`
- watchdog for folder monitoring
- SQLite for device-local indexing
- FTS5 for local full-text search
- a swappable local vector-index adapter
- PyMuPDF for PDF text and page extraction
- PyInstaller for macOS and Windows packaging

The companion must bind to loopback only and expose a versioned local API.

## 7.3 Why Python companion first

- Strong PDF and scholarly-text ecosystem
- Straightforward AI and embedding integrations
- Easier development of classification and extraction pipelines
- Cross-platform keychain access
- Can be packaged for macOS and Windows

A Tauri or Rust shell may be considered later for installer polish, but should not replace the Python processing layer in the first build unless testing reveals a clear packaging problem.

## 7.4 Public deployment

- GitHub repository
- GitHub Actions
- GitHub Pages for static PWA
- Separate signed companion releases for macOS and Windows

---

# 8. Local companion security contract

The companion must:

- bind only to `127.0.0.1` and/or `::1`
- reject remote network interfaces
- use a per-installation secret
- pair the PWA and companion explicitly
- validate origin
- require authenticated requests
- use short-lived session tokens after pairing
- validate all file paths against workspace roots
- prevent path traversal
- restrict outbound calls to configured providers/connectors
- redact secrets from logs
- never return API keys to the PWA
- provide explicit health, version and capability endpoints

Suggested API groups:

```text
/api/v1/health
/api/v1/pairing
/api/v1/workspaces
/api/v1/projects
/api/v1/papers
/api/v1/discovery
/api/v1/reading
/api/v1/ai
/api/v1/synthesis
/api/v1/gaps
/api/v1/activity
/api/v1/settings
```

---

# 9. Discovery system

## 9.1 Sources

Initial:

- OpenAlex
- Crossref

Next:

- Semantic Scholar
- arXiv
- PubMed
- citation monitoring
- discipline-specific APIs

## 9.2 Candidate pipeline

```text
Metadata retrieval
→ identifier normalisation
→ duplicate detection
→ exclusion rules
→ keyword scoring
→ semantic scoring
→ citation-network scoring
→ optional AI judgment
→ inbox / auto-import / reject
```

## 9.3 Unified display data

Table, card and Paper Field views must display the same core paper fields:

- title
- year
- project
- paper type
- relevance percentage
- relevance explanation
- access state
- estimated reading time
- primary actions

Display format may change, but information must remain aligned.

## 9.4 Display modes

- Table: default for screening and batch work
- Card: richer browsing
- Paper Field: immersive spatial selection

All views share the same filters, selection and actions.

---

# 10. Full-text access

Access states:

- PDF ready
- open access
- repository version
- institutional access required
- manual upload required
- abstract only
- unavailable

Workflow:

```text
Check workspace
→ check lawful open-access locations
→ show institutional route
→ user authenticates in normal browser
→ user downloads or attaches PDF
→ companion detects and matches file
→ user confirms
→ process locally
```

The platform must never store:

- institutional username
- password
- MFA code
- publisher session cookie

Initial import options:

- file picker
- drag and drop
- watched downloads folder
- DOI/title matching

Later:

- Zotero integration
- browser extension

---

# 11. Paper classification and extraction

## 11.1 Classification

Hierarchical and multi-label:

- publication type
- research type
- methodological subtype
- evidence structure
- paper-level and study-level records

## 11.2 Default full-paper summary

1. 30-second summary
2. Research question and contribution
3. Theory and hypotheses
4. Method and sample
5. Main findings
6. Limitations
7. Relevance to each assigned project

## 11.3 Provenance

Every AI record stores:

- source document hash
- source scope
- abstract-only/full-text flag
- provider
- model
- template ID and version
- timestamp
- source locations
- user edits
- verification state

---

# 12. Reading system

## 12.1 Reading modes

### Quick review

- summary
- research question
- main finding
- project relevance
- next action

### Standard reading

- summary
- research question
- theory
- method
- findings
- limitations
- at least one user note

### Deep reading

- full paper
- study-level records
- measures and analyses
- verification of key AI extraction
- strengths and weaknesses
- cross-paper connections
- synthesis inclusion

## 12.2 Streak logic

A day counts only when the configured number of paper quests is completed.

Configurable:

- daily paper target
- eligible reading modes
- whether abstract-only review counts
- weekends on/off
- streak visibility

Opening PDFs and generating AI summaries do not count.

## 12.3 Reading Hub

- daily target
- streak
- available-time selector
- recommended session
- continue-reading queue
- quick-review queue
- deep-reading queue
- access-required queue
- weekly history

## 12.4 Focus mode

- reading quest
- current section
- PDF/source jump
- project relevance
- AI reading companion
- notes
- optional timer

---

# 13. Research-profile learning

User feedback is project-specific.

Positive labels:

- directly relevant
- useful theory
- useful method
- useful measure
- useful context
- foundational
- contradiction

Negative labels:

- wrong phenomenon
- wrong field
- wrong population
- wrong method
- keyword-only
- technical but not behavioural
- clinical only
- peripheral
- duplicate
- low quality

The system may propose:

- changed concept weights
- new search terms
- exclusions
- preferred methods
- positive/negative semantic examples
- revised screening instructions

Every proposal must be:

- visible
- explained
- accept/modify/reject
- reversible
- logged

---

# 14. Synthesis

Guided workflow:

1. choose purpose
2. select papers
3. inspect paper-type composition
4. choose separate/integrated/cross-type mode
5. choose schemas
6. review extracted evidence
7. verify cells
8. interpret patterns and contradictions
9. save

Cell status:

- source extracted
- AI interpreted
- user edited
- user verified
- missing

---

# 15. Research-gap tracking

Statuses:

- exploratory
- plausible
- supported
- narrowed
- partially addressed
- requires reframing
- unsupported

Gap assessment must show:

- current claim
- supporting evidence
- strongest challenge
- new evidence
- revised assessment
- recommended wording
- accept/edit/keep-original controls
- history

---

# 16. Automation

Independent settings:

- scheduled discovery
- AI relevance screening
- classification
- full-paper summary
- theory/method/variable extraction
- project connections
- reading recommendations
- concept timeline
- citation monitoring
- gap reassessment

Controls:

- relevance threshold
- maximum automatic batch
- daily/monthly budget
- warning
- hard stop
- manual confirmation for large batches
- designated processing device

---

# 17. Privacy modes

- Local only
- Metadata and abstract only
- Selected sections
- Full paper
- Exclude private notes
- Confirm unpublished material
- Preview outbound content

The interface must always state when an external AI provider will receive paper content.

---

# 18. Activity and recovery

Activity centre shows:

- current queue
- completed tasks
- access-needed items
- API errors
- connector errors
- PDF failures
- Dropbox conflicts
- AI cost estimate
- model used
- saved output location
- retry/recovery actions

---

# 19. MVP scope

## Included

- PWA shell and approved design system
- persistent navigation
- local companion and pairing
- workspace creation/opening
- keychain-based AI credentials
- project and research-profile records
- PDF import
- paper library
- OpenAlex and Crossref discovery
- unified Discovery views
- duplicate detection
- open-access and institutional-access states
- watched downloads matching
- paper classification
- full-paper summary
- core extraction
- project relevance
- Reading Hub
- quick/standard/deep quests
- daily paper streak
- focus mode
- basic feedback learning
- activity centre
- backups and conflict warning

## Post-MVP

- Ask Library
- advanced vector retrieval
- sophisticated synthesis
- automated research-gap reassessment
- citation monitoring
- Zotero sync
- browser extension
- local-model runtime
- collaboration
- points, levels and achievements

---

# 20. Implementation milestones

## M0 — Repository and contracts

- monorepo structure
- development environments
- product docs
- schemas
- API contract
- design tokens
- CI
- basic security model

## M1 — Frontend shell

- PWA
- navigation
- routes
- mock screens
- responsive desktop safeguards
- component library
- accessibility baseline

## M2 — Companion foundation

- local server
- pairing
- workspace selection
- keychain
- health/version
- file APIs
- packaging proof of concept

## M3 — Project and paper storage

- workspace manifest
- project CRUD
- research profile
- paper records
- notes
- migrations
- backups

## M4 — Library and PDF

- PDF import
- metadata
- hashing
- duplicate detection
- PDF extraction
- paper page

## M5 — AI processing

- provider abstraction
- prompt/template registry
- classification
- summary
- extraction
- provenance
- caching

## M6 — Discovery

- OpenAlex
- Crossref
- search profiles
- scoring
- inbox
- three display modes

## M7 — Reading

- Reading Hub
- quests
- streak
- focus mode
- notes and progress

## M8 — Access workflow

- open-access lookup adapter
- institutional links
- download watcher
- PDF matching
- abstract-only upgrade

## M9 — Feedback

- labels
- profile update proposals
- relevance adjustments
- audit history

## M10 — Advanced intelligence

- Ask Library
- synthesis
- gap tracker
- citation monitoring

## M11 — Hardening

- signed installers
- macOS and Windows tests
- security review
- recovery tests
- Dropbox conflict tests
- performance
- documentation

---

# 21. Definition of done for each milestone

A milestone is complete only when:

- acceptance tests pass
- no high-severity security issue remains
- schemas and API docs are updated
- unit and integration tests are included
- desktop layouts keep content within panels
- loading, empty, error and disconnected states exist
- no secret is written to workspace or browser storage
- user-facing activity is understandable
- changes are documented

---

# 22. Repository structure

```text
research-intelligence/
├── AGENTS.md
├── README.md
├── apps/
│   └── web/
├── companion/
│   ├── src/
│   ├── tests/
│   └── packaging/
├── packages/
│   ├── schemas/
│   ├── design-tokens/
│   └── api-contract/
├── docs/
│   ├── product-overview.md
│   ├── architecture.md
│   ├── frontend-specification.md
│   ├── data-model.md
│   ├── workspace-format.md
│   ├── local-api.md
│   ├── ai-processing.md
│   ├── discovery.md
│   ├── reading-system.md
│   ├── institutional-access.md
│   ├── privacy-security.md
│   ├── acceptance-tests.md
│   └── roadmap.md
└── .github/
    └── workflows/
```

---

# 23. Required early technical spikes

Before full implementation, build four short proofs:

1. PWA on GitHub Pages connects securely to loopback companion.
2. Companion stores and retrieves a test secret from macOS Keychain and Windows Credential Manager.
3. Companion reads/writes a Dropbox-hosted workspace safely using atomic files.
4. PyInstaller packages a minimal companion on macOS and Windows.

Do not begin the complete platform until all four spikes pass.

---

# 24. Source notes for stack selection

- Vite official documentation: https://vite.dev/
- Vite PWA documentation: https://vite-pwa-org.netlify.app/
- FastAPI documentation: https://fastapi.tiangolo.com/
- Python keyring documentation: https://keyring.readthedocs.io/
- PyInstaller documentation: https://pyinstaller.org/
