# ADR 006: Shared Discovery records across views

## Status
Accepted

## Decision
Discovery Table, Card, and Paper Field are display modes over the same records, filters, selection, and actions.

The current interactive mock uses the shared records in
[`apps/web/src/mockData.ts`](../../apps/web/src/mockData.ts) and the shared
Discovery state in
[`apps/web/src/App.tsx`](../../apps/web/src/App.tsx), with coverage in
[`apps/web/src/App.test.tsx`](../../apps/web/src/App.test.tsx). This is an
`Interactive mock` state under
[`docs/feature-status-model.md`](../feature-status-model.md), not a claim of
production discovery persistence.

See [ADR 005](005-paper-type-specific-extraction.md) for future paper-type
processing and [ADR 001](001-local-first-pwa-companion.md) for the application
boundary.
