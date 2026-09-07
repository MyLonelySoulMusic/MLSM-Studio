import type { AudioAnalysisResult } from "@rbs/audio-analysis";
import { ANALYSIS_STORE_NAME, openAnalysisDatabase } from "./analysis-database";

const memoryCache = new Map<string, AudioAnalysisResult>();
export function resetAnalysisMemoryCache() { memoryCache.clear(); }
export class AnalysisCache {
  async get(key: string): Promise<AudioAnalysisResult | null> {
    const fallback = memoryCache.get(key) ?? null;
    if (!("indexedDB" in globalThis)) return fallback;
    try {
      const database = await openAnalysisDatabase();
      try { return await new Promise((resolve, reject) => { const request = database.transaction(ANALYSIS_STORE_NAME, "readonly").objectStore(ANALYSIS_STORE_NAME).get(key); request.onsuccess = () => resolve((request.result as AudioAnalysisResult | undefined) ?? fallback); request.onerror = () => reject(request.error); }); }
      finally { database.close(); }
    } catch { return fallback; }
  }
  async set(key: string, value: AudioAnalysisResult): Promise<void> {
    memoryCache.set(key, value);
    if (!("indexedDB" in globalThis)) return;
    try {
      const database = await openAnalysisDatabase();
      try { await new Promise<void>((resolve, reject) => { const request = database.transaction(ANALYSIS_STORE_NAME, "readwrite").objectStore(ANALYSIS_STORE_NAME).put(value, key); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); }
      finally { database.close(); }
    } catch { /* The cache must never prevent a real audio analysis. */ }
  }
}
