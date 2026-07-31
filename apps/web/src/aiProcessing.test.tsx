import { screen, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("Task 5B processing framework", () => {
  beforeEach(() => vi.restoreAllMocks());

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
    render(<AiProcessingPanel companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId="workspace-test" connectionState="online" />);
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
    render(<AiProcessingPanel companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" workspaceId="workspace-test" connectionState="online" />);
    await waitFor(() => expect(screen.getByText(/available only in the explicit test companion mode/i)).toBeInTheDocument());
    expect(screen.queryByRole("textbox", { name: /prompt/i })).not.toBeInTheDocument();
  });
});
