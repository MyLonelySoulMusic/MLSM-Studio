import { describe, expect, it } from "vitest";
import { defaultSceneLight } from "../store/scene-store";
import { resolveSceneLightFrame } from "./scene-light";

describe("scene light frame", () => {
  it("trasla origine e destinazione insieme alla biglia conservando il vettore", () => {
    const light = { ...defaultSceneLight, enabled: true, origin: [4, 6, 6] as [number, number, number], target: [0, 1, 0] as [number, number, number], followBall: true };
    const frame = resolveSceneLightFrame(light, [3, -8, -12], 42);
    expect(frame.target).toEqual([3, -8, -12]);
    expect(frame.origin).toEqual([7, -3, -6]);
    expect(frame.active).toBe(true);
  });

  it("estende il volume oltre la destinazione e rispetta l'intervallo", () => {
    const light = { ...defaultSceneLight, enabled: true, origin: [0, 4, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number], followBall: false, beamLengthMultiplier: 3, activeFromSeconds: 5, activeUntilSeconds: 12 };
    expect(resolveSceneLightFrame(light, [9, 9, 9], 4.9).active).toBe(false);
    const frame = resolveSceneLightFrame(light, [9, 9, 9], 8);
    expect(frame.active).toBe(true);
    expect(frame.beamEnd).toEqual([0, -8, 0]);
    expect(resolveSceneLightFrame(light, [9, 9, 9], 12.1).active).toBe(false);
  });
});
