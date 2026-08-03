import { describe, expect, it } from "vitest";
import {
  assertPixelsSubFrameIntegrity,
  pixelsSubOfflineFrameCount,
  pixelsSubOfflineFrameTiming,
  resolvePixelsSubOfflineRhythmPulse
} from "./pixels-sub-offline-exporter";

describe("Pixels Subtitles offline export timing", () => {
  it("usa il numero esatto di frame necessario a coprire la durata", () => {
    expect(pixelsSubOfflineFrameCount(1.01, 60)).toBe(61);
    expect(pixelsSubOfflineFrameCount(2, 30)).toBe(60);
  });

  it("assegna timestamp contigui e accorcia soltanto l'ultimo frame", () => {
    const first = pixelsSubOfflineFrameTiming(0, 1.01, 60);
    const penultimate = pixelsSubOfflineFrameTiming(59, 1.01, 60);
    const last = pixelsSubOfflineFrameTiming(60, 1.01, 60);
    expect(first.timestampSeconds).toBe(0);
    expect(first.durationSeconds).toBeCloseTo(1 / 60, 10);
    expect(penultimate.timestampSeconds + penultimate.durationSeconds).toBeCloseTo(last.timestampSeconds, 10);
    expect(last.timestampSeconds + last.durationSeconds).toBeCloseTo(1.01, 10);
    expect(last.durationSeconds).toBeGreaterThan(0);
  });

  it("rifiuta un file quando il conteggio dei frame codificati non coincide", () => {
    expect(() => assertPixelsSubFrameIntegrity(600, 599)).toThrow(/anti-drop/);
    expect(() => assertPixelsSubFrameIntegrity(600, 600)).not.toThrow();
  });

  it("ricostruisce il pulse ritmico dal tempo assoluto del frame", () => {
    const events = [{ timeSeconds: 1, strength: 1 }, { timeSeconds: 2, strength: .6 }];
    expect(resolvePixelsSubOfflineRhythmPulse(.5, events, .25)).toBe(.25);
    expect(resolvePixelsSubOfflineRhythmPulse(1, events, 0)).toBe(1);
    expect(resolvePixelsSubOfflineRhythmPulse(1.18, events, 0)).toBeCloseTo(Math.exp(-1), 6);
  });
});
