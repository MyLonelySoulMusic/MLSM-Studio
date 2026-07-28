import { describe, expect, it } from "vitest";
import { planTrajectory } from "@rbs/trajectory";
import { createNewYorkRaceEvaluator, newYorkRacerTakesBounce } from "./new-york-race";

const segments = planTrajectory([
  { eventId: "a", objectId: "a", timeSeconds: 0, contactPoint: { x: 0, y: 1, z: 4 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: .6 },
  { eventId: "b", objectId: "b", timeSeconds: 1, contactPoint: { x: .4, y: .9, z: 0 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: .8 },
  { eventId: "c", objectId: "c", timeSeconds: 2, contactPoint: { x: -.2, y: .8, z: -4 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: .7 }
]);

describe("New York Streets race physics", () => {
  it("produce traiettorie individuali e deterministiche", () => { const evaluate = createNewYorkRaceEvaluator(segments, 6, 42, .45, 2); const first = evaluate(.8); expect(first).toEqual(evaluate(.8)); expect(new Set(first.map((state) => `${state.position.x.toFixed(3)}:${state.position.z.toFixed(3)}:${state.position.y.toFixed(3)}`)).size).toBe(6); expect(new Set(first.map((state) => state.velocity.z.toFixed(3))).size).toBeGreaterThan(1); });
  it("impedisce alle biglie ancora integre di occupare lo stesso spazio", () => { const evaluate = createNewYorkRaceEvaluator(segments, 13, 7, .45, 2); const states = evaluate(.9).filter((state) => state.breakElapsedSeconds === 0); for (let first = 0; first < states.length; first += 1) for (let second = first + 1; second < states.length; second += 1) { const a = states[first]; const b = states[second]; if (!a || !b || Math.abs(a.position.y - b.position.y) > .675) continue; expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThanOrEqual(.764); } });
  it("non assegna lo stesso rimbalzo a tutte le concorrenti", () => { for (let segmentIndex = 0; segmentIndex < 8; segmentIndex += 1) { const choices = Array.from({ length: 13 }, (_, racerIndex) => newYorkRacerTakesBounce(42, racerIndex, segmentIndex)); expect(choices.some(Boolean)).toBe(true); expect(choices.some((choice) => !choice)).toBe(true); } });
  it("convoglia tutte le concorrenti dentro il tombino durante la caduta", () => { const dropSegments = planTrajectory([{ eventId: "s", objectId: "s", timeSeconds: 0, contactPoint: { x: 0, y: 1, z: 4 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: .5, motionToNext: "roll" }, { eventId: "m", objectId: "m", timeSeconds: 1, contactPoint: { x: 0, y: 1, z: 0 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: .5, motionToNext: "sewerDrop" }, { eventId: "f", objectId: "f", timeSeconds: 3, contactPoint: { x: 0, y: -7, z: 0 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: .5, motionToNext: "roll" }, { eventId: "e", objectId: "e", timeSeconds: 4, contactPoint: { x: 0, y: -7, z: -4 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: .5 }]); const states = createNewYorkRaceEvaluator(dropSegments, 13, 5, .42, 10)(2); expect(states.every((state) => state.constrainedToManhole)).toBe(true); expect(states.every((state) => Math.hypot(state.position.x, state.position.z) <= .071)).toBe(true); });
});
