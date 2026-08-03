import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAPER_SUMMARY_HISTORY_VISIBLE_LIMIT, PaperSummarySection } from "./paperSummary";
import type { PaperRecord, ProcessingRecord } from "./companionClient";

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
  current_context_fingerprint: "2".repeat(64),
  cache_available: false,
  cached_processing_id: null
};

function record(status: "queued" | "running" | "completed" | "failed" | "cancelled" = "completed", cacheDisposition: "cache_miss" | "cache_hit" = "cache_miss", overrides: Partial<ProcessingRecord> = {}): ProcessingRecord {
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
    retry_of_processing_id: undefined,
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
    invalidated: false,
    ...overrides
  };
}

function envelope(next = record()) {
  return { schema_version: "task0.v1", workspace_id: "workspace-summary-ui", record: next, revision: "4".repeat(64), reused_active: false };
}

function installFetch(options: { eligible?: boolean; initial?: ReturnType<typeof record>; history?: Array<ReturnType<typeof record>>; afterStart?: ReturnType<typeof record>; retryRecord?: ReturnType<typeof record>; retryTerminalRecord?: ReturnType<typeof record>; deferRefresh?: boolean; cacheAvailable?: boolean; currentContextFingerprint?: string } = {}) {
  const calls: string[] = [];
  let cancelled = false;
  let listed = options.initial ?? null;
  let historyRecords = options.history ? [...options.history] : options.initial ? [options.initial] : [];
  let listCalls = 0;
  let preflightCalls = 0;
  let retryReads = 0;
  let releaseRefresh: () => void = () => {};
  const refreshGate = options.deferRefresh ? new Promise<void>((resolve) => { releaseRefresh = resolve; }) : null;
  let cacheAvailable = options.cacheAvailable ?? (options.initial?.status === "completed" && !options.initial.stale && !options.initial.invalidated);
  const retain = (next: ReturnType<typeof record>) => {
    historyRecords = historyRecords.some((entry) => entry.processing_id === next.processing_id)
      ? historyRecords.map((entry) => entry.processing_id === next.processing_id ? next : entry)
      : [next, ...historyRecords];
  };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/preflight")) {
      preflightCalls += 1;
      if (refreshGate && preflightCalls > 1) await refreshGate;
      return new Response(JSON.stringify(options.eligible === false ? { ...preflight, eligible: false, reason_code: "extraction_required", message: "Run local extraction successfully before requesting a summary." } : { ...preflight, current_context_fingerprint: options.currentContextFingerprint ?? preflight.current_context_fingerprint, cache_available: cacheAvailable }), { status: 200 });
    }
    if (url.endsWith("/ai-summary/records") && !url.includes("processing-summary-ui")) {
      listCalls += 1;
      if (refreshGate && listCalls > 1) await refreshGate;
      const current = cancelled ? record("cancelled") : listed;
      if (current && !historyRecords.some((entry) => entry.processing_id === current.processing_id)) retain(current);
      return new Response(JSON.stringify({ schema_version: "task0.v1", workspace_id: "workspace-summary-ui", records: historyRecords.map((next) => ({ record_id: next.processing_id, record: next, revision: "4".repeat(64), relative_path: `activity/processing/${next.processing_id}.json` })) }), { status: 200 });
    }
    if (url.endsWith("/cancel")) { cancelled = true; const next = record("cancelled"); retain(next); return new Response(JSON.stringify(envelope(next)), { status: 200 }); }
    if (url.endsWith("/start")) {
      listed = options.afterStart ?? record("queued");
      retain(listed);
      cacheAvailable = listed.status === "completed";
      return new Response(JSON.stringify(envelope(listed)), { status: 200 });
    }
    if (url.endsWith("/retry")) {
      listed = options.retryRecord ?? { ...record("queued"), processing_id: "processing-summary-retry", retry_of_processing_id: "processing-summary-ui", output: null, output_fingerprint: null, completed_at: null };
      retain(listed);
      return new Response(JSON.stringify(envelope(listed)), { status: 200 });
    }
    if (url.includes("/records/processing-summary-retry")) {
      retryReads += 1;
      const current = retryReads === 1 ? options.retryRecord ?? listed : options.retryTerminalRecord ?? listed;
      if (retryReads > 1 && current) { listed = current; retain(current); }
      return new Response(JSON.stringify(envelope(current ?? record("queued"))), { status: 200 });
    }
    if (url.includes("/records/processing-summary-ui")) return new Response(JSON.stringify(envelope(cancelled ? record("cancelled") : listed ?? record())), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
  return { calls, fetchMock, releaseRefresh };
}

