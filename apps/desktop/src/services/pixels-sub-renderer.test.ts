import { describe, expect, it } from "vitest";
import { activePixelsSubCue, PIXELS_SUB_FONT_FAMILIES, pixelsSubFontWeight, resolvePixelsSubCueEnvelope, resolvePixelsSubImageRect, resolvePixelsSubPaletteWeights, resolvePixelsSubRhythmState, resolvePixelsSubSwapTarget } from "./pixels-sub-renderer";

const cues = [
  { id: "a", startSeconds: 1, endSeconds: 2.5, text: "FIRST REGION", confidence: 1, verified: true, manual: true },
  { id: "b", startSeconds: 4, endSeconds: 5, text: "SECOND REGION", confidence: 1, verified: true, manual: true }
];

describe("Pixels Subtitles composition", () => {
  it("riduce e centra anche una cover con lo stesso rapporto del video", () => {
    const rect = resolvePixelsSubImageRect(1080, 1920, 1080, 1920, .065);
    expect(rect.x).toBeCloseTo(70.2);
    expect(rect.y).toBeCloseTo(124.8);
    expect(rect.width).toBeCloseTo(939.6);
    expect(rect.height).toBeCloseTo(1670.4);
  });

  it("mostra interamente una cover quadrata senza crop", () => {
    const rect = resolvePixelsSubImageRect(1080, 1920, 1000, 1000, .065);
    expect(rect.width).toBeCloseTo(rect.height);
    expect(rect.x).toBeGreaterThan(0);
    expect(rect.y).toBeGreaterThan(rect.x);
    expect(rect.x + rect.width).toBeLessThan(1080);
    expect(rect.y + rect.height).toBeLessThan(1920);
  });

  it("attiva esclusivamente la frase collegata al tempo corrente", () => {
    expect(activePixelsSubCue(.9, cues)).toBeNull();
    expect(activePixelsSubCue(1.4, cues)?.id).toBe("a");
    expect(activePixelsSubCue(3, cues)).toBeNull();
    expect(activePixelsSubCue(4.8, cues)?.id).toBe("b");
  });

  it("apre e chiude ogni frase con un inviluppo continuo", () => {
    expect(resolvePixelsSubCueEnvelope(1, cues[0]!).visibility).toBe(0);
    expect(resolvePixelsSubCueEnvelope(1.3, cues[0]!).visibility).toBeGreaterThan(.9);
    expect(resolvePixelsSubCueEnvelope(2, cues[0]!).visibility).toBe(1);
    expect(resolvePixelsSubCueEnvelope(2.5, cues[0]!).visibility).toBe(0);
  });

  it("espone soltanto famiglie pixel locali con il peso corretto", () => {
    expect(PIXELS_SUB_FONT_FAMILIES).toEqual(["Pixelify Sans", "Press Start 2P", "Silkscreen", "VT323", "Tiny5", "Jersey 10"]);
    expect(pixelsSubFontWeight("Pixelify Sans")).toBe(700);
    expect(pixelsSubFontWeight("Silkscreen")).toBe(400);
  });

  it("mantiene tutti e tre i colori e sposta il peso cromatico con la frequenza", () => {
    const low = resolvePixelsSubPaletteWeights(0);
    const middle = resolvePixelsSubPaletteWeights(.5);
    const high = resolvePixelsSubPaletteWeights(1);
    for (const weights of [low, middle, high]) {
      expect(weights.every((weight) => weight > .1)).toBe(true);
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    }
    expect(low[0]).toBeGreaterThan(low[2]);
    expect(middle[1]).toBeGreaterThan(middle[0]);
    expect(high[2]).toBeGreaterThan(high[0]);
  });

  it("genera impulsi distinti e temporizzati per kick e snare", () => {
    const hits = [{ timeSeconds: 1, strength: .9, type: "kick" as const }, { timeSeconds: 2, strength: .7, type: "snare" as const }];
    expect(resolvePixelsSubRhythmState(.9, hits)).toBeNull();
    expect(resolvePixelsSubRhythmState(1.08, hits)).toMatchObject({ hitIndex: 0, type: "kick", strength: .9 });
    expect(resolvePixelsSubRhythmState(1.31, hits)).toBeNull();
    expect(resolvePixelsSubRhythmState(2.07, hits)).toMatchObject({ hitIndex: 1, type: "snare", strength: .7 });
    expect(resolvePixelsSubRhythmState(2.23, hits)).toBeNull();
  });

  it("scambia coppie deterministiche e reciproche di celle", () => {
    const state = { hitIndex: 3, type: "kick" as const, strength: 1, impulse: 1 };
    const crossAxis = Array.from({ length: 80 }, (_, index) => index).find((index) => resolvePixelsSubSwapTarget(0, 24, index, state) !== 0);
    expect(crossAxis).toBeDefined();
    const target = resolvePixelsSubSwapTarget(0, 24, crossAxis!, state);
    expect(target).toBe(4);
    expect(resolvePixelsSubSwapTarget(target, 24, crossAxis!, state)).toBe(0);
  });
});
