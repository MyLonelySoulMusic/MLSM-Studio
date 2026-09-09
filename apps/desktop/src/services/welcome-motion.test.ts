import { describe, expect, it } from "vitest";
import { WELCOME_INTRO_SECONDS, welcomeMotion } from "./welcome-motion";

const progressFields = ["draw", "wave", "reveal", "dock", "copy", "pointer"] as const;
const poseFields = ["x", "y", "z", "rx", "ry", "rz", "scale"] as const;

describe("welcomeMotion presentation", () => {
  it("draws the waveform, reveals the logo, then docks before revealing the copy", () => {
    const waveform = welcomeMotion(.4);
    expect(waveform.draw).toBeGreaterThan(0);
    expect(waveform.draw).toBeLessThan(1);
    expect(waveform).toMatchObject({ wave: 1, reveal: 0, dock: 0, copy: 0 });

    const emergingLogo = welcomeMotion(1.3);
    expect(emergingLogo.reveal).toBeGreaterThan(0);
    expect(emergingLogo.reveal).toBeLessThan(1);
    expect(emergingLogo).toMatchObject({ draw: 1, wave: 1, dock: 0, copy: 0 });

    expect(welcomeMotion(2.1)).toMatchObject({ draw: 1, wave: 0, reveal: 1, dock: 0, copy: 0 });
    const dockingLogo = welcomeMotion(3.8);
    expect(dockingLogo.dock).toBeGreaterThan(0);
    expect(dockingLogo.dock).toBeLessThan(1);
    expect(dockingLogo.copy).toBe(0);

    const copy = welcomeMotion(4.6);
    expect(copy.copy).toBeGreaterThan(0);
    expect(copy.copy).toBeLessThan(1);
    expect(copy.dock).toBeGreaterThan(dockingLogo.dock);
    expect(copy.settled).toBe(false);
  });

  it("finishes at 5.6 seconds and keeps the welcome presentation visible during idle motion", () => {
    expect(WELCOME_INTRO_SECONDS).toBe(5.6);
    expect(welcomeMotion(5.599).settled).toBe(false);
    for (const seconds of [5.6, 6, 12]) {
      expect(welcomeMotion(seconds)).toMatchObject({ draw: 1, wave: 0, reveal: 1, dock: 1, copy: 1, pointer: 1, settled: true });
    }
    expect(welcomeMotion(-10)).toEqual(welcomeMotion(0));
  });

  it("returns exactly the same completed, stationary pose for reduced motion at every time", () => {
    const finalPose = welcomeMotion(WELCOME_INTRO_SECONDS);
    expect(finalPose).toMatchObject({ draw: 1, wave: 0, reveal: 1, dock: 1, copy: 1, pointer: 1, settled: true, scale: 1 });
    expect(finalPose.x).toBeCloseTo(0, 12);
    expect(finalPose.y).toBeCloseTo(0, 12);
    expect(finalPose.z).toBeCloseTo(0, 12);
    expect(finalPose.rx).toBeCloseTo(.035, 12);
    expect(finalPose.ry).toBeCloseTo(-.12, 12);
    expect(finalPose.rz).toBeCloseTo(0, 12);
    for (const seconds of [-20, 0, .4, 1.3, 3.8, 5.6, 8, 12, 100, Infinity, NaN]) {
      expect(welcomeMotion(seconds, true)).toEqual(finalPose);
    }
  });

  it("keeps all progress and poses finite and bounded without exposing the portrait back", () => {
    for (let step = 0; step <= 600; step++) {
      const seconds = step * .02;
      const motion = welcomeMotion(seconds);
      for (const field of [...progressFields, ...poseFields]) {
        expect(Number.isFinite(motion[field]), `${field} at ${seconds}s`).toBe(true);
      }
      for (const field of progressFields) {
        expect(motion[field], `${field} at ${seconds}s`).toBeGreaterThanOrEqual(0);
        expect(motion[field], `${field} at ${seconds}s`).toBeLessThanOrEqual(1);
      }
      for (const field of ["x", "y", "z"] as const) {
        expect(Math.abs(motion[field]), `${field} at ${seconds}s`).toBeLessThanOrEqual(1);
      }
      expect(motion.scale).toBeGreaterThanOrEqual(.95);
      expect(motion.scale).toBeLessThanOrEqual(1.1);
      for (const field of ["rx", "ry", "rz"] as const) {
        expect(Math.abs(motion[field]), `${field} at ${seconds}s`).toBeLessThan(Math.PI / 2);
      }
      expect(Math.cos(motion.rx) * Math.cos(motion.ry), `front-facing normal at ${seconds}s`).toBeGreaterThan(0);
    }
  });

  it("joins the introductory pose to idle motion continuously when docking settles", () => {
    const before = welcomeMotion(WELCOME_INTRO_SECONDS - .001);
    const at = welcomeMotion(WELCOME_INTRO_SECONDS);
    const after = welcomeMotion(WELCOME_INTRO_SECONDS + .001);
    for (const field of [...progressFields, ...poseFields]) {
      expect(Math.abs(before[field] - at[field]), `${field} approaching settle`).toBeLessThan(.00001);
      expect(Math.abs(after[field] - at[field]), `${field} entering idle`).toBeLessThan(.00001);
    }
  });
});
