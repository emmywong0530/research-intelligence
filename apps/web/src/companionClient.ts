export const DEFAULT_COMPANION_URL = "http://127.0.0.1:8765";

export type ApiEnvelope = {
  schema_version: string;
};

export type HealthResponse = ApiEnvelope & {
  status: "ok";
  companion_version: string;
  loopback_only: boolean;
};

export type CapabilitiesResponse = ApiEnvelope & {
  capabilities: string[];
  api_version: string;
};

export type PairingStartResponse = ApiEnvelope & {
  pairing_id: string;
  expires_at: string;
  approval_required: true;
  max_failed_attempts: number;
};

export type PairingCompleteResponse = ApiEnvelope & {
  session_token: string;
  expires_at: string;
};

export type WorkspaceMetadata = {
  schema_version: string;
  workspace_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  projects: string[];
  papers: string[];
  syntheses: string[];
  gaps: string[];
};

export type WorkspaceResponse = ApiEnvelope & {
  workspace_id: string;
  metadata: WorkspaceMetadata;
  revision: string;
};

export type WorkspaceHealthResponse = ApiEnvelope & {
  workspace_id: string;
  status: "healthy" | "invalid";
  workspace_revision: string | null;
  missing_directories: string[];
  durable_record_counts: Record<string, number>;
  device_local_registry: {
    available: boolean;
    separate_from_workspace: boolean;
    record_count: number;
  };
  error: string | null;
};

export class CompanionRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CompanionRequestError";
    this.status = status;
  }
}

export async function readHealth(baseUrl: string): Promise<HealthResponse> {
  return request<HealthResponse>(`${baseUrl}/api/v1/health`);
}

export async function readCapabilities(baseUrl: string): Promise<CapabilitiesResponse> {
  return request<CapabilitiesResponse>(`${baseUrl}/api/v1/capabilities`);
}

export async function startPairing(baseUrl: string): Promise<PairingStartResponse> {
  return request<PairingStartResponse>(`${baseUrl}/api/v1/pairing/start`, {
    method: "POST"
  });
}

export async function completePairing(
  baseUrl: string,
  pairingId: string,
  approvalCode: string
): Promise<PairingCompleteResponse> {
  return request<PairingCompleteResponse>(`${baseUrl}/api/v1/pairing/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairing_id: pairingId, approval_code: approvalCode })
  });
}

export async function createWorkspace(
  baseUrl: string,
  sessionToken: string,
  path: string,
  name?: string
): Promise<WorkspaceResponse> {
  return request<WorkspaceResponse>(`${baseUrl}/api/v1/workspaces/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, ...(name ? { name } : {}) })
  }, sessionToken);
}

export async function openWorkspace(
  baseUrl: string,
  sessionToken: string,
  path: string
): Promise<WorkspaceResponse> {
  return request<WorkspaceResponse>(`${baseUrl}/api/v1/workspaces/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path })
  }, sessionToken);
}

export async function readWorkspaceHealth(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string
): Promise<WorkspaceHealthResponse> {
  return request<WorkspaceHealthResponse>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/health`,
    {},
    sessionToken
  );
}

async function request<T>(url: string, init: RequestInit = {}, sessionToken?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (sessionToken) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    let message = `Companion request failed with HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string | { message?: string } };
      if (typeof body.detail === "string") message = body.detail;
      if (body.detail && typeof body.detail === "object" && body.detail.message) message = body.detail.message;
    } catch {
      // Preserve the HTTP status when the companion does not return JSON.
    }
    throw new CompanionRequestError(response.status, message);
  }
  return (await response.json()) as T;
}
