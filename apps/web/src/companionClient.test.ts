import { describe, expect, it, vi } from "vitest";
import { MAX_COMPANION_JSON_RESPONSE_BYTES, readHealth } from "./companionClient";

describe("companion response boundary", () => {
  it("rejects an oversized streamed response before JSON parsing", async () => {
    const oversized = new Uint8Array(MAX_COMPANION_JSON_RESPONSE_BYTES + 1);
    oversized.fill(120);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(oversized, { status: 200 })));

    await expect(readHealth("https://companion.test")).rejects.toMatchObject({
      status: 502,
      code: "response_too_large",
    });
  });
});
