import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PapersPage } from "./papers";
import type { PaperRecord, ProjectRecord } from "./companionClient";

const project: ProjectRecord = {
  schema_version: "m2.v1",
  project_id: "project-paper-ui",
  name: "Paper UI project",
  natural_language_research_idea: "Keep paper metadata durable.",
  central_research_question: "Can a paper record be edited safely?",
  created_at: "2026-07-19T12:00:00Z",
  updated_at: "2026-07-19T12:00:00Z"
};

const paper: PaperRecord = {
  schema_version: "m2.v1",
  paper_id: "paper-ui",
  title: "A durable paper record",
  authors: ["A. Researcher", "B. Scholar", "C. Writer"],
  year: 2024,
  publication_venue: "Local Research Journal",
  doi: "10.1234/ui",
  abstract: "A paper abstract.",
  pdf_access_status: "unavailable",
  assigned_project_ids: [project.project_id],
  created_at: "2026-07-19T12:00:00Z",
  updated_at: "2026-07-19T12:00:00Z"
};

function listEnvelope(records: Array<{ record_id: string; record: PaperRecord; revision: string }>) {
  return { schema_version: "task0.v1", workspace_id: "workspace-ui", collection: "papers", records: records.map((record) => ({ ...record, relative_path: `papers/${record.record_id}/metadata.json` })) };
}

function readEnvelope(record: PaperRecord, revision = "revision-paper") {
  return { schema_version: "task0.v1", workspace_id: "workspace-ui", collection: "papers", record_id: record.paper_id, record, revision, relative_path: `papers/${record.paper_id}/metadata.json` };
}

function renderPapers() {
  render(<PapersPage project={project} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId="workspace-ui" workspaceState="connected" connectionState="online" onNavigate={vi.fn()} onDirtyChange={vi.fn()} />);
}

describe("persisted project papers", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("requires an active project and does not use browser storage", () => {
    const onDirtyChange = vi.fn();
    render(<PapersPage project={null} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId="workspace-ui" workspaceState="connected" connectionState="online" onNavigate={vi.fn()} onDirtyChange={onDirtyChange} />);
    expect(screen.getByRole("heading", { name: "Project required" })).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(onDirtyChange).toHaveBeenCalledWith(false);
  });

  it("shows the truthful empty state and opens creation explicitly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(listEnvelope([])), { headers: { "Content-Type": "application/json" } })));
    const user = userEvent.setup();
    renderPapers();
    expect(await screen.findByText("No paper records yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Title *")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add paper record" }));
    expect(screen.getByLabelText("Title *")).toBeInTheDocument();
    expect(screen.getByText(/PDF files and full text are not available/)).toBeInTheDocument();
  });

  it("validates authors and creates a metadata-only record", async () => {
    const created = { ...paper, paper_id: "paper-created" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/records/papers?") && !init?.method) return new Response(JSON.stringify(listEnvelope([])), { headers: { "Content-Type": "application/json" } });
      if (init?.method === "PUT") return new Response(JSON.stringify(readEnvelope(created, "revision-created")), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPapers();
    await user.click(await screen.findByRole("button", { name: "Add paper record" }));
    await user.type(screen.getByLabelText("Title *"), "A durable paper");
    await user.click(screen.getByRole("button", { name: "Create paper record" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter at least one author");
    await user.type(screen.getByLabelText(/Authors/), "A. Researcher\nB. Scholar");
    await user.click(screen.getByRole("button", { name: "Create paper record" }));
    expect(await screen.findByTestId("paper-save-status")).toHaveRole("status");
    expect(screen.getByTestId("paper-save-status")).toHaveTextContent("Paper metadata saved locally");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/records/papers/"), expect.objectContaining({ method: "PUT", body: expect.stringContaining('"pdf_access_status":"unavailable"') }));
  });

  it("displays persisted papers, opens an editor and preserves local edits through a conflict", async () => {
    let latest = paper;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/records/papers?") && !init?.method) return new Response(JSON.stringify(listEnvelope([{ record_id: paper.paper_id, record: paper, revision: "revision-paper" }])), { headers: { "Content-Type": "application/json" } });
      if (url.includes(`/records/papers/${paper.paper_id}`) && init?.method === "PUT") return new Response(JSON.stringify({ detail: "changed" }), { status: 409, headers: { "Content-Type": "application/json" } });
      if (url.includes(`/records/papers/${paper.paper_id}`)) return new Response(JSON.stringify(readEnvelope(latest)), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPapers();
    expect(await screen.findByText("A durable paper record")).toBeInTheDocument();
    expect(screen.getByText(/A\. Researcher, B\. Scholar \+1/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open paper" }));
    const title = await screen.findByLabelText("Title *");
    await user.clear(title);
    await user.type(title, "My local edit");
    latest = { ...paper, title: "Latest durable title" };
    await user.click(screen.getByRole("button", { name: "Save paper" }));
    expect(await screen.findByText("This paper changed while you were editing.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title *")).toHaveValue("My local edit");
    await user.click(screen.getByRole("button", { name: "Reload latest" }));
    await waitFor(() => expect(screen.getByText(/Latest paper version loaded/)).toBeInTheDocument());
    expect(screen.getByLabelText("Title *")).toHaveValue("My local edit");
  });

  it("supports direct project-paper navigation without browser persistence", () => {
    render(<PapersPage project={project} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId={null} workspaceState="idle" connectionState="online" onNavigate={vi.fn()} onDirtyChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Papers unavailable" })).toBeInTheDocument();
    expect(localStorage.getItem("paper-ui")).toBeNull();
    expect(sessionStorage.getItem("paper-ui")).toBeNull();
  });

  it("protects unsaved paper edits before leaving the project", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(listEnvelope([])), { headers: { "Content-Type": "application/json" } })));
    const onNavigate = vi.fn();
    const onDirtyChange = vi.fn();
    const user = userEvent.setup();
    render(<PapersPage project={project} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId="workspace-ui" workspaceState="connected" connectionState="online" onNavigate={onNavigate} onDirtyChange={onDirtyChange} />);
    await user.click(await screen.findByRole("button", { name: "Add paper record" }));
    await user.type(screen.getByLabelText("Title *"), "Unsaved paper");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    await user.click(screen.getByRole("button", { name: "Back to Project Overview" }));
    expect(screen.getByRole("dialog", { name: "Leave paper editor?" })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Title *")).toHaveValue("Unsaved paper");
    await user.click(screen.getByRole("button", { name: "Back to Project Overview" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onNavigate).toHaveBeenCalledWith("project");
  });
});
