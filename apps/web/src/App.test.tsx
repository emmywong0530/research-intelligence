import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function mockFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/health")) {
      return jsonResponse({ schema_version: "task0.v1", status: "ok", companion_version: "0.1.0", loopback_only: true });
    }
    if (url.endsWith("/api/v1/capabilities")) {
      return jsonResponse({ schema_version: "task0.v1", api_version: "v1", capabilities: ["pairing", "keychain_spike", "workspace_atomic_write_spike"] });
    }
    if (url.endsWith("/api/v1/pairing/start") && init?.method === "POST") {
      return jsonResponse({ schema_version: "task0.v1", pairing_id: "pairing-test", expires_at: "2026-07-18T23:00:00Z", approval_required: true, max_failed_attempts: 5 });
    }
    if (url.endsWith("/api/v1/pairing/complete") && init?.method === "POST") {
      return jsonResponse({ schema_version: "task0.v1", session_token: "session-token-only-in-memory", expires_at: "2026-07-18T23:15:00Z" });
    }
    return jsonResponse({ detail: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("approved frontend prototype", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#home");
    vi.restoreAllMocks();
    mockFetch();
  });

  it("keeps the primary navigation persistent while rendering every primary screen", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: /primary navigation/i });
    expect(within(navigation).getAllByRole("link")).toHaveLength(10);
    expect(await screen.findByTestId("companion-connection-status")).toHaveAttribute("data-connection-state", "connected");
    expect(screen.getByRole("heading", { name: /Continue your research momentum/ })).toBeInTheDocument();

    const screenHeadings: Record<string, RegExp> = {
      Projects: /Your research projects/,
      Discovery: /papers matched your project/,
      Library: /146 saved papers/,
      "Reading Hub": /Choose a session/,
      "Ask Library": /Ask across/,
      Synthesis: /Compare evidence/,
      "Research Gaps": /Track whether/,
      Activity: /See what the platform/,
      Settings: /Workspace, AI/
    };
    for (const label of Object.keys(screenHeadings)) {
      await user.click(within(navigation).getByRole("link", { name: label }));
      expect(screen.getByText(new RegExp(label), { selector: ".topbar-title span" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: screenHeadings[label] })).toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeInTheDocument();
    }
  });

  it("exposes checking and connected companion states through a stable status target", async () => {
    render(<App />);
    const status = screen.getByTestId("companion-connection-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("data-connection-state", "checking");
    expect(await screen.findByTestId("companion-connection-status")).toHaveAttribute("data-connection-state", "connected");
    expect(screen.getByRole("status")).toHaveTextContent("Connected");
  });

  it("exposes a disconnected state when companion health or capabilities fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("companion unavailable")));
    render(<App />);
    const status = await screen.findByTestId("companion-connection-status");
    expect(status).toHaveAttribute("data-connection-state", "disconnected");
    expect(status).toHaveTextContent("Disconnected");
    expect(screen.getByText("Local companion unavailable")).toBeInTheDocument();
  });

  it("uses the same discovery records across table, cards and Paper Field", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Discovery" }));
    expect(screen.getByRole("button", { name: "Conversational Memory and Advice Reliance" })).toBeInTheDocument();
    await user.click(screen.getByTestId("discovery-cards-view"));
    expect(screen.getByRole("heading", { name: "Conversational Memory and Advice Reliance" })).toBeInTheDocument();
    await user.click(screen.getByTestId("discovery-field-view"));
    expect(screen.getByRole("button", { name: "Select Conversational Memory and Advice Reliance" })).toBeInTheDocument();
  });

  it("changes Paper Field selection and preserves it for review", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Discovery" }));
    await user.click(screen.getByTestId("discovery-field-view"));
    await user.click(screen.getByRole("button", { name: "Select Static Labels versus Real Interaction" }));
    expect(screen.getByText("Static Labels versus Real Interaction", { selector: ".field-detail strong" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review paper" }));
    expect(screen.getByRole("heading", { name: "Static Labels versus Real Interaction" })).toBeInTheDocument();
  });

  it("switches the recommended reading session", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Reading Hub" }));
    await user.click(screen.getByRole("button", { name: "30 min" }));
    expect(screen.getByTestId("reading-session-label")).toHaveTextContent("Focused read · 30 minutes");
    await user.click(screen.getByRole("button", { name: "Deep" }));
    expect(screen.getByTestId("reading-session-label")).toHaveTextContent("Deep reading session");
  });

  it("switches settings categories", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Privacy" }));
    expect(screen.getByText(/Paper content sent to an external AI provider always requires an outbound preview/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Institution" }));
    expect(screen.getByText(/Institutional credentials, MFA codes and publisher session cookies are never stored/)).toBeInTheDocument();
  });

  it("opens and closes onboarding and institutional-access modals with Escape", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /onboarding/i }));
    expect(screen.getByRole("dialog", { name: /set up your local-first workspace/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /set up your local-first workspace/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Reading Hub" }));
    await user.click(screen.getByRole("button", { name: /open through warwick/i }));
    expect(screen.getByRole("dialog", { name: /open through university of warwick/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /open through university of warwick/i })).not.toBeInTheDocument();
  });

  it("completes pairing without using localStorage or sessionStorage for secrets", async () => {
    const storageSetItem = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    render(<App />);
    await user.click(screen.getByRole("button", { name: /onboarding/i }));
    await user.click(screen.getByRole("button", { name: /start pairing/i }));
    await user.type(screen.getByLabelText(/approval code shown by companion/i), "123456");
    await user.click(screen.getByRole("button", { name: /complete pairing/i }));

    expect(await screen.findByText(/Paired session established in memory/)).toBeInTheDocument();
    expect(storageSetItem).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/api/v1/pairing/complete",
      expect.objectContaining({ body: JSON.stringify({ pairing_id: "pairing-test", approval_code: "123456" }) })
    );
  });
});
