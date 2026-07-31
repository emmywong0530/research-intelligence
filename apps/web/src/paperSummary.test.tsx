import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperSummarySection } from "./paperSummary";
import type { PaperRecord } from "./companionClient";

const paper: PaperRecord = {
  schema_version: "m2.v1",
  paper_id: "paper-summary-ui",
  title: "A paper selected for summary",
  authors: ["A. Researcher"],
  assigned_project_ids: ["project-summary-ui"],
  created_at: "2026-07-31T12:00:00Z",
  updated_at: "2026-07-31T12:00:00Z"
};

const preflight = {
  schema_version: "task0.v1",
  workspace_id: "workspace-summary-ui",
  project_id: "project-summary-ui",
  paper_id: paper.paper_id,
  eligible: true,
  reason_code: null,
  message: "Ready for explicit confirmation.",
  title: paper.title,
  source_type: "local_extracted_text",
  source_sha256: "a".repeat(64),
  extraction_id: "extraction-summary-ui",
  extraction_status: "completed",
  page_count: 2,
  included_page_count: 2,
  included_characters: 1400,
  truncated: false,
  metadata_fields: ["authors", "title"],
  provider: "openai-compatible",
  model: "gpt-4o-mini",
  cache_available: false,
  cached_processing_id: null
};

function record(status: "queued" | "running" | "completed" | "cancelled" = "completed") {
  return {
    schema_version: "m5b.v1",
    processing_id: "processing-summary-ui",
    workspace_id: "workspace-summary-ui",
    project_id: "project-summary-ui",
    paper_id: paper.paper_id,
    operation_id: "paper_summary" as const,
    operation_type: "paper_summary" as const,
    prompt_id: "paper.summary",
    prompt_version: "1.0.0",
    prompt_fingerprint: "b".repeat(64),
    provider_type: "fake" as const,
    model: "gpt-4o-mini",
    parameters: { temperature: 0.2, max_output_tokens: 512 },
    input_fingerprint: "c".repeat(64),
    source_snapshot: {
      source_type: "paper_extraction" as const,
      project_id: "project-summary-ui",
      paper_id: paper.paper_id,
      source_id: "source-summary-ui",
      source_sha256: "a".repeat(64),
      extraction_id: "extraction-summary-ui",
      extraction_full_text_sha256: "d".repeat(64),
      extraction_status: "completed" as const,
      preparation_version: "paper-summary-source.v1",
      page_count: 2,
      included_page_count: 2,
      included_characters: 1400,
      truncated: false,
      metadata_fingerprint: "e".repeat(64),
      prepared_text_fingerprint: "f".repeat(64)
    },
    source_snapshot_fingerprint: "1".repeat(64),
    cache_key: "2".repeat(64),
    cache_disposition: "cache_miss" as const,
    status,
    requested_at: "2026-07-31T12:00:00Z",
    started_at: status === "queued" ? null : "2026-07-31T12:00:00Z",
    completed_at: status === "completed" || status === "cancelled" ? "2026-07-31T12:00:01Z" : null,
    updated_at: "2026-07-31T12:00:01Z",
    attempt_count: 1,
    output: status === "completed" ? {
      contract_id: "paper-summary.v1" as const,
      summary: "A concise summary from the local extracted paper.",
      key_points: ["The source was selected explicitly."],
      limitations: ["This is a test-provider result."],
      open_questions: ["Check the source paper."]
    } : null,
    output_fingerprint: status === "completed" ? "3".repeat(64) : null,
    usage: null,
    provenance: { source_type: "paper_extraction" },
    error: status === "cancelled" ? { category: "cancelled", message: "Cancelled." } : null,
    stale: false,
    invalidated: false
  };
}

function envelope(next = record()) {
  return { schema_version: "task0.v1", workspace_id: "workspace-summary-ui", record: next, revision: "4".repeat(64), reused_active: false };
}

