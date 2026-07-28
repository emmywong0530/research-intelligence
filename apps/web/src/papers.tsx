import { AlertTriangle, ArrowLeft, Edit3, Plus, RefreshCw, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CompanionRequestError,
  CompanionUnavailableError,
  listPapers,
  readPaper,
  writePaper,
  type DurableRecordListResponse,
  type PaperRecord,
  type ProjectRecord
} from "./companionClient";
import { Button, Card, EmptyState, Modal, PageHeader, SectionHeading, StatusPill } from "./components";
import type { PageId } from "./types";

type ConnectionState = "checking" | "online" | "offline";
type WorkspaceState = "idle" | "working" | "connected" | "error";
type LoadState = "idle" | "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";
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

type PendingEditorAction = "papers" | "project" | { paperId: string };

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
  onDirtyChange
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

  const dirty = Boolean(draft && !sameDraft(draft, savedDraft));
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

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
  }

  useEffect(() => {
    if (createRequested && loadState === "ready" && !draft) {
      beginCreate();
      onCreateRequestHandled?.();
    }
  }, [createRequested, draft, loadState, onCreateRequestHandled]);

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
    } else if (typeof action === "object") {
      void openPaper(action.paperId);
    } else {
      onNavigate(action);
    }
  }

  function discardAndContinue() {
    const action = pendingAction;
    setPendingAction(null);
    setSelected(null); setDraft(null); setSavedDraft(null); setConflictPaper(null); setSaveState("idle");
    if (action === "papers") return;
    if (action && typeof action === "object") void openPaper(action.paperId);
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
    } catch (error) {
      if (error instanceof CompanionRequestError && error.status === 409 && selected) {
        setConflictPaper(selected.record);
      }
      setSaveState("error"); setSaveMessage(errorMessage(error));
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
    <PageHeader eyebrow="Project Papers" title={pageTitle} description="Metadata-only paper records for this project. PDF files and full text are not available in this milestone." action={<div className="profile-header-actions"><Button variant="secondary" onClick={() => requestEditorAction("project")} icon={<ArrowLeft size={16} />}>Back to Project Overview</Button><Button variant="primary" onClick={beginCreate} icon={<Plus size={16} />}>Add paper record</Button></div>} />
    {!editing ? <>
      <Card className="paper-list-card"><SectionHeading title="Paper records" action={<StatusPill tone="muted">{records.length} metadata record{records.length === 1 ? "" : "s"}</StatusPill>} />
        {records.length ? <div className="paper-record-list" role="list">{records.map((item) => <div className="paper-record-row" role="listitem" key={item.record_id}><div className="paper-record-copy"><strong>{item.record.title}</strong><span>{compactAuthors(item.record.authors)}{item.record.year !== undefined ? ` · ${item.record.year}` : ""}{item.record.publication_venue ? ` · ${item.record.publication_venue}` : ""}</span><span className="paper-record-meta"><StatusPill tone="muted">Metadata only</StatusPill>Updated {new Date(item.record.updated_at).toLocaleString()}</span></div><Button variant="secondary" onClick={() => requestEditorAction({ paperId: item.record_id })} icon={<Edit3 size={15} />}>Open paper</Button></div>)}</div> : <EmptyState title="No paper records yet." description="Add a metadata-only paper record to this project. No PDF is copied or downloaded." />}
      </Card>
    </> : <Card className="paper-editor-card"><div className="card-heading"><div><p className="eyebrow">{selected ? "Edit paper record" : "New paper record"}</p><h2>{selected ? selected.record.title : "Paper metadata"}</h2></div><StatusPill tone="muted">Metadata only</StatusPill></div><p className="muted-copy">This record stores manually supplied metadata. The paper schema does not include a source URL field in this milestone.</p><div className="paper-form-grid">{input("title", "Title", { required: true })}{input("authors", "Authors", { required: true, multiline: true, hint: "One author per line." })}{input("year", "Publication year")}{input("publication_venue", "Venue or journal")}{input("doi", "DOI")}{input("abstract", "Abstract", { multiline: true })}{input("publication_status", "Publication status")}{input("research_type", "Research type")}{input("methodological_subtype", "Methodological subtype")}{input("evidence_structure", "Evidence structure")}{input("source_version_type", "Source version type")}</div>{saveMessage ? <p className={saveState === "saved" ? "success-message" : "error-message"} role={saveState === "saved" ? "status" : "alert"}>{saveMessage}</p> : null}{conflictPaper ? <div className="project-conflict" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><strong>This paper changed while you were editing.</strong><p>The latest durable version is shown below. Your local edits remain in the form; choose explicitly before saving again.</p><div className="paper-conflict-values"><div><span className="label">Latest title</span><p>{conflictPaper.title}</p><span className="label">Latest authors</span><p>{compactAuthors(conflictPaper.authors)}</p></div><div><span className="label">Your title</span><p>{draft?.title}</p><span className="label">Your authors</span><p>{draft ? compactAuthors(draft.authors.split("\n").map((author) => author.trim()).filter(Boolean)) : ""}</p></div></div><div className="inline-actions"><Button variant="secondary" onClick={() => void loadLatestAfterConflict()} icon={<RefreshCw size={15} />}>Reload latest</Button><Button variant="ghost" onClick={() => setConflictPaper(null)}>Keep my edits</Button></div></div></div> : null}<div className="inline-actions paper-editor-actions"><Button variant="secondary" onClick={() => requestEditorAction("papers")} icon={<X size={15} />}>Back to Papers</Button><Button variant="primary" onClick={() => void save()} disabled={saveState === "saving"} icon={<Save size={15} />}>{saveState === "saving" ? "Saving…" : selected ? "Save paper" : "Create paper record"}</Button></div>{selected ? <div className="paper-detail-meta"><span>Project association: {project.name}</span><span>Created {new Date(selected.record.created_at).toLocaleString()}</span><span>Updated {new Date(selected.record.updated_at).toLocaleString()}</span></div> : null}</Card>}
    <Modal open={Boolean(pendingAction)} eyebrow="Unsaved paper edits" title="Leave paper editor?" onClose={() => setPendingAction(null)}><p className="modal-description">Your paper metadata changes have not been saved. Keep editing, or discard them and continue.</p><div className="modal-actions"><Button variant="secondary" onClick={() => setPendingAction(null)}>Keep editing</Button><Button variant="primary" onClick={discardAndContinue}>Discard changes</Button></div></Modal>
  </div>;
}
