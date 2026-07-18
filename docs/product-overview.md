# Product Overview

Research Intelligence is a desktop-first, local-first research intelligence platform for literature discovery, lawful full-text handling, structured reading, synthesis, and research-gap tracking.

This project is pre-alpha. The approved build specification defines the intended product and staged implementation, but application implementation has not started.

## Product Statement

The platform helps researchers:

- define research projects;
- discover relevant literature;
- obtain lawful full text;
- process and classify papers;
- complete structured reading quests;
- ask questions across a personal library;
- synthesize evidence;
- track whether proposed research gaps remain defensible.

The product should feel like a premium research command centre rather than a traditional reference manager.

## Initial User Model

The initial model is one researcher using one or more personal computers. User-owned research data lives in a local workspace selected by the user.

## Primary Surface

The primary surface is a desktop-first installable PWA. Mobile may later support simplified reading and notes, but it is not the primary design target.

## Core Principles

- Local-first ownership: user research data is stored in a normal user-selected folder.
- No central user database: GitHub contains application source code, not user data.
- Bring-your-own AI: users provide their own API key, and secrets are stored in the operating-system keychain.
- Transparent intelligence: AI-derived records must preserve provenance.
- Paper-type-aware processing: papers are classified before extraction and synthesis.
- Meaningful reading: reading progress is based on completed reading quests, not opening PDFs.
- Lawful access: the platform must never bypass paywalls or store institutional credentials.
- Desktop-first interface: text, vectors, data, and controls must remain within their panels.

## Task 0 Boundary

Codex Task 0 is repository foundation and technical spikes only. It must not implement OpenAlex, PDF processing, AI summaries, reading quests, synthesis, gap tracking, analytics, a central backend, or a cloud database.
