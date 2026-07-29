import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectOverviewPage } from "./projectOverview";
import type { DuplicateGroup, NoteRecord, PaperRecord, ProjectRecord, ResearchProfileRecord } from "./companionClient";
import type { PageId } from "./types";

const workspaceId = "workspace-overview";
const project: ProjectRecord = {
  schema_version: "m2.v1",
  project_id: "project-overview",
  name: "Advice and interaction project",
  natural_language_research_idea: "Understand how advice changes decisions in repeated interaction.",
  central_research_question: "When does advice change decisions?",
  created_at: "2026-07-19T12:00:00Z",
  updated_at: "2026-07-24T12:00:00Z"
};

const pendingProposal = {
  proposal_id: "proposal-pending",
  type: "new_search_terms" as const,
  explanation: "Add a precise phrase to the explicit search scope.",
  status: "proposed" as const,
  reversible: true,
  created_at: "2026-07-24T12:00:00Z",
  target_field: "search_queries" as const,
  current_value: { values: ["AI advice interaction"] },
  proposed_value: { values: ["conversational AI advice"] },
  history: [{ event: "created" as const, status: "proposed" as const, occurred_at: "2026-07-24T12:00:00Z" }]
};

function profileRecord(): ResearchProfileRecord {
  return {
    schema_version: "m3c.v1",
    research_profile_id: `research_profile_${project.project_id}`,
    project_id: project.project_id,
    central_research_question: project.central_research_question,
    concepts: [{ term: "Advice taking", weight: 2 }, { term: "Trust calibration", weight: 1 }],
    preferred_disciplines: ["Behavioural science"],
    preferred_evidence_types: ["Experiments", "Reviews"],
    exclusions: ["Clinical-only studies"],
    search_queries: ["AI advice interaction", "decision delegation"],
    proposals: [
      pendingProposal,
      { ...pendingProposal, proposal_id: "proposal-accepted", status: "accepted", decision_at: "2026-07-24T12:01:00Z", applied_value: { values: ["conversational AI advice"] }, applied_revision: "revision-2" },
      { ...pendingProposal, proposal_id: "proposal-modified", status: "modified", decision_at: "2026-07-24T12:02:00Z", modified_value: { values: ["advice interaction" ] }, applied_value: { values: ["AI advice interaction", "advice interaction"] }, applied_revision: "revision-3" },
      { ...pendingProposal, proposal_id: "proposal-rejected", status: "rejected", decision_at: "2026-07-24T12:03:00Z" },
      { ...pendingProposal, proposal_id: "proposal-reversed", status: "reversed", decision_at: "2026-07-24T12:04:00Z", reversed_at: "2026-07-24T12:05:00Z", applied_value: { values: ["conversational AI advice"] }, applied_revision: "revision-4" },
      { proposal_id: "legacy-shell", type: "positive_semantic_examples", explanation: "A legacy proposal without an approved durable payload.", status: "proposed", reversible: false, created_at: "2026-07-24T12:06:00Z" }
    ],
    created_at: "2026-07-19T12:00:00Z",
    updated_at: "2026-07-24T12:06:00Z"
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const paper: PaperRecord = {
  schema_version: "m2.v1",
  paper_id: "paper-overview",
  title: "Advice under uncertainty",
  authors: ["A. Researcher", "B. Scholar"],
  year: 2025,
  publication_venue: "Journal of Decisions",
  doi: "10.1000/example",
  assigned_project_ids: [project.project_id],
  pdf_access_status: "unavailable",
  created_at: "2026-07-23T12:00:00Z",
  updated_at: "2026-07-24T12:07:00Z"
};

const notes: NoteRecord[] = [
  {
    schema_version: "m3f.v1",
    note_id: "note-project-overview",
    scope_type: "project",
    project_id: project.project_id,
    title: "Project note",
    body: "A durable project observation.",
    created_at: "2026-07-24T12:00:00Z",
    updated_at: "2026-07-24T12:00:00Z"
  },
  {
    schema_version: "m3f.v1",
    note_id: "note-paper-overview",
    scope_type: "paper",
    project_id: project.project_id,
    paper_id: paper.paper_id,
    title: "Paper note",
    body: "A durable paper observation.",
    created_at: "2026-07-24T12:01:00Z",
    updated_at: "2026-07-24T12:01:00Z"
  }
];

function envelope<T>(collection: string, recordId: string, record: T) {
  return { schema_version: "task0.v1", workspace_id: workspaceId, collection, record_id: recordId, record, revision: "overview-revision", relative_path: `${collection}/${recordId}.json` };
}

const duplicateGroup: DuplicateGroup = {
  group_fingerprint: "d".repeat(64),
  evidence_fingerprint: "e".repeat(64),
  evidence_type: "exact_source",
  review_status: "unreviewed",
  reviewed_at: null,
  review_revision: null,
  details: {
    label: "Exact PDF duplicate",
    explanation: "These paper records contain identical imported PDF bytes.",
    source_sha256_preview: "aaaaaaaaaaaa…",
    source_filenames: ["a.pdf", "b.pdf"]
  },
  papers: [
    { paper_id: paper.paper_id, project_id: project.project_id, project_name: project.name, title: paper.title, authors: paper.authors, year: paper.year, publication_venue: paper.publication_venue },
    { paper_id: "paper-other", project_id: "project-other", project_name: "Other project", title: "Other paper", authors: ["C. Scholar"], year: paper.year, publication_venue: "Other venue" }
  ]
};

function renderOverview(options: { profile?: ResearchProfileRecord | null; papers?: PaperRecord[]; notes?: NoteRecord[]; duplicateGroups?: DuplicateGroup[]; projectStatus?: number; profileStatus?: number; onNavigate?: (page: PageId) => void; onOpenResearchProfile?: (focusProposals?: boolean) => void; onOpenPapers?: (create?: boolean) => void; onOpenNotes?: (create?: boolean) => void; onProjectInvalid?: () => void } = {}) {
  const profile = options.profile === undefined ? profileRecord() : options.profile;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(`/records/projects/${project.project_id}`)) {
      return jsonResponse(options.projectStatus ? { detail: "Project unavailable." } : envelope("projects", project.project_id, project), options.projectStatus ?? 200);
    }
    if (url.includes(`/records/research-profiles/research_profile_${project.project_id}`)) {
      return profile === null || options.profileStatus ? jsonResponse({ detail: "Research Profile was not found." }, options.profileStatus ?? 404) : jsonResponse(envelope("research-profiles", `research_profile_${project.project_id}`, profile));
    }
    if (url.includes("/records/papers?")) {
      return jsonResponse({ schema_version: "task0.v1", workspace_id: workspaceId, collection: "papers", records: (options.papers ?? []).map((record) => ({ record_id: record.paper_id, record, revision: "paper-revision", relative_path: `papers/${record.paper_id}/metadata.json` })) });
    }
    if (url.includes("/duplicates")) {
      const groups = options.duplicateGroups ?? [];
      return jsonResponse({ schema_version: "task0.v1", report_schema_version: "m4c.v1", workspace_id: workspaceId, groups, warnings: [], summary: { group_count: groups.length, papers_with_evidence: groups.length ? 2 : 0, exact_source_groups: groups.filter((group) => group.evidence_type === "exact_source").length, exact_identifier_groups: groups.filter((group) => group.evidence_type === "exact_identifier").length, metadata_candidate_groups: groups.filter((group) => group.evidence_type === "metadata_candidate").length } });
    }
    if (url.includes("/records/notes?")) {
      const scopeType = new URL(url).searchParams.get("scope_type");
      return jsonResponse({ schema_version: "task0.v1", workspace_id: workspaceId, collection: "notes", records: (options.notes ?? []).filter((note) => note.scope_type === scopeType).map((record) => ({ record_id: record.note_id, record, revision: "note-revision", relative_path: `notes/${record.note_id}.json` })) });
    }
    return jsonResponse({ detail: "Not found." }, 404);
  }));
  const onNavigate = options.onNavigate ?? vi.fn();
  const onOpenResearchProfile = options.onOpenResearchProfile ?? vi.fn();
  const onOpenPapers = options.onOpenPapers ?? vi.fn();
  const onOpenNotes = options.onOpenNotes ?? vi.fn();
  const onProjectInvalid = options.onProjectInvalid ?? vi.fn();
  render(<ProjectOverviewPage project={project} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId={workspaceId} workspaceName="Disposable workspace" workspaceState="connected" connectionState="online" onNavigate={onNavigate} onOpenResearchProfile={onOpenResearchProfile} onOpenPapers={onOpenPapers} onOpenNotes={onOpenNotes} onProjectInvalid={onProjectInvalid} />);
  return { onNavigate, onOpenResearchProfile, onOpenPapers, onOpenNotes, onProjectInvalid };
}

