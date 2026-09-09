import { describe, expect, it } from "vitest";
import { buildLogoRelief, LOGO_RELIEF_LIMITS } from "./logo-relief";
import { LOGO_VECTORS, LOGO_WORLD_SIZE } from "./artist-logo-design";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { ExtrudeGeometry } from "three";

describe("artist logo geometry", () => {
  it("keeps the original figure UVs and bounds while adding smooth, bounded depth", () => {
    const face = buildLogoRelief();
    const pos = face.getAttribute("position"), uv = face.getAttribute("uv");
    let minimum = Infinity, maximum = -Infinity;
    for (let i = 0; i < pos.count; i++) { minimum = Math.min(minimum, pos.getZ(i)); maximum = Math.max(maximum, pos.getZ(i)); }
    expect(maximum - minimum).toBeGreaterThan(.05);
    expect(maximum).toBeLessThanOrEqual(LOGO_RELIEF_LIMITS.depth + LOGO_RELIEF_LIMITS.relief + .001);
    expect(pos.count).toBeLessThan(15_000);
    expect(uv.getX(0)).toBe(0); expect(uv.getY(0)).toBe(1);
    face.computeBoundingBox();
    expect(face.boundingBox!.max.x - face.boundingBox!.min.x).toBeCloseTo(LOGO_WORLD_SIZE);
    for (const value of face.getAttribute("normal").array) expect(Number.isFinite(value)).toBe(true);
    face.dispose();
  });

  it("builds separate, finite vector solids for the four letters, ring, signal and birds", () => {
    const loader = new SVGLoader();
    expect(LOGO_VECTORS.filter((part) => part.name.startsWith("letter"))).toHaveLength(4);
    for (const part of LOGO_VECTORS) {
      const parsed = loader.parse('<svg xmlns="http://www.w3.org/2000/svg"><path d="' + part.path + '"/></svg>');
      const shapes = parsed.paths.flatMap((path) => SVGLoader.createShapes(path));
      expect(shapes.length).toBeGreaterThan(0);
      const solid = new ExtrudeGeometry(shapes, { depth: part.depth, bevelEnabled: false, curveSegments: 24 });
      solid.computeBoundingBox();
      expect(solid.boundingBox!.max.z).toBeGreaterThan(0);
      for (const value of solid.getAttribute("position").array) expect(Number.isFinite(value)).toBe(true);
      if (part.name === "ring") expect(shapes[0]!.holes).toHaveLength(1);
      solid.dispose();
    }
  });
});
