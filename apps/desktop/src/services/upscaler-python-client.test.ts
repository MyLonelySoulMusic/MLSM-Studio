import { describe, expect, it } from "vitest";
import { pythonUpscalerSupportsVideoJobs, shouldUsePythonUpscaler, type PythonUpscalerHealth } from "./upscaler-python-client";

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
});
