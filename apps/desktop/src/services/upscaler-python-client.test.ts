import { describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import { buildUpscalerVideoForm, pythonUpscalerSupportsVideoJobs, shouldUsePythonUpscaler, type PythonUpscalerHealth } from "./upscaler-python-client";

const cpuHealth: PythonUpscalerHealth = { ok: true, mps: false, cuda: false, recommendedBackend: "cpu", gpuName: "CPU" };
const metalHealth: PythonUpscalerHealth = { ok: true, mps: true, cuda: false, recommendedBackend: "metal", gpuName: "Apple Silicon · MPS/Metal" };

describe("routing Upscaler PyTorch", () => {
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
  });

  it("invia al backend il frammento sorgente selezionato", () => {
    const settings = { ...createProject().animation.upscaler, sourceStartSeconds: 2.5, sourceDurationSeconds: 1.25 };
    const form = buildUpscalerVideoForm(new Blob(["video"], { type: "video/mp4" }), "source.mp4", settings, "high", "client");
    expect(form.get("source_start_seconds")).toBe("2.5");
    expect(form.get("source_duration_seconds")).toBe("1.25");
  });
});
