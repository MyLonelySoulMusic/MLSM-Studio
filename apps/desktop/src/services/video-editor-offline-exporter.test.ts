import { describe, expect, it } from "vitest";
import {
  assertVideoEditorFrameIntegrity,
  videoEditorOfflineFrameCount,
  videoEditorOfflineFrameTiming
} from "./video-editor-offline-exporter";

describe("Video Editor · tempi dell’export offline", () => {
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
});
