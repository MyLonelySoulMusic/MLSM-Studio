import { describe, expect, it } from "vitest";
import { deformStereoCoverVertex, resolveStereoUnfoldMotion } from "./stereo-unfold-motion";

describe("Stereo Unfold motion", () => {
  it("fa arrivare la cover dall'alto e completa l'apertura senza scatti", () => {
    const start = resolveStereoUnfoldMotion(0, 2.4); const middle = resolveStereoUnfoldMotion(1.2, 2.4); const end = resolveStereoUnfoldMotion(3, 2.4);
    expect(start.coverY).toBeGreaterThan(6); expect(middle.coverY).toBeLessThan(start.coverY); expect(end.coverY).toBeCloseTo(.34, 1); expect(start.unfold).toBe(0); expect(middle.unfold).toBeGreaterThan(0); expect(end.unfold).toBe(1);
  });
  it("mantiene pieghe residue anche dopo il dispiegamento", () => {
    const crumpled = deformStereoCoverVertex(1.1, -.7, 0, .7, 0); const open = deformStereoCoverVertex(1.1, -.7, 1, .7, 0);
    expect(Math.abs(crumpled.z)).toBeGreaterThan(Math.abs(open.z)); expect(Math.abs(open.z)).toBeGreaterThan(.001); expect(open.x).toBeCloseTo(1.1);
  });
});
