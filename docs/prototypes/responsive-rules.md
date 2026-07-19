# Responsive and Containment Rules

## Primary target
Desktop first, designed for 1280–1600 px wide displays.

## Required safeguards
- `box-sizing: border-box` globally
- `min-width: 0` on flex and grid children
- `minmax(0, 1fr)` for flexible grid tracks
- Wrapping for long titles and metadata
- `overflow-wrap: anywhere` for long identifiers
- SVGs use a bounded `viewBox`, `width: 100%`, and `height: auto`
- Dense tables use their own horizontal-scroll container
- No fixed-width element may escape its panel
- Absolute positioning is permitted only for contained visualisations such as Paper Field

## Breakpoints
- Above 1100 px: full desktop grids
- 720–1100 px: stacked complex layouts and two-column cards where suitable
- Below 720 px: single-column content and compact sidebar

## Visual regression sizes
- 1440 × 1000
- 1280 × 800
- 1024 × 768
