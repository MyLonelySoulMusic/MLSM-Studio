import { describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import { fitUpscalerPreset, formatUpscalerViewportFooter, resolveUpscalerPreviewSize, resolveUpscalerTarget, resolvedUpscalerDimensions, upscalerFilter } from "./upscaler-renderer";

describe("upscaler renderer", () => {
  it("mantiene il rapporto quando cambia la risoluzione finale", () => {
    expect(resolvedUpscalerDimensions({ sourceWidth: 1920, sourceHeight: 1080, finalWidth: 3840, finalHeight: 2000, lockAspectRatio: true }, "width")).toEqual({ width: 3840, height: 2160 });
    expect(resolvedUpscalerDimensions({ sourceWidth: 1920, sourceHeight: 1080, finalWidth: 3000, finalHeight: 1080, lockAspectRatio: false }, "width")).toEqual({ width: 3000, height: 1080 });
  });
  it("risolve target non 16:9, verticali e oltre il limite massimo senza deformare", () => {
    expect(resolveUpscalerTarget(1440, 1080, 2)).toEqual({ width: 2880, height: 2160 });
    expect(resolveUpscalerTarget(1080, 1920, 2)).toEqual({ width: 2160, height: 3840 });
    expect(resolveUpscalerTarget(6000, 4000, 4)).toEqual({ width: 16384, height: 10922 });
    expect(resolveUpscalerTarget(63, 47, 1)).toEqual({ width: 86, height: 64 });
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
  it("mostra nel footer originale/output senza ereditare il rapporto globale", () => {
    const footer = formatUpscalerViewportFooter({ sourceWidth: 1440, sourceHeight: 1080, finalWidth: 1920, finalHeight: 1440 });
    expect(footer).toContain("Originale 1440 × 1080");
    expect(footer).toContain("Output 1920 × 1440");
    expect(footer).not.toContain("16:9");
  });
  it.each([[4, 3], [9, 16], [1, 1], [21, 9]])("mantiene il rapporto intrinseco del canvas per %s:%s", (width, height) => {
    const preview = resolveUpscalerPreviewSize(width, height);
    expect(preview.width / preview.height).toBeCloseTo(width / height, 2);
  });
});
