# Approved Prototype Reference

This folder is the visual and interaction source of truth for the Research Intelligence frontend.

## Purpose

The prototype converts the approved product concept into a standalone, inspectable HTML reference. It is not production code. Codex should use it to understand the intended layout, hierarchy, screen coverage, component behavior, vectors, spacing and visual language before implementing React components.

## Priority of sources

1. Product and security specifications under `docs/`
2. This prototype package
3. Production React implementation
4. Optional Figma mirror

## Run

Open `complete-prototype.html` directly in a browser. No build step, server or external dependency is required.

## Visual direction

- Near-black and charcoal surfaces
- Mint-green accent
- Muted white and grey typography
- Compact, data-rich desktop layout
- Persistent left navigation
- Rounded cards with low-contrast borders
- Subtle glow and restrained motion
- SVG/CSS-first functional visuals
- No childish gamification

## Implementation boundary

Task 1 may implement all screens with mock data. It must not add real discovery, PDF, AI or workspace processing beyond the approved Task 0 companion shell.
