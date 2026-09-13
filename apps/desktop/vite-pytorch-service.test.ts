import { EventEmitter } from "node:events";
import type { spawn as nodeSpawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isCompatibleUpscalerHealth, localPyTorchService } from "./vite-pytorch-service";

class FakeChild extends EventEmitter {
  pid = 123;
  exitCode: number | null = null;
  killed = false;
  kill = vi.fn(() => { this.killed = true; return true; });
}

function fakeServer() {
  let closeServer: (() => void) | undefined;
  let lifecycle: ((request: { url?: string; method?: string }, response: { statusCode: number; setHeader: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }, next: () => void) => Promise<void>) | undefined;
  const server = {
    config: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    middlewares: { use: vi.fn((_route: string, handler: typeof lifecycle) => { lifecycle = handler; }) },
    httpServer: { once: vi.fn((event: string, callback: () => void) => { if (event === "close") closeServer = callback; }) },
  };
  const request = async (url: string) => {
    const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    await lifecycle?.({ url, method: "POST" }, response, vi.fn());
    return response;
  };
  return { server, request, close: () => closeServer?.() };
}

describe("servizio PyTorch locale", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("accetta soltanto il contratto API con Canvas video streaming", () => {
    const capabilities = {
      videoJobs: true,
      remoteVideoPartialEndpointPreflight: true,
      canvasVideoStreaming: true,
    };
    expect(isCompatibleUpscalerHealth({ apiVersion: 7, capabilities })).toBe(true);
    expect(isCompatibleUpscalerHealth({ apiVersion: 6, capabilities })).toBe(false);
    expect(isCompatibleUpscalerHealth({ apiVersion: 7, capabilities: { ...capabilities, canvasVideoStreaming: false } })).toBe(false);
    expect(isCompatibleUpscalerHealth({ apiVersion: 7, capabilities, ownerKind: "vite", parentPid: 42 }, 42)).toBe(true);
    expect(isCompatibleUpscalerHealth({ apiVersion: 7, capabilities, ownerKind: "external", parentPid: 42 }, 42)).toBe(false);
    expect(isCompatibleUpscalerHealth({ apiVersion: 7, capabilities, ownerKind: "vite", parentPid: 99 }, 42)).toBe(false);
  });

  it("non avvia né sonda PyTorch insieme all'app e rifiuta backend incompatibili solo su richiesta", async () => {
    const spawn = vi.fn();
    const probe = vi.fn(async () => ({ running: true, compatible: false, apiVersion: 6 }));
    const plugin = localPyTorchService(
      probe,
      spawn as unknown as typeof nodeSpawn,
      () => true,
    );
    const runtime = fakeServer();
    await (plugin.configureServer as (value: typeof runtime.server) => Promise<void>)(runtime.server);
    expect(probe).not.toHaveBeenCalled();
    const response = await runtime.request("/start");
    expect(response.statusCode).toBe(409);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("riavvia automaticamente il backend se cade e si ferma alla chiusura di Vite", async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    const spawn = vi.fn();
    spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const runtime = fakeServer();
    const plugin = localPyTorchService(
      async () => ({ running: false, compatible: false }),
      spawn as unknown as typeof nodeSpawn,
      () => true,
    );
    await (plugin.configureServer as (value: typeof runtime.server) => Promise<void>)(runtime.server);
    expect(spawn).not.toHaveBeenCalled();
    await runtime.request("/start");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({
      env: {
        MLSM_UPSCALER_PARENT_PID: String(process.pid),
        MLSM_UPSCALER_OWNER_KIND: "vite",
      },
    });

    first.exitCode = 1;
    first.emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(500);
    expect(spawn).toHaveBeenCalledTimes(2);

    runtime.close();
    expect(second.kill).toHaveBeenCalledWith("SIGTERM");
    second.exitCode = 0;
    second.emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("forza la chiusura del child che non termina entro la grazia", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    const runtime = fakeServer();
    const plugin = localPyTorchService(
      async () => ({ running: false, compatible: false }),
      spawn as unknown as typeof nodeSpawn,
      () => true,
    );
    await (plugin.configureServer as (value: typeof runtime.server) => Promise<void>)(runtime.server);
    await runtime.request("/start");
    runtime.close();
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });
});
