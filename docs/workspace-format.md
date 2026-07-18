# Workspace Format

The user workspace is a normal folder selected by the user. It is not part of this repository and must not be committed.

## Folder Structure

```text
Research Intelligence Workspace/
|-- workspace.json
|-- projects/
|   `-- <project-id>/
|       |-- project.json
|       |-- research-profile.json
|       |-- search-profile.json
|       |-- feedback-profile.json
|       `-- settings.json
|-- papers/
|   `-- <paper-id>/
|       |-- metadata.json
|       |-- paper.pdf
|       |-- extracted-text.json
|       |-- classification.json
|       |-- studies.json
|       |-- summary.json
|       |-- extraction.json
|       |-- project-connections.json
|       |-- reading-progress.json
|       |-- notes.md
|       `-- provenance.json
|-- syntheses/
|-- gaps/
|-- feedback/
|-- activity/
`-- backups/
```

## Durable and Synchronized Data

The following are durable and synchronized through normal file sync if the user chooses that:

- projects;
- PDFs;
- notes;
- metadata;
- summaries;
- extractions;
- reading progress;
- project relevance;
- synthesis;
- gap assessments;
- settings excluding secrets.

## Device-Local and Rebuildable Data

The following are device-local and rebuildable:

- SQLite index;
- full-text index;
- vector index;
- task queue;
- temporary files;
- thumbnails;
- logs;
- machine role;
- API credentials.

## File Safety

Workspace writes must use atomic temporary-file plus rename behavior. Durable JSON records require schema versions. The system should use content hashes for PDFs and generated analyses, optimistic concurrency metadata, conflict detection before write, and versioned backups.

A single cloud-synchronized monolithic database must never be used as the durable source of truth.
