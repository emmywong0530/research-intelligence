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
