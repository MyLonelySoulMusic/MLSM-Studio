import { describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import type { VideoEditorClip } from "./video-editor";
import {
  defaultVideoEditorAudioMix,
  videoEditorAudioMix,
  videoEditorAudioMixValue,
  videoEditorAudioMixWithValue,
  videoEditorAutomaticAudioFadeSeconds,
  videoEditorDbToGain
} from "./video-editor-audio-mix";
import { videoEditorSettingsAtAutomationFrame } from "./video-editor-renderer";

const clip = { volume: 1 } as VideoEditorClip;

describe("Video Editor · Mix audio", () => {
  it("mantiene neutri i progetti precedenti privi del blocco audioMix", () => {
    expect(videoEditorAudioMix(clip)).toEqual(defaultVideoEditorAudioMix);
    expect(videoEditorAudioMixValue(clip, "audioMix.pan")).toBe(0);
    expect(videoEditorAudioMixValue(clip, "volume")).toBe(1);
  });

  it("aggiorna proprietà annidate senza perdere gli altri parametri", () => {
    const withMid = { ...clip, ...videoEditorAudioMixWithValue(clip, "audioMix.eq.midGainDb", 4.5) };
    const withPan = { ...withMid, ...videoEditorAudioMixWithValue(withMid, "audioMix.pan", -.7) };
    expect(videoEditorAudioMix(withPan)).toMatchObject({ pan: -.7, eq: { midGainDb: 4.5, lowFrequencyHz: 120 } });
  });

  it("calcola fade automatici sicuri e converte il make-up gain in ampiezza", () => {
    expect(videoEditorAutomaticAudioFadeSeconds(10)).toBe(.4);
    expect(videoEditorAutomaticAudioFadeSeconds(.2)).toBeLessThanOrEqual(.1);
    expect(videoEditorDbToGain(6)).toBeCloseTo(1.995, 2);
  });

  it("risolve gli inviluppi di pan ed EQ nello snapshot usato da preview ed export", () => {
    const settings = createProject("Automation audio").animation.videoEditor;
    const source = {
      ...clip, id: "c", assetId: "a", trackId: settings.tracks[1]!.id, startSeconds: 0, durationSeconds: 4, blendIntensity: 1,
      adjustments: { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, clarity: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, blur: 0, grayscale: 0, sepia: 0, fade: 0, vignette: 0, opacity: 1 }
    };
    const snapshot = videoEditorSettingsAtAutomationFrame({
      ...settings,
      clips: [source],
      automationLanes: [
        { id: "pan", enabled: true, target: { kind: "clip", clipId: "c", property: "audioMix.pan" }, keyframes: [{ id: "p0", frame: 0, value: -1, curve: "linear" }, { id: "p1", frame: 120, value: 1, curve: "linear" }] },
        { id: "eq", enabled: true, target: { kind: "clip", clipId: "c", property: "audioMix.eq.midGainDb" }, keyframes: [{ id: "e0", frame: 0, value: 0, curve: "linear" }, { id: "e1", frame: 120, value: 12, curve: "linear" }] }
      ]
    }, 1);
    expect(snapshot.clips[0]?.audioMix?.pan).toBeCloseTo(0);
    expect(snapshot.clips[0]?.audioMix?.eq.midGainDb).toBeCloseTo(6);
  });
});
