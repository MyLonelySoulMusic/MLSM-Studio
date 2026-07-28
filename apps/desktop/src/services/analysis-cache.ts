import type { AudioAnalysisResult } from "@rbs/audio-analysis";

const memoryCache = new Map<string, AudioAnalysisResult>();
export class AnalysisCache {
  private readonly databaseName = "rhythm-ball-analysis";
  async get(key: string): Promise<AudioAnalysisResult | null> {
    if (!("indexedDB" in globalThis)) return memoryCache.get(key) ?? null;
    const database = await this.open();
    return new Promise((resolve, reject) => { const request = database.transaction("analyses", "readonly").objectStore("analyses").get(key); request.onsuccess = () => resolve((request.result as AudioAnalysisResult | undefined) ?? null); request.onerror = () => reject(request.error); });
  }
  async set(key: string, value: AudioAnalysisResult): Promise<void> {
    if (!("indexedDB" in globalThis)) { memoryCache.set(key, value); return; }
    const database = await this.open();
    await new Promise<void>((resolve, reject) => { const request = database.transaction("analyses", "readwrite").objectStore("analyses").put(value, key); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  }
  private async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => { const request = indexedDB.open(this.databaseName, 1); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("analyses")) request.result.createObjectStore("analyses"); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }
}
