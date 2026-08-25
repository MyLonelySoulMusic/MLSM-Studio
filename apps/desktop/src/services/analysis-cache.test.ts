import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioAnalysisResult } from "@rbs/audio-analysis";
import { AnalysisCache } from "./analysis-cache";
const result: AudioAnalysisResult = { analyzerVersion: "test", durationSeconds: 1, sampleRate: 48_000, globalBpm: 120, bpmConfidence: 1, localTempo: [], beats: [], downbeats: [], events: [], energy: [], onsetEnvelope: [], spectralFlux: [], lowEnergySegments: [] };
const originalIndexedDb = globalThis.indexedDB;
afterEach(() => { if (originalIndexedDb === undefined) Reflect.deleteProperty(globalThis, "indexedDB"); else Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb }); });
describe("analysis cache", () => {
  it("salva e recupera per chiave senza confondere contenuti", async () => { const cache = new AnalysisCache(); await cache.set("one", result); expect(await cache.get("one")).toEqual(result); expect(await cache.get("two")).toBeNull(); });
  it("non blocca l'analisi se IndexedDB risponde con VersionError", async () => {
    Reflect.deleteProperty(globalThis, "indexedDB"); const cache = new AnalysisCache(); await cache.set("version-error", result);
    const open = vi.fn(() => { const request = { error: new DOMException("versione precedente", "VersionError") } as IDBOpenDBRequest; queueMicrotask(() => request.onerror?.(new Event("error"))); return request; });
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open } });
    await expect(cache.get("version-error")).resolves.toEqual(result);
  });
});
