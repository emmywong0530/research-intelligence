import { AlertTriangle, ArrowLeft, Edit3, FileText, History, Plus, RefreshCw, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CompanionRequestError,
  CompanionUnavailableError,
  listDuplicateGroups,
  listPapers,
  listNotes,
  readProject,
  readResearchProfile,
  type PaperRecord,
  type NoteRecord,
  type ProjectRecord,
  type DuplicateGroup,
  type ResearchProfileProposal,
  type ResearchProfileRecord
} from "./companionClient";
import { isActionableProposal, proposalTarget, proposalTitle, PROPOSAL_TARGET_LABELS } from "./profileLearning";
import { Button, Card, EmptyState, PageHeader, SectionHeading, StatusPill } from "./components";
import type { PageId } from "./types";

type ConnectionState = "checking" | "online" | "offline";
type WorkspaceState = "idle" | "working" | "connected" | "error";
type LoadState = "idle" | "loading" | "ready" | "missing" | "error";
type ProfileState = "idle" | "loading" | "ready" | "missing" | "error";
type PaperState = "idle" | "loading" | "ready" | "error";
type NoteState = "idle" | "loading" | "ready" | "error";
type DuplicateState = "idle" | "loading" | "ready" | "error";

export type ProjectOverviewPageProps = {
  project: ProjectRecord | null;
  companionUrl: string;
  sessionToken: string;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceState: WorkspaceState;
  connectionState: ConnectionState;
  onNavigate: (page: PageId) => void;
  onOpenResearchProfile: (focusProposals?: boolean) => void;
  onOpenPapers?: (create?: boolean) => void;
  onOpenNotes?: (create?: boolean) => void;
  onProjectInvalid?: () => void;
};

type ProposalSummary = {
  pending: ResearchProfileProposal[];
  legacyPending: number;
  accepted: number;
  modified: number;
  rejected: number;
  reversed: number;
  blockedReversal: number;
  recent: ResearchProfileProposal[];
};

