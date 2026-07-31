from __future__ import annotations

import os
import threading
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials

from research_intelligence_companion import __version__
from research_intelligence_companion.ai_provider import (
    ProviderConfigConflict,
    ProviderConfigError,
    ProviderRuntime,
)
from research_intelligence_companion.device import (
    DeviceRegistry,
    DeviceRegistryError,
    WorkspaceIdentityCollision,
)
from research_intelligence_companion.duplicate_detection import (
    DuplicateAnalysisLimitError,
    DuplicateGroupNotFoundError,
    build_duplicate_report,
    read_duplicate_group,
    write_duplicate_review,
)
from research_intelligence_companion.keychain import (
    KeychainCredentialUnavailable,
    installation_secret_status,
    run_keychain_roundtrip,
)
from research_intelligence_companion.models import (
    SCHEMA_VERSION,
    AtomicWriteSpikeRequest,
    AtomicWriteSpikeResponse,
    AuthenticatedTestResponse,
    BackupCreateRequest,
    BackupListResponse,
    BackupResponse,
    BackupRestoreRequest,
    BackupRestoreResponse,
    CapabilitiesResponse,
    ConflictReportRequest,
    ConflictReportResponse,
    DuplicateGroupResponse,
    DuplicateReportResponse,
    DuplicateReviewRequest,
    DuplicateReviewResponse,
    DurableRecordListResponse,
    DurableRecordResponse,
    DurableRecordWriteRequest,
    HealthResponse,
    InstallationSecretStatusResponse,
    KeychainSpikeResponse,
    PairingCompleteRequest,
    PairingCompleteResponse,
    PairingStartResponse,
    PaperPdfImportResponse,
    PaperSummaryPreflightResponse,
    PaperSummaryStartRequest,
    PaperTextExtractionResponse,
    ProcessingActionResponse,
    ProcessingListResponse,
    ProcessingOperationsResponse,
    ProcessingPromptsResponse,
    ProcessingRecordResponse,
    ProcessingScenarioRequest,
    ProcessingStartRequest,
    ProcessingStartResponse,
    ProviderConfigView,
    ProviderConfigWriteRequest,
    ProviderConnectionTestResponse,
    ProviderConnectionTestView,
    ProviderCredentialRemoveRequest,
    ProviderCredentialRequest,
    ProviderCredentialStatusResponse,
    ProviderScenarioRequest,
    ProviderScenarioResponse,
    ProviderStatusResponse,
    ProviderTestRequest,
    SourceFileResponse,
    WorkspaceCreateRequest,
    WorkspaceHealthResponse,
    WorkspaceInitializeResponse,
    WorkspaceMetadataResponse,
    WorkspaceOpenRequest,
    WorkspaceOpenResponse,
    WorkspaceResolveRequest,
    WorkspaceResolveResponse,
)
from research_intelligence_companion.processing import ProcessingEngine, ProcessingError
from research_intelligence_companion.security import (
    MAX_PAIRING_FAILED_ATTEMPTS,
    InMemorySecurityState,
    bearer_scheme,
    iso_timestamp,
    require_allowed_origin,
    require_bearer_token,
    validate_bind_host,
)
from research_intelligence_companion.settings import CompanionSettings
from research_intelligence_companion.workspace import (
    MAX_PDF_SIZE_BYTES,
    RECORD_DESCRIPTORS,
    WORKSPACE_DIRECTORIES,
    PaperNotFoundError,
    PaperSourceNotFoundError,
    PdfExtractionError,
    PdfExtractionLimitError,
    PdfImportSizeError,
    WorkspaceBusyError,
    WorkspaceConflictError,
    WorkspaceError,
    abort_pdf_import,
    atomic_write_json,
    complete_pdf_import,
    create_backup,
    create_workspace,
    extract_paper_text,
    initialize_workspace_structure,
    list_backups,
    list_records,
    open_workspace,
    prepare_pdf_import,
    read_paper_extraction,
    read_paper_source,
    read_record,
    read_workspace_metadata,
    report_conflict,
    resolve_under_workspace,
    restore_backup,
    sha256_file,
    simulate_interrupted_write,
    write_record,
)


class AppState:
    def __init__(self) -> None:
        self.security = InMemorySecurityState()
        self.workspace_roots: dict[str, Path] = {}
        self.provider_runtime = ProviderRuntime.from_environment()
        self.processing_engine = ProcessingEngine(self.provider_runtime)
        self.provider_test_lock = threading.Lock()
        try:
            self.device_registry: DeviceRegistry | None = DeviceRegistry()
        except (DeviceRegistryError, OSError):
            self.device_registry = None

    def register_workspace(self, workspace_id: str, root: Path) -> None:
        if self.device_registry is None:
            raise DeviceRegistryError("Device-local registry is unavailable.")
        self.device_registry.register_workspace(workspace_id, root)
        self.workspace_roots[workspace_id] = root


