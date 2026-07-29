from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import VALID_ORIGIN, paired_headers
from research_intelligence_companion import duplicate_detection
from test_task3e_paper_records import paper_record, project_record, write_paper

PDF_A = b"%PDF-1.7\nexact local bytes A\n%%EOF\n"
PDF_B = b"%PDF-1.7\nother local bytes B\n%%EOF\n"
TIMESTAMP = "2026-07-29T10:00:00Z"


def duplicate_paper(paper_id: str, project_id: str, **overrides: object) -> dict[str, object]:
    record = paper_record(paper_id, project_id, title="A Normalized Study")
    record.update(
        {
            "authors": ["Jane Doe"],
            "year": 2024,
            "doi": None,
            "updated_at": TIMESTAMP,
        }
    )
    record.update(overrides)
    return record


def create_duplicate_workspace(
    client: TestClient, tmp_path: Path
) -> tuple[dict[str, str], Path, str]:
    headers = paired_headers(client, {"Origin": VALID_ORIGIN})
    workspace_path = tmp_path / "task4c-workspace"
    created = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(workspace_path), "name": "Task 4C Workspace"},
    )
    assert created.status_code == 200, created.text
    workspace_id = created.json()["workspace_id"]
    for project_id in ("project-paper-a", "project-paper-b"):
        response = client.put(
            f"/api/v1/workspaces/{workspace_id}/records/projects/{project_id}",
            headers=headers,
            json={"record": project_record(project_id)},
        )
        assert response.status_code == 200, response.text
    for paper_id, project_id in (("paper-a", "project-paper-a"), ("paper-b", "project-paper-b")):
        response = write_paper(
            client,
            headers,
            workspace_id,
            duplicate_paper(paper_id, project_id),
            parent_id=project_id,
        )
        assert response.status_code == 200, response.text
    return headers, workspace_path, workspace_id


def create_single_paper_workspace(
    client: TestClient, tmp_path: Path, suffix: str
) -> tuple[dict[str, str], Path, str]:
    headers = paired_headers(client, {"Origin": VALID_ORIGIN})
    workspace_path = tmp_path / f"single-workspace-{suffix}"
    created = client.post(
        "/api/v1/workspaces/create",
        headers=headers,
        json={"path": str(workspace_path), "name": f"Single Workspace {suffix}"},
    )
    assert created.status_code == 200, created.text
    workspace_id = created.json()["workspace_id"]
    project_id = f"project-single-{suffix}"
    paper_id = f"paper-single-{suffix}"
    assert (
        client.put(
            f"/api/v1/workspaces/{workspace_id}/records/projects/{project_id}",
            headers=headers,
            json={"record": project_record(project_id)},
        ).status_code
        == 200
    )
    assert (
        write_paper(
            client,
            headers,
            workspace_id,
            duplicate_paper(paper_id, project_id),
            parent_id=project_id,
        ).status_code
        == 200
    )
    return headers, workspace_path, workspace_id


def upload_pdf(
    client: TestClient,
    headers: dict[str, str],
    workspace_id: str,
    project_id: str,
    paper_id: str,
    content: bytes,
    revision: str,
    *,
    replace: bool = False,
):
    return client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/source-file",
        headers={
            **headers,
            "Content-Type": "application/pdf",
            "X-Original-Filename": f"{paper_id}.pdf",
        },
        params={"replace": str(replace).lower(), "expected_revision": revision},
        content=content,
    )


def duplicate_report(client: TestClient, headers: dict[str, str], workspace_id: str):
    return client.get(f"/api/v1/workspaces/{workspace_id}/duplicates", headers=headers)


def test_normalization_is_unicode_case_whitespace_and_punctuation_conservative() -> None:
    assert duplicate_detection.normalize_title("  Ａ Study:  Title ! ") == "a study: title"
    assert duplicate_detection.normalize_title("A   Study : Title!") == "a study: title"
    assert duplicate_detection.normalize_title("A study title?") == "a study title"
    assert duplicate_detection.normalize_author_surname("Doe, Jane") == "doe"
    assert duplicate_detection.normalize_author_surname("Jane Doe") == "doe"
    assert duplicate_detection.normalize_author_surname("van der Waals") == "waals"


@pytest.mark.parametrize(
    ("kind", "value", "expected"),
    [
        ("doi", "https://doi.org/10.1234/ABC", "10.1234/abc"),
        ("doi", "doi:10.1234/ABC", "10.1234/abc"),
        ("pmid", "PMID:12345", "12345"),
        ("arXiv", "arXiv:2401.12345v2", "2401.12345v2"),
    ],
)
def test_identifier_normalization_is_type_aware(kind: str, value: str, expected: str) -> None:
    assert duplicate_detection.normalize_identifier(kind, value) == expected


