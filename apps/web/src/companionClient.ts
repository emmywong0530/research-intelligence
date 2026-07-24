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

export type ProjectRecord = {
  schema_version: string;
  project_id: string;
  name: string;
  natural_language_research_idea: string;
  central_research_question: string;
  created_at: string;
  updated_at: string;
};

export type ResearchProfileConcept = {
  term: string;
  weight?: number;
};

export type ResearchProfileRecord = {
  schema_version: string;
  research_profile_id: string;
  project_id: string;
  central_research_question: string;
  concepts?: ResearchProfileConcept[];
  synonyms?: string[];
  theories?: string[];
  mechanisms?: string[];
  outcomes?: string[];
  contexts?: string[];
  populations?: string[];
  preferred_disciplines?: string[];
  preferred_evidence_types?: string[];
  exclusions?: string[];
  watched_authors?: string[];
  search_queries?: string[];
  created_at: string;
  updated_at: string;
};

export type DurableRecordEnvelope<T> = ApiEnvelope & {
  workspace_id: string;
  collection: string;
  record_id: string;
  record: T;
  revision: string;
  relative_path: string;
  previous_revision?: string | null;
};

export type DurableRecordListResponse<T> = ApiEnvelope & {
  workspace_id: string;
  collection: string;
  records: Array<{
    record_id: string;
    record: T;
    revision: string;
    relative_path: string;
  }>;
};

export class CompanionRequestError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "CompanionRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class CompanionUnavailableError extends Error {
  constructor(message = "The local companion is unavailable.") {
    super(message);
    this.name = "CompanionUnavailableError";
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

export async function listProjects(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string
): Promise<DurableRecordListResponse<ProjectRecord>> {
  return request<DurableRecordListResponse<ProjectRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/projects`,
    {},
    sessionToken
  );
}

export async function readProject(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  projectId: string
): Promise<DurableRecordEnvelope<ProjectRecord>> {
  return request<DurableRecordEnvelope<ProjectRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/projects/${encodeURIComponent(projectId)}`,
    {},
    sessionToken
  );
}

export async function writeProject(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  project: ProjectRecord,
  expectedRevision?: string
): Promise<DurableRecordEnvelope<ProjectRecord>> {
  return request<DurableRecordEnvelope<ProjectRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/projects/${encodeURIComponent(project.project_id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record: project, ...(expectedRevision ? { expected_revision: expectedRevision } : {}) })
    },
    sessionToken
  );
}

export function researchProfileIdForProject(projectId: string): string {
  return `research_profile_${projectId}`;
}

export async function listResearchProfiles(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string
): Promise<DurableRecordListResponse<ResearchProfileRecord>> {
  return request<DurableRecordListResponse<ResearchProfileRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/research-profiles`,
    {},
    sessionToken
  );
}

export async function readResearchProfile(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  profileId: string
): Promise<DurableRecordEnvelope<ResearchProfileRecord>> {
  return request<DurableRecordEnvelope<ResearchProfileRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/research-profiles/${encodeURIComponent(profileId)}`,
    {},
    sessionToken
  );
}

export async function writeResearchProfile(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  profile: ResearchProfileRecord,
  expectedRevision?: string
): Promise<DurableRecordEnvelope<ResearchProfileRecord>> {
  return request<DurableRecordEnvelope<ResearchProfileRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/research-profiles/${encodeURIComponent(profile.research_profile_id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        record: profile,
        parent_id: profile.project_id,
        ...(expectedRevision ? { expected_revision: expectedRevision } : {})
      })
    },
    sessionToken
  );
}

async function request<T>(url: string, init: RequestInit = {}, sessionToken?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (sessionToken) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new CompanionUnavailableError("The local companion could not be reached.");
  }
  if (!response.ok) {
    let message = `Companion request failed with HTTP ${response.status}`;
    let code: string | undefined;
    let details: unknown;
    try {
      const body = (await response.json()) as { detail?: string | { code?: string; message?: string; [key: string]: unknown } };
      if (typeof body.detail === "string") message = body.detail;
      if (body.detail && typeof body.detail === "object") {
        if (body.detail.message) message = body.detail.message;
        code = body.detail.code;
        details = body.detail;
      }
    } catch {
      // Preserve the HTTP status when the companion does not return JSON.
    }
    throw new CompanionRequestError(response.status, message, code, details);
  }
  return (await response.json()) as T;
}
