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

export type PaperRecord = {
  schema_version: string;
  paper_id: string;
  title: string;
  authors: string[];
  year?: number;
  publication_venue?: string;
  doi?: string | null;
  external_identifiers?: Record<string, string>;
  publication_status?: string;
  research_type?: string;
  methodological_subtype?: string;
  evidence_structure?: string;
  abstract?: string;
  pdf_access_status?: "pdf_ready" | "open_access" | "repository_version" | "institutional_access_required" | "manual_upload_required" | "abstract_only" | "unavailable";
  local_pdf_path?: string | null;
  source_version_type?: string;
  assigned_project_ids: string[];
  project_relevance_records?: Array<{
    project_id: string;
    relevance_percentage: number;
    relevance_explanation: string;
  }>;
  reading_progress_id?: string | null;
  processing_state?: Record<string, unknown>;
  provenance_ids?: string[];
  history?: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
};

export type SourceFileRecord = {
  schema_version: string;
  source_id: string;
  paper_id: string;
  project_id: string;
  source_type: "local_file";
  media_type: "application/pdf";
  original_filename: string;
  relative_path: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  imported_at: string;
  updated_at: string;
};

export type SourceFileResponse = ApiEnvelope & {
  workspace_id: string;
  project_id: string;
  paper_id: string;
  source: SourceFileRecord;
  source_revision: string;
};

export type PaperPdfImportResponse = ApiEnvelope & {
  workspace_id: string;
  project_id: string;
  paper_id: string;
  source: SourceFileRecord;
  paper: PaperRecord;
  paper_revision: string;
  recovery_backup_id: string;
};

export type PaperTextExtractionSummary = {
  schema_version: string;
  extraction_id: string;
  project_id: string;
  paper_id: string;
  source_id: string;
  source_sha256: string;
  extraction_status: "completed" | "failed";
  status: "completed" | "stale";
  extraction_engine: string;
  extraction_engine_version: string;
  created_at: string;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
  page_count: number;
  pages_with_text: number;
  pages_without_text: number;
  character_count: number;
  word_count: number;
  warnings: string[];
  full_text_sha256: string;
  text_preview: string;
};

export type PaperTextExtractionResponse = ApiEnvelope & {
  workspace_id: string;
  project_id: string;
  paper_id: string;
  status: "not_run" | "completed" | "stale";
  extraction: PaperTextExtractionSummary | null;
};

