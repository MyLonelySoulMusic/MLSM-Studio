import { describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import { fitUpscalerPreset, resolvedUpscalerDimensions, upscalerFilter } from "./upscaler-renderer";

describe("upscaler renderer", () => {
  it("mantiene il rapporto quando cambia la risoluzione finale", () => {
    expect(resolvedUpscalerDimensions({ sourceWidth: 1920, sourceHeight: 1080, finalWidth: 3840, finalHeight: 2000, lockAspectRatio: true }, "width")).toEqual({ width: 3840, height: 2160 });
    expect(resolvedUpscalerDimensions({ sourceWidth: 1920, sourceHeight: 1080, finalWidth: 3000, finalHeight: 1080, lockAspectRatio: false }, "width")).toEqual({ width: 3000, height: 1080 });
  });
  it("ruota i preset e preserva il rapporto delle sorgenti verticali", () => {
    expect(fitUpscalerPreset(1080, 1920, 1920, 1080)).toEqual({ width: 1080, height: 1920 });
    expect(fitUpscalerPreset(1000, 2000, 2560, 1440)).toEqual({ width: 1280, height: 2560 });
    expect(fitUpscalerPreset(2048, 1024, 1920, 1080)).toEqual({ width: 1920, height: 960 });
  });
  it("converte le regolazioni fotografiche in una pipeline canvas valida", () => {
    const settings = createProject().animation.upscaler;
    expect(upscalerFilter({ adjustments: { ...settings.adjustments, exposure: 1, saturation: 20, denoise: 18 } })).toContain("brightness(2");
    expect(upscalerFilter({ adjustments: settings.adjustments })).toContain("contrast(1)");
  });
});
