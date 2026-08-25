import { describe, expect, it } from "vitest";
import { decodeNativeSongPlayerAnalysis } from "./song-player-analysis";
import { SongPlayerAnalysisCache, songPlayerAnalysisCacheKey } from "./song-player-analysis-cache";

describe("native song player analysis decode", () => {
  it("transposes the worker row-major matrix and exposes fingerprint chroma", () => {
    const raw = Uint8Array.from([1, 2, 3, 10, 20, 30]); const data = btoa(String.fromCharCode(...raw));
    const analysis = decodeNativeSongPlayerAnalysis({ hash: "a".repeat(64), durationSeconds: 3, fingerprint: { algorithm: "mlsm-chroma-v1", frameCount: 2, hashes: ["12f", "34a"] }, spectrogram: { encoding: "base64-uint8", rows: 2, columns: 3, data } }, "a".repeat(64), 3);
    expect([...new Uint8Array(analysis.spectrogram.data)]).toEqual([1, 10, 2, 20, 3, 30]); expect(analysis.spectrogram.frameCount).toBe(3); expect(analysis.spectrogram.bands).toBe(2); expect(analysis.chroma).toHaveLength(24); expect(analysis.chroma[1]).toBe(1); expect(analysis.chroma[2]).toBe(.5);
  });
  it("rejects mismatched hashes and malformed payload sizes", () => { const result = { hash: "b".repeat(64), durationSeconds: 1, fingerprint: { algorithm: "mlsm-chroma-v1", frameCount: 1, hashes: ["12f"] }, spectrogram: { encoding: "base64-uint8", rows: 2, columns: 2, data: btoa("x") } }; expect(() => decodeNativeSongPlayerAnalysis(result, "a".repeat(64), 1)).toThrow(/Hash/); });
  it("rejects pitch-class nibbles above B while allowing F as strength", () => { const base = { hash: "a".repeat(64), durationSeconds: 1, spectrogram: { encoding: "base64-uint8", rows: 1, columns: 1, data: btoa("x") } }; expect(() => decodeNativeSongPlayerAnalysis({ ...base, fingerprint: { algorithm: "mlsm-chroma-v1", frameCount: 1, hashes: ["c2f"] } }, "a".repeat(64), 1)).toThrow(/Fingerprint/); expect(() => decodeNativeSongPlayerAnalysis({ ...base, fingerprint: { algorithm: "mlsm-chroma-v1", frameCount: 1, hashes: ["2cf"] } }, "a".repeat(64), 1)).toThrow(/Fingerprint/); expect(decodeNativeSongPlayerAnalysis({ ...base, fingerprint: { algorithm: "mlsm-chroma-v1", frameCount: 1, hashes: ["abf"] } }, "a".repeat(64), 1).chroma).toHaveLength(12); });
  it("round-trips the decoded typed arrays through the analysis cache", async () => { const sourceHash = "c".repeat(64); const decoded = decodeNativeSongPlayerAnalysis({ hash: sourceHash, durationSeconds: 1, fingerprint: { algorithm: "mlsm-chroma-v1", frameCount: 1, hashes: ["12f"] }, spectrogram: { encoding: "base64-uint8", rows: 1, columns: 1, data: btoa("x") } }, sourceHash, 1); const cache = new SongPlayerAnalysisCache(); await cache.set(decoded); expect(await cache.get(sourceHash)).toEqual(decoded); });
  it("uses a real-FFT cache namespace that cannot reuse the former synthetic fallback", () => { expect(songPlayerAnalysisCacheKey("a".repeat(64))).toContain("real-fft-v3"); expect(songPlayerAnalysisCacheKey("a".repeat(64))).not.toContain("song-player:v1:"); });
});
