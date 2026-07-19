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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Companion request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}
