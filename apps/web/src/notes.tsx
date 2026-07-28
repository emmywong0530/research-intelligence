import { AlertTriangle, ArrowLeft, Edit3, Plus, RefreshCw, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CompanionRequestError,
  CompanionUnavailableError,
  listNotes,
  readNote,
  writeNote,
  type DurableRecordListResponse,
  type NoteRecord,
  type PaperRecord,
  type ProjectRecord
} from "./companionClient";
import { Button, Card, EmptyState, Modal, PageHeader, SectionHeading, StatusPill } from "./components";
import type { PageId } from "./types";

type ConnectionState = "checking" | "online" | "offline";
type WorkspaceState = "idle" | "working" | "connected" | "error";
type LoadState = "idle" | "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";
type NoteListRecord = DurableRecordListResponse<NoteRecord>["records"][number];
type NoteDraft = { title: string; body: string };

export type NotesPageProps = {
  project: ProjectRecord | null;
  paper: PaperRecord | null;
  scopeType: NoteRecord["scope_type"];
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

const EMPTY_DRAFT: NoteDraft = { title: "", body: "" };

function secureNoteId(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure note ID generation is unavailable in this browser.");
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `note_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sameDraft(left: NoteDraft | null, right: NoteDraft | null): boolean {
  return Boolean(left && right && left.title === right.title && left.body === right.body);
}

function noteErrorMessage(error: unknown): string {
  if (error instanceof CompanionUnavailableError) return "The local companion is unavailable. Check the connection and try again.";
  if (error instanceof CompanionRequestError) {
    if (error.status === 401) return "The companion session expired. Pair this browser again.";
    if (error.status === 404) return "The workspace, project, paper or note is no longer available.";
    if (error.status === 409) return "This note changed elsewhere. Reconcile the latest version before saving again.";
    if (error.status === 400) return `Note validation failed: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : "The note could not be saved.";
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

export function NotesPage({
  project,
  paper,
  scopeType,
  companionUrl,
  sessionToken,
  workspaceId,
  workspaceState,
  connectionState,
  createRequested = false,
  onCreateRequestHandled,
  onNavigate,
  onDirtyChange
}: NotesPageProps) {
  const connected = Boolean(workspaceId && sessionToken && workspaceState === "connected" && connectionState === "online");
  const validContext = Boolean(project && (scopeType === "project" || paper?.assigned_project_ids[0] === project.project_id));
  const [records, setRecords] = useState<NoteListRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<NoteListRecord | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<NoteDraft | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<string | undefined>();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [conflictNote, setConflictNote] = useState<NoteRecord | null>(null);
  const [pendingDestination, setPendingDestination] = useState<PageId | null>(null);

  const dirty = Boolean(draft && !sameDraft(draft, savedDraft));
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function loadList() {
    if (!connected || !workspaceId || !project || !validContext) return;
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await listNotes(companionUrl, sessionToken, workspaceId, project.project_id, scopeType, paper?.paper_id);
      if (response.workspace_id !== workspaceId || response.records.some(({ record }) => record.scope_type !== scopeType || record.project_id !== project.project_id || (scopeType === "paper" && record.paper_id !== paper?.paper_id))) {
        throw new Error("The companion returned a note from another project or paper.");
      }
      setRecords([...response.records].sort((left, right) => right.record.updated_at.localeCompare(left.record.updated_at)));
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setLoadError(noteErrorMessage(error));
    }
  }

  useEffect(() => { void loadList(); }, [companionUrl, connected, paper?.paper_id, project, scopeType, sessionToken, validContext, workspaceId]);

  function beginCreate() {
    setSelected(null);
    setSelectedRevision(undefined);
    setDraft({ ...EMPTY_DRAFT });
    setSavedDraft({ ...EMPTY_DRAFT });
    setSaveState("idle");
    setSaveMessage("");
    setConflictNote(null);
  }

  useEffect(() => {
    if (createRequested && loadState === "ready" && !draft) {
      beginCreate();
      onCreateRequestHandled?.();
    }
  }, [createRequested, draft, loadState, onCreateRequestHandled]);

  async function openNote(noteId: string) {
    if (!workspaceId || !project) return;
    try {
      const response = await readNote(companionUrl, sessionToken, workspaceId, noteId);
      if (response.workspace_id !== workspaceId || response.record.project_id !== project.project_id || response.record.scope_type !== scopeType || (scopeType === "paper" && response.record.paper_id !== paper?.paper_id)) {
        throw new Error("This note is not associated with the active context.");
      }
      const nextDraft = { title: response.record.title, body: response.record.body };
      setSelected({ record_id: response.record_id, record: response.record, revision: response.revision, relative_path: response.relative_path });
      setSelectedRevision(response.revision);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setSaveState("idle");
      setSaveMessage("");
      setConflictNote(null);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(noteErrorMessage(error));
    }
  }

  function requestDestination(destination: PageId) {
    if (dirty) {
      setPendingDestination(destination);
      return;
    }
    onNavigate(destination);
  }

  function discardAndContinue() {
    const destination = pendingDestination;
    setPendingDestination(null);
    setDraft(null);
    setSavedDraft(null);
    setSelected(null);
    setConflictNote(null);
    setSaveState("idle");
    if (destination) onNavigate(destination);
  }

  function validateDraft(): string | null {
    if (!draft?.title.trim()) return "Title is required.";
    if (draft.title.trim().length > 240) return "Title must be 240 characters or fewer.";
    if (!draft.body.trim()) return "Body is required.";
    if (draft.body.length > 100000) return "Body must be 100,000 characters or fewer.";
    return null;
  }

  async function save() {
    if (!draft || !project || !workspaceId || conflictNote) return;
    const validationError = validateDraft();
    if (validationError) { setSaveState("error"); setSaveMessage(validationError); return; }
    const timestamp = new Date().toISOString();
    const existing = selected?.record;
    const record: NoteRecord = {
      ...(existing ?? {}),
      schema_version: existing?.schema_version ?? "m3f.v1",
      note_id: existing?.note_id ?? secureNoteId(),
      scope_type: scopeType,
      project_id: project.project_id,
      ...(scopeType === "paper" && paper ? { paper_id: paper.paper_id } : {}),
      title: draft.title.trim(),
      body: draft.body.trim(),
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    };
    setSaveState("saving");
    setSaveMessage("");
    try {
      const response = await writeNote(companionUrl, sessionToken, workspaceId, record, selected ? selectedRevision : undefined);
      const item = { record_id: response.record_id, record: response.record, revision: response.revision, relative_path: response.relative_path };
      setRecords((current) => current.some((entry) => entry.record_id === item.record_id) ? current.map((entry) => entry.record_id === item.record_id ? item : entry) : [item, ...current]);
      setSelected(item);
      setSelectedRevision(response.revision);
      const confirmed = { title: response.record.title, body: response.record.body };
      setDraft(confirmed);
      setSavedDraft(confirmed);
      setSaveState("saved");
      setSaveMessage("Note saved to the local workspace.");
      setConflictNote(null);
    } catch (error) {
      if (error instanceof CompanionRequestError && error.status === 409 && selected) setConflictNote(selected.record);
      setSaveState("error");
      setSaveMessage(noteErrorMessage(error));
    }
  }

  async function reconcileKeepEdits() {
    if (!selected || !workspaceId) return;
    try {
      const response = await readNote(companionUrl, sessionToken, workspaceId, selected.record_id);
      setSelected({ ...selected, record: response.record, revision: response.revision });
      setSelectedRevision(response.revision);
      setSavedDraft({ title: response.record.title, body: response.record.body });
      setConflictNote(null);
      setSaveMessage("Latest revision loaded. Your edits remain visible; save again to apply them explicitly.");
    } catch (error) { setSaveMessage(noteErrorMessage(error)); }
  }

  async function reloadLatest() {
    if (!selected || !workspaceId) return;
    try {
      const response = await readNote(companionUrl, sessionToken, workspaceId, selected.record_id);
      const nextDraft = { title: response.record.title, body: response.record.body };
      setSelected({ ...selected, record: response.record, revision: response.revision });
      setSelectedRevision(response.revision);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setConflictNote(null);
      setSaveState("idle");
      setSaveMessage("Latest note version loaded; local edits were discarded.");
    } catch (error) { setSaveMessage(noteErrorMessage(error)); }
  }

  const scopeLabel = scopeType === "paper" ? "Paper notes" : "Project notes";
  const pageTitle = scopeType === "paper" ? `${paper?.title ?? "Paper"} notes` : `${project?.name ?? "Project"} notes`;
  const backPage: PageId = scopeType === "paper" ? "papers" : "project";
  const editing = Boolean(draft);

  if (!connected) return <div className="page"><PageHeader eyebrow={scopeLabel} title="Notes unavailable" description="A paired companion and healthy workspace are required." action={<Button variant="secondary" onClick={() => onNavigate(backPage)} icon={<ArrowLeft size={16} />}>Back</Button>} /><Card className="overview-state-card"><StatusPill tone={connectionState === "offline" ? "danger" : "warning"}>{connectionState === "offline" ? "Companion unavailable" : "Workspace unavailable"}</StatusPill><p className="muted-copy">Reconnect the local companion and open a workspace before viewing durable notes.</p></Card></div>;
  if (!project) return <div className="page"><PageHeader eyebrow={scopeLabel} title="Project required" action={<Button variant="primary" onClick={() => onNavigate("projects")} icon={<ArrowLeft size={16} />}>Open Projects</Button>} /><Card className="overview-state-card"><EmptyState title="No active project" description="Select a persisted project and, for paper notes, an explicitly opened paper." /></Card></div>;
  if (scopeType === "paper" && !paper) return <div className="page"><PageHeader eyebrow={scopeLabel} title="Paper required" action={<Button variant="primary" onClick={() => onNavigate("papers")} icon={<ArrowLeft size={16} />}>Open Papers</Button>} /><Card className="overview-state-card"><EmptyState title="No active paper" description="Open a persisted paper before viewing its notes." /></Card></div>;
  if (!validContext) return <div className="page"><PageHeader eyebrow={scopeLabel} title="Project context unavailable" action={<Button variant="primary" onClick={() => onNavigate("projects")} icon={<ArrowLeft size={16} />}>Open Projects</Button>} /><Card className="overview-state-card"><EmptyState title="Context mismatch" description="This note context does not belong to the active project." /></Card></div>;
  if (loadState === "loading" || loadState === "idle") return <div className="page"><PageHeader eyebrow={scopeLabel} title={pageTitle} description="Loading durable plain-text notes." /><p className="workspace-status" role="status">Loading notes…</p></div>;
  if (loadState === "error") return <div className="page"><PageHeader eyebrow={scopeLabel} title={pageTitle} action={<Button variant="secondary" onClick={() => void loadList()} icon={<RefreshCw size={15} />}>Retry</Button>} /><div className="project-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{loadError}</span></div></div>;

  return <div className="page notes-page" data-testid="notes-page">
    <PageHeader eyebrow={scopeLabel} title={pageTitle} description="Plain-text notes are stored durably in this workspace. Markdown is not rendered as HTML." action={<div className="profile-header-actions"><Button variant="secondary" onClick={() => requestDestination(backPage)} icon={<ArrowLeft size={16} />}>Back</Button><Button variant="primary" onClick={beginCreate} icon={<Plus size={16} />}>Add note</Button></div>} />
    {!editing ? <Card className="notes-list-card"><SectionHeading title={scopeLabel} action={<StatusPill tone="muted">{records.length} note{records.length === 1 ? "" : "s"}</StatusPill>} />{records.length ? <div className="note-record-list" role="list">{records.map((item) => <div className="note-record-row" role="listitem" key={item.record_id}><div className="note-record-copy"><strong>{item.record.title}</strong><span>{item.record.body.slice(0, 180)}{item.record.body.length > 180 ? "…" : ""}</span><small>Updated {displayDate(item.record.updated_at)}</small></div><Button variant="secondary" onClick={() => void openNote(item.record_id)} icon={<Edit3 size={15} />}>Open note</Button></div>)}</div> : <EmptyState title="No notes yet." description={`Add a ${scopeType === "paper" ? "paper" : "project"} note when you have a durable observation to keep.`} />}</Card> : <Card className="notes-editor-card"><div className="card-heading"><div><p className="eyebrow">{selected ? "Edit note" : "New note"}</p><h2>{selected ? selected.record.title : "Note"}</h2></div><StatusPill tone={dirty ? "warning" : "muted"}>{dirty ? "Unsaved" : "Plain text"}</StatusPill></div><p className="muted-copy">This note is scoped to {scopeType === "paper" ? `the paper “${paper?.title}”` : `the project “${project.name}”`} and never stored in browser storage.</p><label className="note-form-field" htmlFor="note-title"><span>Title *</span><input id="note-title" maxLength={240} value={draft?.title ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)} /></label><label className="note-form-field" htmlFor="note-body"><span>Body *</span><small className="muted-copy">Plain text only. Line breaks are preserved.</small><textarea id="note-body" rows={14} maxLength={100000} value={draft?.body ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, body: event.target.value } : current)} /></label>{saveMessage ? <p data-testid="note-save-status" className={saveState === "saved" ? "success-message" : "error-message"} role={saveState === "saved" ? "status" : "alert"}>{saveMessage}</p> : null}{conflictNote ? <div className="project-conflict" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><strong>This note changed while you were editing.</strong><p>Your edits remain visible. Reload the latest note to discard them, or load its latest revision and explicitly save your edits again.</p><div className="inline-actions"><Button variant="secondary" onClick={() => void reloadLatest()} icon={<RefreshCw size={15} />}>Reload latest and discard edits</Button><Button variant="ghost" onClick={() => void reconcileKeepEdits()}>Keep my edits and use latest revision</Button></div></div></div> : null}<div className="inline-actions note-editor-actions"><Button variant="secondary" onClick={() => requestDestination(backPage)} icon={<X size={15} />}>Back</Button><Button variant="primary" onClick={() => void save()} disabled={saveState === "saving" || Boolean(conflictNote)} icon={<Save size={15} />}>{saveState === "saving" ? "Saving…" : selected ? "Save note" : "Create note"}</Button></div>{selected ? <div className="note-detail-meta"><span>{scopeLabel}</span><span>Created {displayDate(selected.record.created_at)}</span><span>Updated {displayDate(selected.record.updated_at)}</span></div> : null}</Card>}
    <Modal open={pendingDestination !== null} eyebrow="Unsaved note" title="Leave note editor?" onClose={() => setPendingDestination(null)}><p className="modal-description">This note has unsaved edits. Keep editing, or discard them and continue.</p><div className="modal-actions"><Button variant="secondary" onClick={() => setPendingDestination(null)}>Keep editing</Button><Button variant="primary" onClick={discardAndContinue}>Discard changes</Button></div></Modal>
  </div>;
}