export type NoteRecord = {
  schema_version: string;
  note_id: string;
  scope_type: "project" | "paper";
  project_id: string;
  paper_id?: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type ResearchProfileConcept = {
  term: string;
  weight?: number;
};

export type ResearchProfileProposalType =
  | "changed_concept_weights"
  | "new_search_terms"
  | "exclusions"
  | "preferred_methods"
  | "positive_semantic_examples"
  | "negative_semantic_examples"
  | "revised_screening_instructions";

export type ResearchProfileProposalStatus = "proposed" | "accepted" | "modified" | "rejected" | "reversed";
export type ResearchProfileProposalTarget = "concepts" | "search_queries" | "exclusions" | "preferred_evidence_types";
export type ResearchProfileProposalValue =
  | { values: string[] }
  | ResearchProfileConcept[];

export type ResearchProfileProposalHistoryEvent = {
  event: "created" | "accepted" | "modified" | "rejected" | "reversed" | "reversal_blocked";
  status?: ResearchProfileProposalStatus;
  occurred_at: string;
  value?: ResearchProfileProposalValue;
  revision?: string;
  note?: string;
};

export type ResearchProfileProposal = {
  proposal_id: string;
  type: ResearchProfileProposalType;
  explanation: string;
  status: ResearchProfileProposalStatus;
  reversible?: boolean;
  created_at: string;
  target_field?: ResearchProfileProposalTarget;
  current_value?: ResearchProfileProposalValue;
  proposed_value?: ResearchProfileProposalValue;
  modified_value?: ResearchProfileProposalValue;
  applied_value?: ResearchProfileProposalValue;
  decision_at?: string;
  applied_revision?: string;
  reversal_result?: "restored" | "blocked";
  reversed_at?: string;
  history?: ResearchProfileProposalHistoryEvent[];
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
  proposals?: ResearchProfileProposal[];
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

export async function listPapers(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  projectId: string
): Promise<DurableRecordListResponse<PaperRecord>> {
  const query = new URLSearchParams({ project_id: projectId });
  return request<DurableRecordListResponse<PaperRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/papers?${query.toString()}`,
    {},
    sessionToken
  );
}

export async function readPaper(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  paperId: string
): Promise<DurableRecordEnvelope<PaperRecord>> {
  return request<DurableRecordEnvelope<PaperRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/papers/${encodeURIComponent(paperId)}`,
    {},
    sessionToken
  );
}

export async function readPaperSource(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  projectId: string,
  paperId: string
): Promise<SourceFileResponse> {
  return request<SourceFileResponse>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/papers/${encodeURIComponent(paperId)}/source-file`,
    {},
    sessionToken
  );
}

export async function importPaperPdf(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  projectId: string,
  paperId: string,
  file: File,
  expectedRevision?: string,
  replace = false
): Promise<PaperPdfImportResponse> {
  const query = new URLSearchParams({ replace: String(replace) });
  if (expectedRevision) query.set("expected_revision", expectedRevision);
  return request<PaperPdfImportResponse>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/papers/${encodeURIComponent(paperId)}/source-file?${query.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-Original-Filename": file.name
      },
      body: file
    },
    sessionToken
  );
}

export async function readPaperExtraction(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  projectId: string,
  paperId: string
): Promise<PaperTextExtractionResponse> {
  return request<PaperTextExtractionResponse>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/papers/${encodeURIComponent(paperId)}/text-extraction`,
    {},
    sessionToken
  );
}

export async function extractPaperText(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  projectId: string,
  paperId: string,
  expectedRevision?: string,
  reextract = false
): Promise<PaperTextExtractionResponse> {
  const query = new URLSearchParams({ reextract: String(reextract) });
  if (expectedRevision) query.set("expected_revision", expectedRevision);
  return request<PaperTextExtractionResponse>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/papers/${encodeURIComponent(paperId)}/text-extraction?${query.toString()}`,
    { method: "POST" },
    sessionToken
  );
}

export async function writePaper(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  paper: PaperRecord,
  expectedRevision?: string
): Promise<DurableRecordEnvelope<PaperRecord>> {
  return request<DurableRecordEnvelope<PaperRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/papers/${encodeURIComponent(paper.paper_id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        record: paper,
        parent_id: paper.assigned_project_ids[0],
        ...(expectedRevision ? { expected_revision: expectedRevision } : {})
      })
    },
    sessionToken
  );
}

export async function listNotes(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  projectId: string,
  scopeType: NoteRecord["scope_type"],
  paperId?: string
): Promise<DurableRecordListResponse<NoteRecord>> {
  const query = new URLSearchParams({ project_id: projectId, scope_type: scopeType });
  if (paperId) query.set("paper_id", paperId);
  return request<DurableRecordListResponse<NoteRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/notes?${query.toString()}`,
    {},
    sessionToken
  );
}

export async function readNote(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  noteId: string
): Promise<DurableRecordEnvelope<NoteRecord>> {
  return request<DurableRecordEnvelope<NoteRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/notes/${encodeURIComponent(noteId)}`,
    {},
    sessionToken
  );
}

export async function writeNote(
  baseUrl: string,
  sessionToken: string,
  workspaceId: string,
  note: NoteRecord,
  expectedRevision?: string
): Promise<DurableRecordEnvelope<NoteRecord>> {
  return request<DurableRecordEnvelope<NoteRecord>>(
    `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/records/notes/${encodeURIComponent(note.note_id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        record: note,
        parent_id: note.scope_type === "project" ? note.project_id : note.paper_id,
        ...(expectedRevision ? { expected_revision: expectedRevision } : {})
      })
    },
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
