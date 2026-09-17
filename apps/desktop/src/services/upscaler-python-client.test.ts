import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { activeRemoteUpscalerEndpoints } from "./remote-upscaler-client";
import { activeUpscalerVideoJobs, buildUpscalerVideoForm, clearRemoteUpscalerVideoCache, generatePythonUpscaledVideo, getRemoteUpscalerVideoCache, preflightRemoteUpscalerVideo, pythonUpscalerHealth, pythonUpscalerSupportsVideoJobs, settingsWithReachableRemoteEndpoints, shouldUsePythonUpscaler, type PythonUpscalerHealth } from "./upscaler-python-client";
import { shutdownAreaPythonServices } from "./python-service-lifecycle";

const tauriInvoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke }));

const cpuHealth: PythonUpscalerHealth = { ok: true, mps: false, cuda: false, recommendedBackend: "cpu", gpuName: "CPU" };
const metalHealth: PythonUpscalerHealth = { ok: true, mps: true, cuda: false, recommendedBackend: "metal", gpuName: "Apple Silicon · MPS/Metal" };

describe("routing Upscaler PyTorch", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); tauriInvoke.mockReset(); });
  it("instrada sempre i checkpoint non ONNX al servizio Python", () => {
    expect(shouldUsePythonUpscaler(false, "auto", null)).toBe(true);
    expect(shouldUsePythonUpscaler(false, "cpu", cpuHealth)).toBe(true);
  });

  it("usa MPS/Metal in automatico quando il servizio lo rileva", () => {
    expect(shouldUsePythonUpscaler(true, "auto", metalHealth)).toBe(true);
    expect(shouldUsePythonUpscaler(true, "metal", metalHealth)).toBe(true);
  });

  it("lascia i modelli ONNX nel browser se non esiste un backend nativo", () => {
    expect(shouldUsePythonUpscaler(true, "auto", null)).toBe(false);
    expect(shouldUsePythonUpscaler(true, "webgpu", metalHealth)).toBe(false);
  });

  it("accetta soltanto il backend video con Canvas streaming diretto", () => {
    expect(pythonUpscalerSupportsVideoJobs(metalHealth)).toBe(false);
    expect(pythonUpscalerSupportsVideoJobs({ ...metalHealth, apiVersion: 6, capabilities: { imageUpscale: true, videoJobs: true } })).toBe(false);
    expect(pythonUpscalerSupportsVideoJobs({ ...metalHealth, apiVersion: 7, capabilities: { imageUpscale: true, videoJobs: true, canvasVideoStreaming: true } })).toBe(true);
  });

  it("avvia automaticamente il backend nativo e attende che diventi raggiungibile", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    tauriInvoke.mockResolvedValue({ running: false, started: true, pid: 123 });
    const available = { ...cpuHealth, apiVersion: 5, capabilities: { videoJobs: true }, interpolation: { ffmpeg: true } };
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("connection refused"))
      .mockResolvedValueOnce(new Response(JSON.stringify(available), { status: 200 }));
    await expect(pythonUpscalerHealth(true)).resolves.toEqual(available);
    expect(tauriInvoke).toHaveBeenCalledWith("ensure_upscaler_service");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("arresta i processi Python posseduti da MLSM al cambio modalità", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    tauriInvoke.mockResolvedValue(undefined);
    await shutdownAreaPythonServices();
    expect(tauriInvoke).toHaveBeenCalledWith("shutdown_area_python_services");
  });

  it("invia preserve_aspect_ratio insieme alla richiesta video", () => {
    const settings = createProject().animation.upscaler;
    const form = buildUpscalerVideoForm(new Blob(["video"], { type: "video/mp4" }), "source.mp4", settings, "maximum", "client");
    expect(form.get("preserve_aspect_ratio")).toBe("true");
    expect(form.get("width")).toBe(String(settings.finalWidth));
    expect(form.get("height")).toBe(String(settings.finalHeight));
    expect(form.get("apply_video_adjustments")).toBe("false");
    expect(JSON.parse(String(form.get("adjustments")))).toEqual(settings.adjustments);
  });

  it("invia l'attivazione esplicita delle regolazioni video lente", () => {
    const settings = { ...createProject().animation.upscaler, applyVideoAdjustments: true };
    const form = buildUpscalerVideoForm(new Blob(["video"], { type: "video/mp4" }), "source.mp4", settings, "maximum", "client");
    expect(form.get("apply_video_adjustments")).toBe("true");
  });

  it("invia al backend il frammento sorgente selezionato", () => {
    const settings = { ...createProject().animation.upscaler, sourceStartSeconds: 2.5, sourceDurationSeconds: 1.25 };
    const form = buildUpscalerVideoForm(new Blob(["video"], { type: "video/mp4" }), "source.mp4", settings, "high", "client");
    expect(form.get("source_start_seconds")).toBe("2.5");
    expect(form.get("source_duration_seconds")).toBe("1.25");
  });

  it.each(["resume", "restart"] as const)("invia la policy checkpoint remota esplicita %s", (policy) => {
    const defaults = createProject().animation.upscaler;
    const settings = { ...defaults, remote: { ...defaults.remote, enabled: true, model: "x4", endpoints: [{ id: "one", label: "Colab", url: "https://one.gradio.live", enabled: true }] } };
    const form = buildUpscalerVideoForm(new Blob(["video"], { type: "video/mp4" }), "source.mp4", settings, "maximum", "client", policy);
    expect(form.get("checkpoint_policy")).toBe(policy);
    expect(JSON.parse(String(form.get("remote_config")))).toMatchObject({ segmentFrames: 100 });
  });

  it("invia blocchi e FPS solo quando il frame rate è stato richiesto", () => {
    const defaults = createProject().animation.upscaler;
    const baseRemote = { ...defaults.remote, enabled: true, model: "x4", segmentFrames: 300, endpoints: [{ id: "one", label: "Colab", url: "https://one.gradio.live", enabled: true }] };
    const original = buildUpscalerVideoForm(new Blob(["video"]), "source.mp4", { ...defaults, remote: baseRemote }, "maximum", "client");
    expect(JSON.parse(String(original.get("remote_config")))).toMatchObject({ segmentFrames: 300 });
    expect(JSON.parse(String(original.get("remote_config")))).not.toHaveProperty("outputFps");
    const converted = buildUpscalerVideoForm(new Blob(["video"]), "source.mp4", { ...defaults, remote: { ...baseRemote, outputFps: 59.94 } }, "maximum", "client");
    expect(JSON.parse(String(converted.get("remote_config")))).toMatchObject({ segmentFrames: 300, outputFps: 59.94 });
  });

  it("verifica gli endpoint video e costruisce un job con il solo subset approvato", async () => {
    const defaults = createProject().animation.upscaler;
    const settings = { ...defaults, remote: { ...defaults.remote, enabled: true, model: "x4", segmentFrames: 300, endpoints: [
      { id: "one", label: "Online", url: "https://online.gradio.live/", enabled: true },
      { id: "two", label: "Offline", url: "https://offline.gradio.live", enabled: true },
    ] } };
    const response = { ok: true, reachableEndpoints: ["https://online.gradio.live"], failures: [{ url: "https://offline.gradio.live", error: "HTTP 404" }] };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));
    await expect(preflightRemoteUpscalerVideo(settings)).resolves.toEqual(response);
    expect(JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({ model: "x4", segmentFrames: 300 });
    const selected = settingsWithReachableRemoteEndpoints(settings, response.reachableEndpoints);
    expect(activeRemoteUpscalerEndpoints(selected)).toEqual(["https://online.gradio.live"]);
  });

  it("usa restart come default sicuro e non invia policy per un job locale", () => {
    const defaults = createProject().animation.upscaler;
    const remote = { ...defaults, remote: { ...defaults.remote, enabled: true, model: "x4", endpoints: [{ id: "one", label: "Colab", url: "https://one.gradio.live", enabled: true }] } };
    expect(buildUpscalerVideoForm(new Blob(["video"]), "source.mp4", remote, "maximum", "client").get("checkpoint_policy")).toBe("restart");
    expect(buildUpscalerVideoForm(new Blob(["video"]), "source.mp4", defaults, "maximum", "client").get("checkpoint_policy")).toBeNull();
  });

  it("legge e svuota la cache video remota tramite l'endpoint locale dedicato", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: 4, bytes: 1024, activeJobs: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ removedJobs: 4, removedBytes: 1024 }), { status: 200 }));
    await expect(getRemoteUpscalerVideoCache()).resolves.toEqual({ jobs: 4, bytes: 1024, activeJobs: 0 });
    await expect(clearRemoteUpscalerVideoCache()).resolves.toEqual({ removedJobs: 4, removedBytes: 1024 });
    expect(fetch.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8765/upscale/remote/video/cache");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("espone il motivo del rifiuto backend quando esiste un job attivo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ detail: { message: "La cache remota non può essere svuotata mentre esistono job attivi." } }), { status: 409 }));
    await expect(clearRemoteUpscalerVideoCache()).rejects.toThrow("La cache remota non può essere svuotata mentre esistono job attivi.");
  });

  it("controlla l'ammissione prima di copiare nuovamente il video", async () => {
    const jobs = [{ id: "job-active", phase: "upscaling", phaseLabel: "Segmenti remoti", sourceName: "old.mp4", remote: true, cancelRequested: false }];
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ jobs }), { status: 200 }));
    await expect(activeUpscalerVideoJobs()).resolves.toEqual(jobs);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8765/upscale/video/jobs/active", undefined);
  });

  it("non apre l'upload se un altro job è ancora attivo", async () => {
    const health = { ...cpuHealth, apiVersion: 7, capabilities: { videoJobs: true, remoteVideoPartialEndpointPreflight: true, canvasVideoStreaming: true }, interpolation: { ffmpeg: true } };
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) return new Response(JSON.stringify(health), { status: 200 });
      if (url.endsWith("/upscale/remote/video/preflight")) return new Response(JSON.stringify({ ok: true, reachableEndpoints: ["https://one.gradio.live"], failures: [] }), { status: 200 });
      if (url.endsWith("/upscale/video/jobs/active")) return new Response(JSON.stringify({ jobs: [{ id: "old-job", phase: "upscaling", phaseLabel: "Segmenti remoti", sourceName: "old.mp4", remote: true, cancelRequested: false }] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const xhr = vi.fn(); vi.stubGlobal("XMLHttpRequest", xhr);
    const settings = createProject().animation.upscaler;
    settings.remote = { ...settings.remote, enabled: true, model: "x4", endpoints: [{ id: "one", label: "One", url: "https://one.gradio.live", enabled: true }] };
    await expect(generatePythonUpscaledVideo({
      sourceUrl: "blob:new", sourceBlob: new File(["new-video"], "new.mp4", { type: "video/mp4" }), sourceName: "new.mp4",
      settings, quality: "maximum", signal: new AbortController().signal, onStatus: vi.fn(),
    })).rejects.toThrow(/old-job.*non è stato copiato nuovamente/);
    expect(xhr).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8765/upscale/video/jobs/active", expect.anything());
  });

  it("non invia il vecchio video se la sorgente viene sostituita durante l'health check", async () => {
    let resolveHealth!: (response: Response) => void;
    const health = new Promise<Response>((resolve) => { resolveHealth = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => String(input).endsWith("/health")
      ? health
      : Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const xhr = vi.fn(); vi.stubGlobal("XMLHttpRequest", xhr);
    const controller = new AbortController();
    const settings = createProject().animation.upscaler;
    const operation = generatePythonUpscaledVideo({
      sourceUrl: "blob:old", sourceBlob: new File(["old-video"], "old.mp4", { type: "video/mp4" }), sourceName: "old.mp4",
      settings, quality: "maximum", signal: controller.signal, onStatus: vi.fn()
    });

    controller.abort();
    resolveHealth(new Response(JSON.stringify({
      ok: true, apiVersion: 7, capabilities: { videoJobs: true, canvasVideoStreaming: true }, mps: false, cuda: false,
      recommendedBackend: "cpu", gpuName: "CPU", interpolation: { ffmpeg: true }
    }), { status: 200 }));

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(xhr).not.toHaveBeenCalled();
  });
});
