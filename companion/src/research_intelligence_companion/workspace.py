from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PureWindowsPath
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError

WORKSPACE_DURABLE_SCHEMA_VERSION = "m2.v1"
WORKSPACE_METADATA_FILENAME = "workspace.json"
WORKSPACE_DIRECTORIES = (
    "projects",
    "papers",
    "notes",
    "syntheses",
    "gaps",
    "feedback",
    "activity",
    "backups",
)
STABLE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
SECRET_FIELD_PATTERN = re.compile(
    r"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|credential|cookie)",
    re.IGNORECASE,
)
TIMESTAMP_FIELDS = {"created_at", "updated_at", "timestamp", "completed_at"}


class WorkspaceError(ValueError):
    pass


class WorkspaceConflictError(WorkspaceError):
    def __init__(
        self,
        message: str,
        *,
        expected_revision: str | None,
        current_revision: str,
        incoming_revision: str | None = None,
    ) -> None:
        super().__init__(message)
        self.expected_revision = expected_revision
        self.current_revision = current_revision
        self.incoming_revision = incoming_revision


@dataclass(frozen=True)
class RecordDescriptor:
    collection: str
    schema_filename: str
    id_field: str
    nested: bool = False


RECORD_DESCRIPTORS: dict[str, RecordDescriptor] = {
    "projects": RecordDescriptor("projects", "project.schema.json", "project_id"),
    "research-profiles": RecordDescriptor(
        "research-profiles", "research-profile.schema.json", "research_profile_id", True
    ),
    "papers": RecordDescriptor("papers", "paper.schema.json", "paper_id"),
    "studies": RecordDescriptor("studies", "study.schema.json", "study_id", True),
    "reading-progress": RecordDescriptor(
        "reading-progress", "reading-progress.schema.json", "reading_progress_id", True
    ),
    "syntheses": RecordDescriptor("syntheses", "synthesis.schema.json", "synthesis_id"),
    "gaps": RecordDescriptor("gaps", "gap.schema.json", "gap_id"),
    "provenance": RecordDescriptor("provenance", "provenance.schema.json", "provenance_id", True),
}
WORKSPACE_COLLECTION_FIELDS = {
    "projects": "projects",
    "papers": "papers",
    "syntheses": "syntheses",
    "gaps": "gaps",
}
BACKUP_ID_PATTERN = re.compile(r"^backup_[0-9]{8}T[0-9]{6}Z_[A-Fa-f0-9]{8}$")


def stable_workspace_id(root: Path) -> str:
    resolved = root.resolve()
    digest = hashlib.sha256(str(resolved).encode("utf-8")).hexdigest()[:16]
    return f"workspace_{digest}"


def _absolute_path(path: str, *, label: str) -> Path:
    if not path or "\x00" in path:
        raise WorkspaceError(f"{label} must be a valid filesystem path.")
    candidate = Path(path).expanduser()
    if not candidate.is_absolute():
        raise WorkspaceError(f"{label} must be an absolute path.")
    return candidate


def ensure_workspace_root(path: str | Path) -> Path:
    candidate = _absolute_path(str(path), label="Workspace path") if isinstance(path, str) else path
    root = candidate.resolve()
    if not root.exists() or not root.is_dir():
        raise WorkspaceError("Workspace path must be an existing directory.")
    return root


def create_workspace_root(path: str | Path) -> Path:
    candidate = _absolute_path(str(path), label="Workspace path") if isinstance(path, str) else path
    if candidate.exists() and not candidate.is_dir():
        raise WorkspaceError("Workspace path must be a directory.")
    try:
        candidate.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise WorkspaceError(f"Workspace directory could not be created: {exc}") from exc
    return candidate.resolve()


