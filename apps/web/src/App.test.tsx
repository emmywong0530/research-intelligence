import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function mockFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/health")) {
      return jsonResponse({ schema_version: "task0.v1", status: "ok", companion_version: "0.1.0", loopback_only: true });
    }
    if (url.endsWith("/api/v1/capabilities")) {
      return jsonResponse({
        schema_version: "task0.v1",
        api_version: "v1",
        capabilities: ["pairing", "keychain_spike", "workspace_atomic_write_spike"]
      });
    }
    if (url.endsWith("/api/v1/pairing/start") && init?.method === "POST") {
      return jsonResponse({
        schema_version: "task0.v1",
        pairing_id: "pairing-test",
        pairing_code: "123456",
        expires_at: "2026-07-18T23:00:00Z"
      });
    }
    if (url.endsWith("/api/v1/pairing/complete") && init?.method === "POST") {
      return jsonResponse({
        schema_version: "task0.v1",
        session_token: "session-token-only-in-memory",
        expires_at: "2026-07-18T23:15:00Z"
      });
    }
    return jsonResponse({ detail: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("Task 0 shell", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch();
  });

  it("renders the persistent desktop navigation and companion status", async () => {
    render(<App />);

    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reading Hub" })).toBeInTheDocument();
    expect(await screen.findByText(/Loopback companion online/)).toBeInTheDocument();
  });

  it("completes a pairing flow without browser storage", async () => {
    const setLocal = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText(/Loopback companion online/);
    await user.click(screen.getByRole("button", { name: /start pairing/i }));
    expect(await screen.findByDisplayValue("123456")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /complete pairing/i }));

    expect(await screen.findByText(/Session token is held only in component state/)).toBeInTheDocument();
    expect(setLocal).not.toHaveBeenCalled();
  });
});
