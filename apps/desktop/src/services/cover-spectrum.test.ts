import { describe, expect, it } from "vitest";
import { resolveCoverSpectrum } from "./cover-spectrum";

describe("cover spectrum", () => {
  it("restituisce sempre 48 bande interpolate", () => {
    const frame = (timeSeconds: number, value: number) => ({ timeSeconds, rms: value / 10, low: value, mid: value, high: value, flux: 0, spectralCentroid: 1000, spectralFlatness: .1, bands48: Array.from({ length: 48 }, () => value) });
    const result = resolveCoverSpectrum([frame(0, 0), frame(1, 1)], .5);
    expect(result.bands).toHaveLength(48); expect(result.bands[24]).toBeCloseTo(.2); expect(result.pulse).toBeGreaterThan(0);
  });
  it("sfuma gli impulsi con un rilascio visivo più lungo del frame FFT", () => {
    const frames = Array.from({ length: 21 }, (_, index) => { const active = index === 10 ? 1 : 0; return { timeSeconds: index * .05, rms: active * .1, low: active, mid: active, high: active, flux: 0, spectralCentroid: 1000, spectralFlatness: .1, bands48: Array.from({ length: 48 }, () => active) }; });
    expect(resolveCoverSpectrum(frames, .65).bands[20]).toBeGreaterThan(0);
  });
  it("interpola separatamente spettro sinistro, destro e ampiezza stereo", () => {
    const frame = (timeSeconds: number, left: number, right: number, width: number) => ({ timeSeconds, rms: .1, leftRms: left * .1, rightRms: right * .1, low: 1, mid: 1, high: 1, flux: 0, spectralCentroid: 1000, spectralFlatness: .1, bands48: Array.from({ length: 48 }, () => .5), leftBands48: Array.from({ length: 48 }, () => left), rightBands48: Array.from({ length: 48 }, () => right), stereoWidth: width });
    const resolved = resolveCoverSpectrum([frame(0, 1, .1, .2), frame(1, .8, .2, .8)], .5);
    expect(resolved.leftBands[20]).toBeGreaterThan(resolved.rightBands[20] ?? 0); expect(resolved.leftPulse).toBeGreaterThan(resolved.rightPulse); expect(resolved.stereoWidth).toBeCloseTo(.5);
  });
});
