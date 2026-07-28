import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotesPage } from "./notes";
import type { NoteRecord, PaperRecord, ProjectRecord } from "./companionClient";
import type { PageId } from "./types";

const project: ProjectRecord = {
  schema_version: "m2.v1",
  project_id: "project-notes-ui",
  name: "Notes project",
  natural_language_research_idea: "Keep local observations durable.",
  central_research_question: "Can notes remain scoped?",
  created_at: "2026-07-28T12:00:00Z",
  updated_at: "2026-07-28T12:00:00Z"
};

const paper: PaperRecord = {
  schema_version: "m2.v1",
  paper_id: "paper-notes-ui",
  title: "A paper with notes",
  authors: ["A. Researcher"],
  assigned_project_ids: [project.project_id],
  pdf_access_status: "unavailable",
  created_at: "2026-07-28T12:00:00Z",
  updated_at: "2026-07-28T12:00:00Z"
};

const note: NoteRecord = {
  schema_version: "m3f.v1",
  note_id: "note-ui",
  scope_type: "project",
  project_id: project.project_id,
  title: "A project note",
  body: "An observation stored as plain text.",
  created_at: "2026-07-28T12:00:00Z",
  updated_at: "2026-07-28T12:00:00Z"
};

function envelope(record: NoteRecord, revision = "revision-note") {
  return { schema_version: "task0.v1", workspace_id: "workspace-notes-ui", collection: "notes", record_id: record.note_id, record, revision, relative_path: "projects/project-notes-ui/notes/note-ui.json" };
}

function listEnvelope(records: NoteRecord[]) {
  return { schema_version: "task0.v1", workspace_id: "workspace-notes-ui", collection: "notes", records: records.map((record) => ({ record_id: record.note_id, record, revision: "revision-note", relative_path: `notes/${record.note_id}.json` })) };
}

function renderNotes(options: { paper?: PaperRecord | null; scopeType?: NoteRecord["scope_type"]; createRequested?: boolean; onNavigate?: (page: PageId) => void; onDirtyChange?: (dirty: boolean) => void } = {}) {
  const onNavigate = options.onNavigate ?? vi.fn();
  const onDirtyChange = options.onDirtyChange ?? vi.fn();
  render(<NotesPage project={project} paper={options.paper ?? null} scopeType={options.scopeType ?? "project"} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId="workspace-notes-ui" workspaceState="connected" connectionState="online" createRequested={options.createRequested} onNavigate={onNavigate} onDirtyChange={onDirtyChange} />);
  return { onNavigate, onDirtyChange };
}

describe("persisted project and paper notes", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("requires project context and never uses browser storage", () => {
    const onDirtyChange = vi.fn();
    render(<NotesPage project={null} paper={null} scopeType="project" companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId="workspace-notes-ui" workspaceState="connected" connectionState="online" onNavigate={vi.fn()} onDirtyChange={onDirtyChange} />);
    expect(screen.getByRole("heading", { name: "Project required" })).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(onDirtyChange).toHaveBeenCalledWith(false);
  });

  it("shows an empty project list and opens creation explicitly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(listEnvelope([])), { headers: { "Content-Type": "application/json" } })));
    const user = userEvent.setup();
    renderNotes();
    expect(await screen.findByText("No notes yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Title *")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByLabelText("Title *")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Body/ })).toBeInTheDocument();
  });

  it("validates, creates and lists a plain-text note", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify(listEnvelope([])), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify(envelope({ ...note, title: "Created note", body: "Created body" })), { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderNotes({ createRequested: true });
    await screen.findByLabelText("Title *");
    await user.click(screen.getByRole("button", { name: "Create note" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Title is required");
    await user.type(screen.getByLabelText("Title *"), "Created note");
    await user.type(screen.getByRole("textbox", { name: /Body/ }), "Created body");
    await user.click(screen.getByRole("button", { name: "Create note" }));
    expect(await screen.findByTestId("note-save-status")).toHaveTextContent("Note saved");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/records/notes/"), expect.objectContaining({ method: "PUT", body: expect.stringContaining('"scope_type":"project"') }));
  });

  it("displays persisted notes and protects dirty navigation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/records/notes/")
      ? new Response(JSON.stringify(envelope(note)), { headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify(listEnvelope([note])), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { onNavigate } = renderNotes();
    expect(await screen.findByText("A project note")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open note" }));
    const body = await screen.findByRole("textbox", { name: /Body/ });
    await user.type(body, " Unsaved");
    await user.click(screen.getAllByRole("button", { name: "Back" })[1]);
    expect(screen.getByRole("dialog", { name: "Leave note editor?" })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onNavigate).toHaveBeenCalledWith("project");
  });

  it("targets a note title exactly when the body contains the title text", async () => {
    const noteWithTitleInBody: NoteRecord = { ...note, title: "Project observation", body: "A durable project observation." };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(listEnvelope([noteWithTitleInBody])), { headers: { "Content-Type": "application/json" } })));
    renderNotes();
    expect(await screen.findByText("Project observation", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("A durable project observation.", { exact: true })).toBeInTheDocument();
  });

  it("preserves local edits and blocks save until a stale revision is reconciled", async () => {
    let latest = note;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method && url.includes("/records/notes?")) return new Response(JSON.stringify(listEnvelope([note])), { headers: { "Content-Type": "application/json" } });
      if (init?.method === "PUT") return new Response(JSON.stringify({ detail: "changed" }), { status: 409, headers: { "Content-Type": "application/json" } });
      latest = { ...note, title: "Latest note" };
      return new Response(JSON.stringify(envelope(latest, "revision-latest")), { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderNotes();
    await user.click(await screen.findByRole("button", { name: "Open note" }));
    const title = await screen.findByLabelText("Title *");
    await user.clear(title);
    await user.type(title, "My local note");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByText("This note changed while you were editing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Keep my edits and use latest revision" }));
    expect(await screen.findByText(/Latest revision loaded/)).toBeInTheDocument();
    expect(screen.getByLabelText("Title *")).toHaveValue("My local note");
    expect(screen.getByRole("button", { name: "Save note" })).not.toBeDisabled();
  });

  it("filters paper notes by the selected paper context", async () => {
    const paperNote: NoteRecord = { ...note, note_id: "note-paper-ui", scope_type: "paper", paper_id: paper.paper_id, title: "Paper note" };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(listEnvelope([paperNote])), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderNotes({ paper, scopeType: "paper" });
    expect(await screen.findByText("Paper note")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("scope_type=paper"), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("paper_id=paper-notes-ui"), expect.anything());
  });

  it("reports missing paper context instead of fabricating paper notes", () => {
    renderNotes({ scopeType: "paper", paper: null });
    expect(screen.getByRole("heading", { name: "Paper required" })).toBeInTheDocument();
  });
});
