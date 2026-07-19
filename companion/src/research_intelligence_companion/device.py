from __future__ import annotations

import os
import platform
import sqlite3
from datetime import UTC, datetime
from pathlib import Path


class DeviceRegistryError(RuntimeError):
    pass


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

    def register_workspace(self, workspace_id: str, workspace_root: Path) -> None:
        self._assert_separate(workspace_root)
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
                connection.execute(
                    """
                    INSERT INTO workspaces(workspace_id, workspace_root, last_opened_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(workspace_id) DO UPDATE SET
                        workspace_root = excluded.workspace_root,
                        last_opened_at = excluded.last_opened_at
                    """,
                    (
                        workspace_id,
                        str(workspace_root.resolve()),
                        datetime.now(tz=UTC).isoformat().replace("+00:00", "Z"),
                    ),
                )
        except sqlite3.Error as exc:
            raise DeviceRegistryError("Device-local registry is unavailable.") from exc

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
