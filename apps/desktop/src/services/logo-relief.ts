import { PlaneGeometry } from "three";
import { LOGO_WORLD_SIZE } from "./artist-logo-design";

export const LOGO_RELIEF_LIMITS = { samples: 112, depth: .035, relief: .12 } as const;

/** Smooth geometry only for the seated figure. Its silhouette and texture stay at
 * source resolution; lettering and graphic lines use separate vector solids. */
export function buildLogoRelief() {
  const geometry = new PlaneGeometry(LOGO_WORLD_SIZE, LOGO_WORLD_SIZE, LOGO_RELIEF_LIMITS.samples, LOGO_RELIEF_LIMITS.samples);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < position.count; i++) {
    const u = uv.getX(i), v = 1 - uv.getY(i);
    const dome = (cx: number, cy: number, rx: number, ry: number) => Math.exp(-(((u - cx) / rx) ** 2) - ((v - cy) / ry) ** 2);
    const relief = Math.min(1, .85 * dome(.56, .3, .13, .12) + .7 * dome(.59, .47, .18, .17) + .35 * dome(.48, .68, .3, .12));
    position.setZ(i, LOGO_RELIEF_LIMITS.depth + LOGO_RELIEF_LIMITS.relief * relief);
  }
  geometry.computeVertexNormals();
  return geometry;
}
