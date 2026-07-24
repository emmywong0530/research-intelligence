import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectRecord, ResearchProfileRecord } from "./companionClient";
import { ResearchProfilePage } from "./researchProfile";

const workspaceId = "workspace_test";
const projectA: ProjectRecord = {
  schema_version: "m2.v1",
  project_id: "project-a",
  name: "Advice project",
  natural_language_research_idea: "Understand advice use.",
  central_research_question: "When does advice change decisions?",
  created_at: "2026-07-19T12:00:00Z",
  updated_at: "2026-07-19T12:00:00Z"
};
const projectB: ProjectRecord = { ...projectA, project_id: "project-b", name: "Methods project", central_research_question: "Which method is most useful?" };

function profileRecord(project: ProjectRecord = projectA): ResearchProfileRecord {
  return {
    schema_version: "m2.v1",
    research_profile_id: `research_profile_${project.project_id}`,
    project_id: project.project_id,
    central_research_question: project.central_research_question,
    concepts: [{ term: "Advice taking", weight: 1.25 }],
    synonyms: ["Advice use"],
    theories: ["Trust calibration"],
    mechanisms: ["Source evaluation"],
    outcomes: ["Decision change"],
    contexts: ["Interactive studies"],
    populations: ["Adults"],
    preferred_disciplines: ["Behavioural science"],
    preferred_evidence_types: ["Experiments"],
    exclusions: ["Clinical-only studies"],
    watched_authors: ["A. Researcher"],
    search_queries: ["AI advice interaction"],
    created_at: "2026-07-19T12:00:00Z",
    updated_at: "2026-07-19T12:00:00Z"
  };
}

