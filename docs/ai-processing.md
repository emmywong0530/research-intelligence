# AI Processing

Research Intelligence uses bring-your-own AI. Users provide their own API key, and secrets are stored through the operating-system keychain by the local companion.

## Privacy Requirements

- API keys must not be stored in browser storage, workspace files, logs, or source control.
- The PWA must never receive keychain values.
- The interface must state when an external AI provider will receive paper content.
- Unpublished material must not be processed externally without confirmation.

## Paper Classification

Classification is hierarchical and multi-label:

- publication type;
- research type;
- methodological subtype;
- evidence structure;
- paper-level and study-level records.

Papers must be classified before extraction and synthesis.

## Default Full-Paper Summary

The default full-paper summary contains:

1. 30-second summary;
2. research question and contribution;
3. theory and hypotheses;
4. method and sample;
5. main findings;
6. limitations;
7. relevance to each assigned project.

## Provenance

Every AI record stores:

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

## Automation

Independent automation settings include:

- scheduled discovery;
- AI relevance screening;
- classification;
- full-paper summary;
- theory, method, and variable extraction;
- project connections;
- reading recommendations;
- concept timeline;
- citation monitoring;
- gap reassessment.

Controls include relevance threshold, maximum automatic batch, daily/monthly budget, warning, hard stop, manual confirmation for large batches, and designated processing device.

## Task 0 Boundary

Task 0 must not implement AI summaries, production extraction, OpenAlex discovery, reading quests, synthesis, or gap tracking.
