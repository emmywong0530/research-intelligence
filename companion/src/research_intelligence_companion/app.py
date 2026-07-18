from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials

from research_intelligence_companion import __version__
from research_intelligence_companion.keychain import run_keychain_roundtrip
from research_intelligence_companion.models import (
    SCHEMA_VERSION,
    AtomicWriteSpikeRequest,
    AtomicWriteSpikeResponse,
    AuthenticatedTestResponse,
    CapabilitiesResponse,
    HealthResponse,
    KeychainSpikeResponse,
    PairingCompleteRequest,
    PairingCompleteResponse,
    PairingStartResponse,
    WorkspaceOpenRequest,
    WorkspaceOpenResponse,
    WorkspaceResolveRequest,
    WorkspaceResolveResponse,
)
from research_intelligence_companion.security import (
    InMemorySecurityState,
    bearer_scheme,
    iso_timestamp,
    require_allowed_origin,
    require_bearer_token,
    validate_bind_host,
)
from research_intelligence_companion.settings import CompanionSettings
from research_intelligence_companion.workspace import (
    WorkspaceError,
    atomic_write_json,
    ensure_workspace_root,
    resolve_under_workspace,
    sha256_file,
    simulate_interrupted_write,
    stable_workspace_id,
)


class AppState:
    def __init__(self) -> None:
        self.security = InMemorySecurityState()
        self.workspace_roots: dict[str, Path] = {}


def create_app(settings: CompanionSettings | None = None) -> FastAPI:
    resolved_settings = settings or CompanionSettings.from_env()
    validate_bind_host(resolved_settings.host)
    task0_state = AppState()
    app = FastAPI(title="Research Intelligence Companion", version=__version__)

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
            response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
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
                "keychain_spike",
                "workspace_open",
                "atomic_json_write_spike",
                "path_traversal_protection",
            ],
        )

    @app.post("/api/v1/pairing/start", response_model=PairingStartResponse)
    def pairing_start() -> PairingStartResponse:
        pairing_id, attempt = task0_state.security.start_pairing()
        return PairingStartResponse(
            schema_version=SCHEMA_VERSION,
            pairing_id=pairing_id,
            pairing_code=attempt.pairing_code,
            expires_at=iso_timestamp(attempt.expires_at),
        )

    @app.post("/api/v1/pairing/complete", response_model=PairingCompleteResponse)
    def pairing_complete(request: PairingCompleteRequest) -> PairingCompleteResponse:
        token, session = task0_state.security.complete_pairing(
            request.pairing_id, request.pairing_code
        )
        return PairingCompleteResponse(
            schema_version=SCHEMA_VERSION,
            session_token=token,
            expires_at=iso_timestamp(session.expires_at),
        )

    @app.get("/api/v1/authenticated-test", response_model=AuthenticatedTestResponse)
    def authenticated_test(_session: None = Depends(require_session)) -> AuthenticatedTestResponse:
        return AuthenticatedTestResponse(schema_version=SCHEMA_VERSION, status="authenticated")

    @app.post("/api/v1/spikes/keychain-test", response_model=KeychainSpikeResponse)
    def keychain_spike(_session: None = Depends(require_session)) -> KeychainSpikeResponse:
        try:
            result = run_keychain_roundtrip()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Keychain spike failed: {exc}") from exc
        return KeychainSpikeResponse(schema_version=SCHEMA_VERSION, **result)

    @app.post("/api/v1/workspaces/open", response_model=WorkspaceOpenResponse)
    def workspace_open(
        request: WorkspaceOpenRequest, _session: None = Depends(require_session)
    ) -> WorkspaceOpenResponse:
        try:
            root = ensure_workspace_root(request.path)
        except WorkspaceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        workspace_id = stable_workspace_id(root)
        task0_state.workspace_roots[workspace_id] = root
        return WorkspaceOpenResponse(
            schema_version=SCHEMA_VERSION, workspace_id=workspace_id, root=str(root)
        )

    @app.post("/api/v1/workspaces/resolve", response_model=WorkspaceResolveResponse)
    def workspace_resolve(
        request: WorkspaceResolveRequest, _session: None = Depends(require_session)
    ) -> WorkspaceResolveResponse:
        root = task0_state.workspace_roots.get(request.workspace_id)
        if root is None:
            raise HTTPException(status_code=404, detail="Workspace is not open.")
        try:
            target = resolve_under_workspace(root, request.relative_path)
        except WorkspaceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
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
        root = task0_state.workspace_roots.get(request.workspace_id)
        if root is None:
            raise HTTPException(status_code=404, detail="Workspace is not open.")
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
