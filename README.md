# Research Intelligence

Research Intelligence is a desktop-first, local-first research platform for literature discovery, lawful full-text handling, structured reading, synthesis, and research-gap tracking.

The project is **pre-alpha**. This repository currently contains planning material and the intended monorepo skeleton only. Application implementation has not started yet.

## Architecture

Research Intelligence is designed around three surfaces:

- A static, installable web app in `apps/web`, intended to remain compatible with public static hosting such as GitHub Pages.
- A private local companion in `companion`, intended to bind only to loopback and handle local files, keychain secrets, indexing, and processing.
- A user-owned workspace folder outside the repository, where papers, notes, metadata, analyses, indexes, and other research data live.

There is no central user database. Durable user data should be stored as normal files in the user's chosen workspace, while device-local indexes and caches should be rebuildable.

## Data Safety

User papers and research data must never be committed to this repository.

Do not commit PDFs, private notes, workspace folders, local databases, extracted text, AI outputs, API keys, credentials, tokens, logs containing private content, or institutional-access material. The repository is for source code, schemas, contracts, documentation, and tests only.

## Intended Repository Structure

```text
research-intelligence/
├── .github/
│   └── workflows/
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
│   ├── tasks/
│   └── prototypes/
├── AGENTS.md
├── README.md
├── LICENSE
└── .gitignore
```

Planning documents currently live under `docs/`. Task briefs belong in `docs/tasks/`, and exploratory UI or workflow prototypes belong in `docs/prototypes/`.
