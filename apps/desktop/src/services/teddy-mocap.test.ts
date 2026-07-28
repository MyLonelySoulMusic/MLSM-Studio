import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { resolveTeddyMocapCue, solveTeddyLimbChain } from "./teddy-mocap";

describe("teddy mocap direction", () => {
  it("rallenta il ciclo di camminata portandolo a quattro beat", () => {
    expect(resolveTeddyMocapCue(1, 120, false).walkProgress).toBe(.5);
    expect(resolveTeddyMocapCue(2, 120, false).walkProgress).toBe(0);
  });
  it("programma danza e salti su finestre musicali con dissolvenze", () => {
    const hipHop = resolveTeddyMocapCue(2, 120, true); const jump = resolveTeddyMocapCue(7, 120, true); const walk = resolveTeddyMocapCue(5, 120, true);
    expect(hipHop).toMatchObject({ actionId: "hipHop", actionWeight: 1 }); expect(jump.actionId).toBe("joyfulJump"); expect(jump.actionWeight).toBeGreaterThan(.9); expect(walk.actionId).toBeNull();
  });
  it("produce un giro completo continuo durante la sezione hip hop", () => {
    const before = resolveTeddyMocapCue(1, 120, true); const after = resolveTeddyMocapCue(3.8, 120, true);
    expect(before.turnRadians).toBe(0); expect(after.turnRadians).toBeGreaterThan(Math.PI * 1.8); expect(after.turnRadians).toBeLessThanOrEqual(Math.PI * 2);
  });
  it("mantiene entrambe le braccia fuori dal volume del busto", () => {
    const left = solveTeddyLimbChain(new THREE.Vector3(.8, -.3, .1), new THREE.Vector3(.5, -.7, .2), -1, "arm");
    const right = solveTeddyLimbChain(new THREE.Vector3(-.8, -.3, .1), new THREE.Vector3(-.5, -.7, .2), 1, "arm");
    expect(new THREE.Vector3(0, -1, 0).applyQuaternion(left.upper).x).toBeLessThanOrEqual(-.15);
    expect(new THREE.Vector3(0, -1, 0).applyQuaternion(right.upper).x).toBeGreaterThanOrEqual(.15);
  });
  it("limita le rotazioni estreme e produce sempre quaternion validi", () => {
    const result = solveTeddyLimbChain(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0), -1, "arm");
    for (const quaternion of [result.upper, result.lower]) {
      expect([quaternion.x, quaternion.y, quaternion.z, quaternion.w].every(Number.isFinite)).toBe(true);
      expect(quaternion.length()).toBeCloseTo(1, 5);
    }
    expect(result.upper.angleTo(new THREE.Quaternion())).toBeLessThanOrEqual(THREE.MathUtils.degToRad(148) + 1e-5);
    expect(result.lower.angleTo(new THREE.Quaternion())).toBeLessThanOrEqual(THREE.MathUtils.degToRad(122) + 1e-5);
  });
});
