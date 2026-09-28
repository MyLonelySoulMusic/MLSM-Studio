import { describe, expect, it } from "vitest";
import { estimateSpatialTranslation, fingerprintSimilarity, frameRatesDiffer, selectTemporalOffset } from "./static-watermark-alignment";

const fingerprint = (...values: number[]) => Float32Array.from(values);

describe("static watermark video alignment", () => {
  it("scores identical frame fingerprints as an exact match", () => {
    expect(fingerprintSimilarity(fingerprint(1, -1, 2), fingerprint(1, -1, 2))).toBeCloseTo(1, 6);
  });

  it("distinguishes incompatible FPS while accepting normal 29.97/30 rounding", () => {
    expect(frameRatesDiffer(30, 29.97)).toBe(false);
    expect(frameRatesDiffer(30, 25)).toBe(true);
  });

  it("finds the temporal offset between the watermarked and clean sequences", () => {
    const source = [
      { time: 0, fingerprint: fingerprint(1, 0, 0) },
      { time: 1, fingerprint: fingerprint(0, 1, 0) },
      { time: 2, fingerprint: fingerprint(0, 0, 1) },
    ];
    const reference = source.map(frame => ({ time: frame.time + 2, fingerprint: frame.fingerprint }));
    const result = selectTemporalOffset(source, reference, [0, 1, 2]);
    expect(result.offsetSeconds).toBe(2);
    expect(result.comparedFrames).toBe(3);
    expect(result.confidence).toBeGreaterThan(.7);
  });

  it("recovers a small spatial translation outside the watermark area", () => {
    const width = 36; const height = 28;
    const make = (shiftX: number, shiftY: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 3; y < height - 3; y += 1) for (let x = 3; x < width - 3; x += 1) {
        const value = ((x * 29 + y * 47 + (x * y % 13) * 17) % 255);
        const targetX = x + shiftX; const targetY = y + shiftY;
        if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
        const offset = (targetY * width + targetX) * 4;
        data[offset] = value; data[offset + 1] = value; data[offset + 2] = value; data[offset + 3] = 255;
      }
      return { data, width, height } as ImageData;
    };
    const result = estimateSpatialTranslation(make(0, 0), make(2, -1), { x: .7, y: .05, width: .2, height: .15 }, 4, 4);
    expect(result.dx).toBe(-2);
    expect(result.dy).toBe(1);
    expect(result.confidence).toBeGreaterThan(.5);
  });
});
