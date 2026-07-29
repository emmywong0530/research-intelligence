import { AlertTriangle, ArrowLeft, Edit3, FileText, Plus, RefreshCw, Save, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  CompanionRequestError,
  CompanionUnavailableError,
  extractPaperText,
  listDuplicateGroups,
  listPapers,
  importPaperPdf,
  readPaper,
  readPaperExtraction,
  readPaperSource,
  writeDuplicateReview,
  writePaper,
  type DurableRecordListResponse,
  type PaperRecord,
  type ProjectRecord,
  type SourceFileRecord,
  type PaperTextExtractionSummary,
  type DuplicateGroup
} from "./companionClient";
import { Button, Card, EmptyState, Modal, PageHeader, SectionHeading, StatusPill } from "./components";
import type { PageId } from "./types";

type ConnectionState = "checking" | "online" | "offline";
type WorkspaceState = "idle" | "working" | "connected" | "error";
type LoadState = "idle" | "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";
type SourceState = "idle" | "loading" | "selected" | "uploading" | "completed" | "error";
type ExtractionState = "idle" | "loading" | "not_run" | "extracting" | "completed" | "stale" | "failed";
type DuplicateState = "idle" | "loading" | "ready" | "error";
type PaperListRecord = DurableRecordListResponse<PaperRecord>["records"][number];

type PaperDraft = {
  title: string;
  authors: string;
  year: string;
  publication_venue: string;
  doi: string;
  abstract: string;
  publication_status: string;
  research_type: string;
  methodological_subtype: string;
  evidence_structure: string;
  source_version_type: string;
};

type PendingEditorAction = "papers" | "project" | { paperId: string } | { notesForPaperId: string };

function duplicateLabel(group: DuplicateGroup): string {
  if (group.evidence_type === "exact_source") return "Exact PDF duplicate";
  if (group.evidence_type === "exact_identifier") return "Matching identifier";
  return "Possible metadata duplicate";
}

function duplicateTone(group: DuplicateGroup): "danger" | "warning" | "muted" {
  return group.evidence_type === "exact_source" ? "danger" : group.evidence_type === "exact_identifier" ? "warning" : "muted";
}

function duplicateReviewLabel(group: DuplicateGroup): string {
  if (group.review_status === "reviewed_duplicate") return "Reviewed as duplicate";
  if (group.review_status === "reviewed_not_duplicate") return "Reviewed as separate";
  if (group.review_status === "ignored") return "Ignored";
  return "Unreviewed";
}

function PaperDuplicateIndicators({ groups }: { groups: DuplicateGroup[] }) {
  if (!groups.length) return null;
  return <div className="paper-record-duplicates" data-testid="paper-duplicate-indicators">{groups.slice(0, 3).map((group) => <StatusPill tone={duplicateTone(group)} key={group.group_fingerprint}>{duplicateLabel(group)}</StatusPill>)}{groups.length > 3 ? <span className="label">+{groups.length - 3} more</span> : null}</div>;
}

export type PapersPageProps = {
  project: ProjectRecord | null;
  companionUrl: string;
  sessionToken: string;
  workspaceId: string | null;
  workspaceState: WorkspaceState;
  connectionState: ConnectionState;
  createRequested?: boolean;
  onCreateRequestHandled?: () => void;
  onNavigate: (page: PageId) => void;
  onDirtyChange: (dirty: boolean) => void;
  onOpenNotes?: (paper: PaperRecord) => void;
};

const EMPTY_DRAFT: PaperDraft = {
  title: "",
  authors: "",
  year: "",
  publication_venue: "",
  doi: "",
  abstract: "",
  publication_status: "",
  research_type: "",
  methodological_subtype: "",
  evidence_structure: "",
  source_version_type: ""
};