def _provider_status(runtime: ProviderRuntime) -> dict[str, object]:
    config = runtime.store.read()
    credential_state = runtime.credential_state(config.provider if config else "openai")
    return {
        "config": ProviderConfigView(**config.as_dict()) if config else None,
        "credential_state": credential_state,
        "state": runtime.state(config),
        "last_test": (
            ProviderConnectionTestView(**runtime.last_test.as_dict()) if runtime.last_test else None
        ),
        "available_providers": [{"id": "openai", "label": "OpenAI-compatible"}],
    }


def _workspace_error(exc: WorkspaceError) -> HTTPException:
    if isinstance(exc, WorkspaceBusyError):
        return HTTPException(
            status_code=409,
            detail={
                "code": "workspace_busy",
                "message": "The workspace changed while it was being read; retry the operation.",
            },
        )
    if isinstance(exc, WorkspaceConflictError):
        return HTTPException(
            status_code=409,
            detail={
                "code": "workspace_conflict",
                "message": str(exc),
                "expected_revision": exc.expected_revision,
                "current_revision": exc.current_revision,
                "incoming_revision": exc.incoming_revision,
            },
        )
    if isinstance(exc, PdfImportSizeError):
        return HTTPException(status_code=413, detail=str(exc))
    if isinstance(exc, PdfExtractionLimitError):
        return HTTPException(status_code=413, detail={"code": exc.code, "message": str(exc)})
    if isinstance(exc, DuplicateAnalysisLimitError):
        return HTTPException(
            status_code=413, detail={"code": "duplicate_analysis_limit", "message": str(exc)}
        )
    if isinstance(exc, PdfExtractionError):
        status_code = (
            409
            if exc.code in {"reextract_required", "source_changed", "extraction_in_progress"}
            else 400
        )
        return HTTPException(
            status_code=status_code,
            detail={"code": exc.code, "message": str(exc)},
        )
    return HTTPException(status_code=400, detail=str(exc))


def _processing_error(exc: ProcessingError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code, detail={"code": exc.code, "message": str(exc)}
    )


def _opened_workspace(state: AppState, workspace_id: str) -> Path:
    root = state.workspace_roots.get(workspace_id)
    if root is None:
        raise HTTPException(status_code=404, detail="Workspace is not open.")
    return root


