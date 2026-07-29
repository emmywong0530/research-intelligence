import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PapersPage } from "./papers";
import type { DuplicateGroup, PaperRecord, PaperTextExtractionSummary, ProjectRecord, SourceFileRecord } from "./companionClient";

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

const source: SourceFileRecord = {
  schema_version: "m4a.v1",
  source_id: "source-paper-ui",
  paper_id: paper.paper_id,
  project_id: project.project_id,
  source_type: "local_file",
  media_type: "application/pdf",
  original_filename: "paper.pdf",
  relative_path: `papers/${paper.paper_id}/source/original.pdf`,
  size_bytes: 42,
  sha256: "a".repeat(64),
  created_at: "2026-07-19T12:00:00Z",
  imported_at: "2026-07-19T12:00:00Z",
  updated_at: "2026-07-19T12:00:00Z"
};

function listEnvelope(records: Array<{ record_id: string; record: PaperRecord; revision: string }>) {
  return { schema_version: "task0.v1", workspace_id: "workspace-ui", collection: "papers", records: records.map((record) => ({ ...record, relative_path: `papers/${record.record_id}/metadata.json` })) };
}

function readEnvelope(record: PaperRecord, revision = "revision-paper") {
  return { schema_version: "task0.v1", workspace_id: "workspace-ui", collection: "papers", record_id: record.paper_id, record, revision, relative_path: `papers/${record.paper_id}/metadata.json` };
}

function sourceEnvelope(record = source) {
  return { schema_version: "task0.v1", workspace_id: "workspace-ui", project_id: project.project_id, paper_id: paper.paper_id, source: record, source_revision: "revision-source" };
}

const completedExtraction: PaperTextExtractionSummary = {
  schema_version: "m4b.v1",
  extraction_id: "extraction-paper-ui",
  project_id: project.project_id,
  paper_id: paper.paper_id,
  source_id: source.source_id,
  source_sha256: source.sha256,
  extraction_status: "completed",
  status: "completed",
  extraction_engine: "pypdf",
  extraction_engine_version: "6.14.2",
  created_at: "2026-07-19T12:01:00Z",
  started_at: "2026-07-19T12:01:00Z",
  completed_at: "2026-07-19T12:01:01Z",
  updated_at: "2026-07-19T12:01:01Z",
  page_count: 2,
  pages_with_text: 2,
  pages_without_text: 0,
  character_count: 42,
  word_count: 8,
  warnings: [],
  full_text_sha256: "b".repeat(64),
  text_preview: "A deterministic local extraction preview."
};

function extractionEnvelope(status: "not_run" | "completed" | "stale", extraction: PaperTextExtractionSummary | null = null) {
  return { schema_version: "task0.v1", workspace_id: "workspace-ui", project_id: project.project_id, paper_id: paper.paper_id, status, extraction };
}

const duplicateGroup: DuplicateGroup = {
  group_fingerprint: "d".repeat(64),
  evidence_fingerprint: "e".repeat(64),
  evidence_type: "metadata_candidate",
  review_status: "unreviewed",
  reviewed_at: null,
  review_revision: null,
  details: {
    label: "Possible metadata duplicate",
    explanation: "The normalized title and available supporting metadata match.",
    matched_fields: ["normalized title", "publication year", "first-author surname"],
    normalized_title_preview: "a durable paper record"
  },
  papers: [
    { paper_id: paper.paper_id, project_id: project.project_id, project_name: project.name, title: paper.title, authors: paper.authors, year: paper.year, publication_venue: paper.publication_venue },
    { paper_id: "paper-other-project", project_id: "project-other", project_name: "Other project", title: "A durable paper record", authors: ["A. Researcher"], year: 2024, publication_venue: "Other Journal" }
  ]
};