function stablePaperId(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure paper ID generation is unavailable in this browser.");
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `paper_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function now(): string {
  return new Date().toISOString();
}

function draftFromRecord(record: PaperRecord): PaperDraft {
  return {
    title: record.title,
    authors: record.authors.join("\n"),
    year: record.year === undefined ? "" : String(record.year),
    publication_venue: record.publication_venue ?? "",
    doi: record.doi ?? "",
    abstract: record.abstract ?? "",
    publication_status: record.publication_status ?? "",
    research_type: record.research_type ?? "",
    methodological_subtype: record.methodological_subtype ?? "",
    evidence_structure: record.evidence_structure ?? "",
    source_version_type: record.source_version_type ?? ""
  };
}

function sameDraft(left: PaperDraft | null, right: PaperDraft | null): boolean {
  return Boolean(left && right && JSON.stringify(left) === JSON.stringify(right));
}

function optionalFields(draft: PaperDraft): Partial<PaperRecord> {
  const fields: Partial<PaperRecord> = {};
  if (draft.year.trim()) fields.year = Number(draft.year.trim());
  for (const field of ["publication_venue", "abstract", "publication_status", "research_type", "methodological_subtype", "evidence_structure", "source_version_type"] as const) {
    if (draft[field].trim()) fields[field] = draft[field].trim();
  }
  fields.doi = draft.doi.trim() || null;
  return fields;
}

function recordFromDraft(draft: PaperDraft, projectId: string, existing?: PaperRecord): PaperRecord {
  const timestamp = now();
  const authors = draft.authors.split("\n").map((author) => author.trim());
  const paperId = existing?.paper_id ?? stablePaperId();
  return {
    ...(existing ?? {}),
    schema_version: existing?.schema_version ?? "m2.v1",
    paper_id: paperId,
    title: draft.title.trim(),
    authors,
    assigned_project_ids: [projectId],
    pdf_access_status: existing?.pdf_access_status ?? "unavailable",
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
    ...optionalFields(draft),
    ...(existing?.external_identifiers ? { external_identifiers: existing.external_identifiers } : {}),
    ...(existing?.project_relevance_records ? { project_relevance_records: existing.project_relevance_records } : {}),
    ...(existing?.provenance_ids ? { provenance_ids: existing.provenance_ids } : {})
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof CompanionUnavailableError) return "The local companion is unavailable. Check the connection and try again.";
  if (error instanceof CompanionRequestError) {
    if (error.status === 401) return "The companion session expired. Pair this browser again.";
    if (error.status === 404) return "The workspace, project or paper is no longer available.";
    if (error.status === 409) return "This paper changed elsewhere. Load the latest version before saving again.";
    if (error.status === 400) return `Paper metadata validation failed: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : "The paper record could not be saved.";
}

