import { describe, expect, it } from "vitest";
import { assertInterpolationIntegrity, expectedInterpolationFrameCount } from "./frame-interpolation-audit";

describe("frame interpolation audit", () => {
  it("uses the minterpolate look-ahead formula", () => {
    expect(expectedInterpolationFrameCount(60, 30, 60)).toBe(117);
  });
  it("rejects truncated output and geometry/audio loss", () => {
    const source = { frameCount: 60, fps: 30, durationSeconds: 2, width: 1920, height: 1080, sampleAspectRatio: "1:1", displayAspectRatio: 16 / 9, hasAudio: true };
    expect(() => assertInterpolationIntegrity({ source, targetFps: 60, output: { ...source, frameCount: 60, fps: 60, hasAudio: true } })).toThrow();
    expect(() => assertInterpolationIntegrity({ source, targetFps: 60, output: { ...source, frameCount: 117, fps: 60, hasAudio: false } })).toThrow(/audio/i);
  });
});
