from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import tempfile
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PureWindowsPath
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError

from .profile_learning import validate_profile_proposals

WORKSPACE_DURABLE_SCHEMA_VERSION = "m2.v1"
RESEARCH_PROFILE_SCHEMA_V2 = "m2.v1"
RESEARCH_PROFILE_SCHEMA_V3C = "m3c.v1"
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
TRANSACTION_ROOT = ".research-intelligence"
TRANSACTION_DIRECTORY = "transactions"

# Tests and the local recovery spike use this hook to model a process or disk
# failure at a named transaction boundary. Production leaves it unset.
_transaction_fault_injector: Any = None


def _inject_transaction_fault(point: str) -> None:
    if _transaction_fault_injector is not None:
        _transaction_fault_injector(point)


def generate_workspace_id() -> str:
    return f"workspace_{uuid.uuid4().hex}"


def stable_workspace_id(root: Path) -> str:
    """Compatibility helper that reads the durable ID instead of hashing a path."""
    metadata_path = root / WORKSPACE_METADATA_FILENAME
    if metadata_path.is_file():
        payload = _read_json(metadata_path)
        validate_workspace_metadata(payload)
        return str(payload["workspace_id"])
    return generate_workspace_id()


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
    if collection == "research-profiles":
        try:
            validate_profile_proposals(payload)
        except ValueError as exc:
            raise WorkspaceError(f"Invalid research-profiles record: {exc}") from exc
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


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _transaction_directory(root: Path) -> Path:
    transaction_root = resolve_under_workspace(root, f"{TRANSACTION_ROOT}/{TRANSACTION_DIRECTORY}")
    transaction_root.mkdir(parents=True, exist_ok=True)
    return transaction_root


def _new_transaction_directory(root: Path, transaction_id: str) -> Path:
    _transaction_directory(root)
    transaction = resolve_under_workspace(
        root, f"{TRANSACTION_ROOT}/{TRANSACTION_DIRECTORY}/{transaction_id}"
    )
    transaction.mkdir(parents=True, exist_ok=False)
    return transaction


def _cleanup_transaction_directory(transaction: Path) -> None:
    shutil.rmtree(transaction)


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
        else:
            try:
                directory.resolve().relative_to(root.resolve())
            except ValueError as exc:
                raise WorkspaceError("Workspace symlink escapes are disallowed.") from exc
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


def _migrate_research_profile_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    version = payload.get("schema_version")
    if version == RESEARCH_PROFILE_SCHEMA_V3C:
        return payload, False
    if version != RESEARCH_PROFILE_SCHEMA_V2:
        raise WorkspaceError(
            "Unsupported Research Profile schema version; refusing to guess or "
            "overwrite profile data."
        )
    migrated = json.loads(json.dumps(payload))
    migrated["schema_version"] = RESEARCH_PROFILE_SCHEMA_V3C
    # Old proposal shells are intentionally preserved without guessed values.
    # They remain visible as legacy, non-actionable history until a future
    # explicit source creates a complete Task 3C proposal.
    validate_durable_record_payload("research-profiles", migrated)
    return migrated, True


def _migrate_research_profiles(root: Path) -> None:
    for path in _candidate_paths(root, "research-profiles"):
        payload = _read_json(path)
        migrated, changed = _migrate_research_profile_payload(payload)
        if not changed:
            continue
        project_id = str(migrated.get("project_id", ""))
        expected_revision = sha256_file(path)
        write_record(
            root,
            "research-profiles",
            str(migrated["research_profile_id"]),
            migrated,
            expected_revision=expected_revision,
            parent_id=project_id,
        )


