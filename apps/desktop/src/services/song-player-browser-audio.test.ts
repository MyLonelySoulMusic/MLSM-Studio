import { describe, expect, it } from "vitest";
import { buildBrowserSongPlayerAnalysis, matchSongPlayerInBrowser } from "./song-player-browser-audio";
import type { SongPlayerAnalysis } from "./song-player-types";

function analysisFromFrames(frames: Float32Array[], hopSeconds: number, hash: string): SongPlayerAnalysis {
  const chroma = new Float32Array(frames.length * 12); frames.forEach((frame, index) => chroma.set(frame, index * 12)); const durationSeconds = frames.length * hopSeconds;
  return { sourceHash: hash, durationSeconds, chromaHopSeconds: hopSeconds, chroma, fingerprintVersion: "v1", spectrogram: { version: 1, sourceHash: hash, sampleRate: 1 / hopSeconds, fftSize: 1024, hopSize: 512, bands: 96, frameCount: frames.length, durationSeconds, minDb: -80, maxDb: 0, data: new ArrayBuffer(frames.length * 96) } };
}

function deterministicFrame(index: number): Float32Array {
  const frame = new Float32Array(12); let norm = 0;
  for (let band = 0; band < 12; band += 1) { const value = ((index * 37 + band * 19 + index * band * 7) % 101) / 100 + .01; frame[band] = value; norm += value * value; }
  norm = Math.sqrt(norm); for (let band = 0; band < 12; band += 1) frame[band] = (frame[band] ?? 0) / norm; return frame;
}

describe("Song Player browser FFT and matching", () => {
  it("builds a real non-empty FFT matrix from PCM samples", () => { const sampleRate = 11_025; const samples = Float32Array.from({ length: sampleRate * 2 }, (_, index) => Math.sin(2 * Math.PI * 440 * index / sampleRate)); const analysis = buildBrowserSongPlayerAnalysis(samples, 2, "a".repeat(64)); expect(analysis.spectrogram.bands).toBe(96); expect(analysis.spectrogram.frameCount).toBeGreaterThan(1); expect(new Uint8Array(analysis.spectrogram.data).some((value) => value > 0)).toBe(true); expect(analysis.chroma.some((value) => value > 0)).toBe(true); });
  it("finds a fragment inside the full-track timeline without native services", async () => { const referenceFrames = Array.from({ length: 120 }, (_, index) => deterministicFrame(index)); const targetFrames = referenceFrames.slice(36, 61).map((frame) => frame.slice()); const result = await matchSongPlayerInBrowser(analysisFromFrames(referenceFrames, .1, "r".repeat(64)), analysisFromFrames(targetFrames, .1, "t".repeat(64))); expect(result.offsetMs).toBeGreaterThanOrEqual(3_300); expect(result.offsetMs).toBeLessThanOrEqual(3_900); expect(result.confidence).toBeGreaterThan(0); });
});
