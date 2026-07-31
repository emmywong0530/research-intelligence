import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderSettings } from "./aiProvider";

const config = {
  schema_version: "task5a.v1" as const,
  provider: "openai" as const,
  model: "gpt-test",
  timeout_seconds: 15,
  max_retries: 1,
  enabled: true,
  created_at: "2026-07-30T12:00:00Z",
  updated_at: "2026-07-30T12:00:00Z",
  revision: "a".repeat(64)
};

function status(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "task0.v1",
    config: null,
    credential_state: "missing",
    state: "unconfigured",
    last_test: null,
    available_providers: [{ id: "openai", label: "OpenAI-compatible" }],
    ...overrides
  };
}

function jsonResponse(body: unknown, responseStatus = 200) {
  return new Response(JSON.stringify(body), { status: responseStatus, headers: { "Content-Type": "application/json" } });
}

function renderSettings() {
  return render(<AiProviderSettings companionUrl="http://127.0.0.1:8765" sessionToken="session-in-memory" connectionState="online" />);
}

describe("Task 5A AI provider settings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("requires a paired companion and does not use browser storage", () => {
    render(<AiProviderSettings companionUrl="http://127.0.0.1:8765" sessionToken="" connectionState="offline" />);
    expect(screen.getByText(/Pair the browser/)).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("shows an explicit unconfigured state without testing on load", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return jsonResponse(status());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();
    expect(await screen.findByText("No AI provider configured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure provider" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/ai/provider/config");
  });

  it("stores a credential through the explicit keychain action and clears input", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return jsonResponse(status({ config, state: "configured_without_credential" }));
      if (init.method === "PUT" && String(input).endsWith("/credential")) return jsonResponse({ schema_version: "task0.v1", provider: "openai", credential_state: "present", state: "ready_untested" });
      return jsonResponse(status({ config, credential_state: "present", state: "ready_untested" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();
    await screen.findByText("Provider configured, credential missing");
    await user.click(screen.getByRole("button", { name: "Add credential" }));
    await user.type(screen.getByTestId("ai-provider-credential-input"), "secret-never-rendered");
    await user.click(screen.getByRole("button", { name: "Store in OS keychain" }));
    await waitFor(() => expect(screen.queryByDisplayValue("secret-never-rendered")).not.toBeInTheDocument());
    expect(screen.getByText(/stored in the operating-system keychain/)).toBeInTheDocument();
    expect(screen.getByText("Ready to test")).toBeInTheDocument();
  });

  it("runs only the explicit connection test and displays a bounded result", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return jsonResponse(status({ config, credential_state: "present", state: "ready_untested" }));
      if (init.method === "POST") return jsonResponse({ schema_version: "task0.v1", result: { status: "success", provider: "openai", model: "gpt-test", checked_at: "2026-07-30T12:01:00Z", latency_ms: 4, error_category: null, message: "Provider connection verified." } });
      return jsonResponse(status({ config, credential_state: "present", state: "ready_untested" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();
    await screen.findByText("Ready to test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Test provider connection" }));
    expect(await screen.findByTestId("ai-provider-test-result")).toHaveTextContent("Provider connection verified.");
    expect(screen.getByText("Connection verified")).toBeInTheDocument();
  });

  it("preserves the edited model when a revision conflict occurs", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT" ? jsonResponse({ detail: { code: "provider_config_conflict", message: "The provider configuration changed elsewhere." } }, 409) : jsonResponse(status({ config, credential_state: "present", state: "ready_untested" })));
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();
    const model = await screen.findByRole("textbox", { name: "Provider model" });
    await user.clear(model);
    await user.type(model, "gpt-local-edit");
    await user.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument();
    expect(model).toHaveValue("gpt-local-edit");
  });

  it("shows a blocked keychain state without revealing credential material", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status({ config, credential_state: "unavailable", state: "configuration_invalid" }))));
    renderSettings();
    expect(await screen.findByText("Provider configuration unavailable")).toBeInTheDocument();
    expect(screen.getByText("Keychain unavailable")).toBeInTheDocument();
    expect(screen.getByText(/No plaintext fallback/)).toBeInTheDocument();
  });
});