def _reject_secret_fields(value: Any, path: str = "record") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if SECRET_FIELD_PATTERN.search(str(key)):
                raise WorkspaceError(
                    "Secrets are not allowed in durable workspace records: "
                    f"{path}.{key}"
                )
            _reject_secret_fields(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _reject_secret_fields(nested, f"{path}[{index}]")


def _validate_timestamp_fields(value: Any, path: str = "record") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in TIMESTAMP_FIELDS:
                if not isinstance(nested, str):
                    raise WorkspaceError(f"{path}.{key} must be an ISO 8601 timestamp.")
                try:
                    parsed = datetime.fromisoformat(nested.replace("Z", "+00:00"))
                except ValueError as exc:
                    raise WorkspaceError(f"{path}.{key} must be an ISO 8601 timestamp.") from exc
                if parsed.tzinfo is None:
                    raise WorkspaceError(f"{path}.{key} must include a timezone.")
            _validate_timestamp_fields(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _validate_timestamp_fields(nested, f"{path}[{index}]")


def _schema_root() -> Path:
    configured = os.getenv("RI_SCHEMA_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[3] / "packages/schemas"


def _load_schema(filename: str) -> dict[str, Any]:
    path = _schema_root() / filename
    if not path.is_file():
        raise WorkspaceError(f"Durable record schema is unavailable: {filename}")
    try:
        schema = json.loads(path.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
    except (OSError, json.JSONDecodeError, SchemaError) as exc:
        raise WorkspaceError(f"Durable record schema is invalid: {filename}") from exc
    return schema


def validate_workspace_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    return validate_durable_record_payload("workspace", payload)


def validate_durable_record_payload(collection: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise WorkspaceError("Durable records must be JSON objects.")
    _reject_secret_fields(payload)
    _validate_timestamp_fields(payload)
    if collection == "workspace":
        schema_filename = "workspace.schema.json"
    else:
        descriptor = RECORD_DESCRIPTORS.get(collection)
        if descriptor is None:
            raise WorkspaceError(f"Unsupported durable record collection: {collection}")
        schema_filename = descriptor.schema_filename
    schema = _load_schema(schema_filename)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(payload), key=lambda error: list(error.path))
    if errors:
        message = "; ".join(error.message for error in errors[:3])
        raise WorkspaceError(f"Invalid {collection} record: {message}")
    return payload


def resolve_under_workspace(root: Path, relative_path: str) -> Path:
    if not relative_path or "\x00" in relative_path:
        raise WorkspaceError("Workspace path must be a non-empty relative path.")
    windows_path = PureWindowsPath(relative_path)
    if Path(relative_path).is_absolute() or windows_path.is_absolute() or windows_path.drive:
        raise WorkspaceError("Workspace paths must be relative.")
    if ".." in Path(relative_path).parts:
        raise WorkspaceError("Workspace path traversal is disallowed.")
    resolved_root = root.resolve()
    target = (resolved_root / relative_path).resolve()
    try:
        target.relative_to(resolved_root)
    except ValueError as exc:
        raise WorkspaceError("Workspace path traversal is disallowed.") from exc
    return target


def _fsync_directory(directory: Path) -> None:
    try:
        flags = getattr(os, "O_DIRECTORY", 0) | os.O_RDONLY
        descriptor = os.open(directory, flags)
    except (AttributeError, OSError):
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def _atomic_write_bytes(path: Path, content: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
        _fsync_directory(path.parent)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()
    return hashlib.sha256(content).hexdigest()


def atomic_write_json(path: Path, payload: dict[str, Any]) -> str:
    if "schema_version" not in payload:
        raise WorkspaceError("Durable JSON records require schema_version.")
    content = (
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    return _atomic_write_bytes(path, content)


def _atomic_write_internal_json(path: Path, payload: dict[str, Any]) -> str:
    content = (
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    return _atomic_write_bytes(path, content)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cleanup_abandoned_temp_files(root: Path) -> int:
    removed = 0
    for directory_name in (".", *WORKSPACE_DIRECTORIES):
        directory = root if directory_name == "." else root / directory_name
        if not directory.exists():
            continue
        for candidate in directory.rglob("*.tmp"):
            if candidate.is_file() and candidate.name.startswith("."):
                try:
                    candidate.unlink()
                    removed += 1
                except OSError:
                    pass
    return removed


def initialize_workspace_structure(root: Path) -> list[str]:
    root.mkdir(parents=True, exist_ok=True)
    created: list[str] = []
    for directory_name in WORKSPACE_DIRECTORIES:
        directory = root / directory_name
        if not directory.exists():
            directory.mkdir(parents=True)
            created.append(directory_name)
        elif not directory.is_dir():
            raise WorkspaceError(f"Workspace path is not a directory: {directory_name}")
    cleanup_abandoned_temp_files(root)
    return created


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WorkspaceError(f"Invalid JSON record at {path.name}.") from exc
    if not isinstance(payload, dict):
        raise WorkspaceError(f"Durable JSON record at {path.name} must be an object.")
    return payload


def read_workspace_metadata(root: Path) -> tuple[dict[str, Any], str]:
    path = root / WORKSPACE_METADATA_FILENAME
    if not path.is_file():
        raise WorkspaceError("Workspace metadata is missing.")
    payload = _read_json(path)
    validate_workspace_metadata(payload)
    return payload, workspace_revision(root)


def create_workspace(path: str, name: str | None = None) -> tuple[Path, dict[str, Any], str]:
    root = create_workspace_root(path)
    metadata_path = root / WORKSPACE_METADATA_FILENAME
    if metadata_path.exists():
        raise WorkspaceError("A workspace already exists at this path.")
    initialize_workspace_structure(root)
    now = datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
    metadata = {
        "schema_version": WORKSPACE_DURABLE_SCHEMA_VERSION,
        "workspace_id": stable_workspace_id(root),
        "name": (name or root.name).strip() or root.name,
        "created_at": now,
        "updated_at": now,
        "projects": [],
        "papers": [],
        "syntheses": [],
        "gaps": [],
    }
    validate_workspace_metadata(metadata)
    atomic_write_json(metadata_path, metadata)
    revision = workspace_revision(root)
    return root, metadata, revision


def open_workspace(path: str) -> tuple[Path, dict[str, Any], str]:
    root = ensure_workspace_root(path)
    metadata, revision = read_workspace_metadata(root)
    expected_id = stable_workspace_id(root)
    if metadata["workspace_id"] != expected_id:
        raise WorkspaceError("Workspace metadata does not match its selected folder.")
    initialize_workspace_structure(root)
    return root, metadata, revision


def _stable_id(value: str, label: str) -> str:
    if not STABLE_ID_PATTERN.fullmatch(value):
        raise WorkspaceError(f"Invalid {label}; only stable relative IDs are allowed.")
    return value


def _candidate_paths(root: Path, collection: str) -> list[Path]:
    if collection not in RECORD_DESCRIPTORS:
        raise WorkspaceError(f"Unsupported durable record collection: {collection}")
    patterns = {
        "projects": "projects/*/project.json",
        "research-profiles": "projects/*/research-profile.json",
        "papers": "papers/*/metadata.json",
        "studies": "papers/*/studies.json",
        "reading-progress": "papers/*/reading-progress.json",
        "syntheses": "syntheses/*.json",
        "gaps": "gaps/*.json",
        "provenance": "papers/*/provenance.json",
    }
    return [path for path in root.glob(patterns[collection]) if path.is_file()]


def find_record_path(root: Path, collection: str, record_id: str) -> Path | None:
    _stable_id(record_id, "record ID")
    descriptor = RECORD_DESCRIPTORS.get(collection)
    if descriptor is None:
        raise WorkspaceError(f"Unsupported durable record collection: {collection}")
    for candidate in _candidate_paths(root, collection):
        try:
            payload = _read_json(candidate)
            validate_durable_record_payload(collection, payload)
        except WorkspaceError:
            continue
        if payload.get(descriptor.id_field) == record_id:
            return candidate
    return None


def _path_for_new_record(
    root: Path,
    collection: str,
    record_id: str,
    payload: dict[str, Any],
    parent_id: str | None,
) -> Path:
    _stable_id(record_id, "record ID")
    if collection == "projects":
        return resolve_under_workspace(root, f"projects/{record_id}/project.json")
    if collection == "papers":
        return resolve_under_workspace(root, f"papers/{record_id}/metadata.json")
    if collection == "syntheses":
        return resolve_under_workspace(root, f"syntheses/{record_id}.json")
    if collection == "gaps":
        return resolve_under_workspace(root, f"gaps/{record_id}.json")
    if collection == "research-profiles":
        project_id = _stable_id(str(payload.get("project_id", parent_id or "")), "project ID")
        return resolve_under_workspace(root, f"projects/{project_id}/research-profile.json")
    if collection == "studies":
        paper_id = _stable_id(str(payload.get("paper_id", parent_id or "")), "paper ID")
        return resolve_under_workspace(root, f"papers/{paper_id}/studies.json")
    if collection == "reading-progress":
        paper_id = _stable_id(str(payload.get("paper_id", parent_id or "")), "paper ID")
        return resolve_under_workspace(root, f"papers/{paper_id}/reading-progress.json")
    if collection == "provenance":
        paper_id = _stable_id(str(parent_id or ""), "paper ID")
        return resolve_under_workspace(root, f"papers/{paper_id}/provenance.json")
    raise WorkspaceError(f"Unsupported durable record collection: {collection}")


def _find_or_derive_record_path(
    root: Path,
    collection: str,
    record_id: str,
    payload: dict[str, Any],
    parent_id: str | None,
) -> Path:
    existing = find_record_path(root, collection, record_id)
    if existing is not None:
        return existing
    return _path_for_new_record(root, collection, record_id, payload, parent_id)


def _update_workspace_index(
    root: Path, collection: str, record_id: str
) -> tuple[dict[str, Any], str]:
    metadata, _ = read_workspace_metadata(root)
    field = WORKSPACE_COLLECTION_FIELDS.get(collection)
    if field is None:
        metadata["updated_at"] = datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
        validate_workspace_metadata(metadata)
        atomic_write_json(root / WORKSPACE_METADATA_FILENAME, metadata)
        revision = workspace_revision(root)
        return metadata, revision
    values = list(metadata[field])
    if record_id not in values:
        values.append(record_id)
        values.sort()
        metadata[field] = values
    metadata["updated_at"] = datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
    validate_workspace_metadata(metadata)
    atomic_write_json(root / WORKSPACE_METADATA_FILENAME, metadata)
    revision = workspace_revision(root)
    return metadata, revision


def read_record(root: Path, collection: str, record_id: str) -> tuple[dict[str, Any], str, str]:
    path = find_record_path(root, collection, record_id)
    if path is None:
        raise WorkspaceError("Durable record was not found.")
    payload = _read_json(path)
    validate_durable_record_payload(collection, payload)
    return payload, sha256_file(path), path.relative_to(root).as_posix()


def list_records(root: Path, collection: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    descriptor = RECORD_DESCRIPTORS.get(collection)
    if descriptor is None:
        raise WorkspaceError(f"Unsupported durable record collection: {collection}")
    for path in _candidate_paths(root, collection):
        payload = _read_json(path)
        validate_durable_record_payload(collection, payload)
        record_id = payload.get(descriptor.id_field)
        if not isinstance(record_id, str):
            raise WorkspaceError(f"{collection} record is missing its stable ID.")
        records.append(
            {
                "record_id": record_id,
                "record": payload,
                "revision": sha256_file(path),
                "relative_path": path.relative_to(root).as_posix(),
            }
        )
    return sorted(records, key=lambda item: item["record_id"])


def write_record(
    root: Path,
    collection: str,
    record_id: str,
    payload: dict[str, Any],
    *,
    expected_revision: str | None,
    parent_id: str | None = None,
) -> tuple[dict[str, Any], str, str, str | None]:
    descriptor = RECORD_DESCRIPTORS.get(collection)
    if descriptor is None:
        raise WorkspaceError(f"Unsupported durable record collection: {collection}")
    _stable_id(record_id, "record ID")
    validate_durable_record_payload(collection, payload)
    if payload.get(descriptor.id_field) != record_id:
        raise WorkspaceError(f"Record ID does not match {descriptor.id_field}.")
    path = _find_or_derive_record_path(root, collection, record_id, payload, parent_id)
    current_revision = sha256_file(path) if path.exists() else None
    if current_revision is not None and expected_revision != current_revision:
        incoming = hashlib.sha256(
            (json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")
        ).hexdigest()
        raise WorkspaceConflictError(
            "The durable record changed since it was read.",
            expected_revision=expected_revision,
            current_revision=current_revision,
            incoming_revision=incoming,
        )
    if current_revision is None and expected_revision is not None:
        raise WorkspaceConflictError(
            "The durable record no longer exists.",
            expected_revision=expected_revision,
            current_revision="missing",
        )
    if current_revision:
        create_backup(root, reason=f"before-write-{collection}-{record_id}")
    new_revision = atomic_write_json(path, payload)
    _update_workspace_index(root, collection, record_id)
    return payload, new_revision, path.relative_to(root).as_posix(), current_revision


def _iter_durable_files(root: Path) -> list[Path]:
    files: list[Path] = []
    durable_roots = [
        root / WORKSPACE_METADATA_FILENAME,
        *[root / name for name in WORKSPACE_DIRECTORIES if name != "backups"],
    ]
    for path in durable_roots:
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            for candidate in path.rglob("*"):
                if not candidate.is_file():
                    continue
                resolved = candidate.resolve()
                try:
                    resolved.relative_to(root.resolve())
                except ValueError as exc:
                    raise WorkspaceError("Workspace symlink escapes are disallowed.") from exc
                files.append(candidate)
    return sorted(files)


def workspace_revision(root: Path) -> str:
    digest = hashlib.sha256()
    for path in _iter_durable_files(root):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(sha256_file(path).encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()


def _timestamp() -> str:
    return datetime.now(tz=UTC).strftime("%Y%m%dT%H%M%SZ")


def create_backup(root: Path, *, reason: str = "manual") -> dict[str, Any]:
    metadata, source_revision = read_workspace_metadata(root)
    backup_id = f"backup_{_timestamp()}_{secrets.token_hex(4)}"
    backup_root = resolve_under_workspace(root, f"backups/{backup_id}")
    snapshot_root = backup_root / "snapshot"
    snapshot_root.mkdir(parents=True, exist_ok=False)
    files: list[str] = []
    try:
        for source in _iter_durable_files(root):
            relative = source.relative_to(root)
            target = snapshot_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            files.append(relative.as_posix())
        manifest = {
            "schema_version": "backup.v1",
            "backup_id": backup_id,
            "workspace_id": metadata["workspace_id"],
            "created_at": datetime.now(tz=UTC).isoformat().replace("+00:00", "Z"),
            "source_revision": source_revision,
            "reason": reason,
            "files": files,
        }
        _atomic_write_internal_json(backup_root / "manifest.json", manifest)
    except Exception:
        shutil.rmtree(backup_root, ignore_errors=True)
        raise
    return manifest


def _read_backup(root: Path, backup_id: str) -> tuple[Path, dict[str, Any]]:
    if not BACKUP_ID_PATTERN.fullmatch(backup_id):
        raise WorkspaceError("Invalid backup ID.")
    backup_root = resolve_under_workspace(root, f"backups/{backup_id}")
    manifest_path = backup_root / "manifest.json"
    if not manifest_path.is_file():
        raise WorkspaceError("Backup was not found.")
    manifest = _read_json(manifest_path)
    if manifest.get("backup_id") != backup_id or not isinstance(manifest.get("files"), list):
        raise WorkspaceError("Backup manifest is invalid.")
    return backup_root, manifest


def list_backups(root: Path) -> list[dict[str, Any]]:
    backups: list[dict[str, Any]] = []
    backups_root = root / "backups"
    if not backups_root.is_dir():
        return backups
    for manifest_path in backups_root.glob("*/manifest.json"):
        manifest = _read_json(manifest_path)
        if (
            isinstance(manifest.get("backup_id"), str)
            and BACKUP_ID_PATTERN.fullmatch(manifest["backup_id"])
        ):
            backups.append(manifest)
    return sorted(backups, key=lambda item: item["created_at"], reverse=True)


def restore_backup(
    root: Path,
    backup_id: str,
    *,
    expected_workspace_revision: str,
) -> tuple[dict[str, Any], str, str | None]:
    current_metadata, current_revision = read_workspace_metadata(root)
    if current_revision != expected_workspace_revision:
        raise WorkspaceConflictError(
            "The workspace changed since the restore preview.",
            expected_revision=expected_workspace_revision,
            current_revision=current_revision,
        )
    backup_root, manifest = _read_backup(root, backup_id)
    if manifest.get("workspace_id") != current_metadata["workspace_id"]:
        raise WorkspaceError("Backup belongs to a different workspace.")
    recovery = create_backup(root, reason=f"before-restore-{backup_id}")
    snapshot_root = backup_root / "snapshot"
    expected_files = {str(relative) for relative in manifest["files"]}
    snapshot_sources: dict[str, Path] = {}
    for relative in expected_files:
        source = resolve_under_workspace(snapshot_root, relative)
        if not source.is_file():
            raise WorkspaceError("Backup snapshot is incomplete.")
        snapshot_sources[relative] = source
    for path in _iter_durable_files(root):
        if path.relative_to(root).as_posix() not in expected_files:
            path.unlink()
    for relative in expected_files:
        target = resolve_under_workspace(root, relative)
        _atomic_write_bytes(target, snapshot_sources[relative].read_bytes())
    metadata, revision = read_workspace_metadata(root)
    return metadata, revision, recovery["backup_id"]


def report_conflict(
    root: Path,
    collection: str,
    record_id: str,
    expected_revision: str | None,
) -> dict[str, Any]:
    payload, current_revision, relative_path = read_record(root, collection, record_id)
    _ = payload
    return {
        "conflict": expected_revision != current_revision,
        "collection": collection,
        "record_id": record_id,
        "expected_revision": expected_revision,
        "current_revision": current_revision,
        "relative_path": relative_path,
    }


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
