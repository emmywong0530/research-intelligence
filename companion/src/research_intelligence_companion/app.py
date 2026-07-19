from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials

from research_intelligence_companion import __version__
from research_intelligence_companion.device import (
    DeviceRegistry,
    DeviceRegistryError,
    WorkspaceIdentityCollision,
)
from research_intelligence_companion.keychain import (
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
    DurableRecordListResponse,
    DurableRecordResponse,
    DurableRecordWriteRequest,
    HealthResponse,
    InstallationSecretStatusResponse,
    KeychainSpikeResponse,
    PairingCompleteRequest,
    PairingCompleteResponse,
    PairingStartResponse,
    WorkspaceCreateRequest,
    WorkspaceHealthResponse,
    WorkspaceInitializeResponse,
    WorkspaceMetadataResponse,
    WorkspaceOpenRequest,
    WorkspaceOpenResponse,
    WorkspaceResolveRequest,
    WorkspaceResolveResponse,
)
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
    RECORD_DESCRIPTORS,
    WORKSPACE_DIRECTORIES,
    WorkspaceConflictError,
    WorkspaceError,
    atomic_write_json,
    create_backup,
    create_workspace,
    initialize_workspace_structure,
    list_backups,
    list_records,
    open_workspace,
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
        try:
            self.device_registry: DeviceRegistry | None = DeviceRegistry()
        except (DeviceRegistryError, OSError):
            self.device_registry = None

    def register_workspace(self, workspace_id: str, root: Path) -> None:
        if self.device_registry is None:
            raise DeviceRegistryError("Device-local registry is unavailable.")
        self.device_registry.register_workspace(workspace_id, root)
        self.workspace_roots[workspace_id] = root


def _workspace_error(exc: WorkspaceError) -> HTTPException:
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
    return HTTPException(status_code=400, detail=str(exc))


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
            response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Authorization,Content-Type"
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
        _session: None = Depends(require_session),
    ) -> DurableRecordListResponse:
        root = _opened_workspace(task0_state, workspace_id)
        try:
            records = list_records(root, collection)
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
