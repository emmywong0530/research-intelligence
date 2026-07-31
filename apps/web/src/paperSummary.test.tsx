import { render, screen, waitFor, within } from "@testing-library/react";
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

function record(status: "queued" | "running" | "completed" | "failed" | "cancelled" = "completed", cacheDisposition: "cache_miss" | "cache_hit" = "cache_miss") {
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
    cache_disposition: cacheDisposition,
    status,
    requested_at: "2026-07-31T12:00:00Z",
    started_at: status === "queued" ? null : "2026-07-31T12:00:00Z",
    completed_at: status === "completed" || status === "failed" || status === "cancelled" ? "2026-07-31T12:00:01Z" : null,
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

function installFetch(options: { eligible?: boolean; initial?: ReturnType<typeof record>; afterStart?: ReturnType<typeof record>; deferRefresh?: boolean; cacheAvailable?: boolean } = {}) {
  const calls: string[] = [];
  let cancelled = false;
  let listed = options.initial ?? null;
  let listCalls = 0;
  let preflightCalls = 0;
  let releaseRefresh: () => void = () => {};
  const refreshGate = options.deferRefresh ? new Promise<void>((resolve) => { releaseRefresh = resolve; }) : null;
  let cacheAvailable = options.cacheAvailable ?? (options.initial?.status === "completed" && !options.initial.stale && !options.initial.invalidated);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/preflight")) {
      preflightCalls += 1;
      if (refreshGate && preflightCalls > 1) await refreshGate;
      return new Response(JSON.stringify(options.eligible === false ? { ...preflight, eligible: false, reason_code: "extraction_required", message: "Run local extraction successfully before requesting a summary." } : { ...preflight, cache_available: cacheAvailable }), { status: 200 });
    }
    if (url.endsWith("/ai-summary/records") && !url.includes("processing-summary-ui")) {
      listCalls += 1;
      if (refreshGate && listCalls > 1) await refreshGate;
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
  return { calls, fetchMock, releaseRefresh };
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

  it("renders a completed cache-miss output even when preflight cannot reuse a cache", async () => {
    installFetch({ initial: record("completed"), cacheAvailable: false });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    expect(await within(summary).findByTestId("paper-summary-output")).toHaveTextContent("A concise summary");
    expect(summary).toHaveTextContent("Available");
    expect(summary).not.toHaveTextContent("Not applied");
  });

  it("renders completed cache-hit output while keeping reuse availability separate", async () => {
    installFetch({ initial: record("completed", "cache_hit") });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    expect(await within(summary).findByTestId("paper-summary-output")).toHaveTextContent("A concise summary");
    expect(summary).toHaveTextContent("Available");
  });

  it("keeps a cancelled request visible in durable history", async () => {
    const user = userEvent.setup();
    installFetch({ initial: record("running") });
    renderSummary();
    await screen.findByRole("button", { name: "Cancel summary" });
    await user.click(screen.getByRole("button", { name: "Cancel summary" }));
    await waitFor(() => expect(screen.getByTestId("paper-summary-history")).toHaveTextContent("cancelled"));
  });

  it("shows the safe invalid-output message, preserves failed history and offers retry", async () => {
    const user = userEvent.setup();
    const invalidOutput = {
      ...record("cancelled"),
      status: "failed" as const,
      completed_at: "2026-07-31T12:00:02Z",
      output: null,
      output_fingerprint: null,
      error: {
        category: "invalid_output",
        message: "The provider returned an unsupported paper summary contract."
      }
    };
    installFetch({ afterStart: invalidOutput });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    const summaryQueries = within(summary);
    await user.click(await screen.findByRole("button", { name: "Generate summary" }));
    await user.click(screen.getByRole("button", { name: "Confirm and generate" }));
    const processingStatus = summaryQueries.getByTestId("paper-summary-processing-status");
    await waitFor(() => expect(processingStatus).toHaveTextContent("Latest request: failed"));
    expect(processingStatus).toHaveTextContent("The provider returned an unsupported paper summary contract.");
    expect(summaryQueries.getByTestId("paper-summary-history")).toHaveTextContent("failed");
    expect(summaryQueries.getByTestId("paper-summary-history")).toHaveTextContent("cache_miss");
    expect(screen.getByRole("button", { name: "Retry summary" })).toBeVisible();
    expect(summary).not.toHaveTextContent("synthetic output");
    expect(summary).not.toHaveTextContent("provider_request_id");
  });

  it("keeps source-check and processing-result live regions uniquely addressable", async () => {
    const user = userEvent.setup();
    const invalidOutput = {
      ...record("cancelled"),
      status: "failed" as const,
      completed_at: "2026-07-31T12:00:02Z",
      output: null,
      output_fingerprint: null,
      error: { category: "invalid_output", message: "The provider returned an unsupported paper summary contract." }
    };
    const { releaseRefresh } = installFetch({ afterStart: invalidOutput, deferRefresh: true });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    await user.click(await screen.findByRole("button", { name: "Generate summary" }));
    await user.click(screen.getByRole("button", { name: "Confirm and generate" }));
    const processingStatus = await within(summary).findByTestId("paper-summary-processing-status");
    await waitFor(() => expect(processingStatus).toHaveTextContent("Latest request: failed"));
    expect(within(summary).getByText("Checking summary source…")).toBeVisible();
    expect(within(summary).getAllByRole("status")).toHaveLength(2);
    expect(within(summary).getByRole("button", { name: "Retry summary" })).toBeVisible();
    releaseRefresh();
  });

  it("shows an honest ineligible state and does not offer a generation action", async () => {
    installFetch({ eligible: false });
    renderSummary();
    expect(await screen.findByTestId("paper-summary-ineligible")).toHaveTextContent("Run local extraction");
    expect(screen.queryByRole("button", { name: "Generate summary" })).not.toBeInTheDocument();
  });

  it("keeps stale completed output readable while marking it unavailable for reuse", async () => {
    installFetch({ initial: { ...record("completed"), stale: true } });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    expect(await within(summary).findByTestId("paper-summary-output")).toHaveTextContent("A concise summary");
    expect(summary).toHaveTextContent("Stale source");
    expect(summary).not.toHaveTextContent("Use cached summary");
  });

  it("keeps completed output visible while a preflight refresh is loading", async () => {
    const user = userEvent.setup();
    const { releaseRefresh } = installFetch({ initial: record("completed"), deferRefresh: true });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    expect(await within(summary).findByTestId("paper-summary-output")).toHaveTextContent("A concise summary");
    await user.click(within(summary).getByRole("button", { name: "Refresh" }));
    expect(within(summary).getByText("Checking summary source…")).toBeVisible();
    expect(within(summary).getByTestId("paper-summary-output")).toHaveTextContent("A concise summary");
    releaseRefresh();
  });

  it("does not render output for failed, cancelled, invalidated or malformed records", async () => {
    for (const next of [
      record("failed"),
      record("cancelled"),
      { ...record("completed"), invalidated: true },
      { ...record("completed"), output: { contract_id: "unsupported.v1" } as never },
      { ...record("completed"), output: { contract_id: "paper-summary.v1", summary: "missing arrays" } as never }
    ]) {
      installFetch({ initial: next });
      const view = renderSummary();
      const summary = view.getByTestId("paper-summary-section");
      await within(summary).findByTestId("paper-summary-history");
      expect(within(summary).queryByTestId("paper-summary-output")).not.toBeInTheDocument();
      view.unmount();
      vi.restoreAllMocks();
    }
  });

  it("keeps a newly completed active record when a later refresh temporarily lists an older record", async () => {
    const completed = record("completed");
    const older = { ...completed, processing_id: "processing-older", updated_at: "2026-07-30T12:00:01Z", requested_at: "2026-07-30T12:00:00Z" };
    let listCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/preflight")) return new Response(JSON.stringify(preflight), { status: 200 });
      if (url.endsWith("/ai-summary/records")) {
        listCalls += 1;
        const listed = listCalls === 1 ? completed : older;
        return new Response(JSON.stringify({ schema_version: "task0.v1", workspace_id: "workspace-summary-ui", records: [{ record_id: listed.processing_id, record: listed, revision: "4".repeat(64), relative_path: `activity/processing/${listed.processing_id}.json` }] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    expect(await within(summary).findByTestId("paper-summary-output")).toHaveTextContent("A concise summary");
    await userEvent.setup().click(within(summary).getByRole("button", { name: "Refresh" }));
    expect(within(summary).getByTestId("paper-summary-output")).toHaveTextContent("A concise summary");
    expect(listCalls).toBe(2);
  });

  it("does not use browser storage for source or summary state", async () => {
    installFetch({ afterStart: record("completed") });
    renderSummary();
    await screen.findByTestId("paper-summary-source");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
