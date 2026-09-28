import { describe, expect, it } from "vitest";
import { assertReferenceCoverage, assertStaticWatermarkFrameIntegrity, referenceFrameTimestamps, regularFrameTimestamps, shouldPromptForUnstableAlignment, staticWatermarkEncodingError } from "./static-watermark-exporter";
import { cleanReferenceTime } from "./static-watermark-time";

describe("static watermark export integrity", () => {
  it("accepts an exact frame count", () => expect(() => assertStaticWatermarkFrameIntegrity(1800, 1800)).not.toThrow());
  it("rejects dropped frames", () => expect(() => assertStaticWatermarkFrameIntegrity(1800, 1799)).toThrow(/anti-drop/i));
  it("rejects empty videos", () => expect(() => assertStaticWatermarkFrameIntegrity(0, 0)).toThrow(/fotogrammi/i));
  it("rende diagnosticabile l'errore generico di WebCodecs", () => expect(staticWatermarkEncodingError(new DOMException("Encoding error", "EncodingError"), 24, 1800).message).toMatch(/frame 24 di 1800.*file parziale.*WebCodecs/i));
  it("indica posizione e dettaglio tecnico per gli errori GOP", () => expect(staticWatermarkEncodingError(new Error("Timestamps cannot be smaller than the largest timestamp of the previous GOP"), 288, 1200).message).toMatch(/fuori ordine.*frame 288 di 1200.*previous GOP/i));
  it("maps every source frame to the clean video using the detected offset", () => referenceFrameTimestamps([10, 10.04, 10.08], 10, 2, .5).forEach((value, index) => expect(value).toBeCloseTo([2.5, 2.54, 2.58][index]!, 6)));
  it("does not slow a 20-second reference to fit a 30-second source", () => {
    const mapped = [0, 5, 10, 19, 20, 29].map(time => cleanReferenceTime(time, 0, 20));
    expect(mapped).toEqual([0, 5, 10, 19, null, null]);
  });
  it("keeps the same scene time with either chosen FPS", () => {
    for (const fps of [24, 25, 30, 60]) {
      const timeline = regularFrameTimestamps(0, 30, fps);
      const mapped = timeline.map(time => cleanReferenceTime(time, 0, 20));
      expect(mapped[10 * fps]).toBe(10);
      expect(mapped[20 * fps]).toBeNull();
    }
  });
  it("applies a manual offset without freezing out-of-range frames", () => {
    expect(cleanReferenceTime(10, .25, 20)).toBe(10.25);
    expect(cleanReferenceTime(0, -.25, 20)).toBeNull();
    expect(cleanReferenceTime(19.9, .25, 20)).toBeNull();
  });
  it("rejects a clean video that does not cover every requested frame", () => expect(() => assertReferenceCoverage([2.5, 3, 4.01], 2, 4)).toThrow(/non copre l’intero intervallo/i));
  it("resamples the source timeline when the clean video frame rate is selected", () => expect(regularFrameTimestamps(4, 1, 25)).toHaveLength(25));
  it("asks once before continuing an export with unstable spatial alignment", () => {
    expect(shouldPromptForUnstableAlignment(29, 20, false)).toBe(false);
    expect(shouldPromptForUnstableAlignment(30, 11, false)).toBe(true);
    expect(shouldPromptForUnstableAlignment(60, 40, true)).toBe(false);
  });
});
