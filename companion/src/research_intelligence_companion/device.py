from __future__ import annotations

import os
import platform
import sqlite3
from datetime import UTC, datetime
from pathlib import Path


class DeviceRegistryError(RuntimeError):
    pass


class WorkspaceIdentityCollision(DeviceRegistryError):
    """The same durable workspace ID was found at a different local identity."""

    def __init__(self, workspace_id: str, existing_path: str, requested_path: str) -> None:
        self.workspace_id = workspace_id
        self.existing_path = existing_path
        self.requested_path = requested_path
        super().__init__(
            "Workspace identity collision: the durable workspace ID is already registered "
            "for a different local workspace copy."
        )


def device_data_root() -> Path:
    configured = os.getenv("RI_DEVICE_DATA_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    system = platform.system()
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "Research Intelligence"
    if system == "Windows":
        local_app_data = os.getenv("LOCALAPPDATA", str(Path.home() / "AppData/Local"))
        return Path(local_app_data) / "Research Intelligence"
    return Path(os.getenv("XDG_DATA_HOME", Path.home() / ".local/share")) / "research-intelligence"


class DeviceRegistry:
    """A rebuildable device-local registry. It is intentionally outside the workspace."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or device_data_root()).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "device-registry.sqlite3"

    def _assert_separate(self, workspace_root: Path) -> None:
        try:
            self.path.resolve().relative_to(workspace_root.resolve())
        except ValueError:
            return
        raise DeviceRegistryError("Device-local registry must not be inside the workspace.")

    @staticmethod
    def _file_identity(workspace_root: Path) -> str | None:
        try:
            stat = (workspace_root / "workspace.json").stat()
        except OSError:
            return None
        return f"{stat.st_dev}:{stat.st_ino}"

    def register_workspace(self, workspace_id: str, workspace_root: Path) -> str:
        self._assert_separate(workspace_root)
        resolved_root = workspace_root.resolve()
        requested_identity = self._file_identity(resolved_root)
        try:
            with sqlite3.connect(self.path) as connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS workspaces (
                        workspace_id TEXT PRIMARY KEY,
                        workspace_root TEXT NOT NULL,
                        workspace_file_identity TEXT,
                        last_opened_at TEXT NOT NULL
                    )
                    """
                )
                columns = {
                    row[1]
                    for row in connection.execute("PRAGMA table_info(workspaces)").fetchall()
                }
                if "workspace_file_identity" not in columns:
                    connection.execute(
                        "ALTER TABLE workspaces ADD COLUMN workspace_file_identity TEXT"
                    )
                existing = connection.execute(
                    """
                    SELECT workspace_root, workspace_file_identity
                    FROM workspaces
                    WHERE workspace_id = ?
                    """,
                    (workspace_id,),
                ).fetchone()
                now = datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
                if existing is None:
                    connection.execute(
                        """
                        INSERT INTO workspaces(
                            workspace_id, workspace_root, workspace_file_identity, last_opened_at
                        ) VALUES (?, ?, ?, ?)
                        """,
                        (workspace_id, str(resolved_root), requested_identity, now),
                    )
                    return "registered"
                existing_root, existing_identity = existing
                if str(existing_root) == str(resolved_root):
                    connection.execute(
                        "UPDATE workspaces SET last_opened_at = ? WHERE workspace_id = ?",
                        (now, workspace_id),
                    )
                    return "unchanged"
                existing_path_exists = Path(str(existing_root)).exists()
                same_local_workspace = (
                    requested_identity is not None
                    and existing_identity is not None
                    and requested_identity == existing_identity
                )
                if existing_path_exists and not same_local_workspace:
                    raise WorkspaceIdentityCollision(
                        workspace_id,
                        str(existing_root),
                        str(resolved_root),
                    )
                connection.execute(
                    """
                    UPDATE workspaces
                    SET workspace_root = ?, workspace_file_identity = ?, last_opened_at = ?
                    WHERE workspace_id = ?
                    """,
                    (str(resolved_root), requested_identity, now, workspace_id),
                )
                return "updated"
        except sqlite3.Error as exc:
            raise DeviceRegistryError("Device-local registry is unavailable.") from exc

    def registered_workspace(self, workspace_id: str) -> dict[str, str] | None:
        try:
            with sqlite3.connect(self.path) as connection:
                row = connection.execute(
                    """
                    SELECT workspace_root, workspace_file_identity, last_opened_at
                    FROM workspaces WHERE workspace_id = ?
                    """,
                    (workspace_id,),
                ).fetchone()
        except sqlite3.Error as exc:
            raise DeviceRegistryError("Device-local registry is unavailable.") from exc
        if row is None:
            return None
        return {
            "workspace_root": str(row[0]),
            "workspace_file_identity": str(row[1]) if row[1] is not None else "",
            "last_opened_at": str(row[2]),
        }

    def health(self) -> dict[str, object]:
        try:
            with sqlite3.connect(self.path) as connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS workspaces (
                        workspace_id TEXT PRIMARY KEY,
                        workspace_root TEXT NOT NULL,
                        last_opened_at TEXT NOT NULL
                    )
                    """
                )
                count = connection.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0]
        except sqlite3.Error:
            return {"available": False, "separate_from_workspace": True, "record_count": 0}
        return {
            "available": True,
            "separate_from_workspace": True,
            "record_count": int(count),
        }
