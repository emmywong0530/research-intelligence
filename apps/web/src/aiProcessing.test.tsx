import { act, fireEvent, screen, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProcessingPanel } from "./aiProcessing";

const operation = {
  operation_id: "provider_echo_test",
  operation_type: "provider_echo_test",
  title: "Synthetic provider processing test",
  description: "A fixed acknowledgement.",
  prompt_id: "task5b.provider_echo_test",
  prompt_version: "1.0.0",
  output_contract: "task5b.provider_echo_ack.v1",
  required_capabilities: ["generation", "structured_output"],
  source_type: "synthetic",
  availability: "test_only"
};

const prompt = {
  prompt_id: "task5b.provider_echo_test",
  version: "1.0.0",
  operation_id: "provider_echo_test",
  operation_type: "provider_echo_test",
  title: "Synthetic provider processing test",
  description: "A fixed acknowledgement.",
  variables: ["synthetic_input_version"],
  output_contract: "task5b.provider_echo_ack.v1",
  required_capabilities: ["generation", "structured_output"],
  max_input_characters: 120,
  prompt_fingerprint: "a".repeat(64)
};

const record = {
  schema_version: "m5b.v1",
  processing_id: "processing-test",
  workspace_id: "workspace-test",
  operation_id: "provider_echo_test",
  operation_type: "provider_echo_test",
  prompt_id: "task5b.provider_echo_test",
  prompt_version: "1.0.0",
  prompt_fingerprint: "a".repeat(64),
  provider_type: "fake",
  model: "gpt-4o-mini",
  parameters: { temperature: 0, max_output_tokens: 64 },
  input_fingerprint: "b".repeat(64),
  source_snapshot: { source_type: "synthetic", synthetic_input_version: "v1" },
  source_snapshot_fingerprint: "f".repeat(64),
  cache_key: "c".repeat(64),
  cache_disposition: "cache_miss",
  status: "completed",
  requested_at: "2026-07-31T01:00:00Z",
  started_at: "2026-07-31T01:00:00Z",
  completed_at: "2026-07-31T01:00:01Z",
  updated_at: "2026-07-31T01:00:01Z",
  attempt_count: 1,
  output: {
    contract_id: "task5b.provider_echo_ack.v1",
    acknowledgement: "Synthetic provider processing completed.",
    synthetic_input_version: "v1"
  },
  output_fingerprint: "d".repeat(64),
  usage: { input_tokens: 7, output_tokens: 6 },
  provenance: { source_type: "synthetic" },
  error: null,
  stale: false,
  invalidated: false
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

type TestOutput = { contract_id: string; acknowledgement: string; synthetic_input_version: string };
type TestError = { category: string; message: string };
type TestRecord = Omit<typeof record, "status" | "started_at" | "completed_at" | "output" | "error" | "source_snapshot"> & {
  status: string;
  started_at: string | null;
  completed_at: string | null;
  output: TestOutput | null;
  error: TestError | null;
  source_snapshot: typeof record.source_snapshot;
};

type TestRecordOverrides = Partial<Omit<TestRecord, "source_snapshot">> & {
  source_snapshot?: Partial<typeof record.source_snapshot>;
};

function makeRecord(overrides: TestRecordOverrides = {}): TestRecord {
  return {
    ...record,
    ...overrides,
    source_snapshot: { ...record.source_snapshot, ...(overrides.source_snapshot ?? {}) }
  };
}

function recordEnvelope(nextRecord: TestRecord) {
  return { schema_version: "task0.v1", workspace_id: "workspace-test", record: nextRecord, revision: "e".repeat(64) };
}

function installFrameworkFetch(options: {
  startRecord?: TestRecord;
  detailRecords?: TestRecord[];
  listedRecords?: TestRecord[];
}) {
  const startRecord = options.startRecord ?? record;
  const detailRecords = options.detailRecords ?? [startRecord];
  let detailIndex = 0;
  const readCounts = new Map<string, number>();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/operations")) return json({ schema_version: "task0.v1", operations: [operation] });
    if (url.endsWith("/prompts")) return json({ schema_version: "task0.v1", prompts: [prompt] });
    if (url.endsWith("/records") && !init?.method) {
      return json({
        schema_version: "task0.v1",
        workspace_id: "workspace-test",
        records: (options.listedRecords ?? []).map((item) => ({ record_id: item.processing_id, record: item, revision: "e".repeat(64), relative_path: `activity/processing/${item.processing_id}.json` }))
      });
    }
    if (url.endsWith("/start")) return json({ ...recordEnvelope(startRecord), reused_active: false });
    if (url.endsWith("/cancel")) {
      return json(recordEnvelope(makeRecord({ status: "cancelled", output: null, error: { category: "cancelled", message: "Processing cancelled." } })));
    }
    if (url.includes("/records/processing-test")) {
      const workspace = url.includes("workspace-next") ? "workspace-next" : "workspace-test";
      readCounts.set(workspace, (readCounts.get(workspace) ?? 0) + 1);
      const nextRecord = detailRecords[Math.min(detailIndex++, detailRecords.length - 1)];
      return json(recordEnvelope(nextRecord));
    }
    return json({ schema_version: "task0.v1", workspace_id: "workspace-test", records: [] });
  });
  return { fetchMock, readCounts };
}

