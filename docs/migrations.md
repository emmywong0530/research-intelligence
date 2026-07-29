# Durable Migrations

## Paper Metadata: `m2.v1` to `m4d.v1`

Task 4D adds the `m4d.v1` paper metadata contract. Existing Task 3E paper
records remain readable because `m2.v1` is still accepted by the schema and is
upgraded explicitly when the workspace opens.

The migration is implemented by
`companion/src/research_intelligence_companion/paper_metadata.py` and invoked
by `companion/src/research_intelligence_companion/workspace.py` during
workspace open. It:

- preserves `paper_id`, `assigned_project_ids`, title, ordered legacy authors,
  year, venue, DOI, abstract, timestamps and existing processing/source
  associations;
- preserves legacy author strings as `author_details[].literal_name` rather
  than guessing given/family names;
- normalizes supported DOI and other identifier forms without network access;
- records `metadata_provenance.record_origin: "imported_record"`;
- writes through the existing validated record transaction and pre-write
  backup;
- is idempotent once the record is `m4d.v1`;
- rejects malformed records and unknown future versions without overwriting
  them.

The durable path remains
`papers/<paper-id>/metadata.json`. Source PDFs, extraction artifacts, notes
and duplicate-review records are separate durable records and are not rewritten
as part of metadata migration.

The migration does not infer metadata, contact remote services, verify
identifiers globally, or calculate completeness as a stored field.

Fixtures and compatibility coverage live in
`companion/tests/fixtures/task4d/` and
`companion/tests/test_task4d_paper_metadata.py`.
