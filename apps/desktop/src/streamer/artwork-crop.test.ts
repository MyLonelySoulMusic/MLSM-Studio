import { describe, expect, it } from "vitest";
import { artworkCrop } from "./artwork-crop";

describe("Square YouTube artwork", () => {
  it("removes 16:9 lateral bars without distorting the cover", () => {
    expect(artworkCrop(1280, 720, true)).toEqual({ width: 1280 / 720 * 100, height: 100 });
  });
  it("removes the black letterbox AND lateral bars from hqdefault", () => {
    const crop = artworkCrop(480, 360, true);
    expect(crop.width).toBeCloseTo(177.7778);
    expect(crop.height).toBeCloseTo(133.3333);
    // Crop is a central 270 x 270 square, not 360 x 360 with black bands.
    expect(480 / crop.width).toBeCloseTo(360 / crop.height);
  });
  it("does not enlarge square artwork and preserves non-YouTube 4:3 images", () => {
    expect(artworkCrop(800, 800, true)).toEqual({ width: 100, height: 100 });
    expect(artworkCrop(480, 360, false)).toEqual({ width: 480 / 360 * 100, height: 100 });
    expect(artworkCrop(0, 0, true)).toEqual({ width: 100, height: 100 });
  });
});
