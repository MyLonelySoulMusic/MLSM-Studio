import { describe, expect, it } from "vitest";
import { StereoAnalysisEngine } from "./analysis-engine";

function measure(rate = 48000, amplitude = .1, right = 1, frequency = 1000, seconds = 4) {
  const engine = new StereoAnalysisEngine(rate, { fftSize: 8192, smoothing: 0, peakHold: 2 });
  for (let offset = 0; offset < rate * seconds; offset += 2048) { const frames = Math.min(2048, rate * seconds - offset), block = new Float32Array(frames * 2); for (let i = 0; i < frames; i++) { const sample = amplitude * Math.sin(2 * Math.PI * frequency * (offset + i) / rate); block[2 * i] = sample; block[2 * i + 1] = sample * right; } engine.push(block); }
  return engine.snapshot();
}
describe("Streamer stereo DSP", () => {
  it.each([44100, 48000, 96000])("measures a -20 dBFS stereo 1 kHz sine at %i Hz", rate => {
    const f = measure(rate); expect(f.peak[0]).toBeCloseTo(-20, 1); expect(f.rms[0]).toBeCloseTo(-23.0103, 2); expect(f.integrated).toBeCloseTo(-20, 0); expect(f.correlation).toBeCloseTo(1, 6); expect(f.width).toBeCloseTo(0, 6); expect(f.lra).toBeLessThan(.1);
    const peakBin = f.spectrumLeft.indexOf(Math.max(...f.spectrumLeft)); expect(Math.abs(peakBin * rate / 8192 - 1000)).toBeLessThan(rate / 8192);
  });
  it("keeps channels independent and recognizes phase inversion", () => {
    const leftOnly = measure(48000, .1, 0); expect(leftOnly.peak[1]).toBe(-Infinity); expect(leftOnly.integrated).toBeCloseTo(-23, 0);
    const inverted = measure(48000, .1, -1); expect(inverted.correlation).toBeCloseTo(-1, 6); expect(inverted.width).toBeCloseTo(100, 6);
  });
  it("does not collapse independent stereo program material to mono", () => {
    const rate = 48000, engine = new StereoAnalysisEngine(rate, { fftSize: 8192, smoothing: 0, peakHold: 2 });
    const pcm = new Float32Array(rate * 2);
    for (let i = 0; i < rate; i++) {
      pcm[i * 2] = .1 * Math.sin(2 * Math.PI * 997 * i / rate);
      pcm[i * 2 + 1] = .1 * Math.sin(2 * Math.PI * 2003 * i / rate);
    }
    engine.push(pcm);
    const frame = engine.snapshot();
    expect(Math.abs(frame.correlation)).toBeLessThan(.03);
    expect(frame.width).toBeGreaterThan(45);
    expect(frame.spectrumLeft.indexOf(Math.max(...frame.spectrumLeft))).not.toBe(frame.spectrumRight.indexOf(Math.max(...frame.spectrumRight)));
  });
  it("reports silence without fabricated loudness or NaN correlations", () => {
    const silent = measure(48000, 0); expect(silent.integrated).toBe(-Infinity); expect(silent.peak[0]).toBe(-Infinity); expect(silent.correlation).toBe(0); expect(silent.width).toBe(0);
  });
  it("detects intersample peaks above the discrete peak", () => {
    const engine = new StereoAnalysisEngine(48000); const pcm = new Float32Array(48000 * 2);
    for (let i = 0; i < 48000; i++) { const x = .95 * Math.sin(2 * Math.PI * 12000 * i / 48000 + Math.PI / 4); pcm[i * 2] = x; pcm[i * 2 + 1] = x; }
    engine.push(pcm); const f = engine.snapshot(); expect(f.truePeak[0] - f.peak[0]).toBeGreaterThan(2); expect(f.truePeak[0]).toBeLessThan(1);
  });
  it("excludes long trailing silence from integrated gated loudness", () => {
    const engine = new StereoAnalysisEngine(48000), signal = new Float32Array(48000 * 8);
    for (let i = 0; i < signal.length / 2; i++) signal[2 * i] = signal[2 * i + 1] = .1 * Math.sin(2 * Math.PI * 1000 * i / 48000);
    engine.push(signal); const before = engine.snapshot().integrated; engine.push(new Float32Array(48000 * 12)); const after = engine.snapshot(); expect(Math.abs(after.integrated - before)).toBeLessThan(.3); expect(after.momentary).toBeLessThan(-70);
  });
});
