import { describe, expect, it } from "vitest";
import { railBarRadius, railGauge, railSupportDrop, railTrimEnd, railTrimStart } from "./route-geometry";

describe("route geometry", () => {
  it("colloca le due guide sotto la sfera con un contatto tangenziale", () => {
    const radius = .42; const type = "pinball" as const; const gauge = railGauge(radius, type); const drop = railSupportDrop(radius, type);
    expect(Math.hypot(gauge, drop)).toBeCloseTo(radius + railBarRadius(type), 6);
    expect(drop).toBeGreaterThan(radius * .8);
  });

  it("colloca mattoncini e guide in vetro sotto il centro", () => {
    expect(railSupportDrop(.42, "bricks")).toBeGreaterThan(.42);
    expect(railSupportDrop(.42, "glassTube")).toBeGreaterThan(.35);
    expect(railTrimStart).toBeGreaterThan(0); expect(railTrimEnd).toBeLessThan(1);
  });
});
