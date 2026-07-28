import { describe, expect, it } from "vitest";
import { analysisCacheKey, analyzePcm, analyzePcmStereo, classifyInstrumentAtFrame, defaultAnalysisParameters, type EnergyFrame } from "./index";

describe("web audio analyzer", () => {
  it("rileva una click track a 120 BPM in modo deterministico", () => {
    const sampleRate = 8_000; const samples = new Float32Array(sampleRate * 12);
    for (let time = 0; time < 12; time += .5) for (let index = 0; index < 80; index += 1) samples[Math.round(time * sampleRate) + index] = (1 - index / 80) * (index % 2 ? -1 : 1);
    const first = analyzePcm(samples, sampleRate, { ...defaultAnalysisParameters, frameSize: 512, hopSize: 128 }); const second = analyzePcm(samples, sampleRate, { ...defaultAnalysisParameters, frameSize: 512, hopSize: 128 });
    expect(first.globalBpm).toBeGreaterThan(115); expect(first.globalBpm).toBeLessThan(125); expect(first.events.length).toBeGreaterThan(15); expect(first.energy[0]?.bands48).toHaveLength(48); expect(second).toEqual(first);
  });
  it("invalida la cache al cambiare dei parametri", () => {
    const first = analysisCacheKey("hash", defaultAnalysisParameters); const second = analysisCacheKey("hash", { ...defaultAnalysisParameters, sensitivity: .8 }); expect(first).not.toBe(second);
  });
  it("gestisce silenzio e audio più corto di una finestra", () => { const result = analyzePcm(new Float32Array(100), 8_000, { ...defaultAnalysisParameters, frameSize: 512, hopSize: 128 }); expect(result.globalBpm).toBeNull(); expect(result.events).toEqual([]); expect(result.energy).toEqual([]); });
  it("mantiene separati i due canali e fornisce un fallback simmetrico mono", () => {
    const sampleRate = 8_000; const left = new Float32Array(sampleRate); const right = new Float32Array(sampleRate);
    for (let index = 0; index < left.length; index += 1) { left[index] = Math.sin(2 * Math.PI * 180 * index / sampleRate) * .8; right[index] = Math.sin(2 * Math.PI * 1_200 * index / sampleRate) * .25; }
    const parameters = { ...defaultAnalysisParameters, frameSize: 512, hopSize: 128 };
    const stereo = analyzePcmStereo(left, right, sampleRate, parameters); const frame = stereo.energy[2]!;
    expect(frame.leftBands48).toHaveLength(48); expect(frame.rightBands48).toHaveLength(48); expect(frame.leftBands48).not.toEqual(frame.rightBands48); expect(frame.leftRms).toBeGreaterThan(frame.rightRms ?? 0); expect(frame.stereoWidth).toBeGreaterThan(0);
    const mono = analyzePcmStereo(left, undefined, sampleRate, parameters).energy[2]!;
    expect(mono.leftBands48).toEqual(mono.rightBands48); expect(mono.stereoWidth).toBe(0);
  });
  it("classifica un burst sinusoidale basso come kick", () => { const sampleRate = 8_000; const samples = new Float32Array(sampleRate * 3); for (let click = 0; click < 5; click += 1) { const start = Math.round((.25 + click * .5) * sampleRate); for (let index = 0; index < 320; index += 1) samples[start + index] = Math.sin(2 * Math.PI * 80 * index / sampleRate) * Math.exp(-index / 80); } const result = analyzePcm(samples, sampleRate, { ...defaultAnalysisParameters, sensitivity: .8, frameSize: 512, hopSize: 64 }); expect(result.events.some((event) => event.type === "kick")).toBe(true); });
  it("distingue famiglie armoniche sostenute e transienti", () => { const frame = (patch: Partial<EnergyFrame> = {}): EnergyFrame => ({ timeSeconds: 0, rms: 1, low: .1, mid: .7, high: .2, flux: 1, spectralCentroid: 700, spectralFlatness: .04, ...patch }); const sustained = [frame(), ...Array.from({ length: 15 }, () => frame({ rms: .8 }))]; const guitar = [frame({ spectralCentroid: 1_400 }), ...Array.from({ length: 15 }, () => frame({ rms: .42, spectralCentroid: 1_400 }))]; const piano = [frame(), ...Array.from({ length: 15 }, () => frame({ rms: .24 }))]; const snare = [frame({ spectralFlatness: .42 }), ...Array.from({ length: 15 }, () => frame({ rms: .04, spectralFlatness: .42 }))]; expect(classifyInstrumentAtFrame(sustained, 0)).toBe("strings"); expect(classifyInstrumentAtFrame(guitar, 0)).toBe("guitar"); expect(classifyInstrumentAtFrame(piano, 0)).toBe("piano"); expect(classifyInstrumentAtFrame(snare, 0)).toBe("snare"); });
});
