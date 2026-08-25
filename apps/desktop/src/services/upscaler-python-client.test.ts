import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { buildUpscalerVideoForm, clearRemoteUpscalerVideoCache, generatePythonUpscaledVideo, getRemoteUpscalerVideoCache, pythonUpscalerSupportsVideoJobs, shouldUsePythonUpscaler, type PythonUpscalerHealth } from "./upscaler-python-client";

const cpuHealth: PythonUpscalerHealth = { ok: true, mps: false, cuda: false, recommendedBackend: "cpu", gpuName: "CPU" };
const metalHealth: PythonUpscalerHealth = { ok: true, mps: true, cuda: false, recommendedBackend: "metal", gpuName: "Apple Silicon · MPS/Metal" };

describe("routing Upscaler PyTorch", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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

  it("distingue il vecchio endpoint immagine dal backend video frame-per-frame", () => {
    expect(pythonUpscalerSupportsVideoJobs(metalHealth)).toBe(false);
    expect(pythonUpscalerSupportsVideoJobs({ ...metalHealth, apiVersion: 2, capabilities: { imageUpscale: true, videoJobs: true } })).toBe(true);
  });

  it("invia preserve_aspect_ratio insieme alla richiesta video", () => {
    const settings = createProject().animation.upscaler;
    const form = buildUpscalerVideoForm(new Blob(["video"], { type: "video/mp4" }), "source.mp4", settings, "maximum", "client");
    expect(form.get("preserve_aspect_ratio")).toBe("true");
    expect(form.get("width")).toBe(String(settings.finalWidth));
    expect(form.get("height")).toBe(String(settings.finalHeight));
    expect(JSON.parse(String(form.get("adjustments")))).toEqual(settings.adjustments);
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
      ok: true, apiVersion: 5, capabilities: { videoJobs: true }, mps: false, cuda: false,
      recommendedBackend: "cpu", gpuName: "CPU", interpolation: { ffmpeg: true }
    }), { status: 200 }));

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(xhr).not.toHaveBeenCalled();
  });
});
