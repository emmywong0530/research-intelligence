# Discovery

The discovery system finds candidate literature and routes it into screening, import, or rejection workflows.

## Sources

Initial sources:

- OpenAlex;
- Crossref.

Later sources:

- Semantic Scholar;
- arXiv;
- PubMed;
- citation monitoring;
- discipline-specific APIs.

## Candidate Pipeline

```text
Metadata retrieval
-> identifier normalisation
-> duplicate detection
-> exclusion rules
-> keyword scoring
-> semantic scoring
-> citation-network scoring
-> optional AI judgment
-> inbox / auto-import / reject
```

## Unified Display Data

Table, card, and Paper Field views must display:

- title;
- year;
- project;
- paper type;
- relevance percentage;
- relevance explanation;
- access state;
- estimated reading time;
- primary actions.

## Display Modes

- Table: default for screening and batch work.
- Card: richer browsing.
- Paper Field: immersive spatial selection.

All views share the same filters, selection, and actions.

## Task 0 Boundary

Task 0 must not implement OpenAlex, Crossref, scoring, inbox, production screening, or discovery automation.