function compactAuthors(authors: string[]): string {
  return authors.length > 2 ? `${authors.slice(0, 2).join(", ")} +${authors.length - 2}` : authors.join(", ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PaperExtractionSection({
  source,
  extraction,
  extractionState,
  extractionError,
  onExtract
}: {
  source: SourceFileRecord | null;
  extraction: PaperTextExtractionSummary | null;
  extractionState: ExtractionState;
  extractionError: string;
  onExtract: () => void;
}) {
  return <section className="paper-extraction-section" data-testid="paper-extraction-section" aria-labelledby="paper-extraction-heading">
    <div className="section-heading"><h3 id="paper-extraction-heading">Text extraction</h3><StatusPill tone={extractionState === "completed" ? "accent" : extractionState === "stale" ? "warning" : "muted"}>{extractionState === "completed" ? "Extracted locally" : extractionState === "stale" ? "Stale" : "Not extracted"}</StatusPill></div>
    <p className="muted-copy">Runs locally and deterministically with pypdf. OCR is not included.</p>
    {!source ? <><p className="muted-copy" data-testid="paper-extraction-disabled">Import a local PDF before extracting text.</p><Button variant="secondary" disabled icon={<FileText size={15} />}>Extract text</Button></> : null}
    {source && extractionState === "loading" ? <p className="workspace-status" role="status">Checking extraction status…</p> : null}
    {source && extractionState === "not_run" ? <div><p className="muted-copy" data-testid="paper-extraction-not-run">PDF stored; text not extracted.</p><Button variant="primary" onClick={onExtract} icon={<FileText size={15} />}>Extract text</Button></div> : null}
    {source && extractionState === "extracting" ? <p className="workspace-status" data-testid="paper-extraction-processing" role="status">Extracting text locally…</p> : null}
    {source && extractionState === "failed" ? <div><p className="error-message" data-testid="paper-extraction-error" role="alert">{extractionError || "Text extraction failed."}</p><Button variant="secondary" onClick={onExtract} icon={<RefreshCw size={15} />}>Retry text extraction</Button></div> : null}
    {source && extraction && (extractionState === "completed" || extractionState === "stale") ? <div className="paper-extraction-result">
      <p className={extractionState === "stale" ? "error-message" : "success-message"} data-testid="paper-extraction-status" role="status">{extractionState === "stale" ? "Text extraction is stale because the PDF was replaced." : extraction.pages_with_text === 0 ? "No machine-readable text found." : "Text extracted locally."}</p>
      <div className="paper-extraction-stats"><span data-testid="paper-extraction-page-count">Pages {extraction.page_count}</span><span data-testid="paper-extraction-pages-with-text">Pages with text {extraction.pages_with_text}</span><span data-testid="paper-extraction-pages-without-text">Pages without text {extraction.pages_without_text}</span><span data-testid="paper-extraction-word-count">Words {extraction.word_count}</span><span data-testid="paper-extraction-character-count">Characters {extraction.character_count}</span></div>
      <p className="muted-copy" data-testid="paper-extraction-engine">Engine {extraction.extraction_engine} {extraction.extraction_engine_version} · Completed {new Date(extraction.completed_at ?? extraction.updated_at).toLocaleString()}</p>
      <p className="muted-copy" data-testid="paper-extraction-source-sha256">Source SHA-256 {extraction.source_sha256}</p>
      {extraction.pages_with_text === 0 ? <p className="warning-text">This PDF may be scanned or image-based; OCR has not been run.</p> : null}
      {extraction.warnings.length ? <ul className="paper-extraction-warnings">{extraction.warnings.slice(0, 3).map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      {extraction.text_preview ? <pre className="paper-extraction-preview" data-testid="paper-extraction-preview">{extraction.text_preview}</pre> : null}
      <Button variant="secondary" onClick={onExtract} icon={<RefreshCw size={15} />}>Re-extract text</Button>
    </div> : null}
  </section>;
}

function PaperDuplicateSection({
  paperId,
  groups,
  state,
  error,
  onOpenPaper,
  onReview
}: {
  paperId: string;
  groups: DuplicateGroup[];
  state: DuplicateState;
  error: string;
  onOpenPaper: (paperId: string) => void;
  onReview: (group: DuplicateGroup, status: "reviewed_duplicate" | "reviewed_not_duplicate" | "ignored") => void;
}) {
  return <section className="paper-duplicate-section" data-testid="paper-duplicate-check" aria-labelledby="paper-duplicate-heading">
    <div className="section-heading"><h3 id="paper-duplicate-heading">Duplicate check</h3><StatusPill tone={groups.length ? "warning" : "muted"}>{groups.length ? `${groups.length} group${groups.length === 1 ? "" : "s"}` : "No evidence"}</StatusPill></div>
    <p className="muted-copy">Deterministic local checking only. This does not establish global scholarly uniqueness.</p>
    {state === "loading" ? <p className="workspace-status" role="status">Checking duplicate evidence…</p> : null}
    {state === "error" ? <p className="error-message" role="alert">{error}</p> : null}
    {state === "ready" && groups.length === 0 ? <p className="muted-copy" data-testid="paper-no-duplicate-evidence">No duplicate evidence found in this workspace.</p> : null}
    {state === "ready" && groups.length ? <div className="paper-duplicate-list">{groups.map((group) => <article className="paper-duplicate-group" data-testid={`duplicate-group-${group.evidence_type}`} key={group.group_fingerprint}>
      <div className="card-heading"><div><StatusPill tone={duplicateTone(group)}>{duplicateLabel(group)}</StatusPill><p className="muted-copy">{group.details.explanation}</p></div><StatusPill tone="muted">{duplicateReviewLabel(group)}</StatusPill></div>
      <div className="paper-duplicate-evidence">{group.evidence_type === "exact_source" ? <><span>Imported filenames: {group.details.source_filenames?.join(", ")}</span><span>PDF bytes match: {group.details.source_sha256_preview}</span></> : null}{group.evidence_type === "exact_identifier" ? <span>{group.details.identifier_type}: {group.details.normalized_identifier}</span> : null}{group.evidence_type === "metadata_candidate" ? <span>Matched fields: {group.details.matched_fields?.join(", ")}</span> : null}</div>
      <ul className="paper-duplicate-paper-list">{group.papers.filter((paper) => paper.paper_id !== paperId).map((paper) => <li key={paper.paper_id}><div><strong>{paper.title}</strong><span>{paper.project_name} · {paper.authors.slice(0, 2).join(", ")}{paper.year ? ` · ${paper.year}` : ""}</span></div>{paper.project_id === group.papers.find((item) => item.paper_id === paperId)?.project_id ? <Button variant="ghost" onClick={() => onOpenPaper(paper.paper_id)} icon={<ArrowLeft size={14} />}>Open paper</Button> : null}</li>)}</ul>
      <div className="inline-actions paper-duplicate-actions">{group.evidence_type === "exact_source" ? <Button variant="secondary" onClick={() => onReview(group, "reviewed_duplicate")}>{group.review_status === "reviewed_duplicate" ? "Keep acknowledged" : "Acknowledge exact evidence"}</Button> : <><Button variant="secondary" onClick={() => onReview(group, "reviewed_duplicate")}>Mark reviewed duplicate</Button><Button variant="ghost" onClick={() => onReview(group, "reviewed_not_duplicate")}>Mark as separate</Button></>}{group.review_status !== "ignored" ? <Button variant="ghost" onClick={() => onReview(group, "ignored")}>Ignore warning</Button> : null}</div>
    </article>)}</div> : null}
  </section>;
}

export function PapersPage({
  project,
  companionUrl,
  sessionToken,
  workspaceId,
  workspaceState,
  connectionState,
  createRequested = false,
  onCreateRequestHandled,
  onNavigate,
  onDirtyChange,
  onOpenNotes
}: PapersPageProps) {
  const connected = Boolean(workspaceId && sessionToken && workspaceState === "connected" && connectionState === "online");
  const [records, setRecords] = useState<PaperListRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<PaperListRecord | null>(null);
  const [draft, setDraft] = useState<PaperDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<PaperDraft | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<string | undefined>();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingEditorAction | null>(null);
  const [conflictPaper, setConflictPaper] = useState<PaperRecord | null>(null);
  const [source, setSource] = useState<SourceFileRecord | null>(null);
  const [sourceState, setSourceState] = useState<SourceState>("idle");
  const [sourceError, setSourceError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [replacePending, setReplacePending] = useState(false);
  const [extraction, setExtraction] = useState<PaperTextExtractionSummary | null>(null);
  const [extractionState, setExtractionState] = useState<ExtractionState>("idle");
  const [extractionError, setExtractionError] = useState("");
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateState, setDuplicateState] = useState<DuplicateState>("idle");
  const [duplicateError, setDuplicateError] = useState("");
  const duplicateRequest = useRef(0);

  const dirty = Boolean((draft && !sameDraft(draft, savedDraft)) || selectedFile || sourceState === "uploading");
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function loadDuplicates() {
    if (!connected || !workspaceId || !project) return;
    const requestId = duplicateRequest.current + 1;
    duplicateRequest.current = requestId;
    setDuplicateState("loading");
    setDuplicateError("");
    try {
      const response = await listDuplicateGroups(companionUrl, sessionToken, workspaceId, project.project_id);
      if (response.workspace_id !== workspaceId || response.groups.some((group) => !group.papers.some((paper) => paper.project_id === project.project_id))) {
        throw new Error("The companion returned duplicate evidence from another workspace or without the active project.");
      }
      if (requestId !== duplicateRequest.current) return;
      setDuplicateGroups(response.groups);
      setDuplicateState("ready");
    } catch (error) {
      if (requestId !== duplicateRequest.current) return;
      setDuplicateGroups([]);
      setDuplicateState("error");
      setDuplicateError(errorMessage(error));
    }
  }

  async function loadList() {
    if (!connected || !workspaceId || !project) return;
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await listPapers(companionUrl, sessionToken, workspaceId, project.project_id);
      if (response.workspace_id !== workspaceId || response.records.some(({ record }) => record.assigned_project_ids.length !== 1 || record.assigned_project_ids[0] !== project.project_id)) {
        throw new Error("The companion returned a paper from another project.");
      }
      setRecords(response.records);
      setLoadState("ready");
      await loadDuplicates();
    } catch (error) {
      setLoadState("error");
      setLoadError(errorMessage(error));
    }
  }

  useEffect(() => { void loadList(); }, [companionUrl, connected, project, sessionToken, workspaceId]);

  function beginCreate() {
    setSelected(null);
    setSelectedRevision(undefined);
    setDraft({ ...EMPTY_DRAFT });
    setSavedDraft({ ...EMPTY_DRAFT });
    setSaveState("idle");
    setSaveMessage("");
    setConflictPaper(null);
    setSource(null);
    setSourceState("idle");
    setSourceError("");
    setSelectedFile(null);
    setExtraction(null);
    setExtractionState("idle");
    setExtractionError("");
  }

  useEffect(() => {
    if (createRequested && loadState === "ready" && !draft) {
      beginCreate();
      onCreateRequestHandled?.();
    }
  }, [createRequested, draft, loadState, onCreateRequestHandled]);

  function extractionErrorMessage(error: unknown): string {
    if (error instanceof CompanionUnavailableError) return "The local companion is unavailable. Check the connection and try again.";
    if (error instanceof CompanionRequestError) {
      if (error.status === 401) return "The companion session expired. Pair this browser again.";
      if (error.status === 404) return "The registered PDF or paper is no longer available.";
      if (error.status === 409) return "The paper or PDF changed during extraction. Reload the paper before trying again.";
      if (error.status === 413) return "This PDF exceeds the local extraction limits.";
      return `Text extraction failed: ${error.message}`;
    }
    return error instanceof Error ? `Text extraction failed: ${error.message}` : "Text extraction failed.";
  }

  async function loadExtraction(paperId: string) {
    if (!workspaceId || !project) return;
    setExtractionState("loading");
    setExtractionError("");
    try {
      const response = await readPaperExtraction(companionUrl, sessionToken, workspaceId, project.project_id, paperId);
      if (response.workspace_id !== workspaceId || response.project_id !== project.project_id || response.paper_id !== paperId) {
        throw new Error("The companion returned extraction data from another workspace, project or paper.");
      }
      setExtraction(response.extraction);
      setExtractionState(response.status);
    } catch (error) {
      setExtraction(null);
      setExtractionState("failed");
      setExtractionError(extractionErrorMessage(error));
    }
  }

  async function openPaper(paperId: string) {
    if (!workspaceId || !project) return;
    setSaveMessage("");
    try {
      const response = await readPaper(companionUrl, sessionToken, workspaceId, paperId);
      if (response.workspace_id !== workspaceId || response.record.assigned_project_ids[0] !== project.project_id || response.record.assigned_project_ids.length !== 1) {
        throw new Error("This paper is not associated with the active project.");
      }
      const nextDraft = draftFromRecord(response.record);
      setSelected({ record_id: response.record_id, record: response.record, revision: response.revision, relative_path: response.relative_path });
      setSelectedRevision(response.revision);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setSaveState("idle");
      setConflictPaper(null);
      setSelectedFile(null);
      setSourceError("");
      setSourceState("loading");
      setExtraction(null);
      setExtractionState("idle");
      setExtractionError("");
      try {
        const sourceResponse = await readPaperSource(companionUrl, sessionToken, workspaceId, project.project_id, paperId);
        if (sourceResponse.workspace_id !== workspaceId || sourceResponse.project_id !== project.project_id || sourceResponse.paper_id !== paperId) {
          throw new Error("The companion returned a source from another workspace or paper.");
        }
        setSource(sourceResponse.source);
        setSourceState("completed");
        await loadExtraction(paperId);
      } catch (sourceLoadError) {
        if (sourceLoadError instanceof CompanionRequestError && sourceLoadError.status === 404) {
          setSource(null);
          setSourceState("idle");
          setExtraction(null);
          setExtractionState("idle");
        } else {
          setSource(null);
          setSourceState("error");
          setSourceError(errorMessage(sourceLoadError));
          setExtraction(null);
          setExtractionState("failed");
          setExtractionError(extractionErrorMessage(sourceLoadError));
        }
      }
      await loadDuplicates();
    } catch (error) {
      setSaveState("error");
      setSaveMessage(errorMessage(error));
    }
  }

  function requestEditorAction(action: PendingEditorAction) {
    if (dirty) {
      setPendingAction(action);
      return;
    }
    if (action === "papers") {
      setSelected(null); setDraft(null); setSavedDraft(null); setConflictPaper(null);
    } else if (typeof action === "object" && "notesForPaperId" in action) {
      const item = records.find((entry) => entry.record_id === action.notesForPaperId);
      if (item) onOpenNotes?.(item.record);
    } else if (typeof action === "object") {
      void openPaper(action.paperId);
    } else {
      onNavigate(action);
    }
  }

  function discardAndContinue() {
    const action = pendingAction;
    setPendingAction(null);
    setSelected(null); setDraft(null); setSavedDraft(null); setConflictPaper(null); setSaveState("idle"); setSource(null); setSourceState("idle"); setSourceError(""); setSelectedFile(null); setExtraction(null); setExtractionState("idle"); setExtractionError("");
    if (action === "papers") return;
    if (action && typeof action === "object" && "notesForPaperId" in action) {
      const item = records.find((entry) => entry.record_id === action.notesForPaperId);
      if (item) onOpenNotes?.(item.record);
    } else if (action && typeof action === "object") void openPaper(action.paperId);
    else if (action) onNavigate(action);
  }

  function validateDraft(): string | null {
    if (!draft?.title.trim()) return "Title is required.";
    const authors = draft.authors.split("\n").map((author) => author.trim());
    if (!authors.length || authors.some((author) => !author)) return "Enter at least one author on each non-empty line.";
    if (draft.year.trim() && (!Number.isInteger(Number(draft.year.trim())) || Number(draft.year.trim()) < 0)) return "Publication year must be a non-negative whole number.";
    return null;
  }

  async function save() {
    if (!draft || !project || !workspaceId) return;
    const validationError = validateDraft();
    if (validationError) { setSaveState("error"); setSaveMessage(validationError); return; }
    setSaveState("saving"); setSaveMessage("");
    const record = recordFromDraft(draft, project.project_id, selected?.record);
    try {
      const response = await writePaper(companionUrl, sessionToken, workspaceId, record, selected ? selectedRevision : undefined);
      const item = { record_id: response.record_id, record: response.record, revision: response.revision, relative_path: response.relative_path };
      setRecords((current) => current.some((entry) => entry.record_id === item.record_id) ? current.map((entry) => entry.record_id === item.record_id ? item : entry) : [...current, item].sort((left, right) => left.record.title.localeCompare(right.record.title)));
      setSelected(item);
      setSelectedRevision(response.revision);
      const nextDraft = draftFromRecord(response.record);
      setDraft(nextDraft); setSavedDraft(nextDraft); setSaveState("saved"); setSaveMessage("Paper metadata saved locally."); setConflictPaper(null);
      await loadDuplicates();
    } catch (error) {
      if (error instanceof CompanionRequestError && error.status === 409 && selected) {
        setConflictPaper(selected.record);
      }
      setSaveState("error"); setSaveMessage(errorMessage(error));
    }
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setSourceError("");
    if (!file) return;
    setSelectedFile(file);
    setSourceState("selected");
  }

  function cancelFileSelection() {
    setSelectedFile(null);
    setSourceState(source ? "completed" : "idle");
    setSourceError("");
  }

  async function importSelectedFile(replace: boolean) {
    if (!selected || !project || !workspaceId || !selectedFile) return;
    setReplacePending(false);
    setSourceState("uploading");
    setSourceError("");
    try {
      const response = await importPaperPdf(
        companionUrl,
        sessionToken,
        workspaceId,
        project.project_id,
        selected.record_id,
        selectedFile,
        selectedRevision,
        replace
      );
      const item = {
        record_id: selected.record_id,
        record: response.paper,
        revision: response.paper_revision,
        relative_path: selected.relative_path
      };
      setSelected(item);
      setSelectedRevision(response.paper_revision);
      const nextDraft = draftFromRecord(response.paper);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setSource(response.source);
      setSelectedFile(null);
      setSourceState("completed");
      setSourceError("");
      await loadExtraction(selected.record_id);
      setRecords((current) => current.map((entry) => entry.record_id === item.record_id ? item : entry));
      await loadDuplicates();
    } catch (error) {
      setSourceState("error");
      setSourceError(errorMessage(error));
    }
  }

  function requestPdfImport() {
    if (!selectedFile) return;
    if (source) {
      setReplacePending(true);
      return;
    }
    void importSelectedFile(false);
  }

  async function requestExtraction() {
    if (!selected || !project || !workspaceId || !source || extractionState === "extracting") return;
    setExtractionState("extracting");
    setExtractionError("");
    try {
      const response = await extractPaperText(
        companionUrl,
        sessionToken,
        workspaceId,
        project.project_id,
        selected.record_id,
        selectedRevision,
        Boolean(extraction)
      );
      if (response.workspace_id !== workspaceId || response.project_id !== project.project_id || response.paper_id !== selected.record_id) {
        throw new Error("The companion returned extraction data from another workspace, project or paper.");
      }
      setExtraction(response.extraction);
      setExtractionState(response.status);
    } catch (error) {
      setExtractionState("failed");
      setExtractionError(extractionErrorMessage(error));
    }
  }

  async function reviewDuplicate(group: DuplicateGroup, status: "reviewed_duplicate" | "reviewed_not_duplicate" | "ignored") {
    if (!workspaceId) return;
    try {
      await writeDuplicateReview(companionUrl, sessionToken, workspaceId, group.group_fingerprint, status, group.review_revision);
      await loadDuplicates();
    } catch (error) {
      setDuplicateState("error");
      setDuplicateError(errorMessage(error));
    }
  }

  async function loadLatestAfterConflict() {
    if (!selected || !workspaceId) return;
    try {
      const response = await readPaper(companionUrl, sessionToken, workspaceId, selected.record_id);
      setConflictPaper(response.record);
      setSelected({ ...selected, record: response.record, revision: response.revision });
      setSelectedRevision(response.revision);
      setSaveMessage("Latest paper version loaded for comparison. Your unsaved edits remain visible.");
    } catch (error) { setSaveMessage(errorMessage(error)); }
  }

  const pageTitle = project ? `${project.name} papers` : "Project papers";
  const editing = Boolean(draft);
  const selectedDuplicateGroups = selected
    ? duplicateGroups.filter((group) => group.papers.some((paper) => paper.paper_id === selected.record_id))
    : [];
  const input = (field: keyof PaperDraft, label: string, options: { multiline?: boolean; required?: boolean; hint?: string } = {}) => (
    <label className="paper-form-field" htmlFor={`paper-${field}`}>
      <span>{label}{options.required ? " *" : ""}</span>
      {options.hint ? <small className="muted-copy">{options.hint}</small> : null}
      {options.multiline ? <textarea id={`paper-${field}`} rows={field === "abstract" ? 6 : 5} value={draft?.[field] ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, [field]: event.target.value } : current)} /> : <input id={`paper-${field}`} value={draft?.[field] ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, [field]: event.target.value } : current)} />}
    </label>
  );

  if (!connected) return <div className="page"><PageHeader eyebrow="Project Papers" title="Papers unavailable" description="A paired companion, healthy workspace and explicitly opened project are required." action={<Button variant="secondary" onClick={() => onNavigate("project")} icon={<ArrowLeft size={16} />}>Back to Project Overview</Button>} /><Card className="overview-state-card"><StatusPill tone={connectionState === "offline" ? "danger" : "warning"}>{connectionState === "offline" ? "Companion unavailable" : workspaceId ? "Workspace unavailable" : "No workspace or project"}</StatusPill><p className="muted-copy">Pair the browser and open a healthy workspace before accessing project paper metadata.</p></Card></div>;
  if (!project) return <div className="page"><PageHeader eyebrow="Project Papers" title="Project required" action={<Button variant="primary" onClick={() => onNavigate("projects")} icon={<ArrowLeft size={16} />}>Open Projects</Button>} /><Card className="overview-state-card"><EmptyState title="No active project" description="Select a persisted project explicitly before viewing its papers." /></Card></div>;
  if (loadState === "loading" || loadState === "idle") return <div className="page"><PageHeader eyebrow="Project Papers" title={pageTitle} description="Loading persisted paper metadata." /><p className="workspace-status" role="status">Loading paper records…</p></div>;
  if (loadState === "error") return <div className="page"><PageHeader eyebrow="Project Papers" title={pageTitle} action={<Button variant="secondary" onClick={() => void loadList()} icon={<RefreshCw size={15} />}>Retry</Button>} /><div className="project-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{loadError}</span></div></div>;

  return <div className="page project-papers" data-testid="project-papers">
    <PageHeader eyebrow="Project Papers" title={pageTitle} description="Metadata records and explicitly imported local PDFs for this project. Text extraction is explicit and local." action={<div className="profile-header-actions"><Button variant="secondary" onClick={() => requestEditorAction("project")} icon={<ArrowLeft size={16} />}>Back to Project Overview</Button><Button variant="primary" onClick={beginCreate} icon={<Plus size={16} />}>Add paper record</Button></div>} />
    {!editing ? <>
      <Card className="paper-list-card"><SectionHeading title="Paper records" action={<StatusPill tone="muted">{records.length} metadata record{records.length === 1 ? "" : "s"}</StatusPill>} />
        {duplicateState === "error" ? <p className="warning-text" role="status">Duplicate checking is unavailable; paper records are still shown.</p> : null}
        {records.length ? <div className="paper-record-list" role="list">{records.map((item) => <div className="paper-record-row" role="listitem" data-testid={`paper-record-row-${item.record_id}`} key={item.record_id}><div className="paper-record-copy"><strong>{item.record.title}</strong><span>{compactAuthors(item.record.authors)}{item.record.year !== undefined ? ` · ${item.record.year}` : ""}{item.record.publication_venue ? ` · ${item.record.publication_venue}` : ""}</span><span className="paper-record-meta"><StatusPill tone="muted">{item.record.pdf_access_status === "pdf_ready" ? "PDF stored" : "Metadata only"}</StatusPill>Updated {new Date(item.record.updated_at).toLocaleString()}</span><PaperDuplicateIndicators groups={duplicateGroups.filter((group) => group.papers.some((paper) => paper.paper_id === item.record_id))} /></div><Button variant="secondary" onClick={() => requestEditorAction({ paperId: item.record_id })} icon={<Edit3 size={15} />}>Open paper</Button></div>)}</div> : <EmptyState title="No paper records yet." description="Add a metadata-only paper record to this project. No PDF is copied or downloaded." />}
      </Card>
    </> : <Card className="paper-editor-card"><div className="card-heading"><div><p className="eyebrow">{selected ? "Edit paper record" : "New paper record"}</p><h2>{selected ? selected.record.title : "Paper metadata"}</h2></div><StatusPill tone="muted">{selected?.record.pdf_access_status === "pdf_ready" ? "PDF stored" : "Metadata only"}</StatusPill></div><p className="muted-copy">This record stores manually supplied metadata. Save the paper record before selecting a local PDF.</p>{selected ? <section className="paper-source-section" data-testid="paper-source-section" aria-labelledby="paper-source-heading"><div className="section-heading"><h3 id="paper-source-heading">Local PDF source</h3><StatusPill tone={source ? "accent" : "muted"}>{source ? "PDF stored" : "No PDF imported"}</StatusPill></div><p className="muted-copy">The companion stores the selected PDF inside this workspace. Text extraction is a separate explicit local action.</p>{sourceState === "loading" ? <p className="workspace-status" role="status">Checking for a local PDF…</p> : null}{sourceState === "error" ? <p className="error-message" role="alert">{sourceError}</p> : null}{source ? <div className="paper-source-metadata" data-testid="paper-source-status"><strong>{source.original_filename}</strong><span>{formatBytes(source.size_bytes)} · {extractionState === "completed" ? "PDF stored; text extracted locally" : extractionState === "stale" ? "PDF stored; extracted text is stale" : "PDF stored; text not extracted"}</span><span>SHA-256 {source.sha256}</span><span>Imported {new Date(source.imported_at).toLocaleString()}</span></div> : sourceState !== "loading" ? <p className="muted-copy" data-testid="paper-source-empty">No local PDF has been imported for this paper.</p> : null}<div className="paper-source-actions"><label className="button button-secondary" htmlFor="paper-source-file-input">Select PDF file</label><input id="paper-source-file-input" data-testid="paper-source-file-input" className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={handleFileSelection} />{selectedFile ? <span className="paper-source-selected" data-testid="paper-source-preview">Selected: {selectedFile.name} ({formatBytes(selectedFile.size)})</span> : null}</div>{selectedFile ? <div className="inline-actions"><Button variant="secondary" onClick={cancelFileSelection} icon={<X size={15} />}>Cancel selection</Button><Button variant="primary" onClick={requestPdfImport} disabled={sourceState === "uploading"} icon={<Save size={15} />}>{sourceState === "uploading" ? "Importing PDF…" : source ? "Replace PDF" : "Import PDF"}</Button></div> : null}{sourceError && sourceState !== "error" ? <p className="success-message" role="status">{sourceError}</p> : null}</section> : null}<PaperExtractionSection source={source} extraction={extraction} extractionState={extractionState} extractionError={extractionError} onExtract={() => void requestExtraction()} />{selected ? <PaperDuplicateSection paperId={selected.record_id} groups={selectedDuplicateGroups} state={duplicateState} error={duplicateError} onOpenPaper={(paperId) => requestEditorAction({ paperId })} onReview={(group, status) => void reviewDuplicate(group, status)} /> : null}<div className="paper-form-grid">{input("title", "Title", { required: true })}{input("authors", "Authors", { required: true, multiline: true, hint: "One author per line." })}{input("year", "Publication year")}{input("publication_venue", "Venue or journal")}{input("doi", "DOI")}{input("abstract", "Abstract", { multiline: true })}{input("publication_status", "Publication status")}{input("research_type", "Research type")}{input("methodological_subtype", "Methodological subtype")}{input("evidence_structure", "Evidence structure")}{input("source_version_type", "Source version type")}</div>{saveMessage ? <p data-testid="paper-save-status" className={saveState === "saved" ? "success-message" : "error-message"} role={saveState === "saved" ? "status" : "alert"}>{saveMessage}</p> : null}{conflictPaper ? <div className="project-conflict" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><strong>This paper changed while you were editing.</strong><p>The latest durable version is shown below. Your local edits remain in the form; choose explicitly before saving again.</p><div className="paper-conflict-values"><div><span className="label">Latest title</span><p>{conflictPaper.title}</p><span className="label">Latest authors</span><p>{compactAuthors(conflictPaper.authors)}</p></div><div><span className="label">Your title</span><p>{draft?.title}</p><span className="label">Your authors</span><p>{draft ? compactAuthors(draft.authors.split("\n").map((author) => author.trim()).filter(Boolean)) : ""}</p></div></div><div className="inline-actions"><Button variant="secondary" onClick={() => void loadLatestAfterConflict()} icon={<RefreshCw size={15} />}>Reload latest</Button><Button variant="ghost" onClick={() => setConflictPaper(null)}>Keep my edits</Button></div></div></div> : null}<div className="inline-actions paper-editor-actions"><Button variant="secondary" onClick={() => requestEditorAction("papers")} icon={<X size={15} />}>Back to Papers</Button><Button variant="primary" onClick={() => void save()} disabled={saveState === "saving"} icon={<Save size={15} />}>{saveState === "saving" ? "Saving…" : selected ? "Save paper" : "Create paper record"}</Button></div>{selected ? <div className="paper-detail-meta"><span>Project association: {project.name}</span><span>Created {new Date(selected.record.created_at).toLocaleString()}</span><span>Updated {new Date(selected.record.updated_at).toLocaleString()}</span></div> : null}</Card>}
    {selected ? <div className="inline-actions paper-notes-action"><Button variant="secondary" onClick={() => requestEditorAction({ notesForPaperId: selected.record_id })} icon={<FileText size={15} />}>Paper notes</Button></div> : null}
    <Modal open={Boolean(pendingAction)} eyebrow="Unsaved paper edits" title="Leave paper editor?" onClose={() => setPendingAction(null)}><p className="modal-description">Your paper metadata changes have not been saved. Keep editing, or discard them and continue.</p><div className="modal-actions"><Button variant="secondary" onClick={() => setPendingAction(null)}>Keep editing</Button><Button variant="primary" onClick={discardAndContinue}>Discard changes</Button></div></Modal>
    <Modal open={replacePending} eyebrow="Replace local PDF" title="Replace the stored PDF?" onClose={() => setReplacePending(false)}><p className="modal-description">The existing local PDF will be replaced only after the new file is validated. The prior valid file is retained in a recovery backup.</p><div className="modal-actions"><Button variant="secondary" onClick={() => setReplacePending(false)}>Keep existing PDF</Button><Button variant="primary" onClick={() => void importSelectedFile(true)}>Replace PDF</Button></div></Modal>
  </div>;
}
