import { describe, expect, it } from "vitest";
import { createVideoEditorArtifact, videoEditorToolRegistry } from "./video-editor-tools";

describe("Video Editor tool registry", () => {
  it("exposes the wired processors and never creates empty artifacts", () => {
    expect(videoEditorToolRegistry).toHaveLength(3);
    expect(() => createVideoEditorArtifact("upscaler", { id: "clip", assetId: "asset", trackId: "track", startSeconds: 0, durationSeconds: 1, sourceInSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0, fadeCurve: "smooth", audioFadeInSeconds: 0, audioFadeOutSeconds: 0, blendMode: "normal", blendIntensity: 1, adjustments: { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, clarity: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, blur: 0, grayscale: 0, sepia: 0, fade: 0, vignette: 0, opacity: 1 }, fit: "cover", muted: false, volume: 1 }, { id: "asset", name: "a", kind: "video", url: "blob:a", durationSeconds: 1, width: 1, height: 1, hasAudio: false, bpm: null, beats: [], downbeats: [], waveform: [] }, "")).toThrow();
    expect(videoEditorToolRegistry.every((tool) => tool.status === "available")).toBe(true);
    const image = { id: "image", name: "i", kind: "image" as const, url: "blob:i", durationSeconds: 1, width: 1, height: 1, hasAudio: false, bpm: null, beats: [], downbeats: [], waveform: [] };
    expect(videoEditorToolRegistry.every((tool) => !tool.accepts(image))).toBe(true);
  });
});
