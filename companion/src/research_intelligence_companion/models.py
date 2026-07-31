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


class ProviderConfigWriteRequest(ApiRequest):
    provider: Literal["openai"]
    model: str = Field(min_length=1, max_length=80, pattern=r"^\S+$")
    timeout_seconds: int = Field(default=15, ge=1, le=30)
    max_retries: Literal[0, 1] = 1
    enabled: bool = True
    expected_revision: str | None = Field(default=None, min_length=64, max_length=64)


class ProviderCredentialRequest(ApiRequest):
    provider: Literal["openai"]
    credential: str = Field(min_length=1, max_length=500)


class ProviderCredentialRemoveRequest(ApiRequest):
    provider: Literal["openai"]


class ProviderTestRequest(ApiRequest):
    expected_revision: str | None = Field(default=None, min_length=64, max_length=64)


class ProviderScenarioRequest(ApiRequest):
    scenario: Literal[
        "success",
        "authentication_failed",
        "model_not_found",
        "rate_limited",
        "timeout",
        "cancelled",
        "unexpected_provider_error",
    ]


class ProcessingStartRequest(ApiRequest):
    synthetic_input_version: str = Field(
        default="v1", min_length=1, max_length=40, pattern=r"^[A-Za-z0-9._-]+$"
    )


class ProcessingScenarioRequest(ApiRequest):
    scenario: Literal["success", "invalid_output", "delayed", "timeout", "provider_unavailable"]


class ProcessingOperationsResponse(ApiResponse):
    operations: list[dict[str, Any]]


class ProcessingPromptsResponse(ApiResponse):
    prompts: list[dict[str, Any]]


class ProcessingStartResponse(ApiResponse):
    workspace_id: str
    record: dict[str, Any]
    revision: str
    reused_active: bool


class ProcessingListResponse(ApiResponse):
    workspace_id: str
    records: list[dict[str, Any]]


class ProcessingRecordResponse(ApiResponse):
    workspace_id: str
    record: dict[str, Any]
    revision: str


class ProcessingActionResponse(ApiResponse):
    workspace_id: str
    record: dict[str, Any]
    revision: str


class ProviderConfigView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["task5a.v1"]
    provider: Literal["openai"]
    model: str
    timeout_seconds: int
    max_retries: int
    enabled: bool
    created_at: str
    updated_at: str
    revision: str


class ProviderConnectionTestView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["success", "failed"]
    provider: Literal["openai"]
    model: str
    checked_at: str
    latency_ms: int | None
    error_category: (
        Literal[
            "credential_missing",
            "authentication_failed",
            "permission_denied",
            "model_not_found",
            "rate_limited",
            "timeout",
            "network_unavailable",
            "invalid_configuration",
            "provider_unavailable",
            "cancelled",
            "unexpected_provider_error",
        ]
        | None
    )
    message: str


class ProviderStatusResponse(ApiResponse):
    config: ProviderConfigView | None
    credential_state: Literal["present", "missing", "unavailable"]
    state: Literal[
        "unconfigured",
        "configured_without_credential",
        "ready_untested",
        "connection_verified",
        "connection_failed",
        "credential_removed",
        "configuration_invalid",
    ]
    last_test: ProviderConnectionTestView | None
    available_providers: list[dict[str, str]]


class ProviderCredentialStatusResponse(ApiResponse):
    provider: Literal["openai"]
    credential_state: Literal["present", "missing", "unavailable"]
    state: Literal[
        "configured_without_credential",
        "ready_untested",
        "connection_verified",
        "connection_failed",
        "credential_removed",
        "configuration_invalid",
        "unconfigured",
    ]


class ProviderConnectionTestResponse(ApiResponse):
    result: ProviderConnectionTestView


class ProviderScenarioResponse(ApiResponse):
    scenario: str


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


class SourceFileResponse(ApiResponse):
    workspace_id: str
    project_id: str
    paper_id: str
    source: dict[str, Any]
    source_revision: str


class PaperPdfImportResponse(ApiResponse):
    workspace_id: str
    project_id: str
    paper_id: str
    source: dict[str, Any]
    paper: dict[str, Any]
    paper_revision: str
    recovery_backup_id: str


class PaperTextExtractionResponse(ApiResponse):
    workspace_id: str
    project_id: str
    paper_id: str
    status: Literal["not_run", "completed", "stale"]
    extraction: dict[str, Any] | None = None


class DuplicateReviewRequest(ApiRequest):
    group_fingerprint: str = Field(pattern=r"^[A-Fa-f0-9]{64}$")
    review_status: Literal["reviewed_duplicate", "reviewed_not_duplicate", "ignored"]
    expected_revision: str | None = None


class DuplicateReportResponse(ApiResponse):
    workspace_id: str
    report_schema_version: str
    groups: list[dict[str, Any]]
    warnings: list[str]
    summary: dict[str, int]


class DuplicateGroupResponse(ApiResponse):
    workspace_id: str
    group: dict[str, Any]


class DuplicateReviewResponse(ApiResponse):
    workspace_id: str
    group: dict[str, Any]
    review: dict[str, Any]
    revision: str


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
