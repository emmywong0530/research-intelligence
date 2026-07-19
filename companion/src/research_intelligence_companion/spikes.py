from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from research_intelligence_companion.keychain import run_keychain_roundtrip
from research_intelligence_companion.models import SCHEMA_VERSION
from research_intelligence_companion.security import SecurityError, validate_bind_host
from research_intelligence_companion.workspace import (
    WorkspaceError,
    atomic_write_json,
    resolve_under_workspace,
    sha256_file,
    simulate_interrupted_write,
)


def run_binding_spike() -> dict[str, object]:
    validate_bind_host("127.0.0.1")
    remote_rejected = False
    try:
        validate_bind_host("0.0.0.0")  # noqa: S104 - verify wildcard bind rejection.
    except SecurityError:
        remote_rejected = True
    return {"loopback_allowed": True, "remote_interface_rejected": remote_rejected}


def run_workspace_spike() -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="ri-workspace-spike-") as tmp:
        root = Path(tmp).resolve()
        target = root / "workspace.json"
        previous_hash = atomic_write_json(
            target,
            {"schema_version": SCHEMA_VERSION, "value": "prior"},
        )
        preserved = simulate_interrupted_write(
            target, {"schema_version": SCHEMA_VERSION, "value": "partial"}
        )
        traversal_rejected = False
        try:
            resolve_under_workspace(root, "../outside.json")
        except WorkspaceError:
            traversal_rejected = True

        return {
            "workspace_root": str(root),
            "previous_hash": previous_hash,
            "current_hash": sha256_file(target),
            "interrupted_write_preserved_prior_file": preserved,
            "path_traversal_rejected": traversal_rejected,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Research Intelligence Task 0 spikes.")
    parser.add_argument("spike", choices=["binding", "keychain", "workspace", "all"])
    args = parser.parse_args()

    results: dict[str, object] = {}
    if args.spike in {"binding", "all"}:
        results["binding"] = run_binding_spike()
    if args.spike in {"keychain", "all"}:
        results["keychain"] = run_keychain_roundtrip()
    if args.spike in {"workspace", "all"}:
        results["workspace"] = run_workspace_spike()

    print(json.dumps(results, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
