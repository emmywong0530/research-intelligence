import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Edit3, Plus, RefreshCw, Save } from "lucide-react";
import {
  CompanionRequestError,
  CompanionUnavailableError,
  listProjects,
  ProjectRecord,
  readProject,
  writeProject,
  type DurableRecordListResponse
} from "./companionClient";
import { Button, Card, EmptyState, Modal, PageHeader, SectionHeading, StatusPill } from "./components";
import { projects as mockProjects } from "./mockData";
import type { PageId, Project as MockProject } from "./types";

type ConnectionState = "checking" | "online" | "offline";
type WorkspaceState = "idle" | "working" | "connected" | "error";
type ProjectListRecord = DurableRecordListResponse<ProjectRecord>["records"][number];
type ProjectDraft = Pick<ProjectRecord, "name" | "natural_language_research_idea" | "central_research_question">;

type ProjectsPageProps = {
  onNavigate: (page: PageId) => void;
  onReview: (paperId: string) => void;
  companionUrl: string;
  sessionToken: string;
  workspaceId: string | null;
  workspaceState: WorkspaceState;
  connectionState: ConnectionState;
  onDirtyChange: (dirty: boolean) => void;
};

type ProjectLoadState = "idle" | "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";
type ConflictState = {
  localDraft: ProjectDraft;
  latestDraft: ProjectDraft | null;
  latestRevision: string | null;
  stage: "unresolved" | "loading" | "reconciled";
};
type PendingEditorAction = { kind: "create" } | { kind: "open"; projectId: string };

const EMPTY_DRAFT: ProjectDraft = {
  name: "",
  natural_language_research_idea: "",
  central_research_question: ""
};

function createStableProjectId(): string {
  const secureRandom = globalThis.crypto?.getRandomValues;
  if (!secureRandom) {
    throw new Error("Secure project ID generation is unavailable in this browser.");
  }
  const bytes = new Uint8Array(16);
  secureRandom.call(globalThis.crypto, bytes);
  return `project_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function draftFromRecord(record: ProjectRecord): ProjectDraft {
  return {
    name: record.name,
    natural_language_research_idea: record.natural_language_research_idea,
    central_research_question: record.central_research_question
  };
}

function normaliseDraft(draft: ProjectDraft): ProjectDraft {
  return {
    name: draft.name.trim(),
    natural_language_research_idea: draft.natural_language_research_idea.trim(),
    central_research_question: draft.central_research_question.trim()
  };
}

function sameDraft(left: ProjectDraft | null, right: ProjectDraft | null): boolean {
  return Boolean(left && right && left.name === right.name && left.natural_language_research_idea === right.natural_language_research_idea && left.central_research_question === right.central_research_question);
}

function projectErrorMessage(error: unknown): string {
  if (error instanceof CompanionUnavailableError) return "The local companion is unavailable. Check the connection and try again.";
  if (error instanceof CompanionRequestError) {
    if (error.status === 401) return "The companion session expired. Pair this browser again.";
    if (error.status === 404) return "This workspace or project is no longer available. Reopen the workspace.";
    if (error.status === 409) return "This project changed elsewhere. Review the conflict below before saving again.";
    if (error.status === 400) return `Project validation failed: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : "The project operation could not be completed.";
}

