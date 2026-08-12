import { createProject } from "@rbs/project-schema";
import { describe, expect, it } from "vitest";
import {
  backgroundAutoConfigurationError,
  backgroundAutoCoverTransform,
  backgroundAutoContainTransform,
  backgroundAutoEffectOpacity,
  backgroundAutoOutputDimensions,
  backgroundAutoResolutionOptions,
  mapBackgroundAutoBoxToCanvas,
  normalizeBackgroundAutoProjectSeed,
  renderBackgroundAutoFrame,
  resolveBackgroundAutoEffects
} from "./background-auto-renderer";
import { activeBackgroundAutoSubtitleCue } from "./background-auto-subtitles";

class RecordingGradient {
  readonly stops: Array<{ offset: number; color: string }> = [];
  addColorStop(offset: number, color: string): void { this.stops.push({ offset, color }); }
}

class RecordingContext {
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000";
  lineWidth = 1;
  readonly fills: Array<{ alpha: number; style: string | CanvasGradient | CanvasPattern }> = [];
  readonly rectangles: Array<{ x: number; y: number; width: number; height: number; alpha: number; style: string | CanvasGradient | CanvasPattern }> = [];
  readonly strokes: Array<{ alpha: number; style: string | CanvasGradient | CanvasPattern }> = [];
  readonly text: Array<{ value: string; alpha: number; style: string | CanvasGradient | CanvasPattern }> = [];
  readonly strokeCompositeModes: GlobalCompositeOperation[] = [];
  readonly rotations: number[] = [];
  gradientCalls = 0;
  private readonly stack: Array<{ alpha: number; mode: GlobalCompositeOperation; fillStyle: string | CanvasGradient | CanvasPattern; strokeStyle: string | CanvasGradient | CanvasPattern }> = [];
  save(): void { this.stack.push({ alpha: this.globalAlpha, mode: this.globalCompositeOperation, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle }); }
  restore(): void { const state = this.stack.pop(); if (!state) return; this.globalAlpha = state.alpha; this.globalCompositeOperation = state.mode; this.fillStyle = state.fillStyle; this.strokeStyle = state.strokeStyle; }
  clearRect(): void {}
  fillRect(x: number, y: number, width: number, height: number): void { this.fills.push({ alpha: this.globalAlpha, style: this.fillStyle }); this.rectangles.push({ x, y, width, height, alpha: this.globalAlpha, style: this.fillStyle }); }
  drawImage(): void {}
  createLinearGradient(): CanvasGradient { this.gradientCalls += 1; return new RecordingGradient() as unknown as CanvasGradient; }
  beginPath(): void {}
  arc(): void {}
  stroke(): void { this.strokes.push({ alpha: this.globalAlpha, style: this.strokeStyle }); this.strokeCompositeModes.push(this.globalCompositeOperation); }
  moveTo(): void {}
  lineTo(): void {}
  clip(): void {}
  fill(): void { this.fills.push({ alpha: this.globalAlpha, style: this.fillStyle }); }
  fillText(value: string): void { this.text.push({ value, alpha: this.globalAlpha, style: this.fillStyle }); }
  measureText(value: string): TextMetrics { return { width: value.length * 10 } as TextMetrics; }
  translate(): void {}
  rotate(angle: number): void { this.rotations.push(angle); }
}

function recordingCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: RecordingContext } {
  const canvas = { width, height } as unknown as HTMLCanvasElement;
  const context = new RecordingContext();
  (canvas as unknown as { getContext: () => RecordingContext }).getContext = () => context;
  return { canvas, context };
}

