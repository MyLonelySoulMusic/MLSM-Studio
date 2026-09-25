import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
import { requestRemoteAnswer } from "./studio-settings";

describe("AI provider request queue", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("serializes requests and respects the configured interval", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const input = JSON.parse(String(init.body));
      const result = input.action === "status" ? { activeProvider: "nvidia", providers: { nvidia: { model: "test", limits: { enabled: true, requests: 1, windowSeconds: 1, contextTokens: 128000 } } } } : { content: "OK", model: "test", source: "nvidia" };
      if (input.action === "chat") starts.push(Date.now());
      return new Response(JSON.stringify({ result }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);
    const messages = [{ role: "user" as const, content: "test" }];
    const first = requestRemoteAnswer(messages);
    const second = requestRemoteAnswer(messages);
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(starts).toHaveLength(2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1000);
  });
  it("rejects an aborted request without contacting the provider", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ result: { activeProvider: "openai", providers: { openai: { model: "test" } } } }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController(); controller.abort();
    await expect(requestRemoteAnswer([{ role: "user", content: "test" }], { signal: controller.signal })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