export function ProjectsPage({
  onNavigate,
  onReview,
  companionUrl,
  sessionToken,
  workspaceId,
  workspaceState,
  connectionState,
  onDirtyChange
}: ProjectsPageProps) {
  const connected = Boolean(workspaceId && sessionToken && workspaceState === "connected" && connectionState === "online");
  const [records, setRecords] = useState<ProjectListRecord[]>([]);
  const [loadState, setLoadState] = useState<ProjectLoadState>("idle");
  const [loadError, setLoadError] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<ProjectDraft | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [conflictState, setConflictState] = useState<ConflictState | null>(null);
  const [pendingEditorAction, setPendingEditorAction] = useState<PendingEditorAction | null>(null);
  const openRequestSequence = useRef(0);

  const dirty = Boolean(conflictState) || (editorMode === "create"
    ? Boolean(draft && !sameDraft(draft, EMPTY_DRAFT))
    : Boolean(draft && savedDraft && !sameDraft(draft, savedDraft)));

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const loadRecords = useCallback(async () => {
    if (!workspaceId || !sessionToken) return;
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await listProjects(companionUrl, sessionToken, workspaceId);
      setRecords(response.records);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setLoadError(projectErrorMessage(error));
    }
  }, [companionUrl, sessionToken, workspaceId]);

  useEffect(() => {
    if (!connected) {
      setLoadState("idle");
      setRecords([]);
      setSelectedProjectId(null);
      setSelectedRevision(null);
      setDraft(null);
      setSavedDraft(null);
      setEditorMode(null);
      return;
    }
    void loadRecords();
  }, [connected, loadRecords]);

  const selectedRecord = useMemo(
    () => records.find((record) => record.record_id === selectedProjectId) ?? null,
    [records, selectedProjectId]
  );

  function beginCreate() {
    setEditorMode("create");
    setSelectedProjectId(null);
    setSelectedRevision(null);
    setDraft({ ...EMPTY_DRAFT });
    setSavedDraft(null);
    setSaveState("idle");
    setSaveMessage("");
    setValidationMessage("");
    setConflictState(null);
  }

  async function openProject(projectId: string) {
    if (openingProjectId) return;
    const requestId = openRequestSequence.current + 1;
    openRequestSequence.current = requestId;
    setOpeningProjectId(projectId);
    setSaveMessage("");
    setValidationMessage("");
    try {
      const response = await readProject(companionUrl, sessionToken, workspaceId ?? "", projectId);
      if (requestId !== openRequestSequence.current) return;
      const nextDraft = draftFromRecord(response.record);
      setSelectedProjectId(response.record.project_id);
      setSelectedRevision(response.revision);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setEditorMode("edit");
      setSaveState("idle");
      setConflictState(null);
    } catch (error) {
      if (requestId === openRequestSequence.current) {
        setSaveState("error");
        setSaveMessage(projectErrorMessage(error));
      }
    } finally {
      if (requestId === openRequestSequence.current) setOpeningProjectId(null);
    }
  }

  function requestEditorAction(action: PendingEditorAction) {
    if (openingProjectId) return;
    if (dirty) {
      setPendingEditorAction(action);
      return;
    }
    if (action.kind === "create") beginCreate();
    else void openProject(action.projectId);
  }

  function confirmEditorAction() {
    const action = pendingEditorAction;
    setPendingEditorAction(null);
    if (!action) return;
    if (action.kind === "create") beginCreate();
    else void openProject(action.projectId);
  }

  function updateDraft(field: keyof ProjectDraft, value: string) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
    setSaveState("idle");
    setSaveMessage("");
    setValidationMessage("");
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !workspaceId || !sessionToken || saveState === "saving" || conflictState) return;
    const nextDraft = normaliseDraft(draft);
    if (!nextDraft.name || !nextDraft.natural_language_research_idea || !nextDraft.central_research_question) {
      setValidationMessage("Name, research idea and central research question are required.");
      setSaveState("error");
      return;
    }
    setSaveState("saving");
    setSaveMessage("");
    setValidationMessage("");
    try {
      const existing = selectedRecord?.record;
      const now = timestamp();
      const record: ProjectRecord = {
        schema_version: existing?.schema_version ?? "m2.v1",
        project_id: existing?.project_id ?? createStableProjectId(),
        ...nextDraft,
        created_at: existing?.created_at ?? now,
        updated_at: now
      };
      const response = await writeProject(companionUrl, sessionToken, workspaceId, record, editorMode === "edit" ? selectedRevision ?? undefined : undefined);
      const nextListRecord: ProjectListRecord = {
        record_id: response.record_id,
        record: response.record,
        revision: response.revision,
        relative_path: response.relative_path
      };
      setRecords((current) => [...current.filter((item) => item.record_id !== nextListRecord.record_id), nextListRecord].sort((left, right) => left.record_id.localeCompare(right.record_id)));
      setSelectedProjectId(response.record_id);
      setSelectedRevision(response.revision);
      const confirmedDraft = draftFromRecord(response.record);
      setDraft(confirmedDraft);
      setSavedDraft(confirmedDraft);
      setEditorMode("edit");
      setSaveState("saved");
      setSaveMessage("Project saved to the local workspace.");
    } catch (error) {
      setSaveState("error");
      if (error instanceof CompanionRequestError && error.status === 409) {
        setConflictState({
          localDraft: { ...draft },
          latestDraft: null,
          latestRevision: null,
          stage: "unresolved"
        });
      }
      setSaveMessage(projectErrorMessage(error));
    }
  }

  async function reloadLatest() {
    if (!selectedProjectId || !workspaceId || !sessionToken) return;
    const requestId = openRequestSequence.current + 1;
    openRequestSequence.current = requestId;
    setOpeningProjectId(selectedProjectId);
    try {
      const response = await readProject(companionUrl, sessionToken, workspaceId, selectedProjectId);
      if (requestId !== openRequestSequence.current) return;
      const nextDraft = draftFromRecord(response.record);
      setRecords((current) => current.map((item) => item.record_id === response.record_id ? { ...item, record: response.record, revision: response.revision } : item));
      setSelectedRevision(response.revision);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setConflictState(null);
      setSaveState("idle");
      setSaveMessage("Latest project version loaded.");
    } catch (error) {
      if (requestId === openRequestSequence.current) {
        setSaveState("error");
        setSaveMessage(projectErrorMessage(error));
      }
    } finally {
      if (requestId === openRequestSequence.current) setOpeningProjectId(null);
    }
  }

  async function preserveUnsavedEdits() {
    if (!conflictState || conflictState.stage !== "unresolved" || !selectedProjectId || !workspaceId || !sessionToken) return;
    const localDraft = { ...conflictState.localDraft };
    const requestId = openRequestSequence.current + 1;
    openRequestSequence.current = requestId;
    setConflictState({ ...conflictState, stage: "loading" });
    setOpeningProjectId(selectedProjectId);
    try {
      const response = await readProject(companionUrl, sessionToken, workspaceId, selectedProjectId);
      if (requestId !== openRequestSequence.current) return;
      const latestDraft = draftFromRecord(response.record);
      setRecords((current) => current.map((item) => item.record_id === response.record_id ? { ...item, record: response.record, revision: response.revision } : item));
      setSelectedRevision(response.revision);
      setDraft(latestDraft);
      setSavedDraft(latestDraft);
      setConflictState({ localDraft, latestDraft, latestRevision: response.revision, stage: "reconciled" });
      setSaveState("idle");
      setSaveMessage("Latest version loaded. Choose which edits to keep before saving.");
    } catch (error) {
      if (requestId === openRequestSequence.current) {
        setConflictState((current) => current ? { ...current, stage: "unresolved" } : current);
        setSaveState("error");
        setSaveMessage(projectErrorMessage(error));
      }
    } finally {
      if (requestId === openRequestSequence.current) setOpeningProjectId(null);
    }
  }

  function useLatestVersion() {
    if (!conflictState?.latestDraft || !conflictState.latestRevision) return;
    setDraft(conflictState.latestDraft);
    setSavedDraft(conflictState.latestDraft);
    setSelectedRevision(conflictState.latestRevision);
    setConflictState(null);
    setSaveState("idle");
    setSaveMessage("Latest project version selected.");
  }

  function usePreservedVersion() {
    if (!conflictState?.latestDraft || !conflictState.latestRevision) return;
    setDraft({ ...conflictState.localDraft });
    setSavedDraft(conflictState.latestDraft);
    setSelectedRevision(conflictState.latestRevision);
    setConflictState(null);
    setSaveState("idle");
    setSaveMessage("Your preserved edits are ready. Review them and save explicitly.");
  }

  const projectHeaderAction = <Button variant="primary" disabled={!connected || openingProjectId !== null} onClick={() => requestEditorAction({ kind: "create" })} icon={<Plus size={16} />}>New project</Button>;

  return (
    <div className="page">
      <PageHeader eyebrow="Projects" title="Your research projects" description="Create and refine durable project records in your local workspace." action={projectHeaderAction} />
      {connected ? (
        <Card className="project-workspace-panel">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Persisted workspace records</p>
              <h2>Projects saved locally</h2>
            </div>
            <StatusPill tone="accent">Companion connected</StatusPill>
          </div>
          {loadState === "loading" ? <p className="workspace-status" role="status">Loading projects from the workspace…</p> : null}
          {loadState === "error" ? <div className="project-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{loadError}</span><Button variant="secondary" onClick={() => void loadRecords()} icon={<RefreshCw size={15} />}>Retry</Button></div> : null}
          {loadState === "ready" && records.length === 0 ? <EmptyState title="No saved projects yet" description="Create a project to write the first schema-validated record to this workspace." /> : null}
          {loadState === "ready" && records.length > 0 ? (
            <div className="project-workspace-grid">
              <div className="project-record-list" aria-label="Saved projects">
                <SectionHeading title={`${records.length} saved ${records.length === 1 ? "project" : "projects"}`} />
                {records.map((item) => (
                  <button className={`project-record-row ${item.record_id === selectedProjectId ? "project-record-row-selected" : ""}`} key={item.record_id} onClick={() => requestEditorAction({ kind: "open", projectId: item.record_id })} disabled={openingProjectId !== null} aria-pressed={item.record_id === selectedProjectId}>
                    <span className="project-record-copy"><strong>{item.record.name}</strong><span>{item.record.natural_language_research_idea}</span></span>
                    <span className="project-record-action">{openingProjectId === item.record_id ? "Opening…" : item.record_id === selectedProjectId ? "Open" : "Select"}</span>
                  </button>
                ))}
              </div>
              {editorMode ? (
                <ProjectEditor
                  draft={draft ?? EMPTY_DRAFT}
                  mode={editorMode}
                  dirty={dirty}
                  saveState={saveState}
                  saveMessage={saveMessage}
                  validationMessage={validationMessage}
                  conflict={conflictState}
                  onChange={updateDraft}
                  onSave={saveProject}
                  onReloadLatest={() => void reloadLatest()}
                  onPreserveUnsaved={preserveUnsavedEdits}
                  onUseLatest={useLatestVersion}
                  onUsePreserved={usePreservedVersion}
                />
              ) : <EmptyState title="Select a project" description="Open a saved project to review or edit its durable fields." />}
            </div>
          ) : null}
          {loadState === "ready" && editorMode === "create" && records.length === 0 ? (
            <ProjectEditor
              draft={draft ?? EMPTY_DRAFT}
              mode="create"
              dirty={dirty}
              saveState={saveState}
              saveMessage={saveMessage}
              validationMessage={validationMessage}
              conflict={conflictState}
              onChange={updateDraft}
              onSave={saveProject}
              onReloadLatest={() => void reloadLatest()}
              onPreserveUnsaved={preserveUnsavedEdits}
              onUseLatest={useLatestVersion}
              onUsePreserved={usePreservedVersion}
            />
          ) : null}
        </Card>
      ) : (
        <Card className="project-connection-card">
          <SectionHeading title="Workspace-backed projects unavailable" action={<StatusPill tone={connectionState === "offline" ? "danger" : "warning"}>{connectionState === "offline" ? "Companion unavailable" : workspaceId ? "Workspace unavailable" : "No workspace"}</StatusPill>} />
          <p className="muted-copy">Pair the browser and connect a healthy workspace from Onboarding to create, open and edit durable project records. The preview below is not saved.</p>
        </Card>
      )}
      <Modal open={pendingEditorAction !== null} eyebrow="Unsaved project" title="Discard unsaved project edits?" onClose={() => setPendingEditorAction(null)}>
        <p className="muted-copy">The requested project action would replace the current draft. Keep editing, or discard the draft and continue.</p>
        <div className="inline-actions">
          <Button type="button" variant="secondary" onClick={() => setPendingEditorAction(null)}>Keep editing</Button>
          <Button type="button" variant="primary" onClick={confirmEditorAction}>Discard edits and continue</Button>
        </div>
      </Modal>
      {!connected ? <PrototypeProjects onNavigate={onNavigate} onReview={onReview} /> : null}
    </div>
  );
}

