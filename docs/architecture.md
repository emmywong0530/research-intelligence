# Architecture

Research Intelligence uses a local-first architecture with three surfaces:

- a public static frontend;
- a private local companion;
- a user-owned workspace.

The architecture is designed so source code can live in GitHub while papers, notes, analyses, credentials, and research data remain under user control.

## Static Frontend

The frontend is a GitHub-Pages-compatible React/Vite PWA. It is the primary user interface and should remain static-host compatible.

Expected frontend stack:

- React;
- TypeScript;
- Vite;
- Vite PWA integration;
- React Router;
- TanStack Query for companion request state;
- Zustand or an equivalent small local UI state store;
- SVG and CSS for functional vectors;
- Vitest;
- React Testing Library;
- Playwright.

The frontend must not store API keys in localStorage, sessionStorage, workspace files, logs, or source control.

## Local Companion

The local companion is a private service that runs on the user's computer and exposes a versioned local API. It handles local files, keychain-backed secrets, indexing, processing, and workspace operations.

Expected companion stack:

- Python;
- FastAPI;
- Uvicorn;
- Pydantic;
- Python `keyring`;
- watchdog for folder monitoring;
- SQLite and FTS5 for device-local indexing;
- a swappable local vector-index adapter;
- PyMuPDF for PDF extraction;
- PyInstaller for macOS and Windows packaging.

The companion must bind only to loopback addresses and reject remote interfaces.

## User-Owned Workspace

Durable research data is stored as normal files inside a user-selected workspace folder. Device-local indexes, queues, temporary files, thumbnails, logs, machine role, and API credentials are rebuildable and must not be treated as the durable source of truth.

## Public Deployment

The repository uses GitHub and GitHub Actions. The frontend is intended for GitHub Pages, with separate signed companion releases for macOS and Windows.

## Required Early Spikes

Before full implementation, Task 0 must validate:

1. a GitHub-Pages-compatible PWA can communicate with a loopback-only companion;
2. the companion can store secrets in the operating-system keychain without exposing them to the PWA;
3. the companion can safely read and atomically update a workspace folder that may be inside Dropbox;
4. the companion can be packaged on macOS and Windows with PyInstaller.
