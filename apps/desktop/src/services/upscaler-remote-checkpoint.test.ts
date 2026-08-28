import { describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { hasCompatibleRemoteUpscalerCheckpoint, plausibleRemoteCheckpointJobs } from "./upscaler-remote-checkpoint";

function remoteSettings() {
  const settings = createProject().animation.upscaler;
  return {
    ...settings,
    remote: {
      ...settings.remote,
      enabled: true,
      model: "RealESRGAN_x4plus",
      segmentFrames: 300,
      outputFps: null,
      endpoints: [{ id: "one", label: "Colab", url: "https://one.gradio.live", enabled: true }]
    }
  };
}

describe("remote Upscaler checkpoint discovery", () => {
  it("scarta subito cache di file, modello o segmentazione differenti", () => {
    const settings = remoteSettings();
    const base = { id: "job", phase: "ready" as const, phaseLabel: "Pronto", progress: 1, currentFrame: 1, totalFrames: 1, tempDirectory: "cache", originalFramesDirectory: "", upscaledFramesDirectory: "", remote: true, sourceBytes: 4, sourceHash: "hash", model: settings.remote.model, remoteChunkFrames: 300, remoteOutputFps: null, outputFps: 24 };
    expect(plausibleRemoteCheckpointJobs([base], 4, settings)).toHaveLength(1);
    expect(plausibleRemoteCheckpointJobs([{ ...base, sourceBytes: 5 }], 4, settings)).toHaveLength(0);
    expect(plausibleRemoteCheckpointJobs([{ ...base, model: "other" }], 4, settings)).toHaveLength(0);
    expect(plausibleRemoteCheckpointJobs([{ ...base, remoteChunkFrames: 100 }], 4, settings)).toHaveLength(0);
  });

  it("confronta SHA-256 soltanto per un candidato plausibile", async () => {
    const source = new File(["same-video"], "renamed.mp4", { type: "video/mp4" });
    const expected = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("same-video"));
    const sourceHash = Array.from(new Uint8Array(expected), (value) => value.toString(16).padStart(2, "0")).join("");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ jobs: [{
      id: "job", phase: "ready", phaseLabel: "Pronto", progress: 1, currentFrame: 1, totalFrames: 1,
      tempDirectory: "cache", originalFramesDirectory: "", upscaledFramesDirectory: "", remote: true,
      sourceBytes: source.size, sourceHash, model: "RealESRGAN_x4plus", remoteChunkFrames: 300, remoteOutputFps: null
    }] }), { status: 200 }));
    await expect(hasCompatibleRemoteUpscalerCheckpoint(source, remoteSettings())).resolves.toBe(true);
  });

  it("considera nuovo un file con hash diverso anche se ha la stessa dimensione", async () => {
    const source = new File(["new-video!"], "new.mp4", { type: "video/mp4" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ jobs: [{
      id: "old", phase: "ready", phaseLabel: "Pronto", progress: 1, currentFrame: 1, totalFrames: 1,
      tempDirectory: "cache", originalFramesDirectory: "", upscaledFramesDirectory: "", remote: true,
      sourceBytes: source.size, sourceHash: "0".repeat(64), model: "RealESRGAN_x4plus", remoteChunkFrames: 300, remoteOutputFps: null
    }] }), { status: 200 }));
    await expect(hasCompatibleRemoteUpscalerCheckpoint(source, remoteSettings())).resolves.toBe(false);
  });
});