@pytest.mark.parametrize(
    ("kind", "value"),
    [
        ("doi", "10.1234"),
        ("pmid", "PMID:abc"),
        ("arxiv", "not-an-arxiv-id"),
        ("isbn", "10.1234/abc"),
    ],
)
def test_malformed_or_unsupported_identifiers_are_excluded(kind: str, value: str) -> None:
    assert duplicate_detection.normalize_identifier(kind, value) is None


def test_exact_source_identifier_and_metadata_groups_are_workspace_scoped(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _workspace_path, workspace_id = create_duplicate_workspace(client, tmp_path)
    papers = [
        client.get(
            f"/api/v1/workspaces/{workspace_id}/records/papers/{paper_id}", headers=headers
        ).json()
        for paper_id in ("paper-a", "paper-b")
    ]
    for paper, project_id in zip(papers, ("project-paper-a", "project-paper-b"), strict=True):
        record = paper["record"]
        record["doi"] = "https://doi.org/10.5555/shared"
        updated = write_paper(
            client,
            headers,
            workspace_id,
            record,
            parent_id=project_id,
            expected_revision=paper["revision"],
        )
        assert updated.status_code == 200, updated.text
    revisions = {
        paper_id: client.get(
            f"/api/v1/workspaces/{workspace_id}/records/papers/{paper_id}", headers=headers
        ).json()["revision"]
        for paper_id in ("paper-a", "paper-b")
    }
    assert (
        upload_pdf(
            client, headers, workspace_id, "project-paper-a", "paper-a", PDF_A, revisions["paper-a"]
        ).status_code
        == 200
    )
    revisions["paper-b"] = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-b", headers=headers
    ).json()["revision"]
    assert (
        upload_pdf(
            client, headers, workspace_id, "project-paper-b", "paper-b", PDF_A, revisions["paper-b"]
        ).status_code
        == 200
    )

    response = duplicate_report(client, headers, workspace_id)
    assert response.status_code == 200, response.text
    payload = response.json()
    types = {group["evidence_type"] for group in payload["groups"]}
    assert types == {"exact_source", "exact_identifier", "metadata_candidate"}
    assert sum(
        any(paper["paper_id"] == "paper-a" for paper in group["papers"])
        for group in payload["groups"]
    ) == 3
    repeated = duplicate_report(client, headers, workspace_id).json()
    assert [group["group_fingerprint"] for group in payload["groups"]] == [
        group["group_fingerprint"] for group in repeated["groups"]
    ]
    source_group = next(
        group for group in payload["groups"] if group["evidence_type"] == "exact_source"
    )
    assert {paper["project_id"] for paper in source_group["papers"]} == {
        "project-paper-a",
        "project-paper-b",
    }
    assert "PDF_A" not in json.dumps(payload)
    assert "research-intelligence" not in json.dumps(payload)
    assert payload["summary"]["papers_with_evidence"] == 2
    group_response = client.get(
        f"/api/v1/workspaces/{workspace_id}/duplicates/{source_group['group_fingerprint']}",
        headers=headers,
    )
    assert group_response.status_code == 200, group_response.text
    assert group_response.json()["group"]["group_fingerprint"] == source_group["group_fingerprint"]

    project_filtered = client.get(
        f"/api/v1/workspaces/{workspace_id}/duplicates?project_id=project-paper-a", headers=headers
    )
    assert project_filtered.status_code == 200
    assert all(
        any(paper["project_id"] == "project-paper-a" for paper in group["papers"])
        for group in project_filtered.json()["groups"]
    )


