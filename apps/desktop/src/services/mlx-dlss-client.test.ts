import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const base = "http://127.0.0.1:8765";
const health = { ok: true, mps: true, cuda: false, recommendedBackend: "metal", gpuName: "Apple Silicon" };
const capabilities = { id: "mlx-dlss", supported: true, installed: false, usable: false };
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset().mockResolvedValue({ started: true, running: false });
  vi.stubGlobal("__TAURI_INTERNALS__", {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("MLX-DLSS service readiness", () => {
  it("reports a backend restart instead of polling idle forever", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ phase: "idle", progress: 0, message: "" }));
    const { waitForMlxDlssInstall } = await import("./mlx-dlss-client");
    await expect(waitForMlxDlssInstall()).rejects.toThrow("riavvio del servizio");
  });

  it("reports polling connection failures with recovery instructions", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { waitForMlxDlssInstall } = await import("./mlx-dlss-client");
    await expect(waitForMlxDlssInstall()).rejects.toThrow("Riapri la configurazione");
  });
  it("waits through a cold start before requesting capabilities", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json(health))
      .mockResolvedValueOnce(json(capabilities));
    const { getMlxDlssCapabilities } = await import("./mlx-dlss-client");
    await expect(getMlxDlssCapabilities()).resolves.toEqual(capabilities);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("ensure_upscaler_service");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${base}/health`, `${base}/health`, `${base}/health`, `${base}/upscale/providers/mlx-dlss`,
    ]);
  });

  it("does not restart an already healthy backend and explains a missing route", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(health))
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const { getMlxDlssCapabilities } = await import("./mlx-dlss-client");
    await expect(getMlxDlssCapabilities()).rejects.toThrow("backend aggiornato");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not request capabilities after leaving the area during startup", async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { getMlxDlssCapabilities } = await import("./mlx-dlss-client");
    const controller = new AbortController();
    const pending = getMlxDlssCapabilities(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    finish(json(health));
    await rejected;
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("provides a retry message when the connection drops after readiness", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(health))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { getMlxDlssCapabilities } = await import("./mlx-dlss-client");
    await expect(getMlxDlssCapabilities()).rejects.toThrow("Premi Riprova");
  });
});
