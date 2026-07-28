import { describe, expect, it } from "vitest";
import { planTrajectory } from "@rbs/trajectory";
import { createRollingOrientationEvaluator } from "./rolling-orientation";

const segments = planTrajectory([
  { eventId: "a", objectId: "a", timeSeconds: 0, contactPoint: { x: 0, y: 1, z: 0 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: .5 },
  { eventId: "b", objectId: "b", timeSeconds: 1, contactPoint: { x: 2, y: 1, z: 0 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: .6 },
  { eventId: "c", objectId: "c", timeSeconds: 2, contactPoint: { x: 2, y: .8, z: -2 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: .7 }
]);

describe("physical rolling orientation", () => {
  it("mantiene una rotazione normalizzata e continua agli impatti", () => { const evaluate = createRollingOrientationEvaluator(segments, .5); for (const time of [0, .5, .999, 1, 1.001, 1.5, 2]) { const value = evaluate(time); expect(Math.hypot(value.x, value.y, value.z, value.w)).toBeCloseTo(1, 6); } const before = evaluate(.999); const after = evaluate(1.001); expect(Math.hypot(before.x - after.x, before.y - after.y, before.z - after.z, before.w - after.w)).toBeLessThan(.02); });
  it("ruota intorno all'asse perpendicolare alla direzione di corsa", () => { const halfway = createRollingOrientationEvaluator(segments.slice(0, 1), .5)(.5); expect(Math.abs(halfway.z)).toBeGreaterThan(.5); expect(Math.abs(halfway.x)).toBeLessThan(.001); });
});
