import { describe, expect, it } from "vitest";
import { assertPortraitLandscapeFrameIntegrity, portraitLandscapeOfflineFrameCount, portraitLandscapeOfflineFrameTiming, resolvePortraitLandscapeRhythmPulse } from "./portrait-landscape-offline-exporter";

describe("portrait landscape offline export", () => {
  it("calcola tutti i frame anche a 120 fps senza troncare la coda", () => {
    expect(portraitLandscapeOfflineFrameCount(60, 120)).toBe(7200);
    expect(portraitLandscapeOfflineFrameCount(1.001, 60)).toBe(61);
    const last = portraitLandscapeOfflineFrameTiming(60, 1.001, 60);
    expect(last.timestampSeconds).toBe(1);
    expect(last.durationSeconds).toBeCloseTo(.001);
    expect(last.sampleTimeSeconds).toBeLessThan(1.001);
  });

  it("blocca un file con frame mancanti e usa l’ultimo evento ritmico", () => {
    expect(() => assertPortraitLandscapeFrameIntegrity(120, 119)).toThrow(/anti-drop/);
    expect(() => assertPortraitLandscapeFrameIntegrity(120, 120)).not.toThrow();
    const pulse = resolvePortraitLandscapeRhythmPulse(1.1, [{ timeSeconds: .5, strength: .2 }, { timeSeconds: 1, strength: 1 }], 0);
    expect(pulse).toBeGreaterThan(.5);
  });
});
