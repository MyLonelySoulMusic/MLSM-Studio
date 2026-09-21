import { afterEach, describe, expect, it, vi } from "vitest";

const ensurePythonUpscalerService = vi.hoisted(() => vi.fn());
const pythonUpscalerRuntimeDiagnostic = vi.hoisted(() => vi.fn(() => ({ phase: "error", message: "backend test non disponibile", at: "2026-01-01T00:00:00.000Z" })));
const reportUpscalerDiagnostic = vi.hoisted(() => vi.fn());
vi.mock("./upscaler-python-client", () => ({ ensurePythonUpscalerService, pythonUpscalerRuntimeDiagnostic, reportUpscalerDiagnostic }));

import { createFrameInterpolationFormData, frameInterpolationJob, normalizeFrameInterpolationMethod, probeFrameInterpolationSource, waitForFrameInterpolationHealth } from "./frame-interpolation-client";

afterEach(() => { vi.restoreAllMocks(); ensurePythonUpscalerService.mockReset(); reportUpscalerDiagnostic.mockReset(); });

describe("Frame Booster interpolation request", () => {
  it("sends only the multiplier so the server derives FPS from ffprobe", () => {
    const form = createFrameInterpolationFormData({
      blob: new Blob(["video"]), fileName: "phone.mp4", method: "motion",
      sourceFps: 30, targetFps: 60, targetMultiplier: 2,
    }, "client-1");
    expect(form.get("target_multiplier")).toBe("2");
    expect(form.has("target_fps")).toBe(false);
    expect(form.has("source_fps")).toBe(false);
    expect(form.has("rife_model")).toBe(false);
    expect(form.has("device")).toBe(false);
    expect(form.has("precision")).toBe(false);
  });

  it("sends direct target FPS when multiplier mode is not selected", () => {
    const form = createFrameInterpolationFormData({
      blob: new Blob(["video"]), fileName: "source.mp4", method: "motion",
      sourceFps: 29.97, targetFps: 59.94,
    }, "client-2");
    expect(form.get("target_fps")).toBe("59.94");
    expect(form.get("source_fps")).toBe("29.97");
    expect(form.has("target_multiplier")).toBe(false);
  });

  it("migrates a stale RIFE value to Motion before creating a Frame Booster job", () => {
    expect(normalizeFrameInterpolationMethod("rife")).toBe("motion");
    const form = createFrameInterpolationFormData({
      blob: new Blob(["video"]), fileName: "legacy.mp4",
      method: "rife" as never, targetMultiplier: 2,
    }, "legacy-client");
    expect(form.get("method")).toBe("motion");
    expect([...form.keys()]).not.toContain("rife_model");
  });

  it("preserves the standalone OBMC bidirectional method in the upload contract", () => {
    expect(normalizeFrameInterpolationMethod("motion-obmc")).toBe("motion-obmc");
    const form = createFrameInterpolationFormData({
      blob: new Blob(["video"]), fileName: "obmc.mp4",
      method: "motion-obmc", targetFps: 60,
    }, "obmc-client");
    expect(form.get("method")).toBe("motion-obmc");
    expect(form.get("target_fps")).toBe("60");
  });

  it("does not start an upload when ownership was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(frameInterpolationJob({
      blob: new Blob(["video"]), fileName: "stale.mp4", method: "motion", targetMultiplier: 2,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("retries health while the automatically started backend is still booting", async () => {
    ensurePythonUpscalerService.mockResolvedValue(true);
    const capabilities = { ffmpeg: true, jobs: true };
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("connection refused"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ interpolation: capabilities }), { status: 200 }));

    await expect(waitForFrameInterpolationHealth({ timeoutMs: 2_000 })).resolves.toMatchObject({ ffmpeg: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(ensurePythonUpscalerService).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the shared Python backend cannot be started", async () => {
    ensurePythonUpscalerService.mockResolvedValue(false);
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("connection refused"));

    await expect(waitForFrameInterpolationHealth({ timeoutMs: 2_000 })).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ensurePythonUpscalerService).toHaveBeenCalledTimes(1);
  });

  it("probes source FPS immediately through the local backend", async () => {
    const metadata = { frameCount: 241, fps: 29.97002997, durationSeconds: 8.04, width: 720, height: 1280, hasAudio: true };
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ interpolation: { ffmpeg: true, jobs: true } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(metadata), { status: 200, headers: { "Content-Type": "application/json" } }));
    const file = new File(["video"], "base.mp4", { type: "video/mp4" });

    await expect(probeFrameInterpolationSource(file)).resolves.toMatchObject(metadata);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8765/interpolation/probe", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
  });
});
