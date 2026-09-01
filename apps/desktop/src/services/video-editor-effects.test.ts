import { createProject } from "@rbs/project-schema";
import { describe, expect, it } from "vitest";
import type { VideoEditorAsset, VideoEditorClip, VideoEditorEffectClip, VideoEditorSettings } from "./video-editor";
import {
  videoEditorClampEffect,
  videoEditorEffectCatalog,
  videoEditorEffectCssFilter,
  videoEditorEffectEnvelope,
  videoEditorEffectFrameState,
  videoEditorEffectFrameStateIsNeutral,
  videoEditorEffectOpacityMultiplier,
  videoEditorEffectPreviewVariables,
  videoEditorMoveEffect,
  videoEditorPlaceEffect,
  videoEditorTrimEffect
} from "./video-editor-effects";

const base = createProject("Effetti").animation.videoEditor;
const asset: VideoEditorAsset = {
  id: "video", name: "video.mp4", kind: "video", url: "blob:video", durationSeconds: 10,
  width: 1080, height: 1920, hasAudio: true, bpm: null, beats: [], downbeats: [], waveform: []
};
const clip: VideoEditorClip = {
  id: "clip", assetId: asset.id, trackId: "video-editor-track-main", startSeconds: 2, durationSeconds: 6, sourceInSeconds: 0,
  fadeInSeconds: 0, fadeOutSeconds: 0, fadeCurve: "smooth", audioFadeInSeconds: 0, audioFadeOutSeconds: 0,
  blendMode: "normal", blendIntensity: 1,
  adjustments: { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, clarity: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, blur: 0, grayscale: 0, sepia: 0, fade: 0, vignette: 0, opacity: 1 },
  fit: "cover", muted: false, volume: 1
};
const settings = (effectClips: VideoEditorEffectClip[] = []): VideoEditorSettings => ({ ...base, assets: [asset], clips: [clip], effectClips });
const effect = (overrides: Partial<VideoEditorEffectClip> = {}): VideoEditorEffectClip => ({
  id: "fade", effectId: "fade-in", target: { kind: "clip", clipId: clip.id }, startSeconds: 2, durationSeconds: 2,
  enabled: true, mix: 1, parameters: { curve: "linear" }, ...overrides
});