def create_workspace(path: str, name: str | None = None) -> tuple[Path, dict[str, Any], str]:
    root = create_workspace_root(path)
    metadata_path = root / WORKSPACE_METADATA_FILENAME
    if metadata_path.exists():
        raise WorkspaceError("A workspace already exists at this path.")
    initialize_workspace_structure(root)
    now = datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
    metadata = {
        "schema_version": WORKSPACE_DURABLE_SCHEMA_VERSION,
        "workspace_id": generate_workspace_id(),
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
    recover_transactions(root)
    initialize_workspace_structure(root)
    _migrate_research_profiles(root)
    metadata, revision = read_workspace_metadata(root)
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


def _metadata_after_record_write(
    metadata: dict[str, Any], collection: str, record_id: str
) -> dict[str, Any]:
    field = WORKSPACE_COLLECTION_FIELDS.get(collection)
    if field is not None:
        values = list(metadata[field])
        if record_id not in values:
            values.append(record_id)
            values.sort()
            metadata[field] = values
    metadata["updated_at"] = datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
    validate_workspace_metadata(metadata)
    return metadata


def _rollback_record_transaction(root: Path, transaction: Path, journal: dict[str, Any]) -> None:
    record_path = resolve_under_workspace(root, str(journal["record_relative_path"]))
    metadata_path = root / WORKSPACE_METADATA_FILENAME
    before_record = transaction / "before-record.bin"
    before_metadata = transaction / "before-metadata.bin"
    if before_record.is_file():
        _atomic_write_bytes(record_path, before_record.read_bytes())
    elif record_path.exists():
        if record_path.is_dir():
            raise WorkspaceError("Record transaction rollback encountered a directory target.")
        record_path.unlink()
        _fsync_directory(record_path.parent)
    _atomic_write_bytes(metadata_path, before_metadata.read_bytes())


def _recover_record_transaction(root: Path, transaction: Path, journal: dict[str, Any]) -> None:
    if journal.get("state") == "committed":
        try:
            _cleanup_transaction_directory(transaction)
        except OSError:
            pass
        return
    _rollback_record_transaction(root, transaction, journal)
    try:
        _cleanup_transaction_directory(transaction)
    except OSError:
        pass


def _commit_record_transaction(
    root: Path,
    record_path: Path,
    record_payload: dict[str, Any],
    metadata: dict[str, Any],
    *,
    previous_revision: str | None,
) -> tuple[str, str]:
    transaction_id = f"record_{uuid.uuid4().hex}"
    transaction = _new_transaction_directory(root, transaction_id)
    metadata_path = root / WORKSPACE_METADATA_FILENAME
    before_metadata = metadata_path.read_bytes()
    before_record_exists = record_path.is_file()
    before_record = record_path.read_bytes() if before_record_exists else b""
    new_record = _json_bytes(record_payload)
    new_metadata = _json_bytes(metadata)
    journal = {
        "schema_version": "transaction.v1",
        "kind": "record",
        "transaction_id": transaction_id,
        "state": "prepared",
        "record_relative_path": record_path.relative_to(root).as_posix(),
        "before_record_exists": before_record_exists,
        "record_revision_before": previous_revision,
        "record_revision_after": hashlib.sha256(new_record).hexdigest(),
    }
    try:
        if before_record_exists:
            _atomic_write_bytes(transaction / "before-record.bin", before_record)
        _atomic_write_bytes(transaction / "before-metadata.bin", before_metadata)
        _atomic_write_bytes(transaction / "after-record.bin", new_record)
        _atomic_write_bytes(transaction / "after-metadata.bin", new_metadata)
        _atomic_write_internal_json(transaction / "journal.json", journal)

        _inject_transaction_fault("before_record_replacement")
        _atomic_write_bytes(record_path, new_record)
        _inject_transaction_fault("after_record_replacement_before_metadata")
        _inject_transaction_fault("during_metadata_replacement")
        _atomic_write_bytes(metadata_path, new_metadata)
        _inject_transaction_fault("after_metadata_replacement_before_commit")
        journal["state"] = "committed"
        _atomic_write_internal_json(transaction / "journal.json", journal)
    except Exception:
        try:
            _rollback_record_transaction(root, transaction, journal)
        except Exception as rollback_error:  # noqa: BLE001 - preserve recovery failure context.
            raise WorkspaceError(
                "Record transaction failed and needs recovery on the next workspace open."
            ) from rollback_error
        try:
            _cleanup_transaction_directory(transaction)
        except OSError:
            pass
        raise

    try:
        _inject_transaction_fault("during_transaction_cleanup")
        _cleanup_transaction_directory(transaction)
    except Exception as cleanup_error:  # noqa: BLE001 - committed state is recoverable.
        # The committed marker makes cleanup idempotent and recoverable on open.
        _ = cleanup_error
    return hashlib.sha256(new_record).hexdigest(), workspace_revision(root)


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
    if collection == "research-profiles":
        migrated, _changed = _migrate_research_profile_payload(payload)
        payload = migrated
    validate_durable_record_payload(collection, payload)
    if payload.get(descriptor.id_field) != record_id:
        raise WorkspaceError(f"Record ID does not match {descriptor.id_field}.")
    if collection == "research-profiles":
        project_id = str(payload["project_id"])
        expected_profile_id = f"research_profile_{project_id}"
        if record_id != expected_profile_id:
            raise WorkspaceError(
                "Research profile ID must be the deterministic ID derived from its project ID."
            )
        if parent_id is not None and parent_id != project_id:
            raise WorkspaceError("Research profile parent project does not match its project ID.")
        if find_record_path(root, "projects", project_id) is None:
            raise WorkspaceError("Research profile project was not found in this workspace.")
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
    if collection == "research-profiles" and current_revision is not None:
        previous_payload = _read_json(path)
        try:
            validate_profile_proposals(payload, previous_payload)
        except ValueError as exc:
            raise WorkspaceError(f"Invalid research-profiles proposal transition: {exc}") from exc
    if current_revision:
        create_backup(root, reason=f"before-write-{collection}-{record_id}")
    metadata, _ = read_workspace_metadata(root)
    metadata = _metadata_after_record_write(metadata, collection, record_id)
    new_revision, _workspace_revision = _commit_record_transaction(
        root,
        path,
        payload,
        metadata,
        previous_revision=current_revision,
    )
    return payload, new_revision, path.relative_to(root).as_posix(), current_revision


def _iter_durable_files(root: Path) -> list[Path]:
    files: list[Path] = []
    durable_roots = [
        root / WORKSPACE_METADATA_FILENAME,
        *[root / name for name in WORKSPACE_DIRECTORIES if name != "backups"],
    ]
    for path in durable_roots:
        if path.is_file():
            try:
                path.resolve().relative_to(root.resolve())
            except ValueError as exc:
                raise WorkspaceError("Workspace symlink escapes are disallowed.") from exc
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
    file_hashes: dict[str, str] = {}
    try:
        for source in _iter_durable_files(root):
            relative = source.relative_to(root)
            target = snapshot_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            relative_name = relative.as_posix()
            files.append(relative_name)
            file_hashes[relative_name] = sha256_file(target)
        manifest = {
            "schema_version": "backup.v1",
            "backup_id": backup_id,
            "workspace_id": metadata["workspace_id"],
            "created_at": datetime.now(tz=UTC).isoformat().replace("+00:00", "Z"),
            "source_revision": source_revision,
            "reason": reason,
            "files": sorted(files),
            "file_hashes": file_hashes,
        }
        _atomic_write_internal_json(backup_root / "manifest.json", manifest)
    except Exception:
        shutil.rmtree(backup_root, ignore_errors=True)
        raise
    return manifest


def _is_allowed_snapshot_path(relative: str) -> bool:
    if not relative or "\\" in relative:
        return False
    parts = Path(relative).parts
    if not parts or any(part in {".", ".."} for part in parts):
        return False
    if relative == WORKSPACE_METADATA_FILENAME:
        return True
    return parts[0] in {name for name in WORKSPACE_DIRECTORIES if name != "backups"}


def _verify_backup_snapshot(
    root: Path, backup_root: Path, manifest: dict[str, Any]
) -> tuple[set[str], dict[str, str]]:
    files = manifest.get("files")
    file_hashes = manifest.get("file_hashes")
    if (
        not isinstance(files, list)
        or not files
        or not all(isinstance(relative, str) for relative in files)
        or len(files) != len(set(files))
        or not isinstance(file_hashes, dict)
    ):
        raise WorkspaceError("Backup manifest is invalid or has no file hashes.")
    expected_files = {str(relative) for relative in files}
    if set(file_hashes) != expected_files or WORKSPACE_METADATA_FILENAME not in expected_files:
        raise WorkspaceError("Backup manifest does not describe a complete workspace snapshot.")
    if not all(_is_allowed_snapshot_path(relative) for relative in expected_files):
        raise WorkspaceError(
            "Backup manifest contains a path outside the approved workspace layout."
        )
    snapshot_root = backup_root / "snapshot"
    if not snapshot_root.is_dir():
        raise WorkspaceError("Backup snapshot is incomplete.")
    try:
        snapshot_root.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise WorkspaceError("Backup snapshot escapes the workspace.") from exc
    for candidate in snapshot_root.rglob("*"):
        if candidate.is_symlink():
            raise WorkspaceError("Backup snapshots must not contain symlinks.")
        if candidate.is_file():
            relative = candidate.relative_to(snapshot_root).as_posix()
            if relative not in expected_files:
                raise WorkspaceError("Backup snapshot contains an unlisted file.")
    for relative in expected_files:
        source = resolve_under_workspace(snapshot_root, relative)
        if not source.is_file() or source.is_symlink():
            raise WorkspaceError("Backup snapshot is incomplete.")
        expected_hash = file_hashes.get(relative)
        if not isinstance(expected_hash, str) or sha256_file(source) != expected_hash:
            raise WorkspaceError(f"Backup snapshot hash verification failed for {relative}.")
    metadata = _read_json(resolve_under_workspace(snapshot_root, WORKSPACE_METADATA_FILENAME))
    validate_workspace_metadata(metadata)
    if metadata.get("workspace_id") != manifest.get("workspace_id"):
        raise WorkspaceError("Backup metadata does not match its manifest.")
    return expected_files, {str(key): str(value) for key, value in file_hashes.items()}


def _read_backup(root: Path, backup_id: str) -> tuple[Path, dict[str, Any]]:
    if not BACKUP_ID_PATTERN.fullmatch(backup_id):
        raise WorkspaceError("Invalid backup ID.")
    backup_root = resolve_under_workspace(root, f"backups/{backup_id}")
    manifest_path = backup_root / "manifest.json"
    if not manifest_path.is_file():
        raise WorkspaceError("Backup was not found.")
    manifest = _read_json(manifest_path)
    if manifest.get("backup_id") != backup_id:
        raise WorkspaceError("Backup manifest is invalid.")
    if not isinstance(manifest.get("workspace_id"), str):
        raise WorkspaceError("Backup manifest is missing its workspace identity.")
    _verify_backup_snapshot(root, backup_root, manifest)
    return backup_root, manifest


def list_backups(root: Path) -> list[dict[str, Any]]:
    backups: list[dict[str, Any]] = []
    backups_root = root / "backups"
    if not backups_root.is_dir():
        return backups
    for manifest_path in backups_root.glob("*/manifest.json"):
        manifest = _read_json(manifest_path)
        backup_id = manifest.get("backup_id")
        if isinstance(backup_id, str) and BACKUP_ID_PATTERN.fullmatch(backup_id):
            backups.append(manifest)
    return sorted(backups, key=lambda item: item["created_at"], reverse=True)


def _stage_backup_snapshot(
    transaction: Path,
    backup_root: Path,
    expected_files: set[str],
    file_hashes: dict[str, str],
) -> Path:
    staging = transaction / "staging"
    staging.mkdir(parents=True, exist_ok=False)
    snapshot_root = backup_root / "snapshot"
    for relative in sorted(expected_files):
        source = resolve_under_workspace(snapshot_root, relative)
        target = staging / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        if sha256_file(target) != file_hashes[relative]:
            raise WorkspaceError(f"Staged backup hash verification failed for {relative}.")
    return staging


def _verify_live_snapshot(
    root: Path, expected_files: set[str], file_hashes: dict[str, str]
) -> None:
    live_files = {path.relative_to(root).as_posix() for path in _iter_durable_files(root)}
    if live_files != expected_files:
        raise WorkspaceError("Restored workspace file set is incomplete.")
    for relative in expected_files:
        path = resolve_under_workspace(root, relative)
        if sha256_file(path) != file_hashes[relative]:
            raise WorkspaceError(f"Restored workspace hash verification failed for {relative}.")
    metadata, _ = read_workspace_metadata(root)
    _ = metadata


def _apply_staged_snapshot(
    root: Path,
    staging: Path,
    expected_files: set[str],
    file_hashes: dict[str, str],
) -> None:
    for path in _iter_durable_files(root):
        if path.relative_to(root).as_posix() not in expected_files:
            path.unlink()
    for relative in sorted(expected_files):
        source = resolve_under_workspace(staging, relative)
        if not source.is_file() or sha256_file(source) != file_hashes[relative]:
            raise WorkspaceError(f"Staged backup is incomplete for {relative}.")
        target = resolve_under_workspace(root, relative)
        _atomic_write_bytes(target, source.read_bytes())
    _verify_live_snapshot(root, expected_files, file_hashes)


def _rollback_restore_transaction(root: Path, journal: dict[str, Any]) -> None:
    recovery_id = journal.get("recovery_backup_id")
    if not isinstance(recovery_id, str):
        raise WorkspaceError("Restore journal has no recovery backup.")
    recovery_root, recovery_manifest = _read_backup(root, recovery_id)
    expected_files, file_hashes = _verify_backup_snapshot(root, recovery_root, recovery_manifest)
    transaction = resolve_under_workspace(
        root,
        f"{TRANSACTION_ROOT}/{TRANSACTION_DIRECTORY}/{journal['transaction_id']}",
    )
    if (transaction / "staging").exists():
        shutil.rmtree(transaction / "staging")
    _stage_backup_snapshot(transaction, recovery_root, expected_files, file_hashes)
    _apply_staged_snapshot(root, transaction / "staging", expected_files, file_hashes)


def _recover_restore_transaction(root: Path, transaction: Path, journal: dict[str, Any]) -> None:
    if journal.get("state") != "committed":
        _rollback_restore_transaction(root, journal)
    try:
        _cleanup_transaction_directory(transaction)
    except OSError:
        pass


def recover_transactions(root: Path) -> None:
    transaction_root = resolve_under_workspace(
        root, f"{TRANSACTION_ROOT}/{TRANSACTION_DIRECTORY}"
    )
    if not transaction_root.exists():
        return
    for transaction in sorted(transaction_root.iterdir()):
        if not transaction.is_dir():
            continue
        journal_path = transaction / "journal.json"
        if not journal_path.exists():
            try:
                _cleanup_transaction_directory(transaction)
            except OSError:
                pass
            continue
        journal = _read_json(journal_path)
        if journal.get("kind") == "record":
            _recover_record_transaction(root, transaction, journal)
        elif journal.get("kind") == "restore":
            _recover_restore_transaction(root, transaction, journal)
        else:
            raise WorkspaceError("Unknown workspace transaction journal.")


def restore_backup(
    root: Path,
    backup_id: str,
    *,
    expected_workspace_revision: str,
) -> tuple[dict[str, Any], str, str | None]:
    current_metadata, current_revision = read_workspace_metadata(root)
    backup_root, manifest = _read_backup(root, backup_id)
    if manifest.get("workspace_id") != current_metadata["workspace_id"]:
        raise WorkspaceError("Backup belongs to a different workspace.")
    if current_revision != expected_workspace_revision:
        raise WorkspaceConflictError(
            "The workspace changed since the restore preview.",
            expected_revision=expected_workspace_revision,
            current_revision=current_revision,
        )
    recovery = create_backup(root, reason=f"before-restore-{backup_id}")
    recovery_root, recovery_manifest = _read_backup(root, recovery["backup_id"])
    _verify_backup_snapshot(root, recovery_root, recovery_manifest)
    expected_files, file_hashes = _verify_backup_snapshot(root, backup_root, manifest)
    transaction_id = f"restore_{uuid.uuid4().hex}"
    transaction = _new_transaction_directory(root, transaction_id)
    staging = _stage_backup_snapshot(transaction, backup_root, expected_files, file_hashes)
    journal = {
        "schema_version": "restore.v1",
        "kind": "restore",
        "transaction_id": transaction_id,
        "state": "prepared",
        "backup_id": backup_id,
        "recovery_backup_id": recovery["backup_id"],
        "expected_files": sorted(expected_files),
        "file_hashes": file_hashes,
    }
    _atomic_write_internal_json(transaction / "journal.json", journal)
    try:
        _inject_transaction_fault("restore_before_commit")
        journal["state"] = "committing"
        _atomic_write_internal_json(transaction / "journal.json", journal)
        _inject_transaction_fault("restore_during_commit")
        _apply_staged_snapshot(root, staging, expected_files, file_hashes)
        _inject_transaction_fault("restore_after_live_commit_before_marker")
        journal["state"] = "committed"
        _atomic_write_internal_json(transaction / "journal.json", journal)
    except Exception:
        try:
            _rollback_restore_transaction(root, journal)
        except Exception as rollback_error:  # noqa: BLE001 - retain recovery context.
            raise WorkspaceError(
                "Restore was interrupted and needs recovery on the next workspace open."
            ) from rollback_error
        try:
            _cleanup_transaction_directory(transaction)
        except OSError:
            pass
        raise
    try:
        _inject_transaction_fault("during_restore_cleanup")
        _cleanup_transaction_directory(transaction)
    except Exception as cleanup_error:  # noqa: BLE001 - committed restore remains recoverable.
        _ = cleanup_error
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
