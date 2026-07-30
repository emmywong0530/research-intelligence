# ADR 005: Paper-type-specific extraction

## Status
Accepted

## Decision
Classify before extraction. Quantitative, qualitative, conceptual, review/meta-analysis, and computational papers use different schemas and synthesis treatment.

This remains an accepted product and data-model decision, not a Task 2
implementation claim. Task 4A and Task 4B now provide explicit local PDF
registration and bounded deterministic extraction, but Task 4D paper metadata
never infers fields from PDF text;
the future implementation must preserve the provenance requirements in
[`docs/ai-processing.md`](../ai-processing.md), the schema/version rules in
[`docs/data-model.md`](../data-model.md), and the local-first boundary in
[ADR 001](001-local-first-pwa-companion.md).
