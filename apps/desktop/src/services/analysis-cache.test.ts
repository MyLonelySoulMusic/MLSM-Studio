import { describe, expect, it } from "vitest";
import type { AudioAnalysisResult } from "@rbs/audio-analysis";
import { AnalysisCache } from "./analysis-cache";
const result: AudioAnalysisResult = { analyzerVersion: "test", durationSeconds: 1, sampleRate: 48_000, globalBpm: 120, bpmConfidence: 1, localTempo: [], beats: [], downbeats: [], events: [], energy: [], onsetEnvelope: [], spectralFlux: [], lowEnergySegments: [] };
describe("analysis cache", () => { it("salva e recupera per chiave senza confondere contenuti", async () => { const cache = new AnalysisCache(); await cache.set("one", result); expect(await cache.get("one")).toEqual(result); expect(await cache.get("two")).toBeNull(); }); });
