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

  it("rifiuta un processo precedente già in ascolto invece di riusarlo", async () => {
    const spawn = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const plugin = localPyTorchService(
      async () => ({ running: true, compatible: false, apiVersion: 6 }),
      spawn as unknown as typeof nodeSpawn,
      () => true,
    );
    await expect((plugin.configureServer as (value: { config: { logger: typeof logger } }) => Promise<void>)({ config: { logger } }))
      .rejects.toThrow(/backend precedente.*Canvas video diretta/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("riavvia automaticamente il backend se cade e si ferma alla chiusura di Vite", async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    const spawn = vi.fn();
    spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    let closeServer: (() => void) | undefined;
    const server = {
      config: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      httpServer: { once: vi.fn((event: string, callback: () => void) => { if (event === "close") closeServer = callback; }) }
    };
    const plugin = localPyTorchService(
      async () => ({ running: false, compatible: false }),
      spawn as unknown as typeof nodeSpawn,
      () => true,
    );
    await (plugin.configureServer as (value: typeof server) => Promise<void>)(server);
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

    closeServer?.();
    expect(second.kill).toHaveBeenCalledWith("SIGTERM");
    second.exitCode = 0;
    second.emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("forza la chiusura del child che non termina entro la grazia", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    let closeServer: (() => void) | undefined;
    const server = {
      config: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      httpServer: { once: vi.fn((event: string, callback: () => void) => { if (event === "close") closeServer = callback; }) },
    };
    const plugin = localPyTorchService(
      async () => ({ running: false, compatible: false }),
      spawn as unknown as typeof nodeSpawn,
      () => true,
    );
    await (plugin.configureServer as (value: typeof server) => Promise<void>)(server);
    closeServer?.();
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });
});
