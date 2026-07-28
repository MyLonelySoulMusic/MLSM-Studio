import { describe, expect, it } from "vitest";
import { pixelArtWalkSpeedPixelsPerSecond, resolvePixelArtNewYorkTimeline, resolvePixelArtWalkRig, solvePixelArtElbow, solvePixelArtKnee } from "./pixel-art-new-york";

describe("Walking Through New York timeline", () => {
  it("inizia l'ingresso nel locale esattamente a metà di ogni brano", () => {
    for (const duration of [30, 93.4, 240]) {
      const before = resolvePixelArtNewYorkTimeline(duration / 2 - .001, duration);
      const atMiddle = resolvePixelArtNewYorkTimeline(duration / 2, duration);
      expect(before.phase).not.toBe("barEntry");
      expect(atMiddle.entranceTimeSeconds).toBe(duration / 2);
      expect(atMiddle.phase).toBe("barEntry");
    }
  });

  it("mantiene la stessa velocità di camminata indipendentemente dalla durata", () => {
    for (const duration of [60, 180]) {
      const timeline = resolvePixelArtNewYorkTimeline(1, duration);
      const next = resolvePixelArtNewYorkTimeline(2, duration);
      expect(next.worldDistancePixels - timeline.worldDistancePixels).toBeCloseTo(pixelArtWalkSpeedPixelsPerSecond, 6);
    }
  });

  it("ferma il passo al semaforo senza accelerare dopo la sosta", () => {
    const timing = resolvePixelArtNewYorkTimeline(0, 120);
    const waiting = resolvePixelArtNewYorkTimeline((timing.trafficStopStartSeconds + timing.trafficStopEndSeconds) / 2, 120);
    const laterWaiting = resolvePixelArtNewYorkTimeline(waiting.trafficStopEndSeconds - .01, 120);
    expect(waiting.phase).toBe("trafficLight");
    expect(laterWaiting.worldDistancePixels).toBeCloseTo(waiting.worldDistancePixels, 6);
    const after = resolvePixelArtNewYorkTimeline(timing.trafficStopEndSeconds + 2, 120);
    expect(after.worldDistancePixels - resolvePixelArtNewYorkTimeline(timing.trafficStopEndSeconds + 1, 120).worldDistancePixels).toBeCloseTo(pixelArtWalkSpeedPixelsPerSecond, 6);
  });

  it("produce una posa articolata continua anziché alternare fotogrammi PNG", () => {
    const first = resolvePixelArtWalkRig(1, true); const next = resolvePixelArtWalkRig(1.01, true); const stopped = resolvePixelArtWalkRig(1, false);
    expect(next.frontThigh).not.toBe(first.frontThigh); expect(Math.abs(next.frontThigh - first.frontThigh)).toBeLessThan(.1);
    expect(first.frontArm).toBeCloseTo(-first.frontThigh * .31 / .42, 6); expect(stopped.bodyBob).toBe(0);
    expect(Math.max(first.frontFootLift, first.backFootLift)).toBeGreaterThan(0);
  });

  it("risolve il ginocchio davanti alla linea della gamba", () => {
    const hip = { x: 0, y: 0 }; const foot = { x: 4, y: 28 }; const knee = solvePixelArtKnee(hip, foot, 16, 16, 1); const lineMidpointX = (hip.x + foot.x) / 2;
    expect(knee.x).toBeGreaterThan(lineMidpointX);
    expect(Math.hypot(knee.x - hip.x, knee.y - hip.y)).toBeCloseTo(16, 5);
  });

  it("mantiene il gomito dietro alla linea del braccio", () => {
    const shoulder = { x: 0, y: 0 }; const hand = { x: 5, y: 20 }; const elbow = solvePixelArtElbow(shoulder, hand, 13, 12, 1); const lineMidpointX = (shoulder.x + hand.x) / 2;
    expect(elbow.x).toBeLessThan(lineMidpointX);
    expect(Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y)).toBeCloseTo(13, 5);
  });
});
