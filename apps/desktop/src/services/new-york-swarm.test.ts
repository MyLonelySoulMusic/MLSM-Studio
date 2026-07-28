import { describe, expect, it } from "vitest";
import { fallingFragmentPose, secondaryMarbleBreakElapsed, secondaryMarbleBreakProgress, secondaryMarbleBreakStartSeconds } from "./new-york-swarm";

describe("New York Streets marble survival", () => {
  it("rompe le secondarie progressivamente e tutte prima dell'arrivo", () => { const duration = 100; const valuesAtHalf = Array.from({ length: 12 }, (_, index) => secondaryMarbleBreakProgress(index, 12, 50, duration)); expect(valuesAtHalf.some((value) => value === 0)).toBe(true); expect(valuesAtHalf.some((value) => value > 0)).toBe(true); expect(Array.from({ length: 12 }, (_, index) => secondaryMarbleBreakProgress(index, 12, duration, duration)).every((value) => value === 1)).toBe(true); });
  it("rimane deterministico anche in pausa", () => { expect(secondaryMarbleBreakProgress(3, 8, 42, 90)).toBe(secondaryMarbleBreakProgress(3, 8, 42, 90)); expect(secondaryMarbleBreakProgress(0, 0, 0, 0)).toBe(0); });
  it("lascia cadere i frammenti, li fa rimbalzare e infine li arresta a terra", () => { const direction = { x: .6, y: .8, z: -.3 }; const airborne = fallingFragmentPose(direction, 2, .18, .42); const settled = fallingFragmentPose(direction, 2, 8, .42); expect(airborne.position.y).toBeGreaterThan(-.378); expect(settled.position.y).toBeCloseTo(-.378, 8); expect(settled.settled).toBe(true); expect(settled).toEqual(fallingFragmentPose(direction, 2, 8, .42)); });
  it("espone un istante e un tempo di rottura assoluti", () => { const start = secondaryMarbleBreakStartSeconds(3, 8, 100); expect(secondaryMarbleBreakElapsed(3, 8, start - 1, 100)).toBe(0); expect(secondaryMarbleBreakElapsed(3, 8, start + .75, 100)).toBeCloseTo(.75, 8); });
});
