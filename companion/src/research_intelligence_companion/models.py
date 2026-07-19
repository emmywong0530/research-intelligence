from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "task0.v1"


class ApiRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ApiResponse(BaseModel):
    schema_version: Literal[SCHEMA_VERSION]


class HealthResponse(ApiResponse):
    status: Literal["ok"]
    companion_version: str
    loopback_only: bool


class CapabilitiesResponse(ApiResponse):
    api_version: Literal["v1"]
    capabilities: list[str]


class PairingStartResponse(ApiResponse):
    pairing_id: str
    expires_at: str
    approval_required: Literal[True]
    max_failed_attempts: int = Field(gt=0)


class PairingCompleteRequest(ApiRequest):
    pairing_id: str
    approval_code: str = Field(pattern=r"^[0-9]{6}$")


class PairingCompleteResponse(ApiResponse):
    session_token: str
    expires_at: str


class AuthenticatedTestResponse(ApiResponse):
    status: Literal["authenticated"]


class KeychainSpikeResponse(ApiResponse):
    backend: str
    write_ok: bool
    read_ok: bool
    delete_ok: bool
    secret_returned: Literal[False]


class InstallationSecretStatusResponse(ApiResponse):
    backend: str
    available: bool
    created: bool
    error: Literal["keychain_unavailable"] | None


class WorkspaceCreateRequest(ApiRequest):
    path: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1)


class WorkspaceOpenRequest(ApiRequest):
    path: str = Field(min_length=1)


class WorkspaceOpenResponse(ApiResponse):
    workspace_id: str
    metadata: dict[str, Any]
    revision: str
    root: str | None = None


class WorkspaceMetadataResponse(ApiResponse):
    workspace_id: str
    metadata: dict[str, Any]
    revision: str


class WorkspaceInitializeResponse(ApiResponse):
    workspace_id: str
    created_directories: list[str]
    metadata: dict[str, Any]
    revision: str


class WorkspaceResolveRequest(ApiRequest):
    workspace_id: str
    relative_path: str


class WorkspaceResolveResponse(ApiResponse):
    workspace_id: str
    relative_path: str


class DurableRecordWriteRequest(ApiRequest):
    record: dict[str, Any]
    expected_revision: str | None = None
    parent_id: str | None = None


class DurableRecordResponse(ApiResponse):
    workspace_id: str
    collection: str
    record_id: str
    record: dict[str, Any]
    revision: str
    relative_path: str
    previous_revision: str | None = None


class DurableRecordListResponse(ApiResponse):
    workspace_id: str
    collection: str
    records: list[dict[str, Any]]


class BackupCreateRequest(ApiRequest):
    reason: str = Field(default="manual", min_length=1, max_length=120)


class BackupResponse(ApiResponse):
    workspace_id: str
    backup: dict[str, Any]


class BackupListResponse(ApiResponse):
    workspace_id: str
    backups: list[dict[str, Any]]


class BackupRestoreRequest(ApiRequest):
    expected_workspace_revision: str = Field(min_length=1)


class BackupRestoreResponse(ApiResponse):
    workspace_id: str
    metadata: dict[str, Any]
    revision: str
    recovery_backup_id: str


class ConflictReportRequest(ApiRequest):
    collection: str
    record_id: str
    expected_revision: str | None = None


class ConflictReportResponse(ApiResponse):
    workspace_id: str
    conflict: bool
    collection: str
    record_id: str
    expected_revision: str | None
    current_revision: str
    relative_path: str


class WorkspaceHealthResponse(ApiResponse):
    workspace_id: str
    status: Literal["healthy", "invalid"]
    workspace_revision: str | None
    missing_directories: list[str]
    durable_record_counts: dict[str, int]
    device_local_registry: dict[str, Any]
    error: str | None = None


class AtomicWriteSpikeRequest(ApiRequest):
    workspace_id: str


class AtomicWriteSpikeResponse(ApiResponse):
    workspace_id: str
    target_relative_path: str
    previous_hash: str
    current_hash: str
    interrupted_write_preserved_prior_file: bool