function renderSummary(sourceContextVersion = "paper-context-1") {
  return render(<PaperSummarySection paper={paper} companionUrl="http://127.0.0.1:8765" sessionToken="memory-session" workspaceId="workspace-summary-ui" projectId="project-summary-ui" paperRevision={"5".repeat(64)} sourceContextVersion={sourceContextVersion} workspaceState="connected" connectionState="online" />);
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

  it("tracks retry by its new processing ID and does not show output while queued", async () => {
    const user = userEvent.setup();
    const failed = {
      ...record("failed"),
      output: null,
      output_fingerprint: null,
      error: { category: "invalid_output", message: "The provider returned an unsupported paper summary contract." }
    };
    const queued = {
      ...record("queued"),
      processing_id: "processing-summary-retry",
      retry_of_processing_id: failed.processing_id,
      output: null,
      output_fingerprint: null,
      completed_at: null,
      error: null
    };
    const completed = {
      ...record("completed"),
      processing_id: queued.processing_id,
      retry_of_processing_id: failed.processing_id
    };
    const { calls } = installFetch({ initial: failed, retryRecord: queued, retryTerminalRecord: completed });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    await user.click(await within(summary).findByRole("button", { name: "Retry summary" }));
    await waitFor(() => expect(within(summary).getByTestId("paper-summary-processing-status")).toHaveTextContent("Latest request: queued"));
    expect(within(summary).queryByTestId("paper-summary-output")).not.toBeInTheDocument();
    expect(calls.some((call) => call.includes("POST") && call.includes("/records/processing-summary-ui/retry"))).toBe(true);
    expect(await within(summary).findByTestId("paper-summary-output")).toHaveTextContent("A concise summary");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-ui")).toHaveAttribute("data-status", "failed");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-ui")).toHaveAttribute("data-cache-disposition", "cache_miss");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-retry")).toHaveAttribute("data-status", "completed");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-retry")).toHaveAttribute("data-cache-disposition", "cache_miss");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-retry")).toHaveAttribute("data-retry-of-processing-id", "processing-summary-ui");
  });

  it("scopes history status and cache assertions to exact processing records", async () => {
    const failed = { ...record("failed"), processing_id: "processing-summary-failed" };
    const cancelled = { ...record("cancelled"), processing_id: "processing-summary-cancelled" };
    const stale = { ...record("completed"), processing_id: "processing-summary-stale", stale: true };
    installFetch({ initial: failed, history: [failed, cancelled, stale] });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    await within(summary).findByTestId("paper-summary-history-event-processing-summary-failed");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-failed")).toHaveAttribute("data-status", "failed");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-failed")).toHaveAttribute("data-cache-disposition", "cache_miss");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-cancelled")).toHaveAttribute("data-status", "cancelled");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-cancelled")).toHaveAttribute("data-cache-disposition", "cache_miss");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-stale")).toHaveAttribute("data-status", "completed");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-stale")).toHaveAttribute("data-stale", "true");
    expect(within(summary).getByTestId("paper-summary-history-event-processing-summary-stale")).toHaveAttribute("data-invalidated", "false");
  });

  it("renders a deterministic six-event window while retaining larger durable history", async () => {
    const history = Array.from({ length: PAPER_SUMMARY_HISTORY_VISIBLE_LIMIT + 1 }, (_, index) => record(
      "completed",
      "cache_miss",
      {
        processing_id: `processing-summary-history-${index}`,
        requested_at: `2026-07-31T12:00:0${index}Z`,
        updated_at: "2026-07-31T12:00:10Z"
      }
    ));
    installFetch({ initial: history[0], history });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    const historyPanel = await within(summary).findByTestId("paper-summary-history");
    expect(historyPanel).toHaveAttribute("data-history-total-count", "7");
    expect(historyPanel).toHaveAttribute("data-history-visible-count", "6");
    expect(historyPanel).toHaveAttribute("data-history-visible-limit", "6");
    const visibleRows = within(historyPanel).getAllByTestId(/^paper-summary-history-event-/);
    expect(visibleRows).toHaveLength(PAPER_SUMMARY_HISTORY_VISIBLE_LIMIT);
    expect(visibleRows.map((row) => row.getAttribute("data-processing-id"))).toEqual([
      "processing-summary-history-6",
      "processing-summary-history-5",
      "processing-summary-history-4",
      "processing-summary-history-3",
      "processing-summary-history-2",
      "processing-summary-history-1"
    ]);
    expect(within(historyPanel).getByTestId("paper-summary-history-event-processing-summary-history-6")).toBeVisible();
    expect(within(historyPanel).queryByTestId("paper-summary-history-event-processing-summary-history-0")).not.toBeInTheDocument();
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

  it("does not label a completed output available when companion applicability changes", async () => {
    installFetch({ initial: record("completed"), currentContextFingerprint: "9".repeat(64) });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    expect(await within(summary).findByTestId("paper-summary-output")).toHaveTextContent("A concise summary");
    expect(summary).toHaveTextContent("Not current");
    expect(summary).not.toHaveTextContent("Available");
  });

  it("separates invalidated record history from current applicability", async () => {
    const invalidated = record("completed", "cache_miss", {
      invalidated: true,
      cache_disposition: "invalidated",
      provenance: { source_type: "paper_extraction", cache_disposition: "invalidated" }
    });
    installFetch({ initial: invalidated });
    renderSummary();
    const summary = screen.getByTestId("paper-summary-section");
    const processingStatus = await within(summary).findByTestId("paper-summary-processing-status");
    const historyEvent = await within(summary).findByTestId(`paper-summary-history-event-${invalidated.processing_id}`);
    expect(processingStatus).toHaveTextContent("Latest request: Not current");
    expect(processingStatus).not.toHaveTextContent("Available");
    expect(historyEvent).toHaveAttribute("data-processing-id", invalidated.processing_id);
    expect(historyEvent).toHaveAttribute("data-status", "completed");
    expect(historyEvent).toHaveAttribute("data-cache-disposition", "invalidated");
    expect(historyEvent).toHaveAttribute("data-invalidated", "true");
    expect(historyEvent).toHaveTextContent("Invalidated");
    expect(within(summary).queryByRole("button", { name: "Use cached summary" })).not.toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: "Generate summary" })).toBeVisible();
    expect(within(summary).queryByTestId("paper-summary-output")).not.toBeInTheDocument();
  });

  it("refreshes applicability when a source context prop changes and ignores an older response", async () => {
    let releaseOld: (() => void) | undefined;
    let preflightCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/preflight")) {
        preflightCalls += 1;
        if (preflightCalls === 1) await new Promise<void>((resolve) => { releaseOld = resolve; });
        return new Response(JSON.stringify({ ...preflight, current_context_fingerprint: preflightCalls === 1 ? "2".repeat(64) : "9".repeat(64) }), { status: 200 });
      }
      if (url.endsWith("/ai-summary/records")) return new Response(JSON.stringify({ schema_version: "task0.v1", workspace_id: "workspace-summary-ui", records: [{ record_id: "processing-summary-ui", record: record("completed"), revision: "4".repeat(64), relative_path: "activity/processing/processing-summary-ui.json" }] }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const view = renderSummary("paper-context-1");
    view.rerender(<PaperSummarySection paper={paper} companionUrl="http://127.0.0.1:8765" sessionToken="memory-session" workspaceId="workspace-summary-ui" projectId="project-summary-ui" paperRevision={"5".repeat(64)} sourceContextVersion="paper-context-2" workspaceState="connected" connectionState="online" />);
    releaseOld?.();
    const summary = screen.getByTestId("paper-summary-section");
    await waitFor(() => expect(summary).toHaveTextContent("Not current"));
    expect(summary).not.toHaveTextContent("Available");
    expect(preflightCalls).toBe(2);
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
