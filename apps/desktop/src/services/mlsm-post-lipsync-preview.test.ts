import { describe, expect, it } from "vitest";
import { fitLipsyncPreview, lipsyncPreviewClockAdjustment, lipsyncPreviewStartTime } from "./mlsm-post-lipsync-preview";

describe("fitLipsyncPreview", () => {
  it.each([
    ["9:16", 1080, 1920, 270, 480],
    ["16:9", 1920, 1080, 800, 450],
    ["1:1", 1080, 1080, 480, 480],
    ["4:3", 1440, 1080, 640, 480]
  ])("mantiene interamente visibile il formato %s", (_label, videoWidth, videoHeight, expectedWidth, expectedHeight) => {
    const result = fitLipsyncPreview(800, 480, videoWidth as number, videoHeight as number);
    expect(result?.width).toBeCloseTo(expectedWidth as number, 5);
    expect(result?.height).toBeCloseTo(expectedHeight as number, 5);
    expect((result?.width ?? 0) <= 800).toBe(true);
    expect((result?.height ?? 0) <= 480).toBe(true);
  });

  it("ignora dimensioni incomplete finché i metadati non sono disponibili", () => {
    expect(fitLipsyncPreview(800, 480, 0, 1920)).toBeNull();
  });
});

describe("lipsyncPreviewClockAdjustment", () => {
  it("riproduce senza seek continui anche il segmento 9.14x del primo hard gate", () => {
    expect(lipsyncPreviewClockAdjustment(9.14, 7.808, 7.808)).toEqual({ playbackRate: 9.14, shouldSeek: false, shouldPlay: true });
    const corrected = lipsyncPreviewClockAdjustment(9.14, 7.7, 7.808);
    expect(corrected.shouldSeek).toBe(false);
    expect(corrected.playbackRate).toBeGreaterThan(9.14);
  });

  it("usa un seek soltanto dopo una vera discontinuità del clock", () => {
    expect(lipsyncPreviewClockAdjustment(.77, 3, 3.45).shouldSeek).toBe(true);
  });

  it("campiona esattamente il video quando l'intro richiede meno della velocità nativa minima", () => {
    const openingSpeed = .02 / .978;
    expect(lipsyncPreviewClockAdjustment(openingSpeed, 0, .01)).toEqual({ playbackRate: .0625, shouldSeek: true, shouldPlay: false });
  });
});

describe("lipsyncPreviewStartTime", () => {
  it("riparte da zero dopo la fine naturale senza richiedere Stop", () => {
    expect(lipsyncPreviewStartTime(7.36, 7.36)).toBe(0);
    expect(lipsyncPreviewStartTime(7.2, 7.36, true)).toBe(0);
  });

  it("mantiene la posizione quando Play segue una pausa", () => {
    expect(lipsyncPreviewStartTime(3.125, 7.36)).toBe(3.125);
  });
});
