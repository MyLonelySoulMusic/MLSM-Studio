import { describe, expect, it } from "vitest";
import { mixOverlaySpectralPalette, overlaySpectralCatalog, overlaySpectralPreset, overlaySpectralPresetIds } from "./overlay-spectral-catalog";

describe("overlay spectral catalog", () => {
  it("espone tutti e soli i 14 effetti adattati con id univoci", () => {
    expect(overlaySpectralCatalog.map((preset) => preset.id)).toEqual(overlaySpectralPresetIds);
    expect(new Set(overlaySpectralPresetIds).size).toBe(14);
    expect(overlaySpectralPreset("non-esiste").id).toBe("milkdrop-radial-spectrum");
  });

  it("miscela in modo esatto palette nativa e palette MLSM", () => {
    const native = ["#000000", "#204060", "#ffffff"] as const;
    const project = ["#ffffff", "#6080a0", "#000000"] as const;
    expect(mixOverlaySpectralPalette(native, project, 0)).toEqual(native);
    expect(mixOverlaySpectralPalette(native, project, 1)).toEqual(project);
    expect(mixOverlaySpectralPalette(native, project, .5)).toEqual(["#808080", "#406080", "#808080"]);
  });
});
