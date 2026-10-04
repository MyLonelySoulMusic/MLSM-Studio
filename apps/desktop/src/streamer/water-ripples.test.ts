import { describe, expect, it } from "vitest";
import type { AnalysisFrame } from "./analysis-engine";
import { RippleDetector, waterField, rippleLifetime } from "./water-ripples";

const frame = (sequence: number, width = 8, level = -25, elapsed = sequence / 30): AnalysisFrame => ({ sequence, width, elapsed, peak: [level, level], truePeak: [level, level] } as AnalysisFrame);
const warm = (detector: RippleDetector) => { for (let i = 1; i <= 5; i++) detector.observe(frame(i), i / 30); };

describe("Audio-reactive water", () => {
  it("ignores initial playback, steady music, duplicate frames and small changes", () => {
    const detector = new RippleDetector();
    for (let i = 1; i < 60; i++) expect(detector.observe(frame(i, 8 + i % 2, -25 + i % 2), i / 30)).toEqual([]);
    expect(detector.observe(frame(59, 90, -1), 2)).toEqual([]);
  });
  it("generates both origins simultaneously on a stereo opening and volume jump", () => {
    const detector = new RippleDetector(); warm(detector);
    const result = detector.observe(frame(6, 55, -8), .2);
    expect(result.map(trigger => trigger.source)).toEqual(["stereo", "peaks"]);
    expect(result.every(trigger => trigger.strength > 1 && trigger.strength <= 1.5)).toBe(true);
    expect(detector.observe(frame(7, 55, -8), .233)).toEqual([]);
  });
  it("detects a strong volume drop, but not mere stereo narrowing", () => {
    const detector = new RippleDetector(); warm(detector);
    expect(detector.observe(frame(6, 0, -38), .2).map(trigger => trigger.source)).toEqual(["peaks"]);
  });
  it("does not trigger on silence, stream restarts or seeking backwards", () => {
    const detector = new RippleDetector(); warm(detector);
    expect(detector.observe(frame(6, 100, -Infinity), .2)).toEqual([]);
    expect(detector.observe(frame(7, 60, -3), .233)).toEqual([]);
    expect(detector.observe(frame(1, 60, -3), 2)).toEqual([]);
    expect(detector.observe(frame(2, 100, -3, 0), 2.033)).toEqual([]);
  });
  it("sums signed height and surface slopes before shading", () => {
    const a = { x: 0, y: 0, born: 0, strength: 1 }, b = { x: 180, y: 0, born: .08, strength: 1 };
    const first = waterField(90, 20, .5, [a]), second = waterField(90, 20, .5, [b]);
    const combined = waterField(90, 20, .5, [a, b]);
    expect(combined.height).toBeCloseTo(first.height + second.height, 12);
    expect(combined.dx).toBeCloseTo(first.dx + second.dx, 12);
    expect(combined.dy).toBeCloseTo(first.dy + second.dy, 12);
    // The two wave packets are out of phase at this point: cancellation.
    expect(Math.abs(combined.height)).toBeLessThan(Math.abs(first.height) + Math.abs(second.height));
  });
  it("spreads at a fixed physical speed, with several crests and gradual damping", () => {
    const impact = { x: 0, y: 0, born: 0, strength: 1 };
    expect(waterField(175, 0, 1, [impact]).height).toBeGreaterThan(0);
    expect(waterField(159, 0, 1, [impact]).height).toBeLessThan(0);
    expect(waterField(143, 0, 1, [impact]).height).toBeGreaterThan(0);
    expect(waterField(350, 0, 2, [impact]).height).toBeLessThan(waterField(175, 0, 1, [impact]).height);
    expect(waterField(0, 0, 0, [impact])).toEqual({ height: 0, dx: 0, dy: 0 });
    expect(waterField(500, 0, rippleLifetime, [impact])).toEqual({ height: 0, dx: 0, dy: 0 });
  });
});