def test_different_source_bytes_and_identifier_types_do_not_match(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _workspace_path, workspace_id = create_duplicate_workspace(client, tmp_path)
    revisions = {
        paper_id: client.get(
            f"/api/v1/workspaces/{workspace_id}/records/papers/{paper_id}", headers=headers
        ).json()["revision"]
        for paper_id in ("paper-a", "paper-b")
    }
    assert (
        upload_pdf(
            client, headers, workspace_id, "project-paper-a", "paper-a", PDF_A, revisions["paper-a"]
        ).status_code
        == 200
    )
    revisions["paper-b"] = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-b", headers=headers
    ).json()["revision"]
    assert (
        upload_pdf(
            client, headers, workspace_id, "project-paper-b", "paper-b", PDF_B, revisions["paper-b"]
        ).status_code
        == 200
    )
    response = duplicate_report(client, headers, workspace_id)
    assert response.status_code == 200
    assert not any(group["evidence_type"] == "exact_source" for group in response.json()["groups"])

    for paper_id, project_id, identifier in (
        ("paper-a", "project-paper-a", {"pmid": "12345"}),
        ("paper-b", "project-paper-b", {"arxiv": "2401.12345"}),
    ):
        current = client.get(
            f"/api/v1/workspaces/{workspace_id}/records/papers/{paper_id}", headers=headers
        ).json()
        record = current["record"]
        record["external_identifiers"] = identifier
        updated = write_paper(
            client,
            headers,
            workspace_id,
            record,
            parent_id=project_id,
            expected_revision=current["revision"],
        )
        assert updated.status_code == 200, updated.text
    response = duplicate_report(client, headers, workspace_id)
    assert response.status_code == 200
    assert not any(
        group["evidence_type"] == "exact_identifier" for group in response.json()["groups"]
    )


def test_same_pdf_in_separate_workspaces_is_never_compared(
    client: TestClient, tmp_path: Path
) -> None:
    headers_a, _path_a, workspace_a = create_single_paper_workspace(client, tmp_path, "a")
    headers_b, _path_b, workspace_b = create_single_paper_workspace(client, tmp_path, "b")
    for headers, workspace_id, project_id, paper_id in (
        (headers_a, workspace_a, "project-single-a", "paper-single-a"),
        (headers_b, workspace_b, "project-single-b", "paper-single-b"),
    ):
        current = client.get(
            f"/api/v1/workspaces/{workspace_id}/records/papers/{paper_id}", headers=headers
        ).json()
        assert (
            upload_pdf(
                client,
                headers,
                workspace_id,
                project_id,
                paper_id,
                PDF_A,
                current["revision"],
            ).status_code
            == 200
        )
    report_a = duplicate_report(client, headers_a, workspace_a).json()
    report_b = duplicate_report(client, headers_b, workspace_b).json()
    assert report_a["summary"]["group_count"] == 0
    assert report_b["summary"]["group_count"] == 0
    assert report_a["workspace_id"] != report_b["workspace_id"]


def test_metadata_candidates_require_matching_present_values_and_matching_missing_values(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _workspace_path, workspace_id = create_duplicate_workspace(client, tmp_path)
    for paper_id, project_id, year, authors in (
        ("paper-a", "project-paper-a", 2024, ["Jane Doe"]),
        ("paper-b", "project-paper-b", 2025, ["Jane Doe"]),
    ):
        current = client.get(
            f"/api/v1/workspaces/{workspace_id}/records/papers/{paper_id}", headers=headers
        ).json()
        record = current["record"]
        record.update({"title": "Same title", "year": year, "authors": authors})
        assert (
            write_paper(
                client,
                headers,
                workspace_id,
                record,
                parent_id=project_id,
                expected_revision=current["revision"],
            ).status_code
            == 200
        )
    report = duplicate_report(client, headers, workspace_id).json()
    assert not any(group["evidence_type"] == "metadata_candidate" for group in report["groups"])

    current = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-b", headers=headers
    ).json()
    record = current["record"]
    record.pop("year", None)
    record["authors"] = ["Jane Doe"]
    assert (
        write_paper(
            client,
            headers,
            workspace_id,
            record,
            parent_id="project-paper-b",
            expected_revision=current["revision"],
        ).status_code
        == 200
    )
    report = duplicate_report(client, headers, workspace_id).json()
    assert not any(group["evidence_type"] == "metadata_candidate" for group in report["groups"])

    current = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-b", headers=headers
    ).json()
    record = current["record"]
    record["authors"] = ["Different Person"]
    assert (
        write_paper(
            client,
            headers,
            workspace_id,
            record,
            parent_id="project-paper-b",
            expected_revision=current["revision"],
        ).status_code
        == 200
    )
    report = duplicate_report(client, headers, workspace_id).json()
    assert not any(group["evidence_type"] == "metadata_candidate" for group in report["groups"])

    current = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-b", headers=headers
    ).json()
    record = current["record"]
    record["year"] = 2024
    record["authors"] = ["Jane Doe"]
    assert (
        write_paper(
            client,
            headers,
            workspace_id,
            record,
            parent_id="project-paper-b",
            expected_revision=current["revision"],
        ).status_code
        == 200
    )
    report = duplicate_report(client, headers, workspace_id).json()
    assert any(group["evidence_type"] == "metadata_candidate" for group in report["groups"])