function settings() {
  const value = createProject().animation.backgroundAuto;
  value.detections = [
    { id: "person-a", label: "person", alias: "person", score: .95, isPerson: true, bbox: { x: .1, y: .2, width: .2, height: .4 } },
    { id: "car-b", label: "car", alias: "car", score: .9, isPerson: false, bbox: { x: .6, y: .3, width: .3, height: .2 } }
  ];
  value.effects = [
    { ...value.effects[0]!, id: "auto-person", enabled: true, detectionId: "person-a", paletteMode: "auto" },
    { ...value.effects[0]!, id: "manual-car", enabled: true, detectionId: "car-b", paletteMode: "manual", color: "#abcdef", palette: ["#111111", "#222222", "#333333"] }
  ];
  return value;
}

describe("Background Auto renderer invariants", () => {
  it("applica lo stesso transform cover/crop al centro e alle dimensioni del bbox", () => {
    const landscapeToPortrait = backgroundAutoCoverTransform(1600, 900, 1080, 1920);
    expect(landscapeToPortrait).toMatchObject({ scale: 1920 / 900, offsetY: 0, drawHeight: 1920 });
    expect(landscapeToPortrait.offsetX).toBeCloseTo((1080 - 1600 * 1920 / 900) / 2, 8);
    const mapped = mapBackgroundAutoBoxToCanvas({ x: .25, y: .25, width: .5, height: .5 }, landscapeToPortrait);
    expect(mapped.centerX).toBeCloseTo(540, 8); expect(mapped.centerY).toBeCloseTo(960, 8);
    expect(mapped.width).toBeCloseTo(1600 * (1920 / 900) * .5, 8); expect(mapped.height).toBeCloseTo(960, 8);
  });

  it("risolve ogni istanza soltanto sulla detection associata e separa palette auto/manuale", () => {
    const value = settings(); value.palette = ["#aa0000", "#00bb00", "#0000cc"];
    const resolved = resolveBackgroundAutoEffects(value);
    expect(resolved.map((item) => [item.effect.id, item.detection.id])).toEqual([["auto-person", "person-a"], ["manual-car", "car-b"]]);
    expect(resolved[0]?.palette).toEqual(value.palette); expect(resolved[0]?.color).toBe("#aa0000");
    expect(resolved[1]?.palette).toEqual(["#111111", "#222222", "#333333"]); expect(resolved[1]?.color).toBe("#abcdef");
  });

  it("accepts explicit effects for every detection regardless of the legacy person flag", () => {
    const value = settings(); value.personAnimationEnabled = true;
    expect(resolveBackgroundAutoEffects(value).map((item) => item.detection.id)).toEqual(["person-a", "car-b"]);
    expect(backgroundAutoConfigurationError(value)).toBeNull();
    value.detections = value.detections.filter((detection) => !detection.isPerson);
    expect(backgroundAutoConfigurationError(value)).toMatch(/not associated with a detected object/);
  });

  it("normalizza il seed una volta per preview ed export", () => {
    expect(normalizeBackgroundAutoProjectSeed(42.9)).toBe(42);
    expect(normalizeBackgroundAutoProjectSeed(-1)).toBe(0xffffffff);
    expect(normalizeBackgroundAutoProjectSeed(Number.NaN)).toBe(0);
  });

  it("clamps opacità e conserva il default forte per i progetti legacy", () => {
    expect(backgroundAutoEffectOpacity(0)).toBe(0);
    expect(backgroundAutoEffectOpacity(1)).toBe(1);
    expect(backgroundAutoEffectOpacity(-1)).toBe(0);
    expect(backgroundAutoEffectOpacity(2)).toBe(1);
    expect(backgroundAutoEffectOpacity(undefined)).toBe(.9);
  });

  it("non vela l'immagine e non aggiunge una vignettatura finale", () => {
    const value = settings();
    value.effects = [];
    const { canvas, context } = recordingCanvas(100, 100);
    renderBackgroundAutoFrame({ canvas, image: { width: 100, height: 100 } as unknown as CanvasImageSource, settings: value, timeSeconds: 0, spectrumBands: [], audioPulse: 0 });
    expect(context.gradientCalls).toBe(0);
    expect(context.fills).toHaveLength(1);
    expect(context.globalAlpha).toBe(1);
  });

  it("moltiplica il ring, i picchi e le particelle con l'opacità per effetto", () => {
    const value = settings();
    const { canvas: hiddenCanvas, context: hiddenContext } = recordingCanvas(100, 100);
    value.effects = [{ ...value.effects[0]!, opacity: 0 }];
    renderBackgroundAutoFrame({ canvas: hiddenCanvas, settings: value, timeSeconds: 0, spectrumBands: [1, 1, 1, 1], audioPulse: 1 });
    expect(hiddenContext.strokes.length).toBeGreaterThan(0);
    expect(hiddenContext.strokes.every((stroke) => stroke.alpha === 0)).toBe(true);
    expect(hiddenContext.fills.every((fill) => fill.alpha === 1 || fill.alpha === 0)).toBe(true);
    expect(hiddenContext.globalAlpha).toBe(1);

    const { canvas: visibleCanvas, context: visibleContext } = recordingCanvas(100, 100);
    value.effects = [{ ...value.effects[0]!, opacity: 1 }];
    renderBackgroundAutoFrame({ canvas: visibleCanvas, settings: value, timeSeconds: 0, spectrumBands: [1, 1, 1, 1], audioPulse: 1 });
    expect(visibleContext.strokes[0]?.alpha).toBe(1);
    expect(visibleContext.strokes.some((stroke) => stroke.alpha > 0)).toBe(true);
    expect(visibleContext.fills.some((fill) => fill.alpha > 0 && fill.alpha < 1)).toBe(true);
    expect(visibleContext.globalAlpha).toBe(1);
  });

  it("mantiene distinti i tre colori delle bande senza fusione additive", () => {
    const value = settings();
    value.detections[0] = { ...value.detections[0]!, palette: ["#110000", "#001100", "#000011"], paletteMode: "manual" };
    value.effects = [{ ...value.effects[0]!, detectionId: "person-a", paletteMode: "auto", rotationSpeed: .08 }];
    const { canvas, context } = recordingCanvas(300, 300);
    renderBackgroundAutoFrame({ canvas, settings: value, timeSeconds: 0, spectrumBands: [1, 1, 1, 1, 1, 1], audioPulse: 1 });
    const styles = new Set(context.strokes.map((stroke) => typeof stroke.style === "string" ? stroke.style : ""));
    expect(styles).toEqual(new Set(["#110000", "#001100", "#000011"]));
    expect(context.strokeCompositeModes.every((mode) => mode === "source-over")).toBe(true);
  });

  it("usa velocità in rivoluzioni/secondo e congela esattamente a zero", () => {
    const value = settings(); value.effects = [{ ...value.effects[0]!, rotationSpeed: 0 }];
    const first = recordingCanvas(200, 200); const second = recordingCanvas(200, 200);
    renderBackgroundAutoFrame({ canvas: first.canvas, settings: value, timeSeconds: 0, spectrumBands: [1], audioPulse: 1 });
    renderBackgroundAutoFrame({ canvas: second.canvas, settings: value, timeSeconds: 8, spectrumBands: [1], audioPulse: 1 });
    expect(second.context.rotations).toEqual(first.context.rotations);
    value.effects = [{ ...value.effects[0]!, rotationSpeed: .25 }];
    const moving = recordingCanvas(200, 200);
    renderBackgroundAutoFrame({ canvas: moving.canvas, settings: value, timeSeconds: 1, spectrumBands: [1], audioPulse: 1 });
    expect(moving.context.rotations[0]).not.toBe(first.context.rotations[0]);
    expect(moving.context.rotations[0]! - first.context.rotations[0]!).toBeCloseTo(Math.PI / 2, 8);
  });

  it("disegna i layer centrali e stereo in orientamento fisso e clippato", () => {
    const value = settings(); value.effects = [{ ...value.effects[0]!, rotationSpeed: .25, centerSpectrumEnabled: true, stereoSidesEnabled: true }];
    const first = recordingCanvas(300, 300); const second = recordingCanvas(300, 300);
    renderBackgroundAutoFrame({ canvas: first.canvas, settings: value, timeSeconds: 0, spectrumBands: [1, .5, .2], stereoLeftBands: [1, .2], stereoRightBands: [.2, 1], audioPulse: 1, stereoLeftPulse: 1, stereoRightPulse: .4 });
    renderBackgroundAutoFrame({ canvas: second.canvas, settings: value, timeSeconds: 1, spectrumBands: [1, .5, .2], stereoLeftBands: [1, .2], stereoRightBands: [.2, 1], audioPulse: 1, stereoLeftPulse: 1, stereoRightPulse: .4 });
    expect(first.context.rotations).toHaveLength(1);
    expect(second.context.rotations[0]! - first.context.rotations[0]!).toBeCloseTo(Math.PI / 2, 8);
    expect(first.context.fills.length).toBeGreaterThan(6);
  });

  it("specchia le barre stereo dai bordi interni e conserva l'asimmetria L/R", () => {
    const value = settings();
    value.effects = [{ ...value.effects[0]!, centerSpectrumEnabled: false, stereoSidesEnabled: true, collisionParticles: false, intensity: 1 }];
    const { canvas, context } = recordingCanvas(300, 300);
    renderBackgroundAutoFrame({ canvas, settings: value, timeSeconds: 0, spectrumBands: [0], stereoLeftBands: [1], stereoRightBands: [1, .1], audioPulse: 0, stereoLeftPulse: 1, stereoRightPulse: 1 });
    const bars = context.rectangles.filter((rectangle) => rectangle.width < 100 && rectangle.x !== 0);
    const left = bars.filter((rectangle) => rectangle.x < 0);
    const right = bars.filter((rectangle) => rectangle.x > 0);
    expect(left).toHaveLength(8);
    expect(right).toHaveLength(8);
    const radius = 120 * .38;
    expect(Math.max(...left.map((rectangle) => rectangle.x + rectangle.width))).toBeCloseTo(-radius * .54, 8);
    expect(Math.min(...right.map((rectangle) => rectangle.x))).toBeCloseTo(radius * .54, 8);
    expect(Math.min(...left.map((rectangle) => rectangle.x))).toBeCloseTo(-radius * .83, 8);
    expect(Math.max(...right.map((rectangle) => rectangle.x + rectangle.width))).toBeCloseTo(radius * .83, 8);
    expect(left.at(-1)!.width).toBeGreaterThan(right.at(-1)!.width);
  });

  it("mantiene tutte le 32 barre stereo dentro il clip circolare con input a 48 bande", () => {
    const value = settings();
    value.effects = [{ ...value.effects[0]!, centerSpectrumEnabled: false, stereoSidesEnabled: true, collisionParticles: false, intensity: 1 }];
    const bands = Array.from({ length: 48 }, (_, index) => (index + 1) / 48);
    const { canvas, context } = recordingCanvas(300, 300);
    renderBackgroundAutoFrame({ canvas, settings: value, timeSeconds: 0, spectrumBands: [0], stereoLeftBands: bands, stereoRightBands: bands, audioPulse: 0, stereoLeftPulse: 1, stereoRightPulse: 1 });
    const bars = context.rectangles.filter((rectangle) => rectangle.width < 100 && rectangle.x !== 0);
    const left = bars.filter((rectangle) => rectangle.x < 0);
    const right = bars.filter((rectangle) => rectangle.x > 0);
    expect(left).toHaveLength(32);
    expect(right).toHaveLength(32);

    const radius = 120 * .38;
    const clipRadius = radius * .96;
    for (let index = 0; index < 32; index += 1) {
      const leftBar = left[index]!;
      const rightBar = right[index]!;
      expect(leftBar.height).toBeGreaterThan(0);
      expect(rightBar.height).toBeGreaterThan(0);
      expect(leftBar.x).toBeCloseTo(-(rightBar.x + rightBar.width), 8);
      expect(leftBar.y).toBeCloseTo(rightBar.y, 8);
      expect(leftBar.width).toBeCloseTo(rightBar.width, 8);
      for (const rectangle of [leftBar, rightBar]) {
        const farthestX = Math.max(Math.abs(rectangle.x), Math.abs(rectangle.x + rectangle.width));
        expect(Math.hypot(farthestX, rectangle.y)).toBeLessThanOrEqual(clipRadius);
        expect(Math.hypot(farthestX, rectangle.y + rectangle.height)).toBeLessThanOrEqual(clipRadius);
      }
    }
  });

  it("renderizza solo le cue attive con palette automatica per parola", () => {
    const value = settings(); value.effects = [{ ...value.effects[0]!, subtitlesEnabled: true, centerSpectrumEnabled: false, stereoSidesEnabled: false }];
    const project = createProject();
    const cue = { id: "cue-a", startSeconds: 1, endSeconds: 2, text: "One Two", confidence: 1, verified: true, manual: true } as const;
    const recording = recordingCanvas(300, 300);
    renderBackgroundAutoFrame({ canvas: recording.canvas, settings: value, timeSeconds: 1.5, spectrumBands: [], audioPulse: 0, subtitleCues: [cue], proSubtitlesSettings: project.animation.proSubtitles });
    expect(recording.context.text.map((entry) => entry.value)).toEqual(["One", "Two"]);
    const inactive = recordingCanvas(300, 300);
    renderBackgroundAutoFrame({ canvas: inactive.canvas, settings: value, timeSeconds: 2, spectrumBands: [], audioPulse: 0, subtitleCues: [cue], proSubtitlesSettings: project.animation.proSubtitles });
    expect(inactive.context.text).toHaveLength(0);
  });

  it("ignora i colori Pro per parola e usa sempre la palette dell'effetto", () => {
    const value = settings();
    value.detections[0] = { ...value.detections[0]!, paletteMode: "manual", palette: ["#110000", "#001100", "#000011"] };
    value.effects = [{ ...value.effects[0]!, detectionId: "person-a", paletteMode: "auto", subtitlesEnabled: true, centerSpectrumEnabled: false, stereoSidesEnabled: false }];
    const project = createProject();
    const cue = { id: "cue-palette", startSeconds: 0, endSeconds: 2, text: "Auto Palette Only", confidence: 1, verified: true, manual: true } as const;
    project.animation.proSubtitles.cueStyles = [{
      cueId: cue.id, animation: "wordRush", animationAutomatic: false,
      fontFamily: "Inter", fontFamilyAutomatic: false, fontSize: 80, fontSizeAutomatic: false,
      positionX: 50, positionY: 50, positionAutomatic: false, opacity: 1, opacityAutomatic: false,
      shadowEnabled: false, shadowColor: "#000000",
      wordStyles: [{ index: 0, color: "#ff00ff", fontSizeScale: 1, animation: null }]
    }];
    const recording = recordingCanvas(300, 300);
    renderBackgroundAutoFrame({ canvas: recording.canvas, settings: value, timeSeconds: 1, spectrumBands: [], audioPulse: 0, subtitleCues: [cue], proSubtitlesSettings: project.animation.proSubtitles });
    expect(recording.context.text.map((entry) => entry.style)).not.toContain("#ff00ff");
    expect(recording.context.text.every((entry) => ["#110000", "#001100", "#000011"].includes(String(entry.style)))).toBe(true);
  });

  it("sceglie deterministicamente una sola cue sovrapposta", () => {
    const cue = (id: string, startSeconds: number, endSeconds: number, text = id) => ({ id, startSeconds, endSeconds, text, confidence: 1, verified: true, manual: true });
    const overlapping = [cue("z", 1, 5), cue("b", .5, 4), cue("a", .5, 4)];
    expect(activeBackgroundAutoSubtitleCue(overlapping, 2)?.id).toBe("a");

    const value = settings(); value.effects = [{ ...value.effects[0]!, subtitlesEnabled: true, centerSpectrumEnabled: false, stereoSidesEnabled: false }];
    const recording = recordingCanvas(300, 300);
    renderBackgroundAutoFrame({ canvas: recording.canvas, settings: value, timeSeconds: 2, spectrumBands: [], audioPulse: 0, subtitleCues: overlapping, proSubtitlesSettings: createProject().animation.proSubtitles });
    expect(recording.context.text.map((entry) => entry.value)).toEqual(["a"]);
  });

  it("ridimensiona e rifluisce una frase lunga senza perdere parole", () => {
    const value = settings(); value.effects = [{ ...value.effects[0]!, subtitlesEnabled: true, centerSpectrumEnabled: false, stereoSidesEnabled: false }];
    const expectedWords = Array.from({ length: 96 }, (_, index) => `word${index}`);
    const cue = { id: "long-cue", startSeconds: 0, endSeconds: 4, text: expectedWords.join(" "), confidence: 1, verified: true, manual: true } as const;
    const recording = recordingCanvas(300, 300);
    renderBackgroundAutoFrame({ canvas: recording.canvas, settings: value, timeSeconds: 2, spectrumBands: [], audioPulse: 0, subtitleCues: [cue], proSubtitlesSettings: createProject().animation.proSubtitles });
    expect(recording.context.text.map((entry) => entry.value)).toEqual(expectedWords);
  });

  it.each([
    [1080, 1920, "9:16"], [1000, 1000, "1:1"], [1440, 1080, "4:3"], [2560, 1080, "64:27"]
  ])("contiene la sorgente %sx%s senza crop", (sourceWidth, sourceHeight) => {
    const transform = backgroundAutoContainTransform(sourceWidth, sourceHeight, 1920, 1080);
    expect(transform.drawWidth).toBeLessThanOrEqual(1920 + 1e-8);
    expect(transform.drawHeight).toBeLessThanOrEqual(1080 + 1e-8);
    expect(transform.offsetX + transform.drawWidth).toBeCloseTo(1920 - transform.offsetX, 6);
    expect(transform.offsetY + transform.drawHeight).toBeCloseTo(1080 - transform.offsetY, 6);
  });

  it("accetta solo output pari e proporzionali alla sorgente", () => {
    expect(backgroundAutoOutputDimensions(1080, 1920, 2160, 3840)).toEqual({ width: 2160, height: 3840 });
    expect(backgroundAutoResolutionOptions(1080, 1920).map((option) => option.value)).toContain("1080x1920");
    expect(() => backgroundAutoOutputDimensions(1080, 1920, 1920, 1080)).toThrow(/9:16 source ratio/);
  });

  it("considera nativo l'arrotondamento pari inevitabile di sorgenti dispari", () => {
    expect(backgroundAutoOutputDimensions(941, 1672, 941, 1672)).toEqual({ width: 942, height: 1672 });
    expect(backgroundAutoOutputDimensions(941, 1672, 942, 1672)).toEqual({ width: 942, height: 1672 });
    expect(backgroundAutoResolutionOptions(941, 1672)).toContainEqual({ value: "942x1672", label: "942 × 1672 (941:1672 · native)" });
    expect(backgroundAutoOutputDimensions(1001, 1001, 1001, 1001)).toEqual({ width: 1002, height: 1002 });
    expect(() => backgroundAutoOutputDimensions(941, 1672, 1920, 1080)).toThrow(/941:1672 source ratio/);
  });

  it("applica i limiti minimi e massimi senza deformare i preset", () => {
    expect(backgroundAutoResolutionOptions(100, 200)).toContainEqual({ value: "64x128", label: "64 × 128 (1:2 · 64%)" });
    expect(backgroundAutoResolutionOptions(4000, 8000)).toContainEqual({ value: "3840x7680", label: "3840 × 7680 (1:2 · 96%)" });
  });
});
