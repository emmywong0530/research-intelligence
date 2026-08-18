from __future__ import annotations

import pytest

from research_intelligence_companion.processing_policy import (
    cache_candidate_is_usable,
    lineage_is_invalidated,
)


def _record(
    processing_id: str,
    *,
    parent: str | None = None,
    invalidated: bool = False,
    key: str = "cache-key",
) -> dict[str, object]:
    return {
        "processing_id": processing_id,
        "original_processing_id": parent,
        "cache_key": key,
        "status": "completed",
        "stale": False,
        "invalidated": invalidated,
        "output": {"contract_id": "bounded-test-output"},
    }


@pytest.mark.parametrize(
    "invalidated_id",
    [None, "root", "cache-hit", "descendant"],
)
def test_cache_lineage_policy_is_shared_across_root_hit_and_descendant(
    invalidated_id: str | None,
) -> None:
    records = {
        "root": _record("root", invalidated=invalidated_id == "root"),
        "cache-hit": _record("cache-hit", parent="root", invalidated=invalidated_id == "cache-hit"),
        "descendant": _record(
            "descendant", parent="cache-hit", invalidated=invalidated_id == "descendant"
        ),
        "unrelated": _record("unrelated", invalidated=False, key="other-key"),
    }

    assert lineage_is_invalidated(records["root"], records) is (invalidated_id is not None)
    for record_id in ("root", "cache-hit", "descendant"):
        expected = invalidated_id is None
        assert cache_candidate_is_usable(records[record_id], "cache-key", records) is expected
    assert cache_candidate_is_usable(records["unrelated"], "cache-key", records) is False
