from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


class WorkspaceError(ValueError):
    pass


def stable_workspace_id(root: Path) -> str:
    resolved = root.resolve()
    digest = hashlib.sha256(str(resolved).encode("utf-8")).hexdigest()[:16]
    return f"workspace_{digest}"


def ensure_workspace_root(path: str) -> Path:
    root = Path(path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise WorkspaceError("Workspace path must be an existing directory.")
    return root


def resolve_under_workspace(root: Path, relative_path: str) -> Path:
    if Path(relative_path).is_absolute():
        raise WorkspaceError("Workspace paths must be relative.")
    resolved_root = root.resolve()
    target = (resolved_root / relative_path).resolve()
    try:
        target.relative_to(resolved_root)
    except ValueError as exc:
        raise WorkspaceError("Workspace path traversal is disallowed.") from exc
    return target


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_write_json(path: Path, payload: dict[str, Any]) -> str:
    if "schema_version" not in payload:
        raise WorkspaceError("Durable JSON records require schema_version.")

    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()
    return sha256_file(path)


def simulate_interrupted_write(path: Path, payload: dict[str, Any]) -> bool:
    before = path.read_bytes()
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.interrupted.",
        suffix=".tmp",
        dir=path.parent,
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(payload)[:8])
            handle.flush()
            os.fsync(handle.fileno())
        return path.read_bytes() == before
    finally:
        if tmp_path.exists():
            tmp_path.unlink()
