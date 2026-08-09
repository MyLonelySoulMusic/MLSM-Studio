import { describe, expect, it } from "vitest";
import {
  assertOfflineAspectRatio,
  assertOfflineFrameIntegrity,
  mediaDrawRect,
  offlineFrameCount,
  offlineFrameTiming,
  recordingBitrate
} from "./offline-video-exporter";

describe("offline video exporter", () => {
  it("calcola l'intera sequenza anche a 60 e 120 fps", () => {
    expect(offlineFrameCount(60, 60)).toBe(3_600);
    expect(offlineFrameCount(60, 120)).toBe(7_200);
    expect(offlineFrameCount(1.001, 60)).toBe(61);
  });

  it("assegna timestamp deterministici e tronca soltanto l'ultimo frame", () => {
    expect(offlineFrameTiming(0, 1.01, 60)).toEqual({ timestampSeconds: 0, durationSeconds: 1 / 60, sampleTimeSeconds: 1 / 120 });
    const last = offlineFrameTiming(60, 1.01, 60);
    expect(last.timestampSeconds).toBe(1);
    expect(last.durationSeconds).toBeCloseTo(.01);
    expect(last.sampleTimeSeconds).toBeCloseTo(1.005);
  });

  it("rifiuta un file se manca anche un solo frame", () => {
    expect(() => assertOfflineFrameIntegrity(3_600, 3_599)).toThrow(/anti-drop/);
    expect(() => assertOfflineFrameIntegrity(3_600, 3_600)).not.toThrow();
  });

  it("impedisce che un progetto 9:16 venga codificato con dimensioni 16:9", () => {
    expect(() => assertOfflineAspectRatio("9:16", 1080, 1920)).not.toThrow();
    expect(() => assertOfflineAspectRatio("16:9", 1920, 1080)).not.toThrow();
    expect(() => assertOfflineAspectRatio("9:16", 1920, 1080)).toThrow(/incompatibile con il formato 9:16/);
    expect(() => assertOfflineAspectRatio("16:9", 1080, 1920)).toThrow(/incompatibile con il formato 16:9/);
  });

  it("dimensiona il bitrate professionale senza superare i limiti operativi", () => {
    expect(recordingBitrate(540, 960, 30)).toBe(12_000_000);
    expect(recordingBitrate(3840, 2160, 120)).toBe(160_000_000);
    expect(recordingBitrate(1920, 1080, 60, "maximum")).toBeGreaterThan(recordingBitrate(1920, 1080, 60, "high"));
  });

  it("mantiene i criteri di adattamento delle sorgenti", () => {
    expect(mediaDrawRect(1_200, 1_200, 1_080, 1_920, "fill")).toEqual({ x: 0, y: 0, width: 1_080, height: 1_920 });
    expect(mediaDrawRect(1_920, 1_080, 1_080, 1_920, "contain")).toEqual({ x: 0, y: 656.25, width: 1_080, height: 607.5 });
  });
});
