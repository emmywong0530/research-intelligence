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
enrichment, discovery, notes, and reading actions remain unavailable.
