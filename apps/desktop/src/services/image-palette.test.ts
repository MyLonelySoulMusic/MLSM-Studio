import { describe, expect, it } from "vitest";
import { extractDominantColors } from "./image-palette";

describe("image palette", () => {
  it("estrae colori dominanti distinti ignorando pixel trasparenti", () => {
    const pixels = new Uint8ClampedArray([
      230, 40, 70, 255, 232, 42, 72, 255, 230, 40, 70, 255,
      30, 120, 220, 255, 31, 121, 219, 255, 0, 255, 0, 0
    ]);
    const colors = extractDominantColors(pixels, 3);
    expect(colors).toHaveLength(2); expect(colors[0]).toMatch(/^#[0-9a-f]{6}$/); expect(colors).not.toContain("#00ff00");
  });

  it("fornisce una palette sicura per immagini vuote", () => { expect(extractDominantColors(new Uint8ClampedArray())).toEqual(["#63f0d1", "#7657ff"]); });
});