function duplicateEnvelope(groups: DuplicateGroup[] = [duplicateGroup]) {
  return { schema_version: "task0.v1", report_schema_version: "m4c.v1", workspace_id: "workspace-ui", groups, warnings: [], summary: { group_count: groups.length, papers_with_evidence: groups.length ? 2 : 0, exact_source_groups: 0, exact_identifier_groups: 0, metadata_candidate_groups: groups.length } };
}

function renderPapers(options: { onOpenNotes?: (paper: PaperRecord) => void } = {}) {
  return render(<PapersPage project={project} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId="workspace-ui" workspaceState="connected" connectionState="online" onNavigate={vi.fn()} onDirtyChange={vi.fn()} onOpenNotes={options.onOpenNotes} />);
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
    expect(screen.getByText(/Text extraction is explicit and local/)).toBeInTheDocument();
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

  it("shows workspace-wide duplicate evidence, owning projects and durable review actions", async () => {
    let currentGroup = duplicateGroup;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/records/papers?") && !init?.method) return new Response(JSON.stringify(listEnvelope([{ record_id: paper.paper_id, record: paper, revision: "revision-paper" }])), { headers: { "Content-Type": "application/json" } });
      if (url.includes("/duplicates/reviews") && init?.method === "POST") {
        currentGroup = { ...currentGroup, review_status: "reviewed_not_duplicate", review_revision: "revision-review" };
        return new Response(JSON.stringify({ schema_version: "task0.v1", workspace_id: "workspace-ui", group: currentGroup, review: {}, revision: "revision-review" }), { headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/duplicates")) return new Response(JSON.stringify(duplicateEnvelope([currentGroup])), { headers: { "Content-Type": "application/json" } });
      if (url.includes(`/records/papers/${paper.paper_id}`)) return new Response(JSON.stringify(readEnvelope(paper)), { headers: { "Content-Type": "application/json" } });
      if (url.includes("source-file")) return new Response(JSON.stringify({ detail: "No local PDF" }), { status: 404, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPapers();
    expect(await screen.findByTestId("paper-duplicate-indicators")).toHaveTextContent("Possible metadata duplicate");
    await user.click(screen.getByRole("button", { name: "Open paper" }));
    expect(await screen.findByTestId("paper-duplicate-check")).toHaveTextContent("Other project");
    expect(screen.getByText("Possible metadata duplicate")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark as separate" }));
    await waitFor(() => expect(screen.getByText("Reviewed as separate")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/duplicates/reviews"), expect.objectContaining({ method: "POST", body: expect.stringContaining("reviewed_not_duplicate") }));
    expect(screen.queryByText(/\/Users\//)).not.toBeInTheDocument();
  });

  it("keeps exact evidence distinct from metadata evidence and does not use browser storage", async () => {
    const exactGroup: DuplicateGroup = { ...duplicateGroup, evidence_type: "exact_source", details: { label: "Exact PDF duplicate", explanation: "These paper records contain identical imported PDF bytes.", source_sha256_preview: "aaaaaaaaaaaa…", source_filenames: ["paper-a.pdf", "paper-b.pdf"] } };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/records/papers?") && !init?.method) return new Response(JSON.stringify(listEnvelope([{ record_id: paper.paper_id, record: paper, revision: "revision-paper" }])), { headers: { "Content-Type": "application/json" } });
      if (url.includes("/duplicates")) return new Response(JSON.stringify(duplicateEnvelope([exactGroup])), { headers: { "Content-Type": "application/json" } });
      if (url.includes(`/records/papers/${paper.paper_id}`)) return new Response(JSON.stringify(readEnvelope(paper)), { headers: { "Content-Type": "application/json" } });
      if (url.includes("source-file")) return new Response(JSON.stringify({ detail: "No local PDF" }), { status: 404, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
    }));
    const user = userEvent.setup();
    renderPapers();
    expect(await screen.findByText("Exact PDF duplicate")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open paper" }));
    expect(await screen.findByTestId("paper-duplicate-check")).toHaveTextContent("PDF bytes match");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps the persisted paper action stable after returning from Paper Notes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes(`/records/papers/${paper.paper_id}`)
      ? new Response(JSON.stringify(readEnvelope(paper)), { headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify(listEnvelope([{ record_id: paper.paper_id, record: paper, revision: "revision-paper" }])), { headers: { "Content-Type": "application/json" } })));
    const user = userEvent.setup();
    const onOpenNotes = vi.fn();
    const firstRender = renderPapers({ onOpenNotes });
    const firstRow = await screen.findByTestId(`paper-record-row-${paper.paper_id}`);
    await user.click(within(firstRow).getByRole("button", { name: "Open paper" }));
    await screen.findByLabelText("Title *");
    await user.click(screen.getByRole("button", { name: "Paper notes" }));
    expect(onOpenNotes).toHaveBeenCalledWith(paper);

    firstRender.unmount();
    renderPapers({ onOpenNotes });
    const returnedRow = await screen.findByTestId(`paper-record-row-${paper.paper_id}`);
    await user.click(within(returnedRow).getByRole("button", { name: "Open paper" }));
    expect(await screen.findByLabelText("Title *")).toHaveValue(paper.title);
  });

  it("supports direct project-paper navigation without browser persistence", () => {
    render(<PapersPage project={project} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId={null} workspaceState="idle" connectionState="online" onNavigate={vi.fn()} onDirtyChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Papers unavailable" })).toBeInTheDocument();
    expect(localStorage.getItem("paper-ui")).toBeNull();
    expect(sessionStorage.getItem("paper-ui")).toBeNull();
  });

  it("previews a selected PDF without writing until import is explicit", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/records/papers?") ) return new Response(JSON.stringify(listEnvelope([{ record_id: paper.paper_id, record: paper, revision: "revision-paper" }])), { headers: { "Content-Type": "application/json" } });
      if (url.includes("/records/papers/paper-ui")) return new Response(JSON.stringify(readEnvelope(paper)), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ detail: "No local PDF" }), { status: 404, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPapers();
    await user.click(await screen.findByRole("button", { name: "Open paper" }));
    await screen.findByTestId("paper-source-empty");
    const file = new File(["%PDF-1.7"], "selected.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("paper-source-file-input"), file);
    expect(screen.getByTestId("paper-source-preview")).toHaveTextContent("selected.pdf");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Cancel selection" }));
    expect(screen.queryByTestId("paper-source-preview")).not.toBeInTheDocument();
  });

  it("imports a PDF, shows durable source metadata and preserves selection on failure", async () => {
    const importedPaper = { ...paper, pdf_access_status: "pdf_ready" as const, local_pdf_path: "papers/paper-ui/source/original.pdf" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/records/papers?") && !init?.method) return new Response(JSON.stringify(listEnvelope([{ record_id: paper.paper_id, record: paper, revision: "revision-paper" }])), { headers: { "Content-Type": "application/json" } });
      if (url.includes("/records/papers/paper-ui") && !url.includes("source-file") && init?.method !== "POST") return new Response(JSON.stringify(readEnvelope(paper)), { headers: { "Content-Type": "application/json" } });
      if (url.includes("source-file") && init?.method === "POST") return new Response(JSON.stringify({ ...sourceEnvelope({ ...source, original_filename: "selected.pdf" }), paper: importedPaper, paper_revision: "revision-imported", recovery_backup_id: "backup-test" }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ detail: "No local PDF" }), { status: 404, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPapers();
    await user.click(await screen.findByRole("button", { name: "Open paper" }));
    await screen.findByTestId("paper-source-empty");
    const file = new File(["%PDF-1.7"], "selected.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("paper-source-file-input"), file);
    await user.click(screen.getByRole("button", { name: "Import PDF" }));
    expect(await screen.findByTestId("paper-source-status")).toHaveTextContent("selected.pdf");
    expect(screen.getByTestId("paper-source-status")).toHaveTextContent("PDF stored; text not extracted");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST" && init.body === file)).toBe(true);
  });

  it("shows the explicit not-run extraction state and persists a completed local result", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/records/papers?") && !init?.method) return new Response(JSON.stringify(listEnvelope([{ record_id: paper.paper_id, record: paper, revision: "revision-paper" }])), { headers: { "Content-Type": "application/json" } });
      if (url.endsWith(`/records/papers/${paper.paper_id}`) && !init?.method) return new Response(JSON.stringify(readEnvelope(paper)), { headers: { "Content-Type": "application/json" } });
      if (url.includes("source-file")) return new Response(JSON.stringify(sourceEnvelope()), { headers: { "Content-Type": "application/json" } });
      if (url.includes("text-extraction") && init?.method === "POST") return new Response(JSON.stringify(extractionEnvelope("completed", completedExtraction)), { headers: { "Content-Type": "application/json" } });
      if (url.includes("text-extraction")) return new Response(JSON.stringify(extractionEnvelope("not_run")), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPapers();
    await user.click(await screen.findByRole("button", { name: "Open paper" }));
    expect(await screen.findByTestId("paper-extraction-not-run")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Extract text" }));
    expect(await screen.findByTestId("paper-extraction-status")).toHaveTextContent("Text extracted locally");
    expect(screen.getByTestId("paper-extraction-page-count")).toHaveTextContent("Pages 2");
    expect(screen.getByTestId("paper-extraction-engine")).toHaveTextContent("pypdf 6.14.2");
    expect(screen.getByTestId("paper-extraction-preview")).toHaveTextContent("deterministic local extraction");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("text-extraction"), expect.objectContaining({ method: "POST" }));
  });

  it("shows a processing state until the companion returns the extraction", async () => {
    let releaseExtraction: (response: Response) => void = () => undefined;
    const pendingExtraction = new Promise<Response>((resolve) => { releaseExtraction = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/records/papers?") && !init?.method) return new Response(JSON.stringify(listEnvelope([{ record_id: paper.paper_id, record: paper, revision: "revision-paper" }])), { headers: { "Content-Type": "application/json" } });
      if (url.endsWith(`/records/papers/${paper.paper_id}`) && !init?.method) return new Response(JSON.stringify(readEnvelope(paper)), { headers: { "Content-Type": "application/json" } });
      if (url.includes("source-file")) return new Response(JSON.stringify(sourceEnvelope()), { headers: { "Content-Type": "application/json" } });
      if (url.includes("text-extraction") && init?.method === "POST") return pendingExtraction;
      if (url.includes("text-extraction")) return new Response(JSON.stringify(extractionEnvelope("not_run")), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPapers();
    await user.click(await screen.findByRole("button", { name: "Open paper" }));
    await user.click(await screen.findByRole("button", { name: "Extract text" }));
    expect(screen.getByTestId("paper-extraction-processing")).toHaveTextContent("Extracting text locally");
    releaseExtraction(new Response(JSON.stringify(extractionEnvelope("completed", completedExtraction)), { headers: { "Content-Type": "application/json" } }));
    expect(await screen.findByTestId("paper-extraction-status")).toHaveTextContent("Text extracted locally");
  });

  it("shows a stale extraction and keeps an extraction failure explicit", async () => {
    const staleExtraction = { ...completedExtraction, status: "stale" as const, source_sha256: "c".repeat(64) };
    let fail = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/records/papers?") && !init?.method) return new Response(JSON.stringify(listEnvelope([{ record_id: paper.paper_id, record: paper, revision: "revision-paper" }])), { headers: { "Content-Type": "application/json" } });
      if (url.endsWith(`/records/papers/${paper.paper_id}`) && !init?.method) return new Response(JSON.stringify(readEnvelope(paper)), { headers: { "Content-Type": "application/json" } });
      if (url.includes("source-file")) return new Response(JSON.stringify(sourceEnvelope()), { headers: { "Content-Type": "application/json" } });
      if (url.includes("text-extraction") && init?.method === "POST" && fail) return new Response(JSON.stringify({ detail: "The PDF changed during extraction." }), { status: 409, headers: { "Content-Type": "application/json" } });
      if (url.includes("text-extraction")) return new Response(JSON.stringify(extractionEnvelope("stale", staleExtraction)), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPapers();
    await user.click(await screen.findByRole("button", { name: "Open paper" }));
    expect(await screen.findByTestId("paper-extraction-status")).toHaveTextContent("stale");
    fail = true;
    await user.click(screen.getByRole("button", { name: "Re-extract text" }));
    expect(await screen.findByTestId("paper-extraction-error")).toHaveTextContent("changed during extraction");
    expect(screen.queryByTestId("paper-extraction-status")).not.toBeInTheDocument();
  });

  it("requires confirmation for replacement and keeps the selected file after an import error", async () => {
    let failImport = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/records/papers?") && !init?.method) return new Response(JSON.stringify(listEnvelope([{ record_id: paper.paper_id, record: paper, revision: "revision-paper" }])), { headers: { "Content-Type": "application/json" } });
      if (url.includes("source-file") && init?.method === "POST" && failImport) return new Response(JSON.stringify({ detail: "The selected file does not have a PDF signature." }), { status: 400, headers: { "Content-Type": "application/json" } });
      if (url.includes("source-file") && init?.method === "POST") return new Response(JSON.stringify({ ...sourceEnvelope(), paper: { ...paper, pdf_access_status: "pdf_ready", local_pdf_path: "papers/paper-ui/source/original.pdf" }, paper_revision: "revision-replaced", recovery_backup_id: "backup-test" }), { headers: { "Content-Type": "application/json" } });
      if (url.includes("source-file")) return new Response(JSON.stringify(sourceEnvelope()), { headers: { "Content-Type": "application/json" } });
      if (url.includes("/records/papers/paper-ui")) return new Response(JSON.stringify(readEnvelope(paper)), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ detail: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPapers();
    await user.click(await screen.findByRole("button", { name: "Open paper" }));
    await screen.findByTestId("paper-source-status");
    const file = new File(["%PDF-1.7 replacement"], "replacement.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("paper-source-file-input"), file);
    await user.click(screen.getByRole("button", { name: "Replace PDF" }));
    const replaceDialog = screen.getByRole("dialog", { name: "Replace the stored PDF?" });
    expect(replaceDialog).toBeInTheDocument();
    await user.click(within(replaceDialog).getByRole("button", { name: "Replace PDF" }));
    expect(await screen.findByText(/does not have a PDF signature/)).toBeInTheDocument();
    expect(screen.getByTestId("paper-source-preview")).toHaveTextContent("replacement.pdf");
    failImport = false;
    await user.click(screen.getByRole("button", { name: "Replace PDF" }));
    const secondReplaceDialog = screen.getByRole("dialog", { name: "Replace the stored PDF?" });
    await user.click(within(secondReplaceDialog).getByRole("button", { name: "Replace PDF" }));
    expect(await screen.findByTestId("paper-source-status")).toBeInTheDocument();
  });

  it("treats an in-memory PDF selection as dirty navigation state", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/records/papers?") ) return new Response(JSON.stringify(listEnvelope([{ record_id: paper.paper_id, record: paper, revision: "revision-paper" }])), { headers: { "Content-Type": "application/json" } });
      if (url.includes("/records/papers/paper-ui")) return new Response(JSON.stringify(readEnvelope(paper)), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ detail: "No local PDF" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }));
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<PapersPage project={project} companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId="workspace-ui" workspaceState="connected" connectionState="online" onNavigate={onNavigate} onDirtyChange={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Open paper" }));
    await screen.findByTestId("paper-source-empty");
    await user.upload(screen.getByTestId("paper-source-file-input"), new File(["%PDF-1.7"], "draft.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Back to Project Overview" }));
    expect(screen.getByRole("dialog", { name: "Leave paper editor?" })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
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