function ProjectEditor({
  draft,
  mode,
  dirty,
  saveState,
  saveMessage,
  validationMessage,
  conflict,
  onChange,
  onSave,
  onReloadLatest,
  onPreserveUnsaved,
  onUseLatest,
  onUsePreserved
}: {
  draft: ProjectDraft;
  mode: "create" | "edit";
  dirty: boolean;
  saveState: SaveState;
  saveMessage: string;
  validationMessage: string;
  conflict: ConflictState | null;
  onChange: (field: keyof ProjectDraft, value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onReloadLatest: () => void;
  onPreserveUnsaved: () => void;
  onUseLatest: () => void;
  onUsePreserved: () => void;
}) {
  return (
    <form className="project-editor" onSubmit={onSave} aria-label={mode === "create" ? "Create project" : "Edit project"}>
      <div className="card-heading"><div><p className="eyebrow">{mode === "create" ? "New project" : "Project editor"}</p><h2>{mode === "create" ? "Describe the research idea" : draft.name}</h2></div><StatusPill tone={dirty ? "warning" : "accent"}>{dirty ? "Unsaved" : "Up to date"}</StatusPill></div>
      <label htmlFor="project-name">Project name</label>
      <input id="project-name" value={draft.name} onChange={(event) => onChange("name", event.target.value)} placeholder="e.g. AI versus Human Advice" />
      <label htmlFor="project-idea">Research idea</label>
      <textarea id="project-idea" rows={4} value={draft.natural_language_research_idea} onChange={(event) => onChange("natural_language_research_idea", event.target.value)} placeholder="Describe the research idea in your own words." />
      <label htmlFor="project-question">Central research question</label>
      <textarea id="project-question" rows={3} value={draft.central_research_question} onChange={(event) => onChange("central_research_question", event.target.value)} placeholder="What is the central question this project investigates?" />
      {validationMessage ? <p className="error-message" role="alert">{validationMessage}</p> : null}
      {saveMessage ? <p className={saveState === "error" ? "error-message" : "success-message"} role={saveState === "error" ? "alert" : "status"}>{saveMessage}</p> : null}
      {conflict ? <div className="project-conflict" role="alert">
        <strong>This project has a newer revision.</strong>
        {conflict.stage === "unresolved" ? <>
          <p>Your local edits remain visible, but Save is blocked until the latest server version is loaded. You can discard them, or preserve them for an explicit comparison.</p>
          <div className="inline-actions"><Button type="button" variant="secondary" onClick={onReloadLatest} icon={<RefreshCw size={15} />}>Reload latest and discard my edits</Button><Button type="button" variant="ghost" onClick={onPreserveUnsaved} icon={<Edit3 size={15} />}>Preserve my edits for reconciliation</Button></div>
        </> : null}
        {conflict.stage === "loading" ? <p role="status">Loading the latest saved version before reconciliation…</p> : null}
        {conflict.stage === "reconciled" && conflict.latestDraft ? <>
          <p>Choose one complete version before saving. Neither choice is written automatically.</p>
          <div className="project-conflict-values">
            <div><strong>Latest saved version</strong><span className="label">Project name</span><p>{conflict.latestDraft.name}</p><span className="label">Research idea</span><p>{conflict.latestDraft.natural_language_research_idea}</p><span className="label">Central question</span><p>{conflict.latestDraft.central_research_question}</p></div>
            <div><strong>Preserved local edits</strong><span className="label">Project name</span><p>{conflict.localDraft.name}</p><span className="label">Research idea</span><p>{conflict.localDraft.natural_language_research_idea}</p><span className="label">Central question</span><p>{conflict.localDraft.central_research_question}</p></div>
          </div>
          <div className="inline-actions"><Button type="button" variant="secondary" onClick={onUseLatest}>Use latest saved version</Button><Button type="button" variant="primary" onClick={onUsePreserved} icon={<Edit3 size={15} />}>Use my preserved edits</Button></div>
        </> : null}
      </div> : null}
      <div className="inline-actions project-editor-actions"><Button type="submit" variant="primary" disabled={(mode === "edit" && !dirty) || saveState === "saving" || conflict !== null} icon={saveState === "saving" ? <RefreshCw size={15} /> : <Save size={15} />}>{saveState === "saving" ? "Saving…" : "Save project"}</Button>{saveState === "saved" ? <span className="saved-indicator"><Check size={15} aria-hidden="true" /> Saved locally</span> : null}</div>
    </form>
  );
}

function PrototypeProjects({ onNavigate, onReview }: { onNavigate: (page: PageId) => void; onReview: (paperId: string) => void }) {
  return (
    <section className="project-preview-section" aria-label="Prototype project examples">
      <div className="card-heading"><div><p className="eyebrow">Prototype preview</p><h2>Example project landscape</h2></div><StatusPill tone="muted">Not saved</StatusPill></div>
      <p className="muted-copy">These Task 1 examples remain available for visual continuity only. They are interactive mock content and do not represent workspace records.</p>
      <div className="grid grid-3">{mockProjects.map((project) => <MockProjectCard project={project} key={project.id} onNavigate={onNavigate} onReview={onReview} />)}</div>
    </section>
  );
}

function MockProjectCard({ project, onNavigate, onReview }: { project: MockProject; onNavigate: (page: PageId) => void; onReview: (paperId: string) => void }) {
  return <Card as="article" className="project-card"><StatusPill tone={project.status === "active" ? "accent" : "muted"}>{project.status === "active" ? "Active" : "Paused"}</StatusPill><h2>{project.name}</h2><p className="muted-copy">{project.description}</p><div className="paper-stats"><div><span className="label">Papers</span><strong>{project.papers}</strong></div><div><span className="label">New</span><strong>{project.newPapers}</strong></div><div><span className="label">Gap</span><strong>{project.gap}</strong></div></div><Button variant={project.id === "ai-advice" ? "primary" : "secondary"} onClick={() => project.id === "ai-advice" ? onNavigate("profile") : onReview("p1")} className="full-button">Open project</Button></Card>;
}
