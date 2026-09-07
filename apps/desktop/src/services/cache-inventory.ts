import { settingsRequest, type DiskCache } from "./studio-settings";
import { hasActiveTasks } from "./task-history";
import { resetAssistantVectorMemory } from "./assistant-vector-store";
import { openAnalysisDatabase } from "./analysis-database";
import { mlsmPostLipsyncCache } from "./mlsm-post-lipsync-cache";
import { resetAnalysisMemoryCache } from "./analysis-cache";
import { resetSongPlayerAnalysisMemoryCache } from "./song-player-analysis-cache";
import { useAnalysisStore } from "../store/analysis-store";

export interface CacheEntry { id: string; label: string; location: string; bytes: number | null; entries?: number; kind: "disk" | "browser" | "analysis" | "vector" }
const browserNames = ["transformers-cache", "dynamic-sound-upscaler-models-v1"];
export async function listBrowserCaches(): Promise<CacheEntry[]> {
  const result: CacheEntry[] = [];
  if (typeof caches !== "undefined") for (const name of await caches.keys()) {
    if (!browserNames.includes(name)) continue;
    const cache = await caches.open(name); const keys = await cache.keys();
    result.push({ id: name, label: name, location: "Cache Storage", bytes: null, entries: keys.length, kind: "browser" });
  }
  result.push({ id: "analysis", label: "Audio / Song Player / Lipsync analysis", location: "IndexedDB", bytes: null, kind: "analysis" });
  result.push({ id: "vector", label: "Lonely Bot knowledge", location: "IndexedDB", bytes: null, kind: "vector" });
  return result;
}
export async function listDiskCaches(): Promise<CacheEntry[]> {
  const rows = await settingsRequest<DiskCache[]>({ action: "caches" });
  return rows.map(row => ({ id: row.id, label: row.label, location: row.path, bytes: row.bytes, kind: "disk" }));
}
export async function clearCacheEntry(entry: CacheEntry): Promise<void> {
  if (hasActiveTasks()) throw new Error("Attendi la fine dei task / Wait for active tasks to finish");
  if (entry.kind === "disk") { await settingsRequest({ action: "clearCache", id: entry.id }); return; }
  if (entry.kind === "browser" && browserNames.includes(entry.id)) { await caches.delete(entry.id); return; }
  if (entry.kind === "analysis") {
    resetAnalysisMemoryCache(); resetSongPlayerAnalysisMemoryCache(); useAnalysisStore.getState().reset();
    await mlsmPostLipsyncCache.clear();
    const database = await openAnalysisDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([...database.objectStoreNames], "readwrite");
      for (const store of database.objectStoreNames) transaction.objectStore(store).clear();
      transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
    return;
  }
  if (entry.kind === "vector") {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("mlsm-lonely-bot-vector-db"); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("Close other MLSM tabs and retry"));
    });
    resetAssistantVectorMemory();
  }
}