def create_app(settings: CompanionSettings | None = None) -> FastAPI:
    resolved_settings = settings or CompanionSettings.from_env()
    validate_bind_host(resolved_settings.host)
    task0_state = AppState()
    app = FastAPI(title="Research Intelligence Companion", version=__version__)
    app.state.task0_state = task0_state
    app.state.task0_allowed_origins = resolved_settings.allowed_origins

    @app.middleware("http")
    async def origin_guard(request: Request, call_next):  # type: ignore[no-untyped-def]
        try:
            require_allowed_origin(request, resolved_settings.allowed_origins)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

        if request.method == "OPTIONS":
            response: Response = Response(status_code=204)
        else:
            response = await call_next(request)

        origin = request.headers.get("origin")
        if origin in resolved_settings.allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "DELETE,GET,POST,PUT,OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = (
                "Authorization,Content-Type,X-Original-Filename"
            )
        return response

    def require_session(
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    ) -> None:
        token = require_bearer_token(credentials)
        task0_state.security.validate_session(token)

    @app.get("/api/v1/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            schema_version=SCHEMA_VERSION,
            status="ok",
            companion_version=__version__,
            loopback_only=True,
        )

    @app.get("/api/v1/capabilities", response_model=CapabilitiesResponse)
    def capabilities() -> CapabilitiesResponse:
        return CapabilitiesResponse(
            schema_version=SCHEMA_VERSION,
            api_version="v1",
            capabilities=[
                "pairing",
                "authenticated_test_endpoint",
                "installation_secret_status",
                "keychain_spike",
                "workspace_create",
                "workspace_open",
                "workspace_metadata",
                "workspace_initialize",
                "durable_record_read",
                "durable_record_write",
                "durable_record_list",
                "workspace_backups",
                "workspace_conflicts",
                "workspace_health",
                "device_local_registry",
                "path_traversal_protection",
                "paper_source_read",
                "paper_pdf_import",
                "paper_pdf_replacement",
                "paper_text_extraction",
                "paper_text_reextraction",
                "duplicate_detection",
                "duplicate_review_state",
                "ai_provider_configuration",
                "ai_provider_keychain_credential",
                "ai_provider_connection_test",
                "ai_provider_openai_compatible",
                "ai_processing_synthetic_test",
                "ai_paper_summary_explicit",
            ],
        )

    @app.post("/api/v1/pairing/start", response_model=PairingStartResponse)
    def pairing_start() -> PairingStartResponse:
        pairing_id, attempt = task0_state.security.start_pairing()
        return PairingStartResponse(
            schema_version=SCHEMA_VERSION,
            pairing_id=pairing_id,
            expires_at=iso_timestamp(attempt.expires_at),
            approval_required=True,
            max_failed_attempts=MAX_PAIRING_FAILED_ATTEMPTS,
        )

    @app.post("/api/v1/pairing/complete", response_model=PairingCompleteResponse)
    def pairing_complete(request: PairingCompleteRequest) -> PairingCompleteResponse:
        token, session = task0_state.security.complete_pairing(
            request.pairing_id, request.approval_code
        )
        return PairingCompleteResponse(
            schema_version=SCHEMA_VERSION,
            session_token=token,
            expires_at=iso_timestamp(session.expires_at),
        )

    @app.get(
        "/api/v1/installation-secret/status",
        response_model=InstallationSecretStatusResponse,
    )
    def installation_secret_status_endpoint() -> InstallationSecretStatusResponse:
        return InstallationSecretStatusResponse(
            schema_version=SCHEMA_VERSION,
            **installation_secret_status(),
        )

    @app.get("/api/v1/ai/provider/config", response_model=ProviderStatusResponse)
    def provider_config(_session: None = Depends(require_session)) -> ProviderStatusResponse:
        try:
            return ProviderStatusResponse(
                schema_version=SCHEMA_VERSION, **_provider_status(task0_state.provider_runtime)
            )
        except ProviderConfigError as exc:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_configuration", "message": str(exc)}
            ) from exc

    @app.put("/api/v1/ai/provider/config", response_model=ProviderStatusResponse)
    def provider_config_write(
        request: ProviderConfigWriteRequest, _session: None = Depends(require_session)
    ) -> ProviderStatusResponse:
        runtime = task0_state.provider_runtime
        try:
            runtime.store.write(
                provider=request.provider,
                model=request.model,
                timeout_seconds=request.timeout_seconds,
                max_retries=request.max_retries,
                enabled=request.enabled,
                expected_revision=request.expected_revision,
            )
            runtime.last_test = None
            runtime.credential_was_removed = False
            return ProviderStatusResponse(
                schema_version=SCHEMA_VERSION, **_provider_status(runtime)
            )
        except ProviderConfigConflict as exc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "provider_config_conflict",
                    "message": str(exc),
                    "expected_revision": exc.expected,
                    "current_revision": exc.current,
                },
            ) from exc
        except ProviderConfigError as exc:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_configuration", "message": str(exc)}
            ) from exc

    @app.put("/api/v1/ai/provider/credential", response_model=ProviderCredentialStatusResponse)
    def provider_credential_save(
        request: ProviderCredentialRequest, _session: None = Depends(require_session)
    ) -> ProviderCredentialStatusResponse:
        runtime = task0_state.provider_runtime
        try:
            runtime.save_credential(request.provider, request.credential)
            config = runtime.store.read()
            return ProviderCredentialStatusResponse(
                schema_version=SCHEMA_VERSION,
                provider=request.provider,
                credential_state="present",
                state=runtime.state(config),
            )
        except KeychainCredentialUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "keychain_unavailable",
                    "message": (
                        "The operating-system keychain is unavailable; the credential was "
                        "not stored in plaintext."
                    ),
                },
            ) from exc
        except (ProviderConfigError, ValueError) as exc:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_credential", "message": str(exc)}
            ) from exc

    @app.delete("/api/v1/ai/provider/credential", response_model=ProviderCredentialStatusResponse)
    def provider_credential_remove(
        request: ProviderCredentialRemoveRequest, _session: None = Depends(require_session)
    ) -> ProviderCredentialStatusResponse:
        runtime = task0_state.provider_runtime
        try:
            runtime.remove_credential(request.provider)
            config = runtime.store.read()
            return ProviderCredentialStatusResponse(
                schema_version=SCHEMA_VERSION,
                provider=request.provider,
                credential_state="missing",
                state=runtime.state(config),
            )
        except KeychainCredentialUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "keychain_unavailable",
                    "message": (
                        "The operating-system keychain is unavailable; no plaintext fallback "
                        "exists."
                    ),
                },
            ) from exc

    @app.post("/api/v1/ai/provider/test", response_model=ProviderConnectionTestResponse)
    async def provider_connection_test(
        request: ProviderTestRequest, _session: None = Depends(require_session)
    ) -> ProviderConnectionTestResponse:
        runtime = task0_state.provider_runtime
        try:
            config = runtime.store.read()
        except ProviderConfigError as exc:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_configuration", "message": str(exc)}
            ) from exc
        if config is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "provider_not_configured",
                    "message": "Configure a provider before testing the connection.",
                },
            )
        if request.expected_revision is not None and request.expected_revision != config.revision:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "provider_config_conflict",
                    "message": "The provider configuration changed elsewhere.",
                    "expected_revision": request.expected_revision,
                    "current_revision": config.revision,
                },
            )
        if runtime.credential_state(config.provider) == "unavailable":
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "keychain_unavailable",
                    "message": (
                        "The operating-system keychain is unavailable; the connection test "
                        "is blocked."
                    ),
                },
            )
        if not task0_state.provider_test_lock.acquire(blocking=False):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "provider_test_in_progress",
                    "message": "A provider connection test is already running.",
                },
            )
        try:
            result = await runtime.run_test(config)
        finally:
            task0_state.provider_test_lock.release()
        return ProviderConnectionTestResponse(
            schema_version=SCHEMA_VERSION,
            result=ProviderConnectionTestView(**result.as_dict()),
        )

    @app.post("/api/v1/ai/provider/test-scenario", response_model=ProviderScenarioResponse)
    def provider_test_scenario(
        request: ProviderScenarioRequest, _session: None = Depends(require_session)
    ) -> ProviderScenarioResponse:
        if not task0_state.provider_runtime.test_mode:
            raise HTTPException(status_code=404, detail="Test provider controls are unavailable.")
        try:
            task0_state.provider_runtime.set_scenario(request.scenario)
        except ProviderConfigError as exc:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_scenario", "message": str(exc)}
            ) from exc
        return ProviderScenarioResponse(schema_version=SCHEMA_VERSION, scenario=request.scenario)

    @app.get(
        "/api/v1/workspaces/{workspace_id}/ai/processing/operations",
        response_model=ProcessingOperationsResponse,
    )
    def processing_operations(
        workspace_id: str, _session: None = Depends(require_session)
    ) -> ProcessingOperationsResponse:
        _opened_workspace(task0_state, workspace_id)
        try:
            operations = task0_state.processing_engine.operations()
        except ProcessingError as exc:
            raise _processing_error(exc) from exc
        return ProcessingOperationsResponse(schema_version=SCHEMA_VERSION, operations=operations)

    @app.get(
        "/api/v1/workspaces/{workspace_id}/ai/processing/prompts",
        response_model=ProcessingPromptsResponse,
    )
    def processing_prompts(
        workspace_id: str, _session: None = Depends(require_session)
    ) -> ProcessingPromptsResponse:
        _opened_workspace(task0_state, workspace_id)
        try:
            prompts = task0_state.processing_engine.prompts()
        except ProcessingError as exc:
            raise _processing_error(exc) from exc
        return ProcessingPromptsResponse(schema_version=SCHEMA_VERSION, prompts=prompts)

    @app.post(
        "/api/v1/workspaces/{workspace_id}/ai/processing/start",
        response_model=ProcessingStartResponse,
    )
    def processing_start(
        workspace_id: str,
        request: ProcessingStartRequest,
        _session: None = Depends(require_session),
    ) -> ProcessingStartResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            started = task0_state.processing_engine.start(
                root, workspace_id, source_version=request.synthetic_input_version
            )
            processing_id = str(started["record"]["processing_id"])
            record, revision, _ = read_record(root, "processing", processing_id)
        except (ProcessingError, WorkspaceError) as exc:
            if isinstance(exc, ProcessingError):
                raise _processing_error(exc) from exc
            raise _workspace_error(exc) from exc
        return ProcessingStartResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            record=record,
            revision=revision,
            reused_active=bool(started["reused_active"]),
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/ai/processing/records",
        response_model=ProcessingListResponse,
    )
    def processing_list(
        workspace_id: str, _session: None = Depends(require_session)
    ) -> ProcessingListResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            records = list_records(root, "processing")
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ProcessingListResponse(
            schema_version=SCHEMA_VERSION, workspace_id=workspace_id, records=records
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/ai/processing/records/{processing_id}",
        response_model=ProcessingRecordResponse,
    )
    def processing_read(
        workspace_id: str,
        processing_id: str,
        _session: None = Depends(require_session),
    ) -> ProcessingRecordResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            record, revision, _ = read_record(root, "processing", processing_id)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ProcessingRecordResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            record=record,
            revision=revision,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/ai/processing/records/{processing_id}/cancel",
        response_model=ProcessingActionResponse,
    )
    def processing_cancel(
        workspace_id: str,
        processing_id: str,
        _session: None = Depends(require_session),
    ) -> ProcessingActionResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            record = task0_state.processing_engine.cancel(root, processing_id)
            _, revision, _ = read_record(root, "processing", processing_id)
        except ProcessingError as exc:
            raise _processing_error(exc) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ProcessingActionResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            record=record,
            revision=revision,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/ai/processing/records/{processing_id}/retry",
        response_model=ProcessingActionResponse,
    )
    def processing_retry(
        workspace_id: str,
        processing_id: str,
        _session: None = Depends(require_session),
    ) -> ProcessingActionResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            started = task0_state.processing_engine.retry(root, workspace_id, processing_id)
            new_id = str(started["record"]["processing_id"])
            record, revision, _ = read_record(root, "processing", new_id)
        except ProcessingError as exc:
            raise _processing_error(exc) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ProcessingActionResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            record=record,
            revision=revision,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/ai/processing/records/{processing_id}/invalidate",
        response_model=ProcessingActionResponse,
    )
    def processing_invalidate(
        workspace_id: str,
        processing_id: str,
        _session: None = Depends(require_session),
    ) -> ProcessingActionResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            record = task0_state.processing_engine.invalidate(root, processing_id)
            _, revision, _ = read_record(root, "processing", processing_id)
        except ProcessingError as exc:
            raise _processing_error(exc) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ProcessingActionResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            record=record,
            revision=revision,
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/ai/processing/records/{processing_id}/provenance",
        response_model=ProcessingActionResponse,
    )
    def processing_provenance(
        workspace_id: str,
        processing_id: str,
        _session: None = Depends(require_session),
    ) -> ProcessingActionResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            record, revision, _ = read_record(root, "processing", processing_id)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ProcessingActionResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            record={"processing_id": processing_id, "provenance": record["provenance"]},
            revision=revision,
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/preflight",
        response_model=PaperSummaryPreflightResponse,
    )
    def paper_summary_preflight(
        workspace_id: str,
        project_id: str,
        paper_id: str,
        _session: None = Depends(require_session),
    ) -> PaperSummaryPreflightResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            result = task0_state.processing_engine.summary_preflight(root, project_id, paper_id)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        result.pop("project_id", None)
        result.pop("paper_id", None)
        return PaperSummaryPreflightResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            project_id=project_id,
            paper_id=paper_id,
            **result,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/start",
        response_model=ProcessingStartResponse,
    )
    def paper_summary_start(
        workspace_id: str,
        project_id: str,
        paper_id: str,
        request: PaperSummaryStartRequest,
        _session: None = Depends(require_session),
    ) -> ProcessingStartResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            started = task0_state.processing_engine.start_paper_summary(
                root,
                workspace_id,
                project_id,
                paper_id,
                expected_paper_revision=request.expected_paper_revision,
            )
            processing_id = str(started["record"]["processing_id"])
            record, revision, _ = read_record(root, "processing", processing_id)
        except ProcessingError as exc:
            raise _processing_error(exc) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ProcessingStartResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            record=record,
            revision=revision,
            reused_active=bool(started["reused_active"]),
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/records",
        response_model=ProcessingListResponse,
    )
    def paper_summary_list(
        workspace_id: str,
        project_id: str,
        paper_id: str,
        _session: None = Depends(require_session),
    ) -> ProcessingListResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            records = task0_state.processing_engine.list_summary_records(root, project_id, paper_id)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ProcessingListResponse(
            schema_version=SCHEMA_VERSION, workspace_id=workspace_id, records=records
        )

    def _summary_record_route(
        workspace_id: str, project_id: str, paper_id: str, processing_id: str
    ) -> tuple[Path, dict[str, object], str]:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            record, revision, _ = read_record(root, "processing", processing_id)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        if (
            record.get("operation_id") != "paper_summary"
            or record.get("project_id") != project_id
            or record.get("paper_id") != paper_id
        ):
            raise HTTPException(status_code=404, detail="Paper summary record was not found.")
        return root, record, revision

    @app.get(
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/records/{processing_id}",
        response_model=ProcessingRecordResponse,
    )
    def paper_summary_read(
        workspace_id: str,
        project_id: str,
        paper_id: str,
        processing_id: str,
        _session: None = Depends(require_session),
    ) -> ProcessingRecordResponse:
        _root, record, revision = _summary_record_route(
            workspace_id, project_id, paper_id, processing_id
        )
        return ProcessingRecordResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            record=record,
            revision=revision,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/records/{processing_id}/cancel",
        response_model=ProcessingActionResponse,
    )
    def paper_summary_cancel(
        workspace_id: str,
        project_id: str,
        paper_id: str,
        processing_id: str,
        _session: None = Depends(require_session),
    ) -> ProcessingActionResponse:
        root, _record, _revision = _summary_record_route(
            workspace_id, project_id, paper_id, processing_id
        )
        try:
            record = task0_state.processing_engine.cancel(root, processing_id)
            _, revision, _ = read_record(root, "processing", processing_id)
        except ProcessingError as exc:
            raise _processing_error(exc) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ProcessingActionResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            record=record,
            revision=revision,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/records/{processing_id}/retry",
        response_model=ProcessingActionResponse,
    )
    def paper_summary_retry(
        workspace_id: str,
        project_id: str,
        paper_id: str,
        processing_id: str,
        _session: None = Depends(require_session),
    ) -> ProcessingActionResponse:
        root, _record, _revision = _summary_record_route(
            workspace_id, project_id, paper_id, processing_id
        )
        try:
            started = task0_state.processing_engine.retry_paper_summary(
                root, workspace_id, project_id, paper_id, processing_id
            )
            new_id = str(started["record"]["processing_id"])
            record, revision, _ = read_record(root, "processing", new_id)
        except ProcessingError as exc:
            raise _processing_error(exc) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ProcessingActionResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            record=record,
            revision=revision,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/ai-summary/records/{processing_id}/invalidate",
        response_model=ProcessingActionResponse,
    )
    def paper_summary_invalidate(
        workspace_id: str,
        project_id: str,
        paper_id: str,
        processing_id: str,
        _session: None = Depends(require_session),
    ) -> ProcessingActionResponse:
        root, _record, _revision = _summary_record_route(
            workspace_id, project_id, paper_id, processing_id
        )
        try:
            record = task0_state.processing_engine.invalidate(root, processing_id)
            _, revision, _ = read_record(root, "processing", processing_id)
        except ProcessingError as exc:
            raise _processing_error(exc) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ProcessingActionResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            record=record,
            revision=revision,
        )

    @app.post("/api/v1/ai/processing/test-scenario", response_model=ProviderScenarioResponse)
    def processing_test_scenario(
        request: ProcessingScenarioRequest, _session: None = Depends(require_session)
    ) -> ProviderScenarioResponse:
        if not task0_state.provider_runtime.test_mode:
            raise HTTPException(status_code=404, detail="Test processing controls are unavailable.")
        try:
            task0_state.provider_runtime.set_processing_scenario(request.scenario)
        except ProviderConfigError as exc:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_scenario", "message": str(exc)}
            ) from exc
        return ProviderScenarioResponse(schema_version=SCHEMA_VERSION, scenario=request.scenario)

    @app.get("/api/v1/authenticated-test", response_model=AuthenticatedTestResponse)
    def authenticated_test(_session: None = Depends(require_session)) -> AuthenticatedTestResponse:
        return AuthenticatedTestResponse(schema_version=SCHEMA_VERSION, status="authenticated")

    @app.post("/api/v1/spikes/keychain-test", response_model=KeychainSpikeResponse)
    def keychain_spike(_session: None = Depends(require_session)) -> KeychainSpikeResponse:
        try:
            result = run_keychain_roundtrip()
        except Exception as exc:  # noqa: BLE001 - surface backend-specific keychain errors.
            raise HTTPException(status_code=500, detail=f"Keychain spike failed: {exc}") from exc
        return KeychainSpikeResponse(schema_version=SCHEMA_VERSION, **result)

    @app.post("/api/v1/workspaces/create", response_model=WorkspaceOpenResponse)
    def workspace_create(
        request: WorkspaceCreateRequest, _session: None = Depends(require_session)
    ) -> WorkspaceOpenResponse:
        try:
            root, metadata, revision = create_workspace(request.path, request.name)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        workspace_id = metadata["workspace_id"]
        try:
            task0_state.register_workspace(workspace_id, root)
        except WorkspaceIdentityCollision as exc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "workspace_identity_collision",
                    "message": str(exc),
                    "workspace_id": exc.workspace_id,
                },
            ) from exc
        except DeviceRegistryError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return WorkspaceOpenResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            metadata=metadata,
            revision=revision,
            root=str(root),
        )

    @app.post("/api/v1/workspaces/open", response_model=WorkspaceOpenResponse)
    def workspace_open(
        request: WorkspaceOpenRequest, _session: None = Depends(require_session)
    ) -> WorkspaceOpenResponse:
        try:
            root, metadata, revision = open_workspace(request.path)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        workspace_id = metadata["workspace_id"]
        try:
            task0_state.register_workspace(workspace_id, root)
        except WorkspaceIdentityCollision as exc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "workspace_identity_collision",
                    "message": str(exc),
                    "workspace_id": exc.workspace_id,
                },
            ) from exc
        except DeviceRegistryError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return WorkspaceOpenResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            metadata=metadata,
            revision=revision,
            root=str(root),
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/metadata",
        response_model=WorkspaceMetadataResponse,
    )
    def workspace_metadata(
        workspace_id: str, _session: None = Depends(require_session)
    ) -> WorkspaceMetadataResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            metadata, revision = read_workspace_metadata(root)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return WorkspaceMetadataResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            metadata=metadata,
            revision=revision,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/initialize",
        response_model=WorkspaceInitializeResponse,
    )
    def workspace_initialize(
        workspace_id: str, _session: None = Depends(require_session)
    ) -> WorkspaceInitializeResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            created = initialize_workspace_structure(root)
            metadata, revision = read_workspace_metadata(root)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return WorkspaceInitializeResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            created_directories=created,
            metadata=metadata,
            revision=revision,
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/records/{collection}",
        response_model=DurableRecordListResponse,
    )
    def workspace_list_records(
        workspace_id: str,
        collection: str,
        project_id: str | None = Query(default=None),
        paper_id: str | None = Query(default=None),
        scope_type: str | None = Query(default=None),
        _session: None = Depends(require_session),
    ) -> DurableRecordListResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            records = list_records(
                root, collection, project_id=project_id, paper_id=paper_id, scope_type=scope_type
            )
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return DurableRecordListResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            collection=collection,
            records=records,
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/records/{collection}/{record_id}",
        response_model=DurableRecordResponse,
    )
    def workspace_read_record(
        workspace_id: str,
        collection: str,
        record_id: str,
        _session: None = Depends(require_session),
    ) -> DurableRecordResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            record, revision, relative_path = read_record(root, collection, record_id)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return DurableRecordResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            collection=collection,
            record_id=record_id,
            record=record,
            revision=revision,
            relative_path=relative_path,
        )

    @app.put(
        "/api/v1/workspaces/{workspace_id}/records/{collection}/{record_id}",
        response_model=DurableRecordResponse,
    )
    def workspace_write_record(
        workspace_id: str,
        collection: str,
        record_id: str,
        request: DurableRecordWriteRequest,
        _session: None = Depends(require_session),
    ) -> DurableRecordResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            record, revision, relative_path, previous_revision = write_record(
                root,
                collection,
                record_id,
                request.record,
                expected_revision=request.expected_revision,
                parent_id=request.parent_id,
            )
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return DurableRecordResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            collection=collection,
            record_id=record_id,
            record=record,
            revision=revision,
            relative_path=relative_path,
            previous_revision=previous_revision,
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/source-file",
        response_model=SourceFileResponse,
    )
    def workspace_read_paper_source(
        workspace_id: str,
        project_id: str,
        paper_id: str,
        _session: None = Depends(require_session),
    ) -> SourceFileResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            source, source_revision = read_paper_source(root, project_id, paper_id)
        except PaperSourceNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PaperNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return SourceFileResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            project_id=project_id,
            paper_id=paper_id,
            source=source,
            source_revision=source_revision,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/source-file",
        response_model=PaperPdfImportResponse,
    )
    async def workspace_import_paper_source(
        workspace_id: str,
        project_id: str,
        paper_id: str,
        request: Request,
        replace: bool = Query(default=False),
        expected_revision: str | None = Query(default=None),
        _session: None = Depends(require_session),
    ) -> PaperPdfImportResponse:
        root = _opened_workspace(task0_state, workspace_id)
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/pdf":
            raise HTTPException(
                status_code=415,
                detail="PDF imports require Content-Type application/pdf.",
            )
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > MAX_PDF_SIZE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="The selected PDF exceeds the 50 MB local import limit.",
                    )
            except ValueError as exc:
                raise HTTPException(
                    status_code=400, detail="Content-Length must be numeric."
                ) from exc
        context: dict[str, object] | None = None
        try:
            context = prepare_pdf_import(
                root,
                project_id,
                paper_id,
                expected_revision=expected_revision,
                replace=replace,
            )
            incoming_path = context["incoming_path"]
            if not isinstance(incoming_path, Path):
                raise WorkspaceError("PDF import staging is unavailable.")
            size = 0
            with incoming_path.open("wb") as handle:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_PDF_SIZE_BYTES:
                        raise PdfImportSizeError(
                            "The selected PDF exceeds the 50 MB local import limit."
                        )
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            source, paper, paper_revision, recovery_backup_id = complete_pdf_import(
                root,
                context,
                original_filename=request.headers.get("x-original-filename"),
            )
        except PaperNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except WorkspaceError as exc:
            if context is not None:
                abort_pdf_import(context)
            raise _workspace_error(exc) from exc
        except Exception as exc:  # noqa: BLE001 - keep upload failures truthful and recoverable.
            if context is not None:
                abort_pdf_import(context)
            raise HTTPException(status_code=400, detail=f"PDF import failed: {exc}") from exc
        return PaperPdfImportResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            project_id=project_id,
            paper_id=paper_id,
            source=source,
            paper=paper,
            paper_revision=paper_revision,
            recovery_backup_id=recovery_backup_id,
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/text-extraction",
        response_model=PaperTextExtractionResponse,
    )
    def workspace_read_paper_extraction(
        workspace_id: str,
        project_id: str,
        paper_id: str,
        _session: None = Depends(require_session),
    ) -> PaperTextExtractionResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            status, extraction = read_paper_extraction(root, project_id, paper_id)
        except PaperSourceNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PaperNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return PaperTextExtractionResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            project_id=project_id,
            paper_id=paper_id,
            status=status,
            extraction=extraction,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/papers/{paper_id}/text-extraction",
        response_model=PaperTextExtractionResponse,
    )
    def workspace_extract_paper_text(
        workspace_id: str,
        project_id: str,
        paper_id: str,
        reextract: bool = Query(default=False),
        expected_revision: str | None = Query(default=None),
        _session: None = Depends(require_session),
    ) -> PaperTextExtractionResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            status, extraction = extract_paper_text(
                root,
                project_id,
                paper_id,
                expected_revision=expected_revision,
                reextract=reextract,
            )
        except PaperSourceNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PaperNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        except Exception as exc:  # noqa: BLE001 - do not expose parser or workspace content.
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "pdf_extraction_failed",
                    "message": "Text extraction failed during local parsing.",
                },
            ) from exc
        return PaperTextExtractionResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            project_id=project_id,
            paper_id=paper_id,
            status=status,
            extraction=extraction,
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/duplicates",
        response_model=DuplicateReportResponse,
    )
    def workspace_list_duplicates(
        workspace_id: str,
        project_id: str | None = Query(default=None),
        paper_id: str | None = Query(default=None),
        _session: None = Depends(require_session),
    ) -> DuplicateReportResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            report = build_duplicate_report(root, project_id=project_id, paper_id=paper_id)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return DuplicateReportResponse(schema_version=SCHEMA_VERSION, **report)

    @app.get(
        "/api/v1/workspaces/{workspace_id}/duplicates/{group_fingerprint}",
        response_model=DuplicateGroupResponse,
    )
    def workspace_read_duplicate_group(
        workspace_id: str,
        group_fingerprint: str,
        _session: None = Depends(require_session),
    ) -> DuplicateGroupResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            group = read_duplicate_group(root, group_fingerprint)
        except DuplicateGroupNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return DuplicateGroupResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            group=group,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/duplicates/reviews",
        response_model=DuplicateReviewResponse,
    )
    def workspace_write_duplicate_review(
        workspace_id: str,
        request: DuplicateReviewRequest,
        _session: None = Depends(require_session),
    ) -> DuplicateReviewResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            group, review, revision = write_duplicate_review(
                root,
                request.group_fingerprint,
                request.review_status,
                request.expected_revision,
            )
        except DuplicateGroupNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return DuplicateReviewResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            group=group,
            review=review,
            revision=revision,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/backups",
        response_model=BackupResponse,
    )
    def workspace_create_backup(
        workspace_id: str,
        request: BackupCreateRequest,
        _session: None = Depends(require_session),
    ) -> BackupResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            backup = create_backup(root, reason=request.reason)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return BackupResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            backup=backup,
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/backups",
        response_model=BackupListResponse,
    )
    def workspace_list_backups(
        workspace_id: str, _session: None = Depends(require_session)
    ) -> BackupListResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            backups = list_backups(root)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return BackupListResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            backups=backups,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/backups/{backup_id}/restore",
        response_model=BackupRestoreResponse,
    )
    def workspace_restore_backup(
        workspace_id: str,
        backup_id: str,
        request: BackupRestoreRequest,
        _session: None = Depends(require_session),
    ) -> BackupRestoreResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            metadata, revision, recovery_backup_id = restore_backup(
                root,
                backup_id,
                expected_workspace_revision=request.expected_workspace_revision,
            )
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return BackupRestoreResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            metadata=metadata,
            revision=revision,
            recovery_backup_id=recovery_backup_id or backup_id,
        )

    @app.post(
        "/api/v1/workspaces/{workspace_id}/conflicts",
        response_model=ConflictReportResponse,
    )
    def workspace_report_conflict(
        workspace_id: str,
        request: ConflictReportRequest,
        _session: None = Depends(require_session),
    ) -> ConflictReportResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            result = report_conflict(
                root,
                request.collection,
                request.record_id,
                request.expected_revision,
            )
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        return ConflictReportResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            **result,
        )

    @app.get(
        "/api/v1/workspaces/{workspace_id}/health",
        response_model=WorkspaceHealthResponse,
    )
    def workspace_health(
        workspace_id: str, _session: None = Depends(require_session)
    ) -> WorkspaceHealthResponse:
        root = _opened_workspace(task0_state, workspace_id)
        missing = [name for name in WORKSPACE_DIRECTORIES if not (root / name).is_dir()]
        workspace_revision: str | None = None
        error: str | None = None
        status = "healthy"
        try:
            metadata, workspace_revision = read_workspace_metadata(root)
        except WorkspaceError as exc:
            status = "invalid"
            error = str(exc)
        counts: dict[str, int] = {}
        if status == "healthy":
            for collection in RECORD_DESCRIPTORS:
                try:
                    if collection in {"notes", "source-files"}:
                        project_ids = [
                            item["record"]["project_id"] for item in list_records(root, "projects")
                        ]
                        counts[collection] = sum(
                            len(list_records(root, collection, project_id=project_id))
                            for project_id in project_ids
                        )
                    else:
                        counts[collection] = len(list_records(root, collection))
                except WorkspaceError as exc:
                    status = "invalid"
                    error = str(exc)
                    break
        return WorkspaceHealthResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=workspace_id,
            status="invalid" if missing or status == "invalid" else "healthy",
            workspace_revision=workspace_revision,
            missing_directories=missing,
            durable_record_counts=counts,
            device_local_registry=(
                task0_state.device_registry.health()
                if task0_state.device_registry is not None
                else {"available": False, "separate_from_workspace": True, "record_count": 0}
            ),
            error=error or ("Workspace structure is incomplete." if missing else None),
        )

    @app.post("/api/v1/workspaces/resolve", response_model=WorkspaceResolveResponse)
    def workspace_resolve(
        request: WorkspaceResolveRequest, _session: None = Depends(require_session)
    ) -> WorkspaceResolveResponse:
        root = _opened_workspace(task0_state, request.workspace_id)
        try:
            target = resolve_under_workspace(root, request.relative_path)
        except WorkspaceError as exc:
            raise _workspace_error(exc) from exc
        relative = target.relative_to(root.resolve()).as_posix()
        return WorkspaceResolveResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=request.workspace_id,
            relative_path=relative,
        )

    @app.post("/api/v1/spikes/atomic-write-test", response_model=AtomicWriteSpikeResponse)
    def atomic_write_spike(
        request: AtomicWriteSpikeRequest, _session: None = Depends(require_session)
    ) -> AtomicWriteSpikeResponse:
        root = _opened_workspace(task0_state, request.workspace_id)
        target = resolve_under_workspace(root, ".research-intelligence-spike/atomic.json")
        initial_hash = atomic_write_json(
            target,
            {"schema_version": SCHEMA_VERSION, "value": "prior"},
        )
        preserved = simulate_interrupted_write(
            target, {"schema_version": SCHEMA_VERSION, "value": "partial"}
        )
        current_hash = sha256_file(target)
        return AtomicWriteSpikeResponse(
            schema_version=SCHEMA_VERSION,
            workspace_id=request.workspace_id,
            target_relative_path=target.relative_to(root.resolve()).as_posix(),
            previous_hash=initial_hash,
            current_hash=current_hash,
            interrupted_write_preserved_prior_file=preserved and initial_hash == current_hash,
        )

    return app