function errorMessage(error: unknown): string {
  if (error instanceof CompanionUnavailableError) return "The local companion is unavailable. Check the connection and try again.";
  if (error instanceof CompanionRequestError) {
    if (error.status === 401) return "The companion session expired. Pair this browser again.";
    if (error.status === 404) return "The selected project is no longer available in this workspace.";
    if (error.status === 409) return "The project changed while the overview was loading. Reload the latest project before continuing.";
    if (error.status === 400) return `The persisted project or profile is invalid: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : "The project overview could not be loaded.";
}

function isProfileRecordValid(record: ResearchProfileRecord, project: ProjectRecord): boolean {
  return record.schema_version === "m2.v1" || record.schema_version === "m3c.v1"
    ? record.research_profile_id === `research_profile_${project.project_id}`
      && record.project_id === project.project_id
      && typeof record.central_research_question === "string"
      && typeof record.created_at === "string"
      && typeof record.updated_at === "string"
      && (record.proposals === undefined || Array.isArray(record.proposals))
    : false;
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function listPreview(values: string[] | undefined): string {
  if (!values?.length) return "None recorded";
  return values.slice(0, 3).join(", ") + (values.length > 3 ? "…" : "");
}

function proposalDecisionTime(proposal: ResearchProfileProposal): string | null {
  return proposal.reversed_at ?? proposal.decision_at ?? proposal.history?.at(-1)?.occurred_at ?? null;
}

function proposalSummary(profile: ResearchProfileRecord): ProposalSummary {
  const proposals = profile.proposals ?? [];
  const actionablePending = proposals.filter((proposal) => proposal.status === "proposed" && isActionableProposal(proposal));
  const legacyPending = proposals.filter((proposal) => proposal.status === "proposed" && !isActionableProposal(proposal)).length;
  const decisions = proposals.filter((proposal) => proposal.status !== "proposed" || proposal.reversal_result === "blocked");
  return {
    pending: actionablePending,
    legacyPending,
    accepted: proposals.filter((proposal) => proposal.status === "accepted").length,
    modified: proposals.filter((proposal) => proposal.status === "modified").length,
    rejected: proposals.filter((proposal) => proposal.status === "rejected").length,
    reversed: proposals.filter((proposal) => proposal.status === "reversed").length,
    blockedReversal: proposals.filter((proposal) => proposal.reversal_result === "blocked").length,
    recent: [...decisions].sort((left, right) => (proposalDecisionTime(right) ?? "").localeCompare(proposalDecisionTime(left) ?? "")).slice(0, 3)
  };
}

function proposalStatusLabel(proposal: ResearchProfileProposal): string {
  if (proposal.reversal_result === "blocked") return "Reversal blocked";
  return proposal.status === "accepted" ? "Accepted" : proposal.status === "modified" ? "Modified" : proposal.status === "rejected" ? "Rejected" : "Reversed";
}

function proposalTone(proposal: ResearchProfileProposal): "accent" | "muted" | "warning" | "danger" {
  if (proposal.reversal_result === "blocked") return "danger";
  return proposal.status === "reversed" ? "accent" : proposal.status === "rejected" ? "muted" : "warning";
}

export function ProjectOverviewPage({
  project,
  companionUrl,
  sessionToken,
  workspaceId,
  workspaceName,
  workspaceState,
  connectionState,
  onNavigate,
  onOpenResearchProfile,
  onOpenPapers,
  onOpenNotes,
  onProjectInvalid
}: ProjectOverviewPageProps) {
  const connected = Boolean(workspaceId && sessionToken && workspaceState === "connected" && connectionState === "online");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [profileState, setProfileState] = useState<ProfileState>("idle");
  const [loadError, setLoadError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [paperState, setPaperState] = useState<PaperState>("idle");
  const [paperError, setPaperError] = useState("");
  const [papers, setPapers] = useState<PaperRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [noteState, setNoteState] = useState<NoteState>("idle");
  const [noteError, setNoteError] = useState("");
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateState, setDuplicateState] = useState<DuplicateState>("idle");
  const [duplicateError, setDuplicateError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [latestProject, setLatestProject] = useState<ProjectRecord | null>(null);
  const [profile, setProfile] = useState<ResearchProfileRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!connected || !workspaceId || !sessionToken || !project) {
      if (!project && loadState !== "missing") setLoadState("idle");
      setLatestProject(null);
      setProfile(null);
      setProfileState("idle");
      setPapers([]);
      setPaperState("idle");
      setNotes([]);
      setNoteState("idle");
      return () => { cancelled = true; };
    }

    setLoadState("loading");
    setProfileState("loading");
    setLoadError("");
    setProfileError("");
    setPaperError("");
    setLatestProject(null);
    setProfile(null);
    setPapers([]);
    setPaperState("loading");
    setNotes([]);
    setNoteState("loading");
    setNoteError("");
    setDuplicateGroups([]);
    setDuplicateState("loading");
    setDuplicateError("");
    const activeProject = project;
    const activeWorkspaceId = workspaceId;

    async function loadOverview() {
      try {
        const projectResponse = await readProject(companionUrl, sessionToken, activeWorkspaceId, activeProject.project_id);
        if (cancelled) return;
        if (projectResponse.workspace_id !== activeWorkspaceId || projectResponse.record.project_id !== activeProject.project_id) {
          throw new Error("The persisted project does not belong to the active workspace.");
        }
        setLatestProject(projectResponse.record);
        setLoadState("ready");
        try {
          const profileResponse = await readResearchProfile(companionUrl, sessionToken, activeWorkspaceId, `research_profile_${activeProject.project_id}`);
          if (cancelled) return;
          if (profileResponse.workspace_id !== activeWorkspaceId || !isProfileRecordValid(profileResponse.record, projectResponse.record)) {
            throw new Error("The persisted Research Profile is malformed or belongs to another project.");
          }
          setProfile(profileResponse.record);
          setProfileState("ready");
        } catch (error) {
          if (cancelled) return;
          if (error instanceof CompanionRequestError && error.status === 404) {
            setProfileState("missing");
          } else {
            setProfileState("error");
            setProfileError(errorMessage(error));
          }
        }
        try {
          const papersResponse = await listPapers(companionUrl, sessionToken, activeWorkspaceId, activeProject.project_id);
          if (cancelled) return;
          if (papersResponse.workspace_id !== activeWorkspaceId || papersResponse.records.some(({ record }) => record.assigned_project_ids.length !== 1 || record.assigned_project_ids[0] !== activeProject.project_id)) {
            throw new Error("The persisted paper list contains a record from another project.");
          }
          setPapers(papersResponse.records.map(({ record }) => record));
          setPaperState("ready");
        } catch (error) {
          if (cancelled) return;
          if (error instanceof CompanionRequestError && error.status === 404) {
            setPapers([]);
            setPaperState("ready");
            return;
          }
          setPaperState("error");
          setPaperError(errorMessage(error));
        }
        try {
          const duplicateResponse = await listDuplicateGroups(companionUrl, sessionToken, activeWorkspaceId, activeProject.project_id);
          if (duplicateResponse.workspace_id !== activeWorkspaceId || duplicateResponse.groups.some((group) => group.papers.some((paper) => !paper.project_id))) {
            throw new Error("The duplicate report contains data from another workspace.");
          }
          setDuplicateGroups(duplicateResponse.groups);
          setDuplicateState("ready");
        } catch (error) {
          if (cancelled) return;
          setDuplicateGroups([]);
          setDuplicateState("error");
          setDuplicateError(errorMessage(error));
        }
        try {
          const [projectNotes, paperNotes] = await Promise.all([
            listNotes(companionUrl, sessionToken, activeWorkspaceId, activeProject.project_id, "project"),
            listNotes(companionUrl, sessionToken, activeWorkspaceId, activeProject.project_id, "paper")
          ]);
          if (cancelled) return;
          const combined = [...projectNotes.records, ...paperNotes.records];
          if ([projectNotes, paperNotes].some((response) => response.workspace_id !== activeWorkspaceId) || combined.some(({ record }) => record.project_id !== activeProject.project_id)) {
            throw new Error("The persisted note list contains a record from another project.");
          }
          setNotes(combined.map(({ record }) => record).sort((left, right) => right.updated_at.localeCompare(left.updated_at)));
          setNoteState("ready");
        } catch (error) {
          if (cancelled) return;
          setNoteState("error");
          setNoteError(errorMessage(error));
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof CompanionRequestError && error.status === 404) {
          setLoadState("missing");
          setLoadError("The selected project could not be found in the active workspace.");
          onProjectInvalid?.();
          return;
        }
        setLoadState("error");
        setLoadError(errorMessage(error));
      }
    }

    void loadOverview();
    return () => { cancelled = true; };
  }, [companionUrl, connected, onProjectInvalid, project, reloadNonce, sessionToken, workspaceId]);

  const persistedProject = latestProject ?? project;
  const summary = useMemo(() => profile ? proposalSummary(profile) : null, [profile]);
  const projectNoteCount = useMemo(() => notes.filter((note) => note.scope_type === "project").length, [notes]);
  const paperNoteCount = useMemo(() => notes.filter((note) => note.scope_type === "paper").length, [notes]);
  const duplicatePaperCount = useMemo(() => new Set(duplicateGroups.flatMap((group) => group.papers.filter((paper) => paper.project_id === project?.project_id).map((paper) => paper.paper_id))).size, [duplicateGroups, project?.project_id]);
  const weightedConcepts = useMemo(() => {
    if (!profile?.concepts?.length) return [];
    return [...profile.concepts].sort((left, right) => (right.weight ?? 0) - (left.weight ?? 0)).slice(0, 3);
  }, [profile]);

  if (!connected) {
    return <div className="page"><PageHeader eyebrow="Project Overview" title="Project overview unavailable" description="A paired companion and healthy active workspace are required before a persisted project can be opened." action={<Button variant="secondary" onClick={() => onNavigate("projects")} icon={<ArrowLeft size={16} />}>Back to Projects</Button>} /><Card className="overview-state-card"><SectionHeading title="Connect the local workspace" action={<StatusPill tone={connectionState === "offline" ? "danger" : "warning"}>{connectionState === "offline" ? "Companion unavailable" : workspaceId ? "Workspace unavailable" : "No workspace"}</StatusPill>} /><p className="muted-copy">Pair the browser and open a healthy workspace from Onboarding, then select a persisted project explicitly.</p></Card></div>;
  }

  if (!project || loadState === "idle") {
    return <div className="page"><PageHeader eyebrow="Project Overview" title="Project required" description="Open a persisted project from Projects before viewing its overview." action={<Button variant="primary" onClick={() => onNavigate("projects")} icon={<ArrowLeft size={16} />}>Open Projects</Button>} /><Card className="overview-state-card"><EmptyState title="No active project" description="Project context is selected in memory only. Reloading or changing workspaces requires you to open the project again." /></Card></div>;
  }

  if (loadState === "loading") {
    return <div className="page"><PageHeader eyebrow="Project Overview" title={project.name} description="Loading the latest persisted project and Research Profile records." /><p className="workspace-status" role="status">Loading Project Overview…</p></div>;
  }

  if (loadState === "missing") {
    return <div className="page"><PageHeader eyebrow="Project Overview" title="Project unavailable" description="The selected project could not be found in the active workspace." action={<Button variant="primary" onClick={() => onNavigate("projects")} icon={<ArrowLeft size={16} />}>Back to Projects</Button>} /><Card className="overview-state-card"><EmptyState title="Project record missing" description="The active project context was cleared. Choose another persisted project from the Projects screen." /></Card></div>;
  }

  if (loadState === "error" || !persistedProject) {
    return <div className="page"><PageHeader eyebrow="Project Overview" title="Project data unavailable" description="The durable project record could not be safely loaded." action={<Button variant="secondary" onClick={() => onNavigate("projects")} icon={<ArrowLeft size={16} />}>Back to Projects</Button>} /><div className="project-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{loadError || "The persisted project is malformed or belongs to another workspace."}</span></div></div>;
  }

  return <div className="page project-overview" data-testid="project-overview">
    <PageHeader eyebrow="Project Overview" title={persistedProject.name} description="A read-only view of the latest persisted project context." action={<div className="profile-header-actions"><Button variant="secondary" onClick={() => onNavigate("projects")} icon={<ArrowLeft size={16} />}>Back to Projects</Button><Button variant="primary" onClick={() => onNavigate("projects")} icon={<Edit3 size={16} />}>Edit project</Button></div>} />
    <Card className="overview-header-card">
      <div className="card-heading"><div><p className="eyebrow">Core research information</p><h2>{persistedProject.central_research_question}</h2></div><StatusPill tone="accent">Persisted locally</StatusPill></div>
      <p className="overview-idea">{persistedProject.natural_language_research_idea}</p>
      <div className="overview-meta"><div><span className="label">Workspace</span><strong>{workspaceName ?? "Active workspace"}</strong></div><div><span className="label">Created</span><strong>{displayDate(persistedProject.created_at)}</strong></div><div><span className="label">Updated</span><strong>{displayDate(persistedProject.updated_at)}</strong></div></div>
    </Card>

    <section aria-labelledby="overview-profile-title" className="overview-section"><SectionHeading title="Research Profile" action={profileState === "ready" ? <Button variant="secondary" onClick={() => onOpenResearchProfile(false)} icon={<UserRound size={15} />}>Open Research Profile</Button> : undefined} />
      {profileState === "loading" ? <p className="workspace-status" role="status">Loading the persisted Research Profile…</p> : null}
      {profileState === "error" ? <div className="project-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{profileError}</span><Button variant="secondary" onClick={() => setReloadNonce((value) => value + 1)} icon={<RefreshCw size={15} />}>Reload overview</Button></div> : null}
      {profileState === "missing" ? <Card className="overview-state-card"><StatusPill tone="muted">Not created</StatusPill><h3 id="overview-profile-title">Research Profile not created</h3><p className="muted-copy">This project has no persisted Research Profile yet. Create one explicitly to define its research scope.</p><Button variant="primary" onClick={() => onOpenResearchProfile(false)} icon={<UserRound size={15} />}>Create Research Profile</Button></Card> : null}
      {profileState === "ready" && profile ? <Card className="overview-panel"><div className="card-heading"><div><p className="eyebrow">Persisted scope summary</p><h3 id="overview-profile-title">{profile.central_research_question}</h3></div><StatusPill tone="accent">Available</StatusPill></div><div className="overview-metrics"><OverviewMetric label="Weighted concepts" value={String(profile.concepts?.length ?? 0)} /><OverviewMetric label="Search queries" value={String(profile.search_queries?.length ?? 0)} /><OverviewMetric label="Exclusions" value={String(profile.exclusions?.length ?? 0)} /><OverviewMetric label="Preferred disciplines" value={String(profile.preferred_disciplines?.length ?? 0)} /><OverviewMetric label="Evidence types" value={String(profile.preferred_evidence_types?.length ?? 0)} /></div><div className="overview-preview-grid"><div><span className="label">Top concepts</span><p>{weightedConcepts.length ? weightedConcepts.map((concept) => concept.weight === undefined ? concept.term : `${concept.term} (${concept.weight})`).join(", ") : "None recorded"}</p></div><div><span className="label">Search queries</span><p>{listPreview(profile.search_queries)}</p></div><div><span className="label">Evidence types</span><p>{listPreview(profile.preferred_evidence_types)}</p></div></div><div className="inline-actions"><Button variant="primary" onClick={() => onOpenResearchProfile(false)} icon={<Edit3 size={15} />}>Edit Research Profile</Button></div><p className="overview-updated">Last updated {displayDate(profile.updated_at)}</p></Card> : null}
    </section>

    {profile && summary ? <section aria-labelledby="overview-proposals-title" className="overview-section"><SectionHeading title="Transparent proposals" action={<div className="overview-section-actions">{summary.pending.length ? <Button variant="primary" onClick={() => onOpenResearchProfile(true)} icon={<History size={15} />}>Review pending proposals</Button> : null}<Button variant="secondary" onClick={() => onOpenResearchProfile(true)} icon={<History size={15} />}>View proposal history</Button></div>} /><Card className="overview-panel"><div className="card-heading"><div><p className="eyebrow">Prepared for review</p><h3 id="overview-proposals-title">Requires your approval</h3></div><StatusPill tone="muted">Not automatically applied</StatusPill></div><p className="muted-copy">These counts come from durable proposal records. They are explicit proposals, not claims about AI learning from papers.</p><div className="overview-metrics overview-proposal-metrics"><OverviewMetric label="Pending" value={String(summary.pending.length)} /><OverviewMetric label="Accepted" value={String(summary.accepted)} /><OverviewMetric label="Modified" value={String(summary.modified)} /><OverviewMetric label="Rejected" value={String(summary.rejected)} /><OverviewMetric label="Reversed" value={String(summary.reversed)} /><OverviewMetric label="Reversal blocked" value={String(summary.blockedReversal)} /></div>{summary.recent.length ? <div className="overview-history"><SectionHeading title="Recent decisions" />{summary.recent.map((proposal) => <div className="overview-history-row" key={proposal.proposal_id}><div><strong>{proposalTitle(proposal)}</strong><span>{proposalTarget(proposal) ? PROPOSAL_TARGET_LABELS[proposalTarget(proposal)!] : "Legacy proposal"} · {proposal.explanation}</span></div><div><StatusPill tone={proposalTone(proposal)}>{proposalStatusLabel(proposal)}</StatusPill><span className="label">{proposalDecisionTime(proposal) ? displayDate(proposalDecisionTime(proposal)!) : "Decision recorded"}</span></div></div>)}</div> : <p className="overview-empty-history">No proposal decisions recorded yet.</p>}{summary.legacyPending ? <p className="overview-legacy-note">{summary.legacyPending} legacy proposal shell{summary.legacyPending === 1 ? " is" : "s are"} preserved but not counted as actionable pending changes.</p> : null}</Card></section> : null}

    <section aria-labelledby="overview-papers-title" className="overview-section"><SectionHeading title="Project papers" action={<div className="overview-section-actions"><Button variant="secondary" onClick={() => onOpenPapers?.(false)} icon={<FileText size={15} />}>Open Papers</Button><Button variant="primary" onClick={() => onOpenPapers?.(true)} icon={<Plus size={15} />}>Add paper record</Button></div>} /><Card className="overview-panel"><div className="card-heading"><div><p className="eyebrow">Persisted metadata</p><h3 id="overview-papers-title" data-testid="overview-paper-count">{paperState === "ready" ? `${papers.length} paper record${papers.length === 1 ? "" : "s"}` : "Paper records"}</h3></div><StatusPill tone={paperState === "ready" ? "accent" : paperState === "error" ? "danger" : "warning"}>{paperState === "ready" ? "Available" : paperState === "error" ? "Unavailable" : "Loading"}</StatusPill></div>{paperState === "loading" ? <p className="workspace-status" role="status">Loading paper records…</p> : null}{paperState === "error" ? <div className="project-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{paperError}</span><Button variant="secondary" onClick={() => setReloadNonce((value) => value + 1)} icon={<RefreshCw size={15} />}>Reload overview</Button></div> : null}{paperState === "ready" && papers.length === 0 ? <EmptyState title="No paper records yet." description="Add manually supplied paper metadata to this project. PDF files and full text are not available in this milestone." /> : null}{paperState === "ready" && papers.length > 0 ? <div className="overview-paper-list">{papers.slice(0, 3).map((paper) => <div className="overview-paper-row" key={paper.paper_id}><div><strong>{paper.title}</strong><span>{paper.authors.slice(0, 2).join(", ")}{paper.authors.length > 2 ? ` +${paper.authors.length - 2}` : ""}{paper.year !== undefined ? ` · ${paper.year}` : ""}{paper.publication_venue ? ` · ${paper.publication_venue}` : ""}</span></div><StatusPill tone="muted">Metadata only</StatusPill></div>)}</div> : null}</Card></section>

    <section aria-labelledby="overview-duplicates-title" className="overview-section"><SectionHeading title="Duplicate evidence" action={<Button variant="secondary" onClick={() => onOpenPapers?.(false)} icon={<FileText size={15} />}>Inspect in Papers</Button>} /><Card className="overview-panel"><div className="card-heading"><div><p className="eyebrow">Deterministic local checking</p><h3 id="overview-duplicates-title">{duplicateState === "ready" ? `${duplicatePaperCount} paper${duplicatePaperCount === 1 ? "" : "s"} with evidence` : "Duplicate evidence"}</h3></div><StatusPill tone={duplicateState === "ready" ? (duplicatePaperCount ? "warning" : "muted") : duplicateState === "error" ? "danger" : "warning"}>{duplicateState === "ready" ? (duplicatePaperCount ? "Review" : "None found") : duplicateState === "error" ? "Unavailable" : "Checking"}</StatusPill></div>{duplicateState === "loading" ? <p className="workspace-status" role="status">Recomputing duplicate evidence…</p> : null}{duplicateState === "error" ? <p className="error-message" role="alert">{duplicateError}</p> : null}{duplicateState === "ready" ? <div className="overview-metrics overview-duplicate-metrics"><OverviewMetric label="Papers with evidence" value={String(duplicatePaperCount)} /><OverviewMetric label="Exact PDF groups" value={String(duplicateGroups.filter((group) => group.evidence_type === "exact_source").length)} /><OverviewMetric label="Identifier groups" value={String(duplicateGroups.filter((group) => group.evidence_type === "exact_identifier").length)} /><OverviewMetric label="Metadata candidates" value={String(duplicateGroups.filter((group) => group.evidence_type === "metadata_candidate").length)} /></div> : null}<p className="muted-copy">Evidence is advisory. Records, projects and imported files remain unchanged; no automatic merge or deletion is performed.</p></Card></section>

    <section aria-labelledby="overview-notes-title" className="overview-section"><SectionHeading title="Project notes" action={<div className="overview-section-actions"><Button variant="secondary" onClick={() => onOpenNotes?.(false)} icon={<FileText size={15} />}>Open Notes</Button><Button variant="primary" onClick={() => onOpenNotes?.(true)} icon={<Plus size={15} />}>Add project note</Button></div>} /><Card className="overview-panel"><div className="card-heading"><div><p className="eyebrow">Durable plain text</p><h3 id="overview-notes-title">{noteState === "ready" ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : "Project notes"}</h3></div><StatusPill tone={noteState === "ready" ? "accent" : noteState === "error" ? "danger" : "warning"}>{noteState === "ready" ? "Available" : noteState === "error" ? "Unavailable" : "Loading"}</StatusPill></div>{noteState === "ready" ? <div className="overview-metrics overview-note-metrics"><OverviewMetric label="Project notes" value={String(projectNoteCount)} /><OverviewMetric label="Paper notes" value={String(paperNoteCount)} /></div> : null}{noteState === "loading" ? <p className="workspace-status" role="status">Loading project and paper note counts…</p> : null}{noteState === "error" ? <div className="project-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{noteError}</span></div> : null}{noteState === "ready" && notes.length === 0 ? <EmptyState title="No notes yet." description="Add a project or paper note when you have a durable observation to keep." /> : null}{noteState === "ready" && notes.length > 0 ? <div className="overview-note-list">{notes.slice(0, 3).map((note) => <div className="overview-note-row" key={note.note_id}><div><strong>{note.title}</strong><span>{note.scope_type === "paper" ? "Paper note" : "Project note"} · {note.body.slice(0, 140)}{note.body.length > 140 ? "…" : ""}</span></div><span className="label">{displayDate(note.updated_at)}</span></div>)}</div> : null}</Card></section>

    <section aria-labelledby="overview-status-title" className="overview-section"><SectionHeading title="Current milestone status" /><Card className="overview-panel"><div className="overview-status-list"><OverviewStatus label="Project record" value="Available" tone="accent" /><OverviewStatus label="Research Profile" value={profileState === "ready" ? "Available" : profileState === "missing" ? "Not created" : "Unavailable"} tone={profileState === "ready" ? "accent" : profileState === "missing" ? "muted" : "warning"} /><OverviewStatus label="Profile proposals" value={profile && summary ? `${summary.pending.length} pending · history available` : "Not available"} tone={profile ? "accent" : "muted"} /><OverviewStatus label="Paper records" value={paperState === "ready" ? `${papers.length} available` : "Unavailable"} tone={paperState === "ready" ? "accent" : "warning"} /><OverviewStatus label="Notes" value={noteState === "ready" ? `${notes.length} available` : "Unavailable"} tone={noteState === "ready" ? "accent" : "warning"} /><OverviewStatus label="Local persistence" value={connected ? "Connected and verified" : "Unavailable"} tone={connected ? "accent" : "danger"} /></div><p className="overview-later-note">PDF import, discovery, reading, AI processing, synthesis and export are not available in this milestone.</p></Card></section>
  </div>;
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return <div className="overview-metric" data-testid={`overview-metric-${label.toLocaleLowerCase().replaceAll(" ", "-")}`}><span className="label">{label}</span><strong>{value}</strong></div>;
}

function OverviewStatus({ label, value, tone }: { label: string; value: string; tone: "accent" | "muted" | "warning" | "danger" }) {
  return <div className="overview-status-row"><span>{label}</span><StatusPill tone={tone}>{value}</StatusPill></div>;
}
