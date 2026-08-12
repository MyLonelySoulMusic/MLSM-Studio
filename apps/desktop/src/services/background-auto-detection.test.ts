import { describe, expect, it } from "vitest";
import { backgroundAutoPersonDetectionError, normalizeBackgroundAutoDetections } from "./background-auto-detection";

describe("Background Auto detection", () => {
  it("normalizza box DETR in coordinate stabili e filtra i punteggi bassi", () => {
    const detections = normalizeBackgroundAutoDetections([
      { label: "  Human ", score: .91, box: { xmin: 10, ymin: 20, xmax: 110, ymax: 220 } },
      { label: "cup", score: .12, box: { xmin: 0, ymin: 0, xmax: 20, ymax: 20 } }
    ], 200, 400);
    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({ label: "Human", alias: "Human", isPerson: true, bbox: { x: .05, y: .05, width: .5, height: .5 } });
    expect(detections[0]?.id).toMatch(/^det-/);
  });

  it("uses the lower default threshold for supported non-person categories and removes duplicate boxes", () => {
    const detections = normalizeBackgroundAutoDetections([
      { label: "lamp", score: .18, box: { xmin: 0, ymin: 0, xmax: 60, ymax: 60 } },
      { label: "lamp", score: .17, box: { xmin: 1, ymin: 1, xmax: 59, ymax: 59 } },
      { label: "cup", score: .16, box: { xmin: 65, ymin: 0, xmax: 90, ymax: 25 } }
    ], 100, 100);
    expect(detections.map((detection) => detection.label)).toEqual(["lamp", "cup"]);
  });

  it("normalizes common person labels without discarding other above-threshold objects", () => {
    const detections = normalizeBackgroundAutoDetections([
      { label: "woman", score: .9, box: { xmin: 0, ymin: 0, xmax: 30, ymax: 40 } },
      { label: "people", score: .8, box: { xmin: 40, ymin: 0, xmax: 70, ymax: 40 } },
      { label: "lamp", score: .81, box: { xmin: 70, ymin: 0, xmax: 100, ymax: 40 } }
    ], 100, 100);
    expect(detections).toHaveLength(3);
    expect(detections.filter((detection) => detection.isPerson).map((detection) => detection.label)).toEqual(["woman", "people"]);
    expect(detections.find((detection) => detection.label === "lamp")?.isPerson).toBe(false);
  });

  it("keeps non-person detections usable when the legacy person flag is active", () => {
    const objects = normalizeBackgroundAutoDetections([{ label: "car", score: .9, box: { xmin: 0, ymin: 0, xmax: 100, ymax: 100 } }], 100, 100);
    expect(backgroundAutoPersonDetectionError(objects, true)).toBeNull();
    expect(backgroundAutoPersonDetectionError(objects, false)).toBeNull();
  });
});
