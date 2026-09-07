import type { SongPlayerAnalysis, SongPlayerSpectrogramCacheRecord } from "./song-player-types";
import { openAnalysisDatabase, SONG_PLAYER_ANALYSIS_STORE_NAME } from "./analysis-database";

const fallback = new Map<string, SongPlayerAnalysis>();
export function resetSongPlayerAnalysisMemoryCache() { fallback.clear(); }
// v3 deliberately invalidates the former browser-synthesized cache entries:
// only matrices produced by a real native or browser FFT may use this key.
export function songPlayerAnalysisCacheKey(hash: string): string { return `song-player:real-fft-v3:${hash}:11025:1024:adaptive:96`; }
function valid(value: unknown, hash: string): value is SongPlayerAnalysis {
  if (!value || typeof value !== "object") return false;
  const candidate = value as SongPlayerAnalysis;
  const record = candidate.spectrogram;
  return candidate.sourceHash === hash && candidate.fingerprintVersion === "v1" && candidate.chroma instanceof Float32Array && candidate.chroma.length > 0 && candidate.chroma.length % 12 === 0 &&
    Boolean(record && record.version === 1 && record.sourceHash === hash && record.sampleRate > 0 && record.fftSize > 0 && record.hopSize > 0 && record.bands > 0 && record.frameCount > 0 && record.data instanceof ArrayBuffer && record.data.byteLength === record.frameCount * record.bands);
}
export class SongPlayerAnalysisCache {
  async get(hash: string): Promise<SongPlayerAnalysis | null> {
    if (!("indexedDB" in globalThis)) return fallback.get(songPlayerAnalysisCacheKey(hash)) ?? null;
    try {
      const db = await openAnalysisDatabase();
      try { const value = await new Promise<unknown>((resolve, reject) => { const request = db.transaction(SONG_PLAYER_ANALYSIS_STORE_NAME, "readonly").objectStore(SONG_PLAYER_ANALYSIS_STORE_NAME).get(songPlayerAnalysisCacheKey(hash)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); return valid(value, hash) ? value : null; }
      finally { db.close(); }
    } catch { return fallback.get(songPlayerAnalysisCacheKey(hash)) ?? null; }
  }
  async set(value: SongPlayerAnalysis): Promise<void> {
    const key = songPlayerAnalysisCacheKey(value.sourceHash); fallback.set(key, value);
    if (!("indexedDB" in globalThis)) return;
    try { const db = await openAnalysisDatabase(); try { await new Promise<void>((resolve, reject) => { const request = db.transaction(SONG_PLAYER_ANALYSIS_STORE_NAME, "readwrite").objectStore(SONG_PLAYER_ANALYSIS_STORE_NAME).put(value, key); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); } finally { db.close(); } } catch { /* memory fallback remains authoritative for this session */ }
  }
  async deleteByHash(hash: string): Promise<void> {
    fallback.delete(songPlayerAnalysisCacheKey(hash)); if (!("indexedDB" in globalThis)) return;
    try { const db = await openAnalysisDatabase(); try { await new Promise<void>((resolve, reject) => { const request = db.transaction(SONG_PLAYER_ANALYSIS_STORE_NAME, "readwrite").objectStore(SONG_PLAYER_ANALYSIS_STORE_NAME).delete(songPlayerAnalysisCacheKey(hash)); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); } finally { db.close(); } } catch { /* best effort */ }
  }
}
export const songPlayerAnalysisCache = new SongPlayerAnalysisCache();
export function spectrogramColumnAt(cache: SongPlayerSpectrogramCacheRecord, timeSeconds: number): Uint8Array {
  if (cache.frameCount <= 0 || cache.bands <= 0) return new Uint8Array(Math.max(0, cache.bands));
  const index = Math.max(0, Math.min(cache.frameCount - 1, Math.round(Math.max(0, timeSeconds) * cache.sampleRate / cache.hopSize)));
  const start = index * cache.bands; return new Uint8Array(cache.data.slice(start, start + cache.bands));
}
