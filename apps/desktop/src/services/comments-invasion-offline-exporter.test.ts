import { describe, expect, it } from "vitest";
import { assertCommentsInvasionFrameIntegrity, commentsInvasionFrameCount, commentsInvasionFrameTiming } from "./comments-invasion-offline-exporter";

describe("Comments Invasion offline export", () => {
  it("non tronca l’ultimo frame ai frame rate selezionabili", () => {
    expect(commentsInvasionFrameCount(24, 60)).toBe(1440);
    expect(commentsInvasionFrameCount(1.001, 60)).toBe(61);
    const last = commentsInvasionFrameTiming(60, 1.001, 60);
    expect(last.timestampSeconds).toBe(1);
    expect(last.durationSeconds).toBeCloseTo(.001);
    expect(last.sampleTimeSeconds).toBeLessThan(1.001);
  });

  it("annulla i file a cui manca anche un solo frame", () => {
    expect(() => assertCommentsInvasionFrameIntegrity(1442, 1441)).toThrow(/anti-drop/);
    expect(() => assertCommentsInvasionFrameIntegrity(1442, 1442)).not.toThrow();
  });
});
