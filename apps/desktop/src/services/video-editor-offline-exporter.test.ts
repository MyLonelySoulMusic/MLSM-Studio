import { describe, expect, it } from "vitest";
import {
  assertVideoEditorInterpolationIntegrity,
  assertVideoEditorFrameIntegrity,
  expectedVideoEditorInterpolationFrameCount,
  videoEditorAudioSourceOffset,
  videoEditorAudioConsumedSourceSeconds,
  videoEditorAudioRateAutomation,
  videoEditorInterpolationExportProgress,
  videoEditorOfflineFrameCount,
  videoEditorOfflineFrameTiming
} from "./video-editor-offline-exporter";
import { createProject } from "@rbs/project-schema";
import { videoEditorClipSourceDuration, videoEditorClipSourceTimeAtFrame, videoEditorSplitSpeed } from "./video-editor-speed";
import { videoEditorSourceTime, type VideoEditorClip } from "./video-editor";
import { videoEditorToolSourceRange } from "./video-editor-tools";

describe("Video Editor · tempi dell’export offline", () => {
  const rampClip = (curve: "hold" | "linear" | "exponential" | "logarithmic" | "custom", durationSeconds = 1): VideoEditorClip => ({
    id: `ramp-${curve}`, assetId: "asset", trackId: "track", startSeconds: 1, durationSeconds, sourceInSeconds: 0,
    speed: { mode: "ramp", constant: 1, preservePitch: false, points: [
      { id: "a", frame: 0, speed: 1, curve: "linear" },
      { id: "b", frame: 60, speed: 2, curve, ...(curve === "custom" ? { bezier: { x1: .15, y1: .05, x2: .7, y2: .9 } } : {}) }
    ] }
  } as VideoEditorClip);

  it("crea hold per-frame campionati al midpoint, senza un punto interpolato al bordo finale", () => {
    const settings = createProject().animation.videoEditor;
    const clip = rampClip("linear");
    const points = videoEditorAudioRateAutomation(clip, settings, 2);
    expect(points).toHaveLength(60);
    expect(points[0]).toEqual({ timeSeconds: 1, rate: expect.closeTo(1 + .5 / 60, 10) });
    expect(points.at(-1)?.timeSeconds).toBeCloseTo(1 + 59 / 60, 10);
    expect(points[30]?.rate).toBeCloseTo(1 + 30.5 / 60, 10);
  });

  it.each(["hold", "exponential", "logarithmic", "custom"] as const)("consuma la stessa sorgente del mapping video per la curva %s", (curve) => {
    const settings = createProject().animation.videoEditor;
    const clip = rampClip(curve);
    const points = videoEditorAudioRateAutomation(clip, settings, 2);
    const audioConsumed = videoEditorAudioConsumedSourceSeconds(points, 2);
    const videoConsumed = videoEditorClipSourceTimeAtFrame(clip, 120, settings.timebase) - clip.sourceInSeconds;
    expect(audioConsumed).toBeCloseTo(videoConsumed, 10);
  });

  it("integra esattamente anche una durata che termina dentro l’ultimo frame", () => {
    const settings = createProject().animation.videoEditor;
    const clip = rampClip("custom", 1.01);
    const end = clip.startSeconds + clip.durationSeconds;
    const points = videoEditorAudioRateAutomation(clip, settings, end);
    expect(points).toHaveLength(61);
    const expected = points.slice(0, -1).reduce((sum, point) => sum + point.rate / 60, 0)
      + points.at(-1)!.rate * (end - points.at(-1)!.timeSeconds);
    expect(videoEditorAudioConsumedSourceSeconds(points, end)).toBeCloseTo(expected, 12);
  });

  it("mantiene in parità video, audio, sourceDuration e tool range con start .010 e durata 1.01", () => {
    const settings = createProject().animation.videoEditor;
    const clip = { ...rampClip("custom", 1.01), startSeconds: .010, sourceInSeconds: 3 };
    const end = clip.startSeconds + clip.durationSeconds;
    const points = videoEditorAudioRateAutomation(clip, settings, end);
    const audioConsumed = videoEditorAudioConsumedSourceSeconds(points, end);
    const sourceDuration = videoEditorClipSourceDuration(clip, settings.timebase);
    const toolRange = videoEditorToolSourceRange(clip, settings.timebase);
    expect(points[0]?.timeSeconds).toBe(.010);
    expect(points).toHaveLength(61);
    expect(audioConsumed).toBeCloseTo(sourceDuration, 12);
    expect(videoEditorSourceTime(clip, end, settings.timebase) - clip.sourceInSeconds).toBeCloseTo(sourceDuration, 12);
    expect(toolRange).toEqual({
      sourceStartSeconds: 3,
      sourceDurationSeconds: expect.closeTo(sourceDuration, 12),
      sourceEndSeconds: expect.closeTo(3 + sourceDuration, 12)
    });
  });

  it("mappa lo stesso intervallo in ordine inverso per video, mix audio e tool", () => {
    const settings = createProject().animation.videoEditor;
    const clip = { ...rampClip("custom", 1.01), startSeconds: .010, sourceInSeconds: 3, reversed: true };
    const end = clip.startSeconds + clip.durationSeconds;
    const sourceDuration = videoEditorClipSourceDuration(clip, settings.timebase);

    expect(videoEditorSourceTime(clip, clip.startSeconds, settings.timebase)).toBeCloseTo(3 + sourceDuration, 12);
    expect(videoEditorSourceTime(clip, end, settings.timebase)).toBeCloseTo(3, 12);
    expect(videoEditorAudioSourceOffset(clip, settings, 10)).toBeCloseTo(10 - 3 - sourceDuration, 12);
    expect(videoEditorToolSourceRange(clip, settings.timebase)).toEqual({
      sourceStartSeconds: 3,
      sourceDurationSeconds: expect.closeTo(sourceDuration, 12),
      sourceEndSeconds: expect.closeTo(3 + sourceDuration, 12)
    });
  });

  it("mantiene l’automazione audio in fase dopo uno split rampa frazionario", () => {
    const settings = createProject().animation.videoEditor;
    const original = { ...rampClip("custom", 1.01), startSeconds: .010, sourceInSeconds: 3 };
    const cutFrames = 37.4;
    const cutSeconds = cutFrames / 60;
    const [, rightSpeed] = videoEditorSplitSpeed(original.speed, cutFrames);
    const right = {
      ...original,
      startSeconds: original.startSeconds + cutSeconds,
      sourceInSeconds: videoEditorSourceTime(original, original.startSeconds + cutSeconds, settings.timebase),
      durationSeconds: original.durationSeconds - cutSeconds,
      speed: rightSpeed
    };
    const end = right.startSeconds + right.durationSeconds;
    const points = videoEditorAudioRateAutomation(right, settings, end);
    expect(points[1]!.timeSeconds - points[0]!.timeSeconds).toBeCloseTo(.6 / 60, 12);
    expect(videoEditorAudioConsumedSourceSeconds(points, end)).toBeCloseTo(videoEditorClipSourceDuration(right, settings.timebase), 12);
  });
  it("usa il numero esatto di frame necessario a coprire la durata del montaggio", () => {
    expect(videoEditorOfflineFrameCount(2, 30)).toBe(60);
    expect(videoEditorOfflineFrameCount(4, 60)).toBe(240);
    // Una durata non multipla del passo richiede un frame in più, non uno in meno.
    expect(videoEditorOfflineFrameCount(1.01, 60)).toBe(61);
    expect(videoEditorOfflineFrameCount(1 / 60, 60)).toBe(1);
  });

  it("rifiuta durate e frame rate non utilizzabili invece di produrre un file vuoto", () => {
    expect(() => videoEditorOfflineFrameCount(0, 30)).toThrow(/durata/);
    expect(() => videoEditorOfflineFrameCount(-1, 30)).toThrow(/durata/);
    expect(() => videoEditorOfflineFrameCount(Number.NaN, 30)).toThrow(/durata/);
    expect(() => videoEditorOfflineFrameCount(2, 0)).toThrow(/frame rate/);
    expect(() => videoEditorOfflineFrameCount(2, Number.POSITIVE_INFINITY)).toThrow(/frame rate/);
  });

  it("assegna timestamp contigui e accorcia soltanto l’ultimo frame", () => {
    const first = videoEditorOfflineFrameTiming(0, 1.01, 60);
    const penultimate = videoEditorOfflineFrameTiming(59, 1.01, 60);
    const last = videoEditorOfflineFrameTiming(60, 1.01, 60);
    expect(first.timestampSeconds).toBe(0);
    expect(first.durationSeconds).toBeCloseTo(1 / 60, 10);
    expect(penultimate.timestampSeconds + penultimate.durationSeconds).toBeCloseTo(last.timestampSeconds, 10);
    expect(last.timestampSeconds + last.durationSeconds).toBeCloseTo(1.01, 10);
    expect(last.durationSeconds).toBeGreaterThan(0);
  });

  it("copre la durata senza buchi né sovrapposizioni su tutta la sequenza", () => {
    const duration = 3.37;
    const fps = 30;
    const timings = Array.from({ length: videoEditorOfflineFrameCount(duration, fps) }, (_, index) => videoEditorOfflineFrameTiming(index, duration, fps));
    let cursor = 0;
    for (const timing of timings) {
      expect(timing.timestampSeconds).toBeCloseTo(cursor, 10);
      expect(timing.durationSeconds).toBeGreaterThan(0);
      cursor = timing.timestampSeconds + timing.durationSeconds;
    }
    expect(cursor).toBeCloseTo(duration, 10);
  });

  it("campiona il montaggio al centro del frame, sempre dentro la durata", () => {
    const middle = videoEditorOfflineFrameTiming(10, 2, 60);
    expect(middle.sampleTimeSeconds).toBeCloseTo(10 / 60 + 1 / 120, 10);
    const last = videoEditorOfflineFrameTiming(119, 2, 60);
    expect(last.sampleTimeSeconds).toBeLessThan(2);
    // Il campionamento non deve mai cadere oltre la fine: nessuna clip sparirebbe a metà frame.
    expect(last.sampleTimeSeconds).toBeGreaterThan(last.timestampSeconds);
  });

  it("è deterministico: lo stesso indice produce sempre gli stessi tempi", () => {
    expect(videoEditorOfflineFrameTiming(42, 5, 24)).toEqual(videoEditorOfflineFrameTiming(42, 5, 24));
  });

  it("rifiuta un indice fuori dai limiti della sequenza", () => {
    expect(() => videoEditorOfflineFrameTiming(-1, 2, 30)).toThrow(/fuori dai limiti/);
    expect(() => videoEditorOfflineFrameTiming(60, 2, 30)).toThrow(/fuori dai limiti/);
    expect(() => videoEditorOfflineFrameTiming(1.5, 2, 30)).toThrow(/fuori dai limiti/);
    expect(() => videoEditorOfflineFrameTiming(59, 2, 30)).not.toThrow();
  });

  it("non consegna un file quando il conteggio dei frame codificati non coincide", () => {
    expect(() => assertVideoEditorFrameIntegrity(600, 599)).toThrow(/anti-drop/);
    expect(() => assertVideoEditorFrameIntegrity(600, 601)).toThrow(/anti-drop/);
    expect(() => assertVideoEditorFrameIntegrity(600, 599)).toThrow(/non è stato consegnato/);
    expect(() => assertVideoEditorFrameIntegrity(600, 600)).not.toThrow();
  });

  it("calcola il conteggio reale minimo di minterpolate col look-ahead di due frame", () => {
    expect(expectedVideoEditorInterpolationFrameCount(60, 30, 48)).toBe(93);
    expect(expectedVideoEditorInterpolationFrameCount(60, 30, 60)).toBe(117);
    expect(expectedVideoEditorInterpolationFrameCount(60, 30, 90)).toBe(175);
  });

  it("accetta la tolleranza esplicita del filtro e rifiuta risultati dimezzati", () => {
    expect(() => assertVideoEditorInterpolationIntegrity({ sourceFrames: 60, sourceFps: 30, sourceDuration: 2, outputFrames: 116, outputFps: 60, outputDuration: 117 / 60, targetFps: 60 })).not.toThrow();
    expect(() => assertVideoEditorInterpolationIntegrity({ sourceFrames: 60, sourceFps: 30, sourceDuration: 2, outputFrames: 61, outputFps: 60, outputDuration: 1.02, targetFps: 60 })).toThrow(/Conteggio interpolato incompleto/);
    expect(() => assertVideoEditorInterpolationIntegrity({ sourceFrames: 4149, sourceFps: 30, sourceDuration: 138.3, outputFrames: 4150, outputFps: 60, outputDuration: 69.2, targetFps: 60 })).toThrow(/Conteggio interpolato incompleto/);
  });

  it("rifiuta frame rate errato e durata troncata anche con abbastanza pacchetti", () => {
    expect(() => assertVideoEditorInterpolationIntegrity({ sourceFrames: 60, sourceFps: 30, sourceDuration: 2, outputFrames: 117, outputFps: 30, outputDuration: 1.95, targetFps: 60 })).toThrow(/Frame rate interpolato non valido/);
    expect(() => assertVideoEditorInterpolationIntegrity({ sourceFrames: 60, sourceFps: 30, sourceDuration: 2, outputFrames: 117, outputFps: 60, outputDuration: .98, targetFps: 60 })).toThrow(/Durata interpolata troncata/);
  });

  it("mappa upload e byte XHR nella fase visibile senza usare il testo server", () => {
    const progress = videoEditorInterpolationExportProgress({
      id: "upload", phase: "uploading", phaseLabel: "Etichetta server italiana", progress: .4, stageProgress: .4,
      uploadProgress: .4, currentFrame: 0, totalFrames: 0, processedBytes: 400, bytesProcessed: 400, totalBytes: 1_000
    });
    expect(progress).toMatchObject({ phase: "interpolation-upload", progress: .4, stageProgress: .4, processedBytes: 400, totalBytes: 1_000 });
    expect(progress.phaseLabel).toBeUndefined();
  });
});