async function waitForFramework(panelText = "Synthetic provider processing test") {
  expect(await screen.findByText(panelText)).toBeInTheDocument();
}

function connectedPanel(workspaceId = "workspace-test") {
  return <AiProcessingPanel companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId={workspaceId} connectionState="online" />;
}

async function clickElement(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advanceTimers(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe("Task 5B processing framework", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.useRealTimers());

  it("requires a connected workspace and does not use browser storage", () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<AiProcessingPanel companionUrl="http://127.0.0.1:8765" sessionToken="" workspaceId={null} connectionState="offline" />);
    expect(screen.getByText(/Connect a paired workspace/)).toBeInTheDocument();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it("shows the code-owned operation and starts the fixed synthetic record", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/operations")) return json({ schema_version: "task0.v1", operations: [operation] });
      if (url.endsWith("/prompts")) return json({ schema_version: "task0.v1", prompts: [prompt] });
      if (url.endsWith("/records") && !init?.method) return json({ schema_version: "task0.v1", workspace_id: "workspace-test", records: [] });
      if (url.endsWith("/start")) return json({ schema_version: "task0.v1", workspace_id: "workspace-test", record, revision: "e".repeat(64), reused_active: false });
      return json({ schema_version: "task0.v1", workspace_id: "workspace-test", record, revision: "e".repeat(64) });
    });
    render(connectedPanel());
    expect(await screen.findByText("Synthetic provider processing test")).toBeInTheDocument();
    expect(screen.getByText("task5b.provider_echo_test · v1.0.0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run synthetic processing test" }));
    expect(await screen.findByTestId("ai-processing-output")).toHaveTextContent("Synthetic provider processing completed.");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/ai/processing/start"), expect.objectContaining({ method: "POST", body: JSON.stringify({ synthetic_input_version: "v1" }) }));
  });

  it("renders unavailable test controls without exposing arbitrary prompt input", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/operations")) return json({ detail: { code: "processing_unavailable" } }, 404);
      return json({ schema_version: "task0.v1", operations: [], prompts: [], records: [] });
    });
    render(connectedPanel());
    await waitFor(() => expect(screen.getByText(/available only in the explicit test companion mode/i)).toBeInTheDocument());
    expect(screen.queryByRole("textbox", { name: /prompt/i })).not.toBeInTheDocument();
  });

  it("polls queued and running records sequentially, replaces history, and stops on completion", async () => {
    const queued = makeRecord({ status: "queued", output: null, started_at: null, completed_at: null, error: null });
    const running = makeRecord({ status: "running", output: null, completed_at: null, error: null });
    const completed = makeRecord({ status: "completed" });
    const { fetchMock, readCounts } = installFrameworkFetch({ startRecord: queued, detailRecords: [running, completed] });
    render(connectedPanel());
    await waitForFramework();
    vi.useFakeTimers();
    const runButton = screen.getByRole("button", { name: "Run synthetic processing test" });
    await clickElement(runButton);
    expect(runButton).toBeDisabled();
    expect(readCounts.get("workspace-test") ?? 0).toBe(0);

    await advanceTimers(250);
    expect(readCounts.get("workspace-test")).toBe(1);
    expect(screen.getByTestId("ai-processing-result")).toHaveTextContent("running");
    await advanceTimers(250);
    expect(readCounts.get("workspace-test")).toBe(2);
    expect(screen.getByTestId("ai-processing-result")).toHaveTextContent("completed");
    expect(within(screen.getByLabelText("Processing history")).getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("1 recorded test event")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/start"))).toHaveLength(1);
  });

  it.each(["completed", "failed", "cancelled"] as const)("stops polling when the record is %s", async (status) => {
    const terminal = makeRecord({
      status,
      output: status === "completed" ? record.output : null,
      error: status === "completed" ? null : { category: status, message: `Processing ${status}.` }
    });
    const { readCounts } = installFrameworkFetch({ startRecord: makeRecord({ status: "running", output: null, completed_at: null, error: null }), detailRecords: [terminal] });
    render(connectedPanel());
    await waitForFramework();
    vi.useFakeTimers();
    await clickElement(screen.getByRole("button", { name: "Run synthetic processing test" }));
    await advanceTimers(250);
    expect(readCounts.get("workspace-test")).toBe(1);
    await advanceTimers(1_000);
    expect(readCounts.get("workspace-test")).toBe(1);
    expect(screen.getByTestId("ai-processing-result")).toHaveTextContent(status);
  });

  it("does not overlap reads while a processing response is slow", async () => {
    const running = makeRecord({ status: "running", output: null, completed_at: null, error: null });
    const completed = makeRecord({ status: "completed" });
    let reads = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<() => void> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/operations")) return json({ schema_version: "task0.v1", operations: [operation] });
      if (url.endsWith("/prompts")) return json({ schema_version: "task0.v1", prompts: [prompt] });
      if (url.endsWith("/records") && !init?.method) return json({ schema_version: "task0.v1", workspace_id: "workspace-test", records: [] });
      if (url.endsWith("/start")) return json({ ...recordEnvelope(running), reused_active: false });
      if (url.includes("/records/processing-test")) {
        reads += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const responseRecord = reads === 1 ? running : completed;
        return new Promise<Response>((resolve) => {
          resolvers.push(() => {
            inFlight -= 1;
            resolve(json(recordEnvelope(responseRecord)));
          });
        });
      }
      return json({ schema_version: "task0.v1", workspace_id: "workspace-test", records: [] });
    });
    render(connectedPanel());
    await waitForFramework();
    vi.useFakeTimers();
    await clickElement(screen.getByRole("button", { name: "Run synthetic processing test" }));
    await advanceTimers(250);
    await advanceTimers(1_000);
    expect(reads).toBe(1);
    expect(maxInFlight).toBe(1);
    resolvers.shift()?.();
    await advanceTimers(0);
    await advanceTimers(250);
    expect(reads).toBe(2);
    expect(maxInFlight).toBe(1);
    resolvers.shift()?.();
    await advanceTimers(0);
    expect(screen.getByTestId("ai-processing-result")).toHaveTextContent("completed");
  });

  it("stops on unmount and workspace changes, clearing the old record", async () => {
    const running = makeRecord({ status: "running", output: null, completed_at: null, error: null });
    const { readCounts } = installFrameworkFetch({ startRecord: running, detailRecords: [running] });
    const view = render(connectedPanel());
    await waitForFramework();
    vi.useFakeTimers();
    await clickElement(screen.getByRole("button", { name: "Run synthetic processing test" }));
    view.rerender(connectedPanel("workspace-next"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(readCounts.get("workspace-test") ?? 0).toBe(0);
    expect(screen.queryByTestId("ai-processing-result")).not.toBeInTheDocument();
    view.unmount();
    await advanceTimers(1_000);
    expect(readCounts.get("workspace-next") ?? 0).toBe(0);
  });

  it("keeps cancellation authoritative when an older poll response arrives late", async () => {
    const running = makeRecord({ status: "running", output: null, completed_at: null, error: null });
    let resolveRead: (() => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/operations")) return json({ schema_version: "task0.v1", operations: [operation] });
      if (url.endsWith("/prompts")) return json({ schema_version: "task0.v1", prompts: [prompt] });
      if (url.endsWith("/records") && !init?.method) return json({ schema_version: "task0.v1", workspace_id: "workspace-test", records: [] });
      if (url.endsWith("/start")) return json({ ...recordEnvelope(running), reused_active: false });
      if (url.endsWith("/cancel")) return json(recordEnvelope(makeRecord({ status: "cancelled", output: null, error: { category: "cancelled", message: "Processing cancelled." } })));
      if (url.includes("/records/processing-test")) {
        return new Promise<Response>((resolve) => {
          resolveRead = () => resolve(json(recordEnvelope(running)));
        });
      }
      return json({ schema_version: "task0.v1", workspace_id: "workspace-test", records: [] });
    });
    render(connectedPanel());
    await waitForFramework();
    vi.useFakeTimers();
    await clickElement(screen.getByRole("button", { name: "Run synthetic processing test" }));
    await advanceTimers(250);
    await clickElement(screen.getByRole("button", { name: "Cancel processing" }));
    await advanceTimers(0);
    expect(screen.getByTestId("ai-processing-result")).toHaveTextContent("cancelled");
    resolveRead?.();
    await advanceTimers(0);
    expect(screen.getByTestId("ai-processing-result")).toHaveTextContent("cancelled");
  });

  it("ignores a late response after the selected processing ID changes", async () => {
    const first = makeRecord({ processing_id: "processing-test", status: "running", output: null, completed_at: null, error: null, source_snapshot: { synthetic_input_version: "v1" } });
    const second = makeRecord({ processing_id: "processing-next", status: "running", output: null, completed_at: null, error: null, source_snapshot: { synthetic_input_version: "v2" } });
    let listCalls = 0;
    let resolveFirst: (() => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/operations")) return json({ schema_version: "task0.v1", operations: [operation] });
      if (url.endsWith("/prompts")) return json({ schema_version: "task0.v1", prompts: [prompt] });
      if (url.endsWith("/records") && !init?.method) {
        listCalls += 1;
        return json({ schema_version: "task0.v1", workspace_id: "workspace-test", records: listCalls === 1 ? [] : [{ record_id: second.processing_id, record: second, revision: "e".repeat(64), relative_path: `activity/processing/${second.processing_id}.json` }] });
      }
      if (url.endsWith("/start")) return json({ ...recordEnvelope(first), reused_active: false });
      if (url.includes("/records/processing-test")) {
        return new Promise<Response>((resolve) => {
          resolveFirst = () => resolve(json(recordEnvelope(first)));
        });
      }
      return json(recordEnvelope(second));
    });
    const view = render(connectedPanel());
    await waitForFramework();
    vi.useFakeTimers();
    await clickElement(screen.getByRole("button", { name: "Run synthetic processing test" }));
    await advanceTimers(250);
    view.rerender(<AiProcessingPanel key="second-processing" companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId="workspace-test" connectionState="online" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("ai-processing-result")).toHaveTextContent("Source version: v2");
    resolveFirst?.();
    await advanceTimers(0);
    expect(screen.getByTestId("ai-processing-result")).toHaveTextContent("Source version: v2");
  });

  it("stops after session expiry and shows the safe re-pair message", async () => {
    const running = makeRecord({ status: "running", output: null, completed_at: null, error: null });
    const { readCounts, fetchMock } = installFrameworkFetch({ startRecord: running });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/records/processing-test")) {
        readCounts.set("workspace-test", (readCounts.get("workspace-test") ?? 0) + 1);
        return json({ detail: { code: "session_expired", message: "The companion session expired." } }, 401);
      }
      if (url.endsWith("/operations")) return json({ schema_version: "task0.v1", operations: [operation] });
      if (url.endsWith("/prompts")) return json({ schema_version: "task0.v1", prompts: [prompt] });
      if (url.endsWith("/records") && !init?.method) return json({ schema_version: "task0.v1", workspace_id: "workspace-test", records: [] });
      if (url.endsWith("/start")) return json({ ...recordEnvelope(running), reused_active: false });
      return json({ schema_version: "task0.v1", workspace_id: "workspace-test", records: [] });
    });
    render(connectedPanel());
    await waitForFramework();
    vi.useFakeTimers();
    await clickElement(screen.getByRole("button", { name: "Run synthetic processing test" }));
    await advanceTimers(250);
    expect(screen.getByText("The companion session expired. Pair this browser again.")).toBeInTheDocument();
    await advanceTimers(1_000);
    expect(readCounts.get("workspace-test")).toBe(1);
  });

  it("loads terminal results and history through the normal reopen path", async () => {
    const completed = makeRecord({ status: "completed" });
    installFrameworkFetch({ listedRecords: [completed] });
    render(connectedPanel());
    await waitForFramework();
    expect(screen.getByTestId("ai-processing-result")).toHaveTextContent("completed");
    expect(within(screen.getByLabelText("Processing history")).getByText("completed")).toBeInTheDocument();
  });
});