function profileWithProposal(project: ProjectRecord = projectA): ResearchProfileRecord {
  return {
    ...profileRecord(project),
    schema_version: "m3c.v1",
    proposals: [{
      proposal_id: `proposal-${project.project_id}`,
      type: "new_search_terms",
      explanation: "Add a phrase that makes the explicit search scope more precise.",
      status: "proposed",
      reversible: true,
      created_at: "2026-07-24T12:00:00Z",
      target_field: "search_queries",
      current_value: { values: ["AI advice interaction"] },
      proposed_value: { values: ["conversational AI advice"] },
      history: [{ event: "created", status: "proposed", occurred_at: "2026-07-24T12:00:00Z" }]
    }]
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function envelope(record: ResearchProfileRecord, revision: string) {
  return {
    schema_version: "task0.v1",
    workspace_id: workspaceId,
    collection: "research-profiles",
    record_id: record.research_profile_id,
    record,
    revision,
    relative_path: `projects/${record.project_id}/research-profile.json`
  };
}

describe("persisted Research Profile lifecycle", () => {
  let serverProfile: ResearchProfileRecord | null;
  let serverRevision: string;
  let failNextWrite: number | null;
  let conflictNextWrite: boolean;

  beforeEach(() => {
    serverProfile = null;
    serverRevision = "profile-revision-1";
    failNextWrite = null;
    conflictNextWrite = false;
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/records/research-profiles") && (!init?.method || init.method === "GET")) {
        return jsonResponse({
          schema_version: "task0.v1",
          workspace_id: workspaceId,
          collection: "research-profiles",
          records: serverProfile ? [{ record_id: serverProfile.research_profile_id, record: serverProfile, revision: serverRevision, relative_path: `projects/${serverProfile.project_id}/research-profile.json` }] : []
        });
      }
      const profileId = url.match(/\/records\/research-profiles\/([^/]+)$/)?.[1];
      if (profileId && (!init?.method || init.method === "GET")) {
        if (!serverProfile || serverProfile.research_profile_id !== decodeURIComponent(profileId)) return jsonResponse({ detail: "Durable record was not found." }, 404);
        return jsonResponse(envelope(serverProfile, serverRevision));
      }
      if (profileId && init?.method === "PUT") {
        if (failNextWrite !== null) {
          const status = failNextWrite;
          failNextWrite = null;
          return jsonResponse({ detail: "The companion rejected the profile write." }, status);
        }
        if (conflictNextWrite) {
          conflictNextWrite = false;
          return jsonResponse({ detail: { code: "workspace_conflict", message: "The durable record changed since it was read.", current_revision: "conflict-only-revision" } }, 409);
        }
        const body = JSON.parse(String(init.body)) as { record: ResearchProfileRecord; expected_revision?: string };
        serverProfile = body.record;
        serverRevision = `revision-${body.record.updated_at}`;
        return jsonResponse(envelope(body.record, serverRevision));
      }
      return jsonResponse({ detail: "not found" }, 404);
    }));
  });

  function renderPage(project: ProjectRecord | null = projectA, onDirtyChange = vi.fn()) {
    return render(<ResearchProfilePage project={project} onNavigate={vi.fn()} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId={workspaceId} workspaceState="connected" connectionState="online" onDirtyChange={onDirtyChange} />);
  }

  it("requires a selected project and does not show the old mock profile", () => {
    renderPage(null);
    expect(screen.getByRole("heading", { name: "Project required" })).toBeInTheDocument();
    expect(screen.getByText(/Open a persisted project from Projects/)).toBeInTheDocument();
    expect(screen.queryByText("AI versus Human Advice")).not.toBeInTheDocument();
  });

  it("shows the profile-not-created state and initialises creation from the persisted project question", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("No Research Profile yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create Research Profile" }));
    expect(screen.getByRole("form", { name: "Create Research Profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Central research question")).toHaveValue(projectA.central_research_question);
    expect(screen.getByRole("button", { name: "Save Research Profile" })).toBeEnabled();
  });

  it("adds and removes list entries and weighted concepts with duplicate prevention", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Create Research Profile" }));
    const synonymsInput = screen.getByLabelText("Synonyms");
    await user.type(synonymsInput, "Advice use");
    await user.click(within(synonymsInput.parentElement!).getByRole("button", { name: "Add" }));
    expect(screen.getByText("Advice use")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Advice use" }));
    expect(screen.queryByText("Advice use")).not.toBeInTheDocument();

    const conceptInput = screen.getByLabelText("Concepts and optional weights");
    await user.type(conceptInput, "Advice taking");
    await user.type(screen.getByRole("spinbutton", { name: "New concept weight" }), "1.5");
    await user.click(within(conceptInput.parentElement!).getByRole("button", { name: "Add" }));
    expect(screen.getByRole("textbox", { name: "Concept term 1" })).toHaveValue("Advice taking");
    expect(screen.getByRole("spinbutton", { name: "Concept weight 1" })).toHaveValue(1.5);

    await user.type(conceptInput, "Advice taking");
    await user.click(within(conceptInput.parentElement!).getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/duplicate concepts/i);
  });

  it("validates required fields and preserves entered values", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Create Research Profile" }));
    const question = screen.getByLabelText("Central research question");
    await user.clear(question);
    await user.click(screen.getByRole("button", { name: "Save Research Profile" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/central research question is required/i);
    expect(question).toHaveValue("");
  });

  it("creates a profile through the typed client with deterministic identity and supported fields only", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Create Research Profile" }));
    const concept = screen.getByLabelText("Concepts and optional weights");
    await user.type(concept, "Advice taking");
    await user.click(within(concept.parentElement!).getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Save Research Profile" }));
    expect(await screen.findByText("Research Profile saved to the local workspace.")).toBeInTheDocument();
    const writeCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(writeCall).toBeDefined();
    const requestBody = JSON.parse(String(writeCall?.[1]?.body)) as { record: ResearchProfileRecord; parent_id: string };
    expect(requestBody.record.research_profile_id).toBe("research_profile_project-a");
    expect(requestBody.record.project_id).toBe(projectA.project_id);
    expect(requestBody.parent_id).toBe(projectA.project_id);
    expect(requestBody.record.concepts).toEqual([{ term: "Advice taking" }]);
    expect((requestBody.record as ResearchProfileRecord & { proposals?: unknown }).proposals).toBeUndefined();
  });

  it("loads and updates the persisted profile while keeping the project context", async () => {
    const user = userEvent.setup();
    serverProfile = profileRecord();
    renderPage();
    expect(await screen.findByRole("heading", { name: "Research scope" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: projectA.name })).toBeInTheDocument();
    expect(screen.getByLabelText("Central research question")).toHaveValue(projectA.central_research_question);
    const question = screen.getByLabelText("Central research question");
    await user.clear(question);
    await user.type(question, "How does experienced interaction change advice use?");
    await user.click(screen.getByRole("button", { name: "Save Research Profile" }));
    expect(await screen.findByText("Research Profile saved to the local workspace.")).toBeInTheDocument();
    expect(serverProfile?.central_research_question).toBe("How does experienced interaction change advice use?");
  });

  it("preserves input after an unexpected save failure", async () => {
    const user = userEvent.setup();
    serverProfile = profileRecord();
    failNextWrite = 500;
    renderPage();
    await screen.findByRole("heading", { name: "Research scope" });
    const question = screen.getByLabelText("Central research question");
    await user.clear(question);
    await user.type(question, "Input retained after failure.");
    await user.click(screen.getByRole("button", { name: "Save Research Profile" }));
    expect(await screen.findByText("The companion rejected the profile write.")).toBeInTheDocument();
    expect(question).toHaveValue("Input retained after failure.");
  });

  it("keeps local edits blocked during a stale conflict and saves only after fetched reconciliation", async () => {
    const user = userEvent.setup();
    serverProfile = profileRecord();
    renderPage();
    await screen.findByRole("heading", { name: "Research scope" });
    const question = screen.getByLabelText("Central research question");
    await user.clear(question);
    await user.type(question, "Local profile edit.");
    conflictNextWrite = true;
    await user.click(screen.getByRole("button", { name: "Save Research Profile" }));
    expect(await screen.findByText("This Research Profile has a newer revision.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Research Profile" })).toBeDisabled();

    serverProfile = { ...profileRecord(), central_research_question: "Latest server profile." };
    serverRevision = "server-revision-2";
    await user.click(screen.getByRole("button", { name: "Preserve my edits for reconciliation" }));
    expect(await screen.findByText("Latest saved version")).toBeInTheDocument();
    expect(screen.getAllByText("Latest server profile.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Save Research Profile" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Use my preserved edits" }));
    expect(screen.getByLabelText("Central research question")).toHaveValue("Local profile edit.");
    expect(screen.getByRole("button", { name: "Save Research Profile" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save Research Profile" }));
    await waitFor(() => expect(screen.getByText("Research Profile saved to the local workspace.")).toBeInTheDocument());
    const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT");
    const finalWrite = writes[writes.length - 1];
    const finalBody = JSON.parse(String(finalWrite?.[1]?.body)) as { expected_revision?: string };
    expect(finalBody.expected_revision).toBe("server-revision-2");
  });

  it("requires an explicit choice before reloading a dirty profile", async () => {
    const user = userEvent.setup();
    serverProfile = profileRecord();
    renderPage();
    await screen.findByRole("heading", { name: "Research scope" });
    const question = screen.getByLabelText("Central research question");
    await user.clear(question);
    await user.type(question, "Unsaved question.");
    await user.click(screen.getByRole("button", { name: "Reload profile" }));
    expect(screen.getByRole("dialog", { name: "Discard unsaved profile edits?" })).toBeInTheDocument();
    expect(question).toHaveValue("Unsaved question.");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Discard unsaved profile edits?" })).not.toBeInTheDocument();
    expect(question).toHaveValue("Unsaved question.");
  });

  it("protects dirty state, isolates project contexts, and never writes browser storage", async () => {
    const user = userEvent.setup();
    serverProfile = profileRecord(projectA);
    const onDirtyChange = vi.fn();
    const view = renderPage(projectA, onDirtyChange);
    await screen.findByRole("heading", { name: "Research scope" });
    const question = screen.getByLabelText("Central research question");
    await user.type(question, " Local edit");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    serverProfile = profileRecord(projectB);
    view.rerender(<ResearchProfilePage project={projectB} onNavigate={vi.fn()} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId={workspaceId} workspaceState="connected" connectionState="online" onDirtyChange={onDirtyChange} />);
    expect(await screen.findByRole("heading", { name: projectB.name })).toBeInTheDocument();
    expect(screen.getByLabelText("Central research question")).toHaveValue(projectB.central_research_question);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("reports companion, session and workspace errors accessibly", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("connection refused"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(/local companion is unavailable/i);

    cleanup();
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ detail: "Session expired." }, 401)));
    render(<ResearchProfilePage project={projectA} onNavigate={vi.fn()} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId={workspaceId} workspaceState="connected" connectionState="online" onDirtyChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/session expired/i);

    cleanup();
    render(<ResearchProfilePage project={projectA} onNavigate={vi.fn()} companionUrl="http://127.0.0.1:8765" sessionToken="" workspaceId={null} workspaceState="idle" connectionState="offline" onDirtyChange={vi.fn()} />);
    expect(screen.getByText("Research Profile unavailable")).toBeInTheDocument();
  });

  it("shows a pending proposal, requires confirmation, applies it, and reverses it safely", async () => {
    const user = userEvent.setup();
    serverProfile = profileWithProposal();
    renderPage();
    expect(await screen.findByRole("heading", { name: "Profile change proposals" })).toBeInTheDocument();
    expect(screen.getByText("Requires your approval")).toBeInTheDocument();
    expect(screen.getByText("Add a phrase that makes the explicit search scope more precise.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept proposal" }));
    expect(screen.getByRole("dialog", { name: "Apply this profile change?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply proposal change" }));
    await waitFor(() => expect(serverProfile?.proposals?.[0].status).toBe("accepted"));
    expect(serverProfile?.search_queries).toContain("conversational AI advice");
    expect(screen.getByText("accepted")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Reverse proposal" })[0]);
    expect(screen.getByRole("dialog", { name: "Reverse this profile change?" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Reverse proposal" })[1]);
    await waitFor(() => expect(serverProfile?.proposals?.[0].status).toBe("reversed"));
    expect(serverProfile?.search_queries).toEqual(["AI advice interaction"]);
  });

  it("preserves the original proposal while modifying or rejecting explicitly", async () => {
    const user = userEvent.setup();
    serverProfile = profileWithProposal();
    renderPage();
    await screen.findByRole("heading", { name: "Profile change proposals" });
    await user.click(screen.getByRole("button", { name: "Modify proposal" }));
    const modified = screen.getByRole("textbox", { name: "Modified proposal value 1" });
    await user.clear(modified);
    await user.type(modified, "human-AI advice interaction");
    await user.click(screen.getByRole("button", { name: "Apply modified proposal" }));
    expect(screen.getByRole("dialog", { name: "Apply this profile change?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply proposal change" }));
    await waitFor(() => expect(serverProfile?.proposals?.[0].status).toBe("modified"));
    expect(serverProfile?.proposals?.[0].proposed_value).toEqual({ values: ["conversational AI advice"] });
    expect(serverProfile?.proposals?.[0].modified_value).toEqual({ values: ["human-AI advice interaction"] });
    expect(serverProfile?.search_queries).toContain("human-AI advice interaction");

    cleanup();
    vi.restoreAllMocks();
    serverProfile = profileWithProposal();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/records/research-profiles") && (!init?.method || init.method === "GET")) {
        return jsonResponse({ schema_version: "task0.v1", workspace_id: workspaceId, collection: "research-profiles", records: [{ record_id: serverProfile!.research_profile_id, record: serverProfile, revision: serverRevision, relative_path: "projects/project-a/research-profile.json" }] });
      }
      if (url.includes("/records/research-profiles/") && (!init?.method || init.method === "GET")) return jsonResponse(envelope(serverProfile!, serverRevision));
      if (url.includes("/records/research-profiles/") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { record: ResearchProfileRecord };
        serverProfile = body.record;
        return jsonResponse(envelope(body.record, "revision-rejected"));
      }
      return jsonResponse({ detail: "not found" }, 404);
    }));
    renderPage();
    await screen.findByRole("heading", { name: "Profile change proposals" });
    await user.click(screen.getByRole("button", { name: "Reject proposal" }));
    await user.click(screen.getAllByRole("button", { name: "Reject proposal" })[1]);
    await waitFor(() => expect(serverProfile?.proposals?.[0].status).toBe("rejected"));
    expect(serverProfile?.search_queries).toEqual(["AI advice interaction"]);
  });

  it("blocks a stale proposal decision until the latest profile is fetched", async () => {
    const user = userEvent.setup();
    serverProfile = profileWithProposal();
    conflictNextWrite = true;
    renderPage();
    await screen.findByRole("heading", { name: "Profile change proposals" });
    await user.click(screen.getByRole("button", { name: "Accept proposal" }));
    await user.click(screen.getByRole("button", { name: "Apply proposal change" }));
    expect(await screen.findByText(/blocked by a newer Research Profile revision/i)).toBeInTheDocument();
    expect(serverProfile?.proposals?.[0].status).toBe("proposed");
    await user.click(screen.getByRole("button", { name: "Fetch latest profile" }));
    expect(await screen.findByText(/Latest proposal state is loaded/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use latest and abandon decision" }));
    expect(screen.getByRole("button", { name: "Accept proposal" })).toBeInTheDocument();
  });

  it("treats proposal edits as dirty and protects them during reload", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    serverProfile = profileWithProposal();
    renderPage(projectA, onDirtyChange);
    await screen.findByRole("heading", { name: "Profile change proposals" });
    await user.click(screen.getByRole("button", { name: "Modify proposal" }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    await user.click(screen.getByRole("button", { name: "Reload profile" }));
    expect(screen.getByRole("dialog", { name: "Discard unsaved profile edits?" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Modified proposal value 1" })).toHaveValue("conversational AI advice");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("textbox", { name: "Modified proposal value 1" })).toBeInTheDocument();
  });
});