def test_group_fingerprint_is_stable_for_input_order() -> None:
    first, evidence = duplicate_detection._fingerprints(
        "metadata_candidate", ("a title", 2024, "doe"), ["paper-b", "paper-a"]
    )
    second, same_evidence = duplicate_detection._fingerprints(
        "metadata_candidate", ("a title", 2024, "doe"), ["paper-a", "paper-b"]
    )
    assert first == second
    assert evidence == same_evidence


def test_metadata_changes_and_source_replacement_rebuild_groups(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _workspace_path, workspace_id = create_duplicate_workspace(client, tmp_path)
    for paper_id, project_id in (("paper-a", "project-paper-a"), ("paper-b", "project-paper-b")):
        current = client.get(
            f"/api/v1/workspaces/{workspace_id}/records/papers/{paper_id}", headers=headers
        ).json()
        record = current["record"]
        record["title"] = "Different title"
        record["authors"] = [f"Author {paper_id}"]
        record["year"] = 2020 if paper_id == "paper-a" else 2021
        updated = write_paper(
            client,
            headers,
            workspace_id,
            record,
            parent_id=project_id,
            expected_revision=current["revision"],
        )
        assert updated.status_code == 200, updated.text
    report = duplicate_report(client, headers, workspace_id).json()
    assert not any(group["evidence_type"] == "metadata_candidate" for group in report["groups"])

    for paper_id, project_id in (("paper-a", "project-paper-a"), ("paper-b", "project-paper-b")):
        current = client.get(
            f"/api/v1/workspaces/{workspace_id}/records/papers/{paper_id}", headers=headers
        ).json()
        record = current["record"]
        record["title"] = "Same title."
        record["authors"] = ["Jane Doe"]
        record["year"] = 2024
        updated = write_paper(
            client,
            headers,
            workspace_id,
            record,
            parent_id=project_id,
            expected_revision=current["revision"],
        )
        assert updated.status_code == 200, updated.text
    report = duplicate_report(client, headers, workspace_id).json()
    metadata_group = next(
        group for group in report["groups"] if group["evidence_type"] == "metadata_candidate"
    )
    old_fingerprint = metadata_group["group_fingerprint"]
    assert (
        upload_pdf(
            client,
            headers,
            workspace_id,
            "project-paper-a",
            "paper-a",
            PDF_A,
            client.get(
                f"/api/v1/workspaces/{workspace_id}/records/papers/paper-a", headers=headers
            ).json()["revision"],
        ).status_code
        == 200
    )
    current_b = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-b", headers=headers
    ).json()
    assert (
        upload_pdf(
            client,
            headers,
            workspace_id,
            "project-paper-b",
            "paper-b",
            PDF_A,
            current_b["revision"],
        ).status_code
        == 200
    )
    report = duplicate_report(client, headers, workspace_id).json()
    assert any(group["evidence_type"] == "exact_source" for group in report["groups"])
    assert any(group["group_fingerprint"] == old_fingerprint for group in report["groups"])
    current_b = client.get(
        f"/api/v1/workspaces/{workspace_id}/records/papers/paper-b", headers=headers
    ).json()
    replaced = upload_pdf(
        client,
        headers,
        workspace_id,
        "project-paper-b",
        "paper-b",
        PDF_B,
        current_b["revision"],
        replace=True,
    )
    assert replaced.status_code == 200, replaced.text
    assert not any(
        group["evidence_type"] == "exact_source"
        for group in duplicate_report(client, headers, workspace_id).json()["groups"]
    )


def test_review_state_is_strict_persistent_and_revision_aware(
    client: TestClient, tmp_path: Path
) -> None:
    headers, workspace_path, workspace_id = create_duplicate_workspace(client, tmp_path)
    response = duplicate_report(client, headers, workspace_id)
    group = next(
        group
        for group in response.json()["groups"]
        if group["evidence_type"] == "metadata_candidate"
    )
    reviewed_group_fingerprint = group["group_fingerprint"]
    reviewed = client.post(
        f"/api/v1/workspaces/{workspace_id}/duplicates/reviews",
        headers=headers,
        json={
            "group_fingerprint": reviewed_group_fingerprint,
            "review_status": "reviewed_not_duplicate",
        },
    )
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["group"]["review_status"] == "reviewed_not_duplicate"
    review_path = (
        workspace_path
        / "feedback/duplicate-reviews"
        / f"duplicate_review_{reviewed_group_fingerprint}.json"
    )
    assert review_path.is_file()
    stale = client.post(
        f"/api/v1/workspaces/{workspace_id}/duplicates/reviews",
        headers=headers,
        json={
            "group_fingerprint": reviewed_group_fingerprint,
            "review_status": "ignored",
            "expected_revision": "stale-review-revision",
        },
    )
    assert stale.status_code == 409
    reopened = client.post(
        "/api/v1/workspaces/open", headers=headers, json={"path": str(workspace_path)}
    )
    assert reopened.status_code == 200
    persisted = duplicate_report(client, headers, workspace_id)
    assert persisted.status_code == 200
    persisted_group = next(
        group
        for group in persisted.json()["groups"]
        if group["group_fingerprint"] == reviewed_group_fingerprint
        and group["evidence_type"] == "metadata_candidate"
    )
    assert persisted_group["review_status"] == "reviewed_not_duplicate"
    (workspace_path / "feedback/duplicate-reviews/unknown.json").write_text(
        json.dumps({"schema_version": "m99.future"}) + "\n", encoding="utf-8"
    )
    warned = duplicate_report(client, headers, workspace_id)
    assert any("malformed duplicate review" in warning for warning in warned.json()["warnings"])


