import { describe, expect, it } from "vitest";
import { expandedWatermarkPixelRect, normalizedWatermarkRegion, resolveReferencePlacement, watermarkContextPixelRect, watermarkPixelRect } from "./static-watermark-renderer";

describe("static watermark geometry", () => {
  it("mantiene la regione selezionata dentro il fotogramma", () => {
    const settings = { region: { x: .9, y: .95, width: .3, height: .2 } };
    expect(normalizedWatermarkRegion(settings)).toEqual({ x: .7, y: .8, width: .3, height: .2 });
    expect(watermarkPixelRect(1_000, 500, settings)).toEqual({ x: 700, y: 400, width: 300, height: 100 });
  });

  it("allinea la foto pulita con cover, scala e offset normalizzati", () => {
    expect(resolveReferencePlacement(1_000, 1_000, 1_920, 1_080, { referenceFit: "cover", referenceScale: 1, referenceOffsetX: 0, referenceOffsetY: 0 })).toEqual({ x: 0, y: -420, width: 1_920, height: 1_920 });
    expect(resolveReferencePlacement(1_000, 500, 1_000, 500, { referenceFit: "stretch", referenceScale: 1.2, referenceOffsetX: .1, referenceOffsetY: -.1 })).toEqual({ x: 0, y: -100, width: 1_200, height: 600 });
  });

  it("estende la sfumatura solo fuori dalla zona sostituita", () => {
    const selected = { x: 100, y: 50, width: 200, height: 80 };
    expect(expandedWatermarkPixelRect(500, 300, selected, 0)).toEqual(selected);
    expect(expandedWatermarkPixelRect(500, 300, selected, 4)).toEqual({ x: 96, y: 46, width: 208, height: 88 });
    expect(expandedWatermarkPixelRect(500, 300, { x: 0, y: 2, width: 100, height: 50 }, 6)).toEqual({ x: 0, y: 0, width: 106, height: 58 });
  });

  it("include il video circostante nella preview di precisione", () => {
    expect(watermarkContextPixelRect(1_000, 800, { x: 400, y: 300, width: 200, height: 100 })).toEqual({ x: 230, y: 215, width: 540, height: 270 });
    expect(watermarkContextPixelRect(1_000, 800, { x: 8, y: 5, width: 40, height: 30 })).toEqual({ x: 0, y: 0, width: 96, height: 83 });
  });
});
