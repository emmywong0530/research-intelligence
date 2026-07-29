from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from conftest import VALID_ORIGIN, paired_headers
from research_intelligence_companion.paper_metadata import (
    PAPER_SCHEMA_VERSION,
    migrate_paper_payload,
    normalize_identifier,
    normalize_paper_payload,
    paper_completeness,
    validate_paper_metadata,
)

TIMESTAMP = "2026-07-19T12:00:00Z"
FIXTURES = Path(__file__).parent / "fixtures" / "task4d"


def project_record(project_id: str) -> dict[str, object]:
    return {
        "schema_version": "m2.v1",
        "project_id": project_id,
        "name": "Metadata project",
        "natural_language_research_idea": "Keep structured metadata local.",
        "central_research_question": "Can paper metadata remain portable?",
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def paper_record(project_id: str, paper_id: str = "paper-metadata") -> dict[str, object]:
    return {
        "schema_version": "m2.v1",
        "paper_id": paper_id,
        "title": "Metadata paper",
        "authors": ["A. Researcher", "B. Scholar"],
        "year": 2024,
        "publication_venue": "Local Journal",
        "doi": "10.1234/METADATA",
        "abstract": "A bounded abstract.",
        "pdf_access_status": "unavailable",
        "assigned_project_ids": [project_id],
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def workspace_with_project(client: TestClient, tmp_path: Path) -> tuple[dict[str, str], Path, str]:
    headers = paired_headers(client, {"Origin": VALID_ORIGIN})
    workspace_path = tmp_path / "task4d-workspace"
    created = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(workspace_path), "name": "Task 4D Workspace"},
    )
    assert created.status_code == 200, created.text
    workspace_id = created.json()["workspace_id"]
    project_id = "project-legacy"
    project = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/projects/{project_id}",
        headers=headers,
        json={"record": project_record(project_id)},
    )
    assert project.status_code == 200, project.text
    return headers, workspace_path, workspace_id


def test_legacy_migration_preserves_ordered_authors_and_is_idempotent() -> None:
    legacy = json.loads((FIXTURES / "legacy-paper.json").read_text(encoding="utf-8"))
    migrated, changed = migrate_paper_payload(legacy)
    assert changed is True
    assert migrated["schema_version"] == PAPER_SCHEMA_VERSION
    assert migrated["authors"] == legacy["authors"]
    assert [author["literal_name"] for author in migrated["author_details"]] == legacy["authors"]
    assert migrated["identifiers"]["doi"] == "10.1234/legacy"
    validate_paper_metadata(migrated)
    again, changed_again = migrate_paper_payload(migrated)
    assert changed_again is False
    assert again == migrated


def test_future_paper_version_is_refused() -> None:
    future = json.loads((FIXTURES / "future-paper.json").read_text(encoding="utf-8"))
    try:
        migrate_paper_payload(future)
    except ValueError as error:
        assert "Unsupported paper schema version" in str(error)
    else:
        raise AssertionError("future paper schema was accepted")


def test_open_workspace_migrates_paper_and_keeps_durable_path(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id = workspace_with_project(client, tmp_path)
    created = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-metadata",
        headers=headers,
        json={"record": paper_record("project-legacy"), "parent_id": "project-legacy"},
    )
    assert created.status_code == 200, created.text
    legacy_path = workspace_path / "papers" / "paper-metadata" / "metadata.json"
    legacy_path.write_text(json.dumps(paper_record("project-legacy")), encoding="utf-8")
    reopened = client.post(
        "/api/v1/workspaces/open",
        headers=headers,
        json={"path": str(workspace_path)},
    )
    assert reopened.status_code == 200, reopened.text
    read = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-metadata",
        headers=headers,
    )
    assert read.status_code == 200, read.text
    assert read.json()["record"]["schema_version"] == PAPER_SCHEMA_VERSION
    assert read.json()["relative_path"] == "papers/paper-metadata/metadata.json"
    assert read.json()["record"]["identifiers"]["doi"] == "10.1234/metadata"
    backups = list((workspace_path / "backups").glob("*/manifest.json"))
    assert backups, "migration should retain a pre-write backup"


def test_m4d_metadata_rejects_unsafe_url_and_unknown_identifier_before_write(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id = workspace_with_project(client, tmp_path)
    record = paper_record("project-legacy")
    record.update(
        {
            "schema_version": PAPER_SCHEMA_VERSION,
            "author_details": [{"literal_name": "A. Researcher"}, {"literal_name": "B. Scholar"}],
            "metadata_provenance": {"record_origin": "manual"},
            "identifiers": {"doi": "10.1234/metadata"},
            "url": "file:///Users/private/paper.pdf",
        }
    )
    response = client.put(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-unsafe",
        headers=headers,
        json={"record": {**record, "paper_id": "paper-unsafe"}, "parent_id": "project-legacy"},
    )
    assert response.status_code == 400
    assert not (workspace_path / "papers/paper-unsafe/metadata.json").exists()


def test_completeness_is_derived_and_not_durable() -> None:
    record = paper_record("project-legacy")
    result = paper_completeness(record)
    assert result["percentage"] > 0
    assert "keywords" in result["missing_fields"]
    assert "completeness" not in record


def test_structured_author_and_identifier_normalization_is_local() -> None:
    record = paper_record("project-legacy")
    record.update(
        {
            "schema_version": PAPER_SCHEMA_VERSION,
            "author_details": [
                {"literal_name": "A. Researcher", "orcid": "https://orcid.org/0000-0002-1825-0097"},
                {"literal_name": "B. Scholar"},
            ],
            "identifiers": {"doi": "https://doi.org/10.1234/Metadata", "pmid": "PMID:12345"},
            "metadata_provenance": {"record_origin": "manual"},
        }
    )
    normalized = normalize_paper_payload(record)
    assert normalized["author_details"][0]["orcid"] == "0000-0002-1825-0097"
    assert normalized["identifiers"] == {"doi": "10.1234/metadata", "pmid": "12345"}
    assert normalize_identifier("doi", "https://doi.org/10.1234/Metadata") == "10.1234/metadata"
    validate_paper_metadata(normalized)


def test_invalid_orcid_and_unknown_identifier_are_rejected() -> None:
    record = paper_record("project-legacy")
    record.update(
        {
            "schema_version": PAPER_SCHEMA_VERSION,
            "author_details": [
                {"literal_name": "A. Researcher", "orcid": "not-an-orcid"},
                {"literal_name": "B. Scholar"},
            ],
            "identifiers": {"unsupported": "value"},
            "metadata_provenance": {"record_origin": "manual"},
        }
    )
    try:
        validate_paper_metadata(record)
    except ValueError as error:
        assert "identifier" in str(error).lower() or "orcid" in str(error).lower()
    else:
        raise AssertionError("invalid structured metadata was accepted")