describe("persisted Project Overview", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "#project");
  });

  it("requires explicit active project context", () => {
    render(<ProjectOverviewPage project={null} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId={workspaceId} workspaceName="Workspace" workspaceState="connected" connectionState="online" onNavigate={vi.fn()} onOpenResearchProfile={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Project required" })).toBeInTheDocument();
    expect(screen.getByText(/selected in memory only/)).toBeInTheDocument();
  });

  it("loads the persisted project header, profile summary and proposal counts", async () => {
    renderOverview();
    expect(await screen.findByTestId("project-overview")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: project.name })).toBeInTheDocument();
    expect(screen.getAllByText(project.central_research_question)).toHaveLength(2);
    expect(screen.getByRole("heading", { name: project.central_research_question, level: 3 })).toHaveAttribute("id", "overview-profile-title");
    expect(screen.getByText(project.natural_language_research_idea)).toBeInTheDocument();
    expect(screen.getByText("Disposable workspace")).toBeInTheDocument();
    expect(screen.getByTestId("overview-metric-weighted-concepts")).toHaveTextContent("2");
    expect(screen.getByTestId("overview-metric-search-queries")).toHaveTextContent("2");
    expect(screen.getByTestId("overview-metric-exclusions")).toHaveTextContent("1");
    expect(screen.getByTestId("overview-metric-pending")).toHaveTextContent("1");
    expect(screen.getByTestId("overview-metric-accepted")).toHaveTextContent("1");
    expect(screen.getByTestId("overview-metric-modified")).toHaveTextContent("1");
    expect(screen.getByTestId("overview-metric-rejected")).toHaveTextContent("1");
    expect(screen.getByTestId("overview-metric-reversed")).toHaveTextContent("1");
    expect(screen.getByText(/legacy proposal shell.*not counted/)).toBeInTheDocument();
    expect(screen.queryByText("Changed concept weights")).not.toBeInTheDocument();
  });

  it("navigates to project editing, profile editing and pending proposals", async () => {
    const user = userEvent.setup();
    const { onNavigate, onOpenResearchProfile } = renderOverview();
    await screen.findByTestId("project-overview");
    await user.click(screen.getByRole("button", { name: "Edit project" }));
    expect(onNavigate).toHaveBeenCalledWith("projects");
    await user.click(screen.getByRole("button", { name: "Edit Research Profile" }));
    expect(onOpenResearchProfile).toHaveBeenCalledWith(false);
    await user.click(screen.getByRole("button", { name: "Review pending proposals" }));
    expect(onOpenResearchProfile).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("button", { name: "View proposal history" }));
    expect(onOpenResearchProfile).toHaveBeenCalledWith(true);
  });

  it("shows the truthful profile-not-created state", async () => {
    renderOverview({ profile: null });
    expect(await screen.findByRole("heading", { name: "Research Profile not created" })).toBeInTheDocument();
    expect(screen.getByText(/no persisted Research Profile yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Research Profile" })).toBeInTheDocument();
    expect(screen.queryByText("Requires your approval")).not.toBeInTheDocument();
  });

  it("shows the persisted paper count and recent metadata", async () => {
    const user = userEvent.setup();
    const onOpenPapers = vi.fn();
    renderOverview({ papers: [paper], onOpenPapers });
    expect(await screen.findByTestId("overview-paper-count")).toHaveTextContent("1");
    expect(screen.getByText(paper.title)).toBeInTheDocument();
    expect(screen.getByText("Metadata only")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Papers" }));
    expect(onOpenPapers).toHaveBeenCalledWith(false);
    await user.click(screen.getByRole("button", { name: "Add paper record" }));
    expect(onOpenPapers).toHaveBeenCalledWith(true);
  });

  it("shows bounded duplicate evidence counts and preserves advisory wording", async () => {
    const user = userEvent.setup();
    const onOpenPapers = vi.fn();
    renderOverview({ duplicateGroups: [duplicateGroup], onOpenPapers });
    expect(await screen.findByTestId("overview-metric-papers-with-evidence")).toHaveTextContent("1");
    expect(screen.getByTestId("overview-metric-exact-pdf-groups")).toHaveTextContent("1");
    expect(screen.getByText(/no automatic merge or deletion/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Inspect in Papers" }));
    expect(onOpenPapers).toHaveBeenCalledWith(false);
  });

  it("shows project and paper note counts with recent notes", async () => {
    const user = userEvent.setup();
    const onOpenNotes = vi.fn();
    renderOverview({ notes, onOpenNotes });
    expect(await screen.findByTestId("overview-metric-project-notes")).toHaveTextContent("1");
    expect(screen.getByTestId("overview-metric-paper-notes")).toHaveTextContent("1");
    expect(screen.getByText("Project note")).toBeInTheDocument();
    expect(screen.getByText("Paper note")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Notes" }));
    expect(onOpenNotes).toHaveBeenCalledWith(false);
    await user.click(screen.getByRole("button", { name: "Add project note" }));
    expect(onOpenNotes).toHaveBeenCalledWith(true);
  });

  it("does not treat malformed profile data as missing", async () => {
    const malformed = { ...profileRecord(), research_profile_id: "research_profile_other" };
    renderOverview({ profile: malformed });
    expect(await screen.findByRole("alert")).toHaveTextContent(/malformed or belongs to another project/);
    expect(screen.queryByText("Research Profile not created")).not.toBeInTheDocument();
  });

  it("clears invalid project context and provides a safe return path", async () => {
    const { onProjectInvalid } = renderOverview({ projectStatus: 404 });
    expect(await screen.findByRole("heading", { name: "Project unavailable" })).toBeInTheDocument();
    await waitFor(() => expect(onProjectInvalid).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Back to Projects" })).toBeInTheDocument();
  });

  it("keeps workspace isolation errors visible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(envelope("projects", project.project_id, project), 200)));
    render(<ProjectOverviewPage project={project} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId="workspace-other" workspaceName="Other workspace" workspaceState="connected" connectionState="online" onNavigate={vi.fn()} onOpenResearchProfile={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/does not belong to the active workspace/);
  });

  it("does not use browser storage for project context", async () => {
    const storageSetItem = vi.spyOn(Storage.prototype, "setItem");
    renderOverview();
    await screen.findByTestId("project-overview");
    expect(storageSetItem).not.toHaveBeenCalled();
  });
});
