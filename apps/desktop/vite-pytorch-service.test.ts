import { EventEmitter } from "node:events";
import type { spawn as nodeSpawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isCompatibleUpscalerHealth, localPyTorchService } from "./vite-pytorch-service";

class FakeChild extends EventEmitter {
  pid = 123;
  exitCode: number | null = null;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => { this.killed = true; return true; });

  emitExit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.exitCode = code;
    this.emit("exit", code, signal);
  }
}

function fakeServer() {
  let closeServer: (() => void) | undefined;
  type Handler = (request: { url?: string; method?: string }, response: { statusCode: number; setHeader: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }, next: () => void) => Promise<void>;
  const handlers = new Map<string, Handler>();
  const server = {
    config: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    middlewares: { use: vi.fn((route: string, handler: Handler) => { handlers.set(route, handler); }) },
    httpServer: { once: vi.fn((event: string, callback: () => void) => { if (event === "close") closeServer = callback; }) },
  };
  const request = async (url: string, method = "POST", route = "/__mlsm/python/upscaler") => {
    const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    await handlers.get(route)?.({ url, method }, response, next);
    return { ...response, next };
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
      { appendLog: vi.fn() },
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
      { appendLog: vi.fn() },
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

    first.emitExit(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(spawn).toHaveBeenCalledTimes(2);

    runtime.close();
    expect(second.kill).toHaveBeenCalledWith("SIGTERM");
    second.emitExit(0);
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
      { appendLog: vi.fn() },
    );
    await (plugin.configureServer as (value: typeof runtime.server) => Promise<void>)(runtime.server);
    await runtime.request("/start");
    runtime.close();
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });

  it("mantiene gli endpoint diagnostici quando il runtime Python manca", async () => {
    const spawn = vi.fn();
    const appendLog = vi.fn();
    const probe = vi.fn(async () => ({ running: false, compatible: false }));
    const runtime = fakeServer();
    const plugin = localPyTorchService(
      probe,
      spawn as unknown as typeof nodeSpawn,
      () => false,
      { appendLog },
    );
    await (plugin.configureServer as (value: typeof runtime.server) => Promise<void>)(runtime.server);

    const status = await runtime.request("/status", "GET");
    const statusPayload = JSON.parse(String(status.end.mock.calls[0]?.[0]));
    expect(status.statusCode).toBe(200);
    expect(statusPayload).toMatchObject({
      running: false,
      phase: "error",
      pid: null,
      recentLogs: expect.any(Array),
    });
    expect(statusPayload.error).toContain("npm run upscaler:setup");
    expect(statusPayload.logPath).toMatch(/logs[/\\]upscaler-vite\.log$/);

    const start = await runtime.request("/start");
    const startPayload = JSON.parse(String(start.end.mock.calls[0]?.[0]));
    expect(start.statusCode).toBe(503);
    expect(startPayload).toMatchObject({ started: false, phase: "error" });
    expect(spawn).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(appendLog).toHaveBeenCalled();
  });

  it("tratta la porta Python ancora chiusa come health non pronto senza invocare il proxy rumoroso", async () => {
    const fetchBackend = vi.fn().mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8765"), { code: "ECONNREFUSED" }));
    const runtime = fakeServer();
    const plugin = localPyTorchService(
      async () => ({ running: false, compatible: false }),
      vi.fn(() => new FakeChild()) as unknown as typeof nodeSpawn,
      () => true,
      { appendLog: vi.fn(), fetchBackend },
    );
    await (plugin.configureServer as (value: typeof runtime.server) => Promise<void>)(runtime.server);
    await runtime.request("/start");

    const health = await runtime.request("/?t=123", "GET", "/__mlsm/upscaler-api/interpolation/health");
    const payload = JSON.parse(String(health.end.mock.calls[0]?.[0]));
    expect(health.statusCode).toBe(503);
    expect(payload).toMatchObject({ ok: false, ready: false, phase: "starting", starting: true });
    expect(health.next).not.toHaveBeenCalled();
    expect(runtime.server.config.logger.error).not.toHaveBeenCalled();
    expect(fetchBackend).toHaveBeenCalledWith("http://127.0.0.1:8765/interpolation/health", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });

  it("inoltra normalmente la health quando il backend ha aperto la porta", async () => {
    const backendPayload = { ok: true, interpolation: { ffmpeg: true, jobs: true } };
    const fetchBackend = vi.fn().mockResolvedValue(new Response(JSON.stringify(backendPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const runtime = fakeServer();
    const plugin = localPyTorchService(
      async () => ({ running: true, compatible: true, pid: 321 }),
      vi.fn() as unknown as typeof nodeSpawn,
      () => true,
      { appendLog: vi.fn(), fetchBackend },
    );
    await (plugin.configureServer as (value: typeof runtime.server) => Promise<void>)(runtime.server);

    const health = await runtime.request("/", "GET", "/__mlsm/upscaler-api/interpolation/health");
    expect(health.statusCode).toBe(200);
    expect(JSON.parse(String(health.end.mock.calls[0]?.[0]))).toEqual(backendPayload);
    expect(health.next).not.toHaveBeenCalled();
  });

  it("espone stdout e stderr recenti e li persiste come righe limitate", async () => {
    const child = new FakeChild();
    const appendLog = vi.fn();
    const runtime = fakeServer();
    const plugin = localPyTorchService(
      async () => ({ running: false, compatible: false }),
      vi.fn(() => child) as unknown as typeof nodeSpawn,
      () => true,
      { appendLog },
    );
    await (plugin.configureServer as (value: typeof runtime.server) => Promise<void>)(runtime.server);
    await runtime.request("/start");
    child.stdout.emit("data", "import torch\nbackend pronto\n");
    child.stderr.emit("data", `${"x".repeat(5_000)}\n`);

    const status = await runtime.request("/status", "GET");
    const payload = JSON.parse(String(status.end.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({ phase: "starting", pid: 123 });
    expect(payload.recentLogs).toEqual(expect.arrayContaining([
      "[stdout] import torch",
      "[stdout] backend pronto",
    ]));
    expect(payload.recentLogs.some((line: string) => line.includes("riga troncata"))).toBe(true);
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining("[stdout] import torch"));
  });

  it("su Windows usa taskkill e attende l'uscita prima di completare lo stop", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    const killer = new EventEmitter();
    const taskkill = vi.fn(() => killer);
    const runtime = fakeServer();
    const plugin = localPyTorchService(
      async () => ({ running: false, compatible: false }),
      spawn as unknown as typeof nodeSpawn,
      () => true,
      { platform: "win32", appendLog: vi.fn(), killProcess: taskkill as unknown as typeof nodeSpawn },
    );
    await (plugin.configureServer as (value: typeof runtime.server) => Promise<void>)(runtime.server);
    await runtime.request("/start");
    expect(spawn.mock.calls[0]?.[0]).toMatch(/\.venv[/\\]Scripts[/\\]python\.exe$/);
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({ detached: false, stdio: ["ignore", "pipe", "pipe"] });

    const stopping = runtime.request("/stop");
    await Promise.resolve();
    expect(taskkill).toHaveBeenCalledWith("taskkill", ["/PID", "123", "/T", "/F"], { stdio: "ignore" });
    child.emitExit(0);
    expect((await stopping).statusCode).toBe(204);
  });
});
