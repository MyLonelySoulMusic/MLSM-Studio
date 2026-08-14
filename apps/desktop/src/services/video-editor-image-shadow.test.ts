import { describe, expect, it } from "vitest";
import {
  defaultVideoEditorImageShadow,
  videoEditorImageLongShadowStops,
  videoEditorImageShadowCssFilter,
  videoEditorImageShadowGeometry,
  videoEditorImageShadowPaint
} from "./video-editor-image-shadow";

describe("Video Editor · ombre immagini", () => {
  it("mantiene l’ombra disattivata per le nuove clip", () => {
    expect(defaultVideoEditorImageShadow.enabled).toBe(false);
    expect(videoEditorImageShadowCssFilter(defaultVideoEditorImageShadow, 1920, 1080)).toBe("none");
  });

  it("condivide la geometria object-fit tra preview e canvas", () => {
    expect(videoEditorImageShadowGeometry(100, 200, 1920, 1080, "contain")).toEqual({ x: 690, y: 0, width: 540, height: 1080 });
    expect(videoEditorImageShadowGeometry(100, 200, 1920, 1080, "cover")).toEqual({ x: 0, y: -1380, width: 1920, height: 3840 });
  });

  it("offre tre trattamenti CSS distinti senza alterare il payload", () => {
    const base = { ...defaultVideoEditorImageShadow, enabled: true };
    const drop = videoEditorImageShadowCssFilter(base, 1920, 1080);
    const glow = videoEditorImageShadowCssFilter({ ...base, style: "glow" }, 1920, 1080);
    const long = videoEditorImageShadowCssFilter({ ...base, style: "long" }, 1920, 1080);
    expect(drop).toContain("drop-shadow(");
    expect(glow.split("drop-shadow(")).toHaveLength(3);
    expect(long.split("drop-shadow(")).toHaveLength(9);
  });

  it("risolve un unico vettore angolo/distanza per drop, CSS e Canvas", () => {
    const shadow = { ...defaultVideoEditorImageShadow, enabled: true, angle: 30, distance: .1, blur: .02 };
    const paint = videoEditorImageShadowPaint(shadow, 200, 100);
    expect(paint.primitives).toHaveLength(1);
    expect(paint.primitives[0]?.offsetX).toBeCloseTo(Math.cos(Math.PI / 6) * 10, 12);
    expect(paint.primitives[0]?.offsetY).toBeCloseTo(5, 12);
    expect(paint.primitives[0]?.blur).toBe(2);
    expect(videoEditorImageShadowCssFilter(shadow, 200, 100)).toContain("8.66px 5.00px 2.00px");
  });

  it("mantiene il glow centrato e l'ombra lunga sugli stop condivisi", () => {
    const base = { ...defaultVideoEditorImageShadow, enabled: true, angle: 0, distance: .08, blur: .02 };
    const glow = videoEditorImageShadowPaint({ ...base, style: "glow" }, 200, 100);
    expect(glow.primitives).toHaveLength(2);
    expect(glow.primitives.every(({ offsetX, offsetY }) => offsetX === 0 && offsetY === 0)).toBe(true);

    const long = videoEditorImageShadowPaint({ ...base, style: "long" }, 200, 100);
    expect(long.primitives.map(({ offsetX }) => offsetX)).toEqual(videoEditorImageLongShadowStops.map((stop) => 8 * stop));
    expect(long.primitives.every(({ offsetY, blur }) => offsetY === 0 && blur === .7)).toBe(true);
  });
});
