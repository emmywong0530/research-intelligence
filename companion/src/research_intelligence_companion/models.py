from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = "task0.v1"


class ApiResponse(BaseModel):
    schema_version: Literal["task0.v1"]


class HealthResponse(ApiResponse):
    status: Literal["ok"]
    companion_version: str
    loopback_only: bool


class CapabilitiesResponse(ApiResponse):
    api_version: Literal["v1"]
    capabilities: list[str]


class PairingStartResponse(ApiResponse):
    pairing_id: str
    pairing_code: str = Field(pattern=r"^[0-9]{6}$")
    expires_at: str


class PairingCompleteRequest(BaseModel):
    pairing_id: str
    pairing_code: str = Field(pattern=r"^[0-9]{6}$")


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


class WorkspaceOpenRequest(BaseModel):
    path: str


class WorkspaceOpenResponse(ApiResponse):
    workspace_id: str
    root: str


class WorkspaceResolveRequest(BaseModel):
    workspace_id: str
    relative_path: str


class WorkspaceResolveResponse(ApiResponse):
    workspace_id: str
    relative_path: str


class AtomicWriteSpikeRequest(BaseModel):
    workspace_id: str


class AtomicWriteSpikeResponse(ApiResponse):
    workspace_id: str
    target_relative_path: str
    previous_hash: str
    current_hash: str
    interrupted_write_preserved_prior_file: bool