def test_duplicate_endpoint_requires_authentication_and_exact_origin(
    client: TestClient, tmp_path: Path
) -> None:
    headers, _workspace_path, workspace_id = create_duplicate_workspace(client, tmp_path)
    assert (
        client.get(
            f"/api/v1/workspaces/{workspace_id}/duplicates", headers={"Origin": VALID_ORIGIN}
        ).status_code
        == 401
    )
    assert (
        client.get(
            f"/api/v1/workspaces/{workspace_id}/duplicates",
            headers={**headers, "Origin": "https://unconfigured.invalid"},
        ).status_code
        == 403
    )
    missing_origin = {key: value for key, value in headers.items() if key.lower() != "origin"}
    assert (
        client.get(
            f"/api/v1/workspaces/{workspace_id}/duplicates", headers=missing_origin
        ).status_code
        == 403
    )


def test_corrupt_source_is_reported_and_excluded(client: TestClient, tmp_path: Path) -> None:
    headers, workspace_path, workspace_id = create_duplicate_workspace(client, tmp_path)
    for paper_id, project_id in (("paper-a", "project-paper-a"), ("paper-b", "project-paper-b")):
        current = client.get(
            f"/api/v1/workspaces/{workspace_id}/records/papers/{paper_id}", headers=headers
        ).json()
        uploaded = upload_pdf(
            client, headers, workspace_id, project_id, paper_id, PDF_A, current["revision"]
        )
        assert uploaded.status_code == 200
    missing_source = workspace_path / "papers/paper-b/source/original.pdf"
    missing_source.unlink()
    missing_response = duplicate_report(client, headers, workspace_id)
    assert missing_response.status_code == 200, missing_response.text
    assert any("unverifiable source" in warning for warning in missing_response.json()["warnings"])
    assert not any(
        group["evidence_type"] == "exact_source" for group in missing_response.json()["groups"]
    )
    missing_source.write_bytes(PDF_B)
    response = duplicate_report(client, headers, workspace_id)
    assert response.status_code == 200, response.text
    assert any("unverifiable source" in warning for warning in response.json()["warnings"])
    assert not any(group["evidence_type"] == "exact_source" for group in response.json()["groups"])


def test_symlinked_source_is_excluded_when_supported(client: TestClient, tmp_path: Path) -> None:
    headers, workspace_path, workspace_id = create_duplicate_workspace(client, tmp_path)
    for paper_id, project_id in (("paper-a", "project-paper-a"), ("paper-b", "project-paper-b")):
        current = client.get(
            f"/api/v1/workspaces/{workspace_id}/records/papers/{paper_id}", headers=headers
        ).json()
        assert (
            upload_pdf(
                client, headers, workspace_id, project_id, paper_id, PDF_A, current["revision"]
            ).status_code
            == 200
        )
    target = workspace_path / "papers/paper-b/source/original.pdf"
    target.unlink()
    try:
        os.symlink(workspace_path / "papers/paper-a/source/original.pdf", target)
    except OSError:
        pytest.skip("symlinks are unavailable in this test environment")
    response = duplicate_report(client, headers, workspace_id)
    assert response.status_code == 200, response.text
    assert any("unverifiable source" in warning for warning in response.json()["warnings"])
    assert not any(group["evidence_type"] == "exact_source" for group in response.json()["groups"])


def test_duplicate_analysis_has_a_bounded_paper_count(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers, _workspace_path, workspace_id = create_duplicate_workspace(client, tmp_path)
    monkeypatch.setattr(duplicate_detection, "MAX_DUPLICATE_ANALYSIS_PAPERS", 1)
    response = duplicate_report(client, headers, workspace_id)
    assert response.status_code == 413
