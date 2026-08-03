import { describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import { fitPortraitLandscapePreview, portraitCenterRect, portraitCubePose, portraitCubeRotationState, portraitLandscapeQualityProfile, portraitLightningIntensity, portraitParticleFlicker, portraitSpectrumBandLevel, portraitSpectrumDisplayValues, portraitSpectrumPalette, portraitSpectrumValues } from "./portrait-landscape-renderer";

describe("portrait landscape renderer", () => {
  it("centra un rettangolo 9:16 esatto nel canvas 16:9", () => {
    const rect = portraitCenterRect(3840, 2160);
    expect(rect).toEqual({ x: 1312.5, y: 0, width: 1215, height: 2160 });
    expect(rect.x).toBeCloseTo((3840 - rect.width) / 2);
  });

  it("fa rimbalzare il cubo sui bordi senza aggiungere vibrazioni ritmiche alla posizione", () => {
    const settings = createProject().animation.portraitLandscape;
    const first = portraitCubePose(1920, 1080, 3.25, 60, settings);
    const same = portraitCubePose(1920, 1080, 3.25, 60, settings);
    const next = portraitCubePose(1920, 1080, 3.251, 60, settings);
    expect(first).toEqual(same);
    expect(first.x).toBeGreaterThan(first.size / 2);
    expect(first.x).toBeLessThan(1920 - first.size / 2);
    expect(Math.abs(next.x - first.x)).toBeLessThan(1);
    expect(Math.abs(next.y - first.y)).toBeLessThan(1);
    expect(Math.abs(next.rotation - first.rotation)).toBeLessThan(.01);
    const differentTempo = portraitCubePose(1920, 1080, 3.25, 180, settings);
    expect(differentTempo.x).toBe(first.x);
    expect(differentTempo.y).toBe(first.y);
    const horizontalBorderTime = (.5 - .08) * 12 / settings.cubeSpeed;
    const border = portraitCubePose(1920, 1080, horizontalBorderTime, 60, settings);
    const beforeBorder = portraitCubePose(1920, 1080, horizontalBorderTime - .1, 60, settings);
    const afterBorder = portraitCubePose(1920, 1080, horizontalBorderTime + .1, 60, settings);
    expect(border.edgeImpact).toBeCloseTo(1);
    expect(border.x).toBeGreaterThan(beforeBorder.x);
    expect(afterBorder.x).toBeLessThan(border.x);
  });

  it("ruota sempre e cambia direzione ai cue musicali e agli urti non coincidenti", () => {
    const settings = createProject().animation.portraitLandscape;
    expect(portraitCubeRotationState(1, 60, settings).angle).toBeGreaterThan(portraitCubeRotationState(0, 60, settings).angle);
    const verticalWallTime = (.5 - .31) / ((settings.cubeSpeed / 12) * .73);
    expect(portraitCubeRotationState(verticalWallTime - .01, 60, settings).direction).toBe(1);
    expect(portraitCubeRotationState(verticalWallTime + .01, 60, settings).direction).toBe(-1);
    expect(portraitCubeRotationState(7.99, 60, settings).direction).toBe(-1);
    expect(portraitCubeRotationState(8.01, 60, settings).direction).toBe(1);
    expect(portraitCubeRotationState(8.2, 60, settings).changeCount).toBe(2);
    const fast = portraitCubeRotationState(1, 60, { ...settings, cubeRotationSpeed: 2 });
    const slow = portraitCubeRotationState(1, 60, { ...settings, cubeRotationSpeed: .5 });
    expect(fast.angle - .42).toBeGreaterThan(slow.angle - .42);
  });

  it("contiene sempre il 16:9 nell’altezza realmente disponibile", () => {
    const fitted = fitPortraitLandscapePreview(1960, 820);
    expect(fitted).toEqual({ width: 820 * 16 / 9, height: 820 });
    expect(fitted.width).toBeLessThanOrEqual(1960);
    expect(fitted.height).toBeLessThanOrEqual(820);
    const widthLimited = fitPortraitLandscapePreview(960, 900);
    expect(widthLimited).toEqual({ width: 960, height: 540 });
  });

  it("divide realmente le 48 bande sui due lati senza dipendere dal flag audio", () => {
    const stereoLeft = Array.from({ length: 48 }, (_, index) => index / 48);
    const stereoRight = Array.from({ length: 48 }, (_, index) => (48 - index) / 48);
    const values = portraitSpectrumValues([], stereoLeft, stereoRight);
    expect(values.left).toHaveLength(24);
    expect(values.right).toHaveLength(24);
    expect(values.left[23]).toBeCloseTo(23 / 48);
    expect(values.right[0]).toBeCloseTo(24 / 48);
    expect(values.right[23]).toBeCloseTo(1 / 48);
    expect(values.peak).toBe(.5);
  });

  it("mantiene visualizer e fulmini visibili anche prima dell’analisi audio", () => {
    const fallback = portraitSpectrumDisplayValues([], [], [], 0, 96);
    expect(fallback.analyzed).toBe(false);
    expect(fallback.left).toHaveLength(24);
    expect(Math.min(...fallback.left, ...fallback.right)).toBeGreaterThan(.1);
    expect(portraitLightningIntensity(0, 96, 0, 0)).toBe(1);
    expect(portraitLightningIntensity(.25, 120, 0, .8)).toBe(.8);
  });

  it("conserva la dinamica assoluta del brano senza normalizzare ogni frame", () => {
    const silence = portraitSpectrumBandLevel(0, 1.2, 0);
    const quiet = portraitSpectrumBandLevel(.04, 1.2, .08);
    const transient = portraitSpectrumBandLevel(.72, 1.2, .9);
    expect(silence).toBe(0);
    expect(quiet).toBeGreaterThan(0);
    expect(transient).toBeGreaterThan(quiet * 2);
    expect(transient).toBeLessThanOrEqual(1);
    const analyzedSilence = portraitSpectrumDisplayValues(Array(48).fill(0), Array(48).fill(0), Array(48).fill(0), 4, 120, true);
    expect(analyzedSilence.analyzed).toBe(true);
    expect(analyzedSilence.left.every((value) => value === 0)).toBe(true);
  });

  it("seleziona per lo spettrogramma la palette della cover, dello sfondo oppure manuale", () => {
    const settings = createProject().animation.portraitLandscape;
    expect(portraitSpectrumPalette({ ...settings, spectrumPaletteSource: "cover", palette: ["#111111", "#222222", "#333333"] })).toEqual(["#111111", "#222222", "#333333"]);
    expect(portraitSpectrumPalette({ ...settings, spectrumPaletteSource: "sideImage", sideImagePalette: ["#aaaaaa", "#bbbbbb", "#cccccc"] })).toEqual(["#aaaaaa", "#bbbbbb", "#cccccc"]);
    expect(portraitSpectrumPalette({ ...settings, spectrumPaletteSource: "manual", spectrumManualPalette: ["#123456", "#abcdef", "#fedcba"] })).toEqual(["#123456", "#abcdef", "#fedcba"]);
  });

  it("fa brillare le particelle a intermittenza con un valore deterministico", () => {
    const samples = Array.from({ length: 20 }, (_, index) => portraitParticleFlicker(3, index / 10));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(.4);
    expect(portraitParticleFlicker(3, .8)).toBe(portraitParticleFlicker(3, .8));
  });

  it("riduce soltanto il costo grafico della preview e conserva la qualità completa in export", () => {
    const preview = portraitLandscapeQualityProfile("preview");
    const output = portraitLandscapeQualityProfile("export");
    expect(preview.canvasMaxWidth).toBeLessThan(output.canvasMaxWidth);
    expect(preview.cubeMaxPixels).toBeLessThan(output.cubeMaxPixels);
    expect(preview.effectDensity).toBeLessThan(output.effectDensity);
    expect(preview.glowScale).toBeLessThan(output.glowScale);
    expect(preview.blurLimit).toBeLessThan(output.blurLimit);
    expect(preview.antialias).toBe(false);
    expect(output.antialias).toBe(true);
  });
});