describe("Video Editor · clip effetto", () => {
  it("calcola Fade In e Fade Out con la stessa curva usata da preview ed export", () => {
    const fadeIn = effect();
    const fadeOut = effect({ effectId: "fade-out", startSeconds: 6 });
    expect(videoEditorEffectEnvelope(fadeIn, 1.99)).toBe(0);
    expect(videoEditorEffectEnvelope(fadeIn, 2.5)).toBeCloseTo(.25, 10);
    expect(videoEditorEffectEnvelope(fadeIn, 3)).toBeCloseTo(.5, 10);
    expect(videoEditorEffectEnvelope(fadeIn, 4)).toBe(1);
    expect(videoEditorEffectEnvelope(fadeOut, 5.99)).toBe(1);
    expect(videoEditorEffectEnvelope(fadeOut, 6.5)).toBeCloseTo(.75, 10);
    expect(videoEditorEffectEnvelope(fadeOut, 7)).toBeCloseTo(.5, 10);
    expect(videoEditorEffectEnvelope(fadeOut, 8)).toBe(0);
  });

  it("rispetta curva, mix, disattivazione e ignora effetti sconosciuti", () => {
    expect(videoEditorEffectEnvelope(effect({ parameters: { curve: "smooth" } }), 2.5)).toBeCloseTo(.15625, 10);
    expect(videoEditorEffectEnvelope(effect({ parameters: { curve: "exponential" } }), 3)).toBeCloseTo(Math.pow(.5, 2.2), 10);
    expect(videoEditorEffectEnvelope(effect({ mix: .5 }), 2)).toBe(.5);
    expect(videoEditorEffectEnvelope(effect({ enabled: false }), 2)).toBe(1);
    expect(videoEditorEffectEnvelope(effect({ effectId: "future-effect" }), 2)).toBe(1);
  });

  it("moltiplica più inviluppi soltanto sulla clip target", () => {
    const effects = [effect({ id: "a" }), effect({ id: "b", mix: .5 })];
    expect(videoEditorEffectOpacityMultiplier(effects, clip.id, 2)).toBe(0);
    expect(videoEditorEffectOpacityMultiplier(effects, "altra", 2)).toBe(1);
    expect(videoEditorEffectOpacityMultiplier(effects, clip.id, 3)).toBeCloseTo(.375, 10);
  });

  it("posiziona, sposta e rifila sempre dentro la clip target", () => {
    expect(videoEditorPlaceEffect(settings(), "fade-in", clip.id)).toMatchObject({ startSeconds: 2, durationSeconds: .65 });
    expect(videoEditorPlaceEffect(settings(), "fade-out", clip.id)).toMatchObject({ startSeconds: 7.35, durationSeconds: .65 });
    const current = effect({ durationSeconds: 1 });
    const state = settings([current]);
    expect(videoEditorMoveEffect(state, current.id, 99)?.startSeconds).toBe(7);
    expect(videoEditorTrimEffect(state, current.id, "end", 99)?.durationSeconds).toBe(6);
    expect(videoEditorTrimEffect(state, current.id, "start", -5)?.startSeconds).toBe(2);
    expect(videoEditorClampEffect(state, effect({ startSeconds: -10, durationSeconds: 99 }))).toMatchObject({ startSeconds: 2, durationSeconds: 6 });
  });

  it("espone un catalogo professionale organizzato e senza card decorative", () => {
    expect(videoEditorEffectCatalog.length).toBeGreaterThanOrEqual(10);
    expect(new Set(videoEditorEffectCatalog.map((definition) => definition.id)).size).toBe(videoEditorEffectCatalog.length);
    expect(new Set(videoEditorEffectCatalog.map((definition) => definition.category))).toEqual(new Set(["transitions", "motion", "color", "distortion", "light"]));

    // Ogni voce deve produrre un vero stato di rendering nel punto centrale:
    // una card senza implementazione rimarrebbe neutra e farebbe fallire il test.
    for (const definition of videoEditorEffectCatalog) {
      const runtime = effect({
        id: definition.id,
        effectId: definition.id,
        startSeconds: 2,
        durationSeconds: definition.defaultDurationSeconds,
        parameters: { ...definition.defaultParameters }
      });
      const state = videoEditorEffectFrameState([runtime], clip.id, 2 + definition.defaultDurationSeconds * .43, 1920, 1080);
      expect(state.opacity !== 1 || !videoEditorEffectFrameStateIsNeutral(state), `${definition.id} deve alterare il frame`).toBe(true);
    }
  });

  it("risolve movimento e look in modo deterministico e soltanto sulla clip target", () => {
    const shake = effect({ effectId: "camera-shake", parameters: { amount: .03, frequency: 7 }, durationSeconds: 2 });
    const noir = effect({ id: "noir", effectId: "noir", parameters: { amount: .8 }, durationSeconds: 2 });
    const first = videoEditorEffectFrameState([shake, noir], clip.id, 2.75, 1000, 500);
    const second = videoEditorEffectFrameState([shake, noir], clip.id, 2.75, 1000, 500);
    expect(first).toEqual(second);
    expect(Math.abs(first.translateX) + Math.abs(first.translateY)).toBeGreaterThan(0);
    expect(first.grayscale).toBeCloseTo(.8, 6);
    expect(first.contrast).toBeGreaterThan(1);
    expect(videoEditorEffectFrameState([shake, noir], "altra", 2.75, 1000, 500)).toEqual(expect.objectContaining({ opacity: 1, scale: 1, grayscale: 0 }));
  });

  it("serializza il filtro condiviso da DOM, canvas ed export", () => {
    const bloom = effect({ effectId: "dream-bloom", parameters: { amount: .6, blur: 4 }, durationSeconds: 2 });
    const state = videoEditorEffectFrameState([bloom], clip.id, 3, 1920, 1080);
    const css = videoEditorEffectCssFilter(state);
    expect(css).toContain("brightness(");
    expect(css).toContain("saturate(");
    expect(css).toContain("blur(2.400px)");
  });

  it("non introduce salti tra la coda dell’effetto e il frame successivo", () => {
    for (const definition of videoEditorEffectCatalog) {
      const runtime = effect({
        id: definition.id,
        effectId: definition.id,
        startSeconds: 2,
        durationSeconds: definition.defaultDurationSeconds,
        parameters: { ...definition.defaultParameters }
      });
      const end = 2 + definition.defaultDurationSeconds;
      const atEnd = videoEditorEffectFrameState([runtime], clip.id, end, 1920, 1080);
      const nextFrame = videoEditorEffectFrameState([runtime], clip.id, end + 1 / 60, 1920, 1080);
      for (const key of Object.keys(atEnd) as Array<keyof typeof atEnd>) {
        expect(nextFrame[key], `${definition.id}.${key}`).toBeCloseTo(atEnd[key], 8);
      }
    }
  });

  it("deriva preview sensibili a frequenza, diffusione, quantità e mix", () => {
    const rgb = videoEditorEffectCatalog.find((definition) => definition.id === "rgb-split")!;
    const rgbSlow = videoEditorEffectPreviewVariables(rgb, { amount: .014, frequency: 4 }, 1);
    const rgbFast = videoEditorEffectPreviewVariables(rgb, { amount: .014, frequency: 16 }, 1);
    expect(rgbSlow.frequency).toBe(4);
    expect(rgbFast.frequency).toBe(16);

    const bloom = videoEditorEffectCatalog.find((definition) => definition.id === "dream-bloom")!;
    expect(videoEditorEffectPreviewVariables(bloom, { amount: .65, blur: 3 }, 1).blurPixels).toBe("3px");
    expect(videoEditorEffectPreviewVariables(bloom, { amount: .65, blur: 8 }, .5).blurPixels).toBe("4px");

    const flicker = videoEditorEffectCatalog.find((definition) => definition.id === "film-flicker")!;
    const subtle = videoEditorEffectPreviewVariables(flicker, { amount: .1, frequency: 7 }, 1);
    const strong = videoEditorEffectPreviewVariables(flicker, { amount: .3, frequency: 7 }, 1);
    const disabled = videoEditorEffectPreviewVariables(flicker, { amount: .3, frequency: 7 }, 0);
    expect(strong.flickerHigh).toBeGreaterThan(subtle.flickerHigh);
    expect(strong.flickerLow).toBeLessThan(subtle.flickerLow);
    expect(disabled).toMatchObject({ flickerLow: 1, flickerHigh: 1, flickerContrast: 1 });
  });

  it("avvia Pull Back e gli Slide da posa neutra anche a metà clip", () => {
    for (const effectId of ["zoom-out", "slide-up", "slide-right"] as const) {
      const definition = videoEditorEffectCatalog.find((item) => item.id === effectId)!;
      const runtime = effect({
        id: effectId, effectId, startSeconds: 2, durationSeconds: 1,
        parameters: { ...definition.defaultParameters }
      });
      const before = videoEditorEffectFrameState([runtime], clip.id, 2 - 1 / 60, 1920, 1080);
      const atStart = videoEditorEffectFrameState([runtime], clip.id, 2, 1920, 1080);
      const next = videoEditorEffectFrameState([runtime], clip.id, 2 + 1 / 60, 1920, 1080);
      const atEnd = videoEditorEffectFrameState([runtime], clip.id, 3, 1920, 1080);
      expect(videoEditorEffectFrameStateIsNeutral(before), `${effectId} prima`).toBe(true);
      expect(videoEditorEffectFrameStateIsNeutral(atStart), `${effectId} inizio`).toBe(true);
      expect(videoEditorEffectFrameStateIsNeutral(next), `${effectId} frame successivo`).toBe(false);
      expect(Math.abs(next.scale - 1), `${effectId} scala continua`).toBeLessThan(.01);
      expect(Math.abs(next.translateX), `${effectId} X continua`).toBeLessThan(3);
      expect(Math.abs(next.translateY), `${effectId} Y continua`).toBeLessThan(3);
      expect(videoEditorEffectFrameStateIsNeutral(atEnd), `${effectId} fine`).toBe(true);
    }
  });
});
