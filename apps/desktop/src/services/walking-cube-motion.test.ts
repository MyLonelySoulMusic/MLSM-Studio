import { describe, expect, it } from "vitest";
import { createWalkingCubeMotionEvaluator } from "./walking-cube-motion";

const impacts = Array.from({ length: 17 }, (_, index) => ({ timeSeconds: .45 + index * .58, strength: .45 + index % 4 * .13 }));

describe("Cube Animation motion", () => {
  it("chiude esattamente orientamento e fase sul frame finale", () => {
    const evaluate = createWalkingCubeMotionEvaluator({ durationSeconds: 12, bpm: 104, impacts, seed: 42, intensity: 1 });
    expect(evaluate(12)).toEqual(evaluate(0));
    expect(evaluate(24)).toEqual(evaluate(0));
  });

  it("mantiene il cubo al centro e non crea più split, zoom o rimbalzi", () => {
    const evaluate = createWalkingCubeMotionEvaluator({ durationSeconds: 12, bpm: 104, impacts, seed: 91, intensity: 1.2 });
    const frames = Array.from({ length: 240 }, (_, index) => evaluate(index / 20));
    expect(frames.every((frame) => frame.position.x === 0 && frame.position.y === 0 && frame.position.z === 0)).toBe(true);
    expect(frames.every((frame) => frame.split === 0 && frame.zoom === 0)).toBe(true);
    const active = frames.find((frame) => Math.abs(frame.rotationX) + Math.abs(frame.rotationY) + Math.abs(frame.rotationZ) > .5);
    expect(active).toBeTruthy();
    expect(Math.abs(active!.rotationX)).toBeGreaterThan(.1);
    expect(Math.abs(active!.rotationY)).toBeGreaterThan(.1);
    expect(Math.abs(active!.rotationZ)).toBeGreaterThan(.1);
    expect(Math.hypot(active!.orientation.x, active!.orientation.y, active!.orientation.z, active!.orientation.w)).toBeCloseTo(1);
  });

  it("completa ogni quarto di giro con accelerazione e frenata morbide", () => {
    const evaluate = createWalkingCubeMotionEvaluator({ durationSeconds: 12, bpm: 104, impacts: [], seed: 7, intensity: 1 });
    const start = evaluate(.001);
    const early = evaluate(.01);
    const middle = evaluate(.25);
    expect(Math.abs(early.rotationX - start.rotationX) + Math.abs(early.rotationY - start.rotationY) + Math.abs(early.rotationZ - start.rotationZ)).toBeLessThan(.01);
    expect(Math.abs(middle.rotationX) + Math.abs(middle.rotationY) + Math.abs(middle.rotationZ)).toBeGreaterThan(.05);
  });

  it("rimane deterministico per seed, beat e tempo assoluto", () => {
    const options = { durationSeconds: 9, bpm: 88, impacts, seed: 1234, intensity: .9 };
    const first = createWalkingCubeMotionEvaluator(options);
    const second = createWalkingCubeMotionEvaluator(options);
    expect(first(4.321)).toEqual(second(4.321));
  });
});