function installFetch(options: { eligible?: boolean; initial?: ReturnType<typeof record>; afterStart?: ReturnType<typeof record> } = {}) {
  const calls: string[] = [];
  let cancelled = false;
  let listed = options.initial ?? null;
  let cacheAvailable = options.initial?.status === "completed" && !options.initial.stale && !options.initial.invalidated;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/preflight")) return new Response(JSON.stringify(options.eligible === false ? { ...preflight, eligible: false, reason_code: "extraction_required", message: "Run local extraction successfully before requesting a summary." } : { ...preflight, cache_available: cacheAvailable }), { status: 200 });
    if (url.endsWith("/ai-summary/records") && !url.includes("processing-summary-ui")) {
      const current = cancelled ? record("cancelled") : listed;
      return new Response(JSON.stringify({ schema_version: "task0.v1", workspace_id: "workspace-summary-ui", records: current ? [{ record_id: current.processing_id, record: current, revision: "4".repeat(64), relative_path: "activity/processing/processing-summary-ui.json" }] : [] }), { status: 200 });
    }
    if (url.endsWith("/cancel")) { cancelled = true; return new Response(JSON.stringify(envelope(record("cancelled"))), { status: 200 }); }
    if (url.endsWith("/start")) {
      listed = options.afterStart ?? record("queued");
      cacheAvailable = listed.status === "completed";
      return new Response(JSON.stringify(envelope(listed)), { status: 200 });
    }
    if (url.includes("/records/processing-summary-ui")) return new Response(JSON.stringify(envelope(cancelled ? record("cancelled") : listed ?? record())), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
  return { calls, fetchMock };
}

function renderSummary() {
  return render(<PaperSummarySection paper={paper} companionUrl="http://127.0.0.1:8765" sessionToken="memory-session" workspaceId="workspace-summary-ui" projectId="project-summary-ui" paperRevision={"5".repeat(64)} workspaceState="connected" connectionState="online" />);
}

afterEach(() => vi.restoreAllMocks());

describe("PaperSummarySection", () => {
  it("requires explicit confirmation and displays the validated summary output", async () => {
    const user = userEvent.setup();
    const { calls } = installFetch({ afterStart: record("completed") });
    renderSummary();
    await screen.findByTestId("paper-summary-source");
    await user.click(screen.getByRole("button", { name: "Generate summary" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Requires your approval");
    expect(calls.some((call) => call.includes("/start"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirm and generate" }));
    expect(await screen.findByTestId("paper-summary-output")).toHaveTextContent("A concise summary");
    expect(calls.some((call) => call.includes("POST") && call.includes("/start"))).toBe(true);
  });

  it("keeps a cancelled request visible in durable history", async () => {
    const user = userEvent.setup();
    installFetch({ initial: record("running") });
    renderSummary();
    await screen.findByRole("button", { name: "Cancel summary" });
    await user.click(screen.getByRole("button", { name: "Cancel summary" }));
    await waitFor(() => expect(screen.getByTestId("paper-summary-history")).toHaveTextContent("cancelled"));
  });

  it("shows an honest ineligible state and does not offer a generation action", async () => {
    installFetch({ eligible: false });
    renderSummary();
    expect(await screen.findByTestId("paper-summary-ineligible")).toHaveTextContent("Run local extraction");
    expect(screen.queryByRole("button", { name: "Generate summary" })).not.toBeInTheDocument();
  });

  it("does not present a stale completed output as the current summary", async () => {
    installFetch({ initial: { ...record("completed"), stale: true } });
    renderSummary();
    await screen.findByTestId("paper-summary-history");
    expect(screen.queryByTestId("paper-summary-output")).not.toBeInTheDocument();
    expect(screen.getByTestId("paper-summary-section")).toHaveTextContent("Stale source");
  });

  it("does not use browser storage for source or summary state", async () => {
    installFetch({ afterStart: record("completed") });
    renderSummary();
    await screen.findByTestId("paper-summary-source");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
