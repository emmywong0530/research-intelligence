import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectRecord } from "./companionClient";
import { ProjectsPage } from "./projects";

const workspaceId = "workspace_test";
const baseRecord: ProjectRecord = {
  schema_version: "m2.v1",
  project_id: "project-existing",
  name: "Existing advice project",
  natural_language_research_idea: "Understand advice use.",
  central_research_question: "When does advice change decisions?",
  created_at: "2026-07-19T12:00:00Z",
  updated_at: "2026-07-19T12:00:00Z"
};

const otherRecord: ProjectRecord = {
  schema_version: "m2.v1",
  project_id: "project-other",
  name: "Other methods project",
  natural_language_research_idea: "Compare methods.",
  central_research_question: "Which method is most useful?",
  created_at: "2026-07-19T12:00:00Z",
  updated_at: "2026-07-19T12:00:00Z"
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function recordEnvelope(record: ProjectRecord, revision: string) {
  return {
    schema_version: "task0.v1",
    workspace_id: workspaceId,
    collection: "projects",
    record_id: record.project_id,
    record,
    revision,
    relative_path: `projects/${record.project_id}/project.json`
  };
}

function renderConnected() {
  return render(
    <ProjectsPage
      onNavigate={vi.fn()}
      onReview={vi.fn()}
      companionUrl="http://127.0.0.1:8765"
      sessionToken="session-in-memory"
      workspaceId={workspaceId}
      workspaceState="connected"
      connectionState="online"
      onDirtyChange={vi.fn()}
    />
  );
}

describe("persisted project lifecycle", () => {
  let records: ProjectRecord[];
  let revisions: Record<string, string>;
  let failNextWrite: number | null;
  let failNextRead: number | null;
  let conflictNextWrite = false;

  beforeEach(() => {
    records = [];
    revisions = {};
    failNextWrite = null;
    failNextRead = null;
    conflictNextWrite = false;
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/records/projects") && (!init?.method || init.method === "GET")) {
        return jsonResponse({ schema_version: "task0.v1", workspace_id: workspaceId, collection: "projects", records: records.map((record) => ({ record_id: record.project_id, record, revision: revisions[record.project_id] ?? "workspace-revision-1", relative_path: `projects/${record.project_id}/project.json` })) });
      }
      const projectId = url.match(/\/records\/projects\/([^/]+)$/)?.[1];
      if (projectId && (!init?.method || init.method === "GET")) {
        if (failNextRead !== null) {
          const status = failNextRead;
          failNextRead = null;
          return jsonResponse({ detail: "The companion could not open the project." }, status);
        }
        const record = records.find((item) => item.project_id === decodeURIComponent(projectId));
        if (!record) return jsonResponse({ detail: "Durable record was not found." }, 404);
        return jsonResponse(recordEnvelope(record, revisions[record.project_id] ?? "workspace-revision-1"));
      }
      if (projectId && init?.method === "PUT") {
        if (failNextWrite !== null) {
          const status = failNextWrite;
          failNextWrite = null;
          return jsonResponse({ detail: "The companion rejected the project write." }, status);
        }
        if (conflictNextWrite) {
          conflictNextWrite = false;
          return jsonResponse({ detail: { code: "workspace_conflict", message: "The durable record changed since it was read.", current_revision: "conflict-only-revision" } }, 409);
        }
        const body = JSON.parse(String(init.body)) as { record: ProjectRecord };
        records = [...records.filter((record) => record.project_id !== body.record.project_id), body.record];
        revisions[body.record.project_id] = `revision-${records.length + 1}`;
        return jsonResponse(recordEnvelope(body.record, revisions[body.record.project_id]));
      }
      return jsonResponse({ detail: "not found" }, 404);
    }));
  });

  it("renders the empty state and creates a schema-shaped project through the client", async () => {
    const user = userEvent.setup();
    renderConnected();
    expect(await screen.findByText("No saved projects yet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByLabelText("Project name"), "New advice project");
    await user.type(screen.getByLabelText("Research idea"), "Study how people use advice.");
    await user.type(screen.getByLabelText("Central research question"), "When does advice change decisions?");
    await user.click(screen.getByRole("button", { name: "Save project" }));

    expect(await screen.findByText("Project saved to the local workspace.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New advice project" })).toBeInTheDocument();
    const writeCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(writeCall).toBeDefined();
    const requestBody = JSON.parse(String(writeCall?.[1]?.body)) as { record: ProjectRecord };
    expect(requestBody.record.schema_version).toBe("m2.v1");
    expect(requestBody.record.project_id).toMatch(/^project_[a-f0-9]{32}$/);
    expect(requestBody.record.created_at).toBe(requestBody.record.updated_at);
  });

  it("validates required fields and preserves edits when a save fails", async () => {
    const user = userEvent.setup();
    renderConnected();
    expect(await screen.findByText("No saved projects yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(screen.getByRole("button", { name: "Save project" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/required/);

    await user.type(screen.getByLabelText("Project name"), "Will remain after failure");
    await user.type(screen.getByLabelText("Research idea"), "An idea");
    await user.type(screen.getByLabelText("Central research question"), "A question");
    failNextWrite = 500;
    await user.click(screen.getByRole("button", { name: "Save project" }));
    expect(await screen.findByText("The companion rejected the project write.")).toBeInTheDocument();
    expect(screen.getByLabelText("Project name")).toHaveValue("Will remain after failure");
  });

  it("opens real records, updates with a revision, and offers explicit stale-conflict recovery", async () => {
    const user = userEvent.setup();
    records = [baseRecord];
    revisions[baseRecord.project_id] = "workspace-revision-1";
    renderConnected();
    await user.click(await screen.findByRole("button", { name: /Existing advice project/ }));
    const idea = screen.getByLabelText("Research idea");
    await user.clear(idea);
    await user.type(idea, "A revised local idea.");
    await user.click(screen.getByRole("button", { name: "Save project" }));
    await waitFor(() => expect(screen.getByText("Project saved to the local workspace.")).toBeInTheDocument());
    expect(screen.getByLabelText("Research idea")).toHaveValue("A revised local idea.");

    conflictNextWrite = true;
    await user.clear(idea);
    await user.type(idea, "Unsaved conflicting idea.");
    await user.click(screen.getByRole("button", { name: "Save project" }));
    expect(await screen.findByText("This project has a newer revision.")).toBeInTheDocument();
    expect(screen.getByLabelText("Research idea")).toHaveValue("Unsaved conflicting idea.");
    expect(screen.getByRole("button", { name: "Save project" })).toBeDisabled();

    records = [{ ...baseRecord, natural_language_research_idea: "Latest server idea." }];
    revisions[baseRecord.project_id] = "server-revision-2";
    await user.click(screen.getByRole("button", { name: /Reload latest/ }));
    expect(await screen.findByLabelText("Research idea")).toHaveValue("Latest server idea.");
    expect(screen.getByRole("button", { name: "Save project" })).toBeDisabled();
  });

  it("establishes the selected project and exposes its Research Profile action", async () => {
    const user = userEvent.setup();
    const onProjectSelected = vi.fn();
    const onOpenResearchProfile = vi.fn();
    records = [baseRecord];
    revisions[baseRecord.project_id] = "workspace-revision-1";
    render(
      <ProjectsPage
        onNavigate={vi.fn()}
        onReview={vi.fn()}
        companionUrl="http://127.0.0.1:8765"
        sessionToken="session-in-memory"
        workspaceId={workspaceId}
        workspaceState="connected"
        connectionState="online"
        onDirtyChange={vi.fn()}
        onProjectSelected={onProjectSelected}
        onOpenResearchProfile={onOpenResearchProfile}
      />
    );
    await user.click(await screen.findByRole("button", { name: /Existing advice project/ }));
    expect(onProjectSelected).toHaveBeenCalledWith(baseRecord);
    await user.click(screen.getByRole("button", { name: "Research Profile" }));
    expect(onOpenResearchProfile).toHaveBeenCalledOnce();
  });

  it("preserves a stale draft without adopting the reported revision and requires explicit reconciliation before save", async () => {
    const user = userEvent.setup();
    records = [baseRecord];
    revisions[baseRecord.project_id] = "workspace-revision-1";
    renderConnected();
    await user.click(await screen.findByRole("button", { name: /Existing advice project/ }));
    const idea = screen.getByLabelText("Research idea");
    await user.clear(idea);
    await user.type(idea, "Local draft that must not overwrite automatically.");
    conflictNextWrite = true;
    await user.click(screen.getByRole("button", { name: "Save project" }));
    expect(await screen.findByText("This project has a newer revision.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save project" })).toBeDisabled();

    records = [{ ...baseRecord, natural_language_research_idea: "Latest server idea." }];
    revisions[baseRecord.project_id] = "server-revision-2";
    await user.click(screen.getByRole("button", { name: "Preserve my edits for reconciliation" }));
    expect(await screen.findByText("Latest saved version")).toBeInTheDocument();
    expect(screen.getAllByText("Latest server idea.").length).toBeGreaterThan(0);
    expect(screen.getByText("Local draft that must not overwrite automatically.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save project" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Use my preserved edits" }));
    expect(screen.getByLabelText("Research idea")).toHaveValue("Local draft that must not overwrite automatically.");
    expect(screen.getByRole("button", { name: "Save project" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save project" }));
    await waitFor(() => expect(screen.getByText("Project saved to the local workspace.")).toBeInTheDocument());
    const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT");
    const finalWrite = writes[writes.length - 1];
    const finalBody = JSON.parse(String(finalWrite?.[1]?.body)) as { expected_revision?: string; record: ProjectRecord };
    expect(finalBody.expected_revision).toBe("server-revision-2");
    expect(finalBody.record.natural_language_research_idea).toBe("Local draft that must not overwrite automatically.");
  });

  it("confirms switching projects and keeps the requested project action until discard", async () => {
    const user = userEvent.setup();
    records = [baseRecord, otherRecord];
    revisions[baseRecord.project_id] = "revision-base";
    revisions[otherRecord.project_id] = "revision-other";
    renderConnected();
    await user.click(await screen.findByRole("button", { name: /Existing advice project/ }));
    const idea = screen.getByLabelText("Research idea");
    await user.clear(idea);
    await user.type(idea, "Draft retained while choosing another project.");
    await user.click(screen.getByRole("button", { name: /Other methods project/ }));
    expect(screen.getByRole("dialog", { name: "Discard unsaved project edits?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Research idea")).toHaveValue("Draft retained while choosing another project.");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Discard unsaved project edits?" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Research idea")).toHaveValue("Draft retained while choosing another project.");

    await user.click(screen.getByRole("button", { name: /Other methods project/ }));
    await user.click(screen.getByRole("button", { name: "Discard edits and continue" }));
    expect(await screen.findByRole("heading", { name: "Other methods project" })).toBeInTheDocument();
    expect(screen.getByLabelText("Research idea")).toHaveValue("Compare methods.");
  });

  it("confirms New project and retains the current draft when cancelled", async () => {
    const user = userEvent.setup();
    records = [baseRecord];
    revisions[baseRecord.project_id] = "revision-base";
    renderConnected();
    await user.click(await screen.findByRole("button", { name: /Existing advice project/ }));
    const idea = screen.getByLabelText("Research idea");
    await user.clear(idea);
    await user.type(idea, "Draft retained while opening a new form.");
    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByRole("dialog", { name: "Discard unsaved project edits?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Research idea")).toHaveValue("Draft retained while opening a new form.");
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(screen.getByRole("button", { name: "Discard edits and continue" }));
    expect(await screen.findByRole("form", { name: "Create project" })).toBeInTheDocument();
    expect(screen.getByLabelText("Project name")).toHaveValue("");
  });

  it("preserves the current draft when a confirmed project open fails", async () => {
    const user = userEvent.setup();
    records = [baseRecord, otherRecord];
    revisions[baseRecord.project_id] = "revision-base";
    revisions[otherRecord.project_id] = "revision-other";
    renderConnected();
    await user.click(await screen.findByRole("button", { name: /Existing advice project/ }));
    const idea = screen.getByLabelText("Research idea");
    await user.clear(idea);
    await user.type(idea, "Draft retained after failed open.");
    failNextRead = 500;
    await user.click(screen.getByRole("button", { name: /Other methods project/ }));
    await user.click(screen.getByRole("button", { name: "Discard edits and continue" }));
    expect(await screen.findByText("The companion could not open the project.")).toBeInTheDocument();
    expect(screen.getByLabelText("Research idea")).toHaveValue("Draft retained after failed open.");
  });

  it("reports no-workspace and disconnected states without using browser storage", () => {
    const storageSetItem = vi.spyOn(Storage.prototype, "setItem");
    render(
      <ProjectsPage
        onNavigate={vi.fn()}
        onReview={vi.fn()}
        companionUrl="http://127.0.0.1:8765"
        sessionToken=""
        workspaceId={null}
        workspaceState="idle"
        connectionState="offline"
        onDirtyChange={vi.fn()}
      />
    );
    expect(screen.getByText("Workspace-backed projects unavailable")).toBeInTheDocument();
    expect(screen.getByText("Companion unavailable")).toBeInTheDocument();
    expect(storageSetItem).not.toHaveBeenCalled();
  });

  it("reports a companion-unavailable error when the real project list cannot be reached", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("connection refused"));
    renderConnected();
    expect(await screen.findByRole("alert")).toHaveTextContent(/local companion is unavailable/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("reports dirty project edits so navigation can request confirmation", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(
      <ProjectsPage
        onNavigate={vi.fn()}
        onReview={vi.fn()}
        companionUrl="http://127.0.0.1:8765"
        sessionToken="session-in-memory"
        workspaceId={workspaceId}
        workspaceState="connected"
        connectionState="online"
        onDirtyChange={onDirtyChange}
      />
    );
    await screen.findByText("No saved projects yet");
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByLabelText("Project name"), "Unsaved project");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });
});
