import { describe, expect, it } from "vitest";
import { createProject, parseProject } from "./index";

function projectWithAudioMix(patch: Record<string, unknown>) {
  const project = createProject("Audio mix schema");
  const asset = { id: "a", name: "voce.wav", kind: "audio", url: "blob:a", durationSeconds: 8, width: 0, height: 0, hasAudio: true, bpm: null, beats: [], downbeats: [], waveform: [] };
  const clip = {
    id: "c", assetId: "a", trackId: "video-editor-track-audio", startSeconds: 0, durationSeconds: 8,
    audioMix: patch
  };
  return parseProject({ ...project, animation: { ...project.animation, videoEditor: { ...project.animation.videoEditor, assets: [asset], clips: [clip] } } });
}

describe("project schema · Video Editor Mix audio", () => {
  it("persiste pan, equalizzatore, compressore e modalità fade", () => {
    const clip = projectWithAudioMix({
      pan: -.35, fadeMode: "automatic",
      eq: { enabled: true, midGainDb: 3.5 },
      compressor: { enabled: true, thresholdDb: -24, ratio: 6 }
    }).animation.videoEditor.clips[0]!;
    expect(clip.audioMix).toMatchObject({
      pan: -.35, fadeMode: "automatic",
      eq: { enabled: true, lowGainDb: 0, midGainDb: 3.5, highFrequencyHz: 8_000 },
      compressor: { enabled: true, thresholdDb: -24, ratio: 6, attackMs: 10 }
    });
  });

  it("rifiuta parametri fuori dai limiti audio", () => {
    expect(() => projectWithAudioMix({ pan: 2 })).toThrow();
    expect(() => projectWithAudioMix({ pan: 0, eq: { midGainDb: 30 } })).toThrow();
    expect(() => projectWithAudioMix({ pan: 0, compressor: { ratio: 30 } })).toThrow();
  });
});
