import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import {
  createVideoEditorFrameRenderer,
  videoEditorAdjustmentsAreNeutral,
  videoEditorFilter,
  type VideoEditorFrameSource
} from "./video-editor-renderer";
import type { VideoEditorAdjustments, VideoEditorClip, VideoEditorEffectClip, VideoEditorSettings } from "./video-editor";

const baseSettings = createProject("Montaggio").animation.videoEditor;
const neutralAdjustments: VideoEditorAdjustments = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, opacity: 1 };

function clip(overrides: Partial<VideoEditorClip> & { id: string }): VideoEditorClip {
  return {
    assetId: "asset", trackId: "video-editor-track-main",
    startSeconds: 0, durationSeconds: 4, sourceInSeconds: 0,
    fadeInSeconds: 0, fadeOutSeconds: 0, fadeCurve: "smooth", audioFadeInSeconds: 0, audioFadeOutSeconds: 0,
    blendMode: "normal", blendIntensity: 1, adjustments: neutralAdjustments,
    fit: "cover", muted: false, volume: 1,
    ...overrides
  };
}

interface DrawRecord { source: string; x: number; y: number; width: number; height: number; alpha: number; mode: string; filter: string }

class RecordingGradient {
  readonly stops: Array<{ offset: number; color: string }> = [];
  addColorStop(offset: number, color: string): void { this.stops.push({ offset, color }); }
  toString(): string { return "recording-gradient"; }
}

/** Registra soltanto ciò che distingue una composizione professionale: ordine, fusione, opacità, filtro. */
class RecordingContext {
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  filter = "none";
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = "low";
  readonly draws: DrawRecord[] = [];
  readonly fills: { color: string; width: number; height: number; mode: string; alpha: number }[] = [];
  private readonly stack: { alpha: number; mode: GlobalCompositeOperation; filter: string; fillStyle: string | CanvasGradient | CanvasPattern }[] = [];

  constructor(readonly canvas: { width: number; height: number; dataset?: { name?: string } }) {}

  save(): void { this.stack.push({ alpha: this.globalAlpha, mode: this.globalCompositeOperation, filter: this.filter, fillStyle: this.fillStyle }); }
  restore(): void {
    const state = this.stack.pop();
    if (!state) return;
    this.globalAlpha = state.alpha;
    this.globalCompositeOperation = state.mode;
    this.filter = state.filter;
    this.fillStyle = state.fillStyle;
  }
  setTransform(): void { /* nessuna trasformazione nel compositor del montaggio */ }
  translate(): void { /* le trasformazioni sono verificate dal resolver matematico */ }
  rotate(): void { /* le trasformazioni sono verificate dal resolver matematico */ }
  scale(): void { /* le trasformazioni sono verificate dal resolver matematico */ }
  createRadialGradient(): CanvasGradient { return new RecordingGradient() as unknown as CanvasGradient; }
  clearRect(): void { /* la tela di servizio viene azzerata a ogni livello */ }
  fillRect(_x: number, _y: number, width: number, height: number): void {
    this.fills.push({ color: String(this.fillStyle), width, height, mode: this.globalCompositeOperation, alpha: this.globalAlpha });
  }
  drawImage(source: unknown, x = 0, y = 0, width = 0, height = 0): void {
    const named = source as { dataset?: { name?: string }; width?: number; height?: number };
    this.draws.push({
      source: named.dataset?.name ?? "layer-canvas",
      x, y, width, height,
      alpha: this.globalAlpha, mode: this.globalCompositeOperation, filter: this.filter
    });
  }
}

function fakeCanvas(width: number, height: number, name = "target"): { canvas: HTMLCanvasElement; context: RecordingContext } {
  const canvas = { width, height, dataset: { name } } as unknown as HTMLCanvasElement;
  const context = new RecordingContext(canvas as unknown as { width: number; height: number; dataset?: { name?: string } });
  (canvas as unknown as { getContext: () => RecordingContext }).getContext = () => context;
  return { canvas, context };
}

function frameSource(width: number, height: number, name: string): VideoEditorFrameSource {
  return { width, height, source: { dataset: { name }, width, height } as unknown as CanvasImageSource };
}

function settings(clips: VideoEditorClip[], overrides: Partial<VideoEditorSettings> = {}): VideoEditorSettings {
  return { ...baseSettings, clips, assets: [], ...overrides };
}

function effectClip(effectId: string, clipId = "c", overrides: Partial<VideoEditorEffectClip> = {}): VideoEditorEffectClip {
  return {
    id: `effect-${effectId}`, effectId, target: { kind: "clip", clipId }, startSeconds: 0, durationSeconds: 2,
    enabled: true, mix: 1, parameters: {}, ...overrides
  };
}

// jsdom non implementa il 2D: la tela di servizio della correzione colore viene
// sostituita da una superficie registrante, così l’isolamento dei livelli resta verificabile.
const originalOffscreenCanvas = globalThis.OffscreenCanvas;
let layerSurfaces: RecordingContext[] = [];

beforeEach(() => {
  layerSurfaces = [];
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
    width = 0;
    height = 0;
    readonly dataset = { name: "layer-canvas" };
    getContext(): RecordingContext {
      const context = new RecordingContext(this);
      layerSurfaces.push(context);
      return context;
    }
  };
});

afterAll(() => { (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreenCanvas; });

describe("Video Editor · catena colore", () => {
  it("riconosce le regolazioni neutre per saltare la tela di servizio", () => {
    expect(videoEditorAdjustmentsAreNeutral(neutralAdjustments)).toBe(true);
    // L’opacità non è una correzione colore: viene applicata in fusione, non nel filtro.
    expect(videoEditorAdjustmentsAreNeutral({ ...neutralAdjustments, opacity: .3 })).toBe(true);
    expect(videoEditorAdjustmentsAreNeutral({ ...neutralAdjustments, contrast: 1 })).toBe(false);
    expect(videoEditorAdjustmentsAreNeutral({ ...neutralAdjustments, temperature: -4 })).toBe(false);
  });

  it("traduce esposizione, contrasto e saturazione in un filtro identità quando tutto è a zero", () => {
    expect(videoEditorFilter(neutralAdjustments)).toBe("brightness(1.0000) contrast(1.0000) saturate(1.0000) blur(0.000px)");
  });

  it("raddoppia la luminanza a +1 stop di esposizione", () => {
    expect(videoEditorFilter({ ...neutralAdjustments, exposure: 1 })).toContain("brightness(2.0000)");
    expect(videoEditorFilter({ ...neutralAdjustments, exposure: -1 })).toContain("brightness(0.5000)");
  });

  it("porta contrasto e saturazione ai valori attesi e limita la sfocatura del denoise", () => {
    expect(videoEditorFilter({ ...neutralAdjustments, contrast: 50 })).toContain("contrast(1.5000)");
    expect(videoEditorFilter({ ...neutralAdjustments, saturation: -100 })).toContain("saturate(0.0000)");
    expect(videoEditorFilter({ ...neutralAdjustments, vibrance: 100 })).toContain("saturate(1.6500)");
    expect(videoEditorFilter({ ...neutralAdjustments, denoise: 100 })).toContain("blur(1.111px)");
  });

  it("aggiunge la rotazione di tonalità soltanto quando serve", () => {
    expect(videoEditorFilter(neutralAdjustments)).not.toContain("hue-rotate");
    expect(videoEditorFilter({ ...neutralAdjustments, hue: -35 })).toContain("hue-rotate(-35deg)");
  });

  it("non produce mai valori negativi o nulli che annullerebbero l’immagine", () => {
    // Ai fondo scala di ogni cursore il filtro resta stampabile e nulla scende sotto il pavimento.
    const extreme = videoEditorFilter({ ...neutralAdjustments, exposure: -2, contrast: -100, highlights: -100, shadows: -100, whites: -100, blacks: -100, saturation: -100, vibrance: -100 });
    expect(extreme).toBe("brightness(0.1700) contrast(0.0500) saturate(0.0000) blur(0.000px)");
    const floored = videoEditorFilter({ ...neutralAdjustments, exposure: -2, whites: -100, blacks: 100 });
    const [, brightness] = /brightness\(([\d.]+)\)/.exec(floored) ?? [];
    expect(Number(brightness)).toBeGreaterThanOrEqual(.05);
  });
});

describe("Video Editor · compositor multitraccia", () => {
  it("riempie il fondo col colore della composizione prima di ogni livello", () => {
    const { canvas, context } = fakeCanvas(1920, 1080);
    const render = createVideoEditorFrameRenderer();
    render(canvas, settings([], { backgroundColor: "#101820" }), 0, () => null);
    expect(context.fills[0]).toEqual({ color: "#101820", width: 1920, height: 1080, mode: "source-over", alpha: 1 });
    expect(context.draws).toEqual([]);
  });

  it("disegna la sorgente in `cover` centrata e senza filtro quando le regolazioni sono neutre", () => {
    const { canvas, context } = fakeCanvas(1000, 1000);
    const render = createVideoEditorFrameRenderer();
    render(canvas, settings([clip({ id: "c" })]), 1, () => frameSource(2000, 1000, "media"));
    expect(context.draws).toHaveLength(1);
    // Copertura di un 2:1 su una tela quadrata: si scala sull’altezza e si eccede in larghezza.
    expect(context.draws[0]).toEqual({ source: "media", x: -500, y: 0, width: 2000, height: 1000, alpha: 1, mode: "source-over", filter: "none" });
  });

  it("rispetta la dissolvenza come opacità di composizione", () => {
    const { canvas, context } = fakeCanvas(100, 100);
    const render = createVideoEditorFrameRenderer();
    const state = settings([clip({ id: "c", fadeInSeconds: 2 })]);
    render(canvas, state, 1, () => frameSource(100, 100, "media"));
    // Metà dissolvenza smoothstep: 0.5 esatto.
    expect(context.draws[0]?.alpha).toBeCloseTo(.5, 10);
  });

  it("compone dal fondo verso l’alto seguendo l’ordine delle tracce", () => {
    const { canvas, context } = fakeCanvas(100, 100);
    const render = createVideoEditorFrameRenderer();
    const state = settings([
      clip({ id: "sopra", assetId: "sopra", trackId: "video-editor-track-overlay" }),
      clip({ id: "sotto", assetId: "sotto", trackId: "video-editor-track-main" })
    ]);
    render(canvas, state, 1, (item) => frameSource(100, 100, item.id));
    expect(context.draws.map((draw) => draw.source)).toEqual(["sotto", "sopra"]);
  });

  it("miscela la modalità di fusione con la passata normale secondo l’intensità", () => {
    const { canvas, context } = fakeCanvas(100, 100);
    const render = createVideoEditorFrameRenderer();
    render(canvas, settings([clip({ id: "c", blendMode: "screen", blendIntensity: .25 })]), 1, () => frameSource(100, 100, "media"));
    expect(context.draws).toHaveLength(2);
    expect(context.draws[0]).toMatchObject({ mode: "source-over", alpha: .75 });
    expect(context.draws[1]).toMatchObject({ mode: "screen", alpha: .25 });
  });

  it("al 100% di intensità usa solo la modalità scelta e al 0% solo la normale", () => {
    const full = fakeCanvas(100, 100);
    createVideoEditorFrameRenderer()(full.canvas, settings([clip({ id: "c", blendMode: "multiply", blendIntensity: 1 })]), 1, () => frameSource(100, 100, "media"));
    expect(full.context.draws).toHaveLength(1);
    expect(full.context.draws[0]).toMatchObject({ mode: "multiply", alpha: 1 });

    const none = fakeCanvas(100, 100);
    createVideoEditorFrameRenderer()(none.canvas, settings([clip({ id: "c", blendMode: "multiply", blendIntensity: 0 })]), 1, () => frameSource(100, 100, "media"));
    expect(none.context.draws).toHaveLength(1);
    expect(none.context.draws[0]).toMatchObject({ mode: "source-over", alpha: 1 });
  });

  it("isola la correzione colore su una tela di servizio senza contaminare i livelli sotto", () => {
    const { canvas, context } = fakeCanvas(100, 100);
    const render = createVideoEditorFrameRenderer();
    render(canvas, settings([clip({ id: "c", adjustments: { ...neutralAdjustments, contrast: 40, temperature: 60 } })]), 1, () => frameSource(100, 100, "media"));
    // Nella scena entra la tela di servizio già corretta, non la sorgente grezza.
    expect(context.draws).toHaveLength(1);
    expect(context.draws[0]?.source).toBe("layer-canvas");
    expect(context.draws[0]?.mode).toBe("source-over");
    // Il filtro resta confinato alla tela di servizio: la scena torna a "none".
    expect(context.filter).toBe("none");
    expect(context.globalCompositeOperation).toBe("source-over");
    expect(context.globalAlpha).toBe(1);

    const surface = layerSurfaces[0];
    expect(surface?.draws[0]?.source).toBe("media");
    expect(surface?.draws[0]?.filter).toContain(videoEditorFilter({ ...neutralAdjustments, contrast: 40, temperature: 60 }));
    // La temperatura non esiste come filtro CSS: arriva come passata di fusione soft-light.
    expect(surface?.fills.some((fill) => fill.mode === "soft-light")).toBe(true);
  });

  it("compone nitidezza e temperatura come passate separate sul livello isolato", () => {
    const { canvas } = fakeCanvas(100, 100);
    createVideoEditorFrameRenderer()(canvas, settings([clip({ id: "c", adjustments: { ...neutralAdjustments, sharpness: 80 } })]), 1, () => frameSource(100, 100, "media"));
    const surface = layerSurfaces[0];
    // La nitidezza rilegge il livello su se stesso in `overlay` con contrasto locale,
    // con un tetto che evita l’aureola tipica dello sharpening spinto.
    const sharpen = surface?.draws.find((draw) => draw.mode === "overlay");
    expect(sharpen).toBeDefined();
    expect(sharpen?.alpha).toBeCloseTo(.18, 10);
    expect(sharpen?.filter).toBe("contrast(1.4444)");
  });

  it("salta i livelli senza fotogramma disponibile e quelli di dimensione nulla", () => {
    const { canvas, context } = fakeCanvas(100, 100);
    const render = createVideoEditorFrameRenderer();
    const state = settings([
      clip({ id: "assente", assetId: "assente", trackId: "video-editor-track-overlay" }),
      clip({ id: "vuoto", assetId: "vuoto", trackId: "video-editor-track-main" })
    ]);
    render(canvas, state, 1, (item) => item.id === "vuoto" ? frameSource(0, 0, "vuoto") : null);
    expect(context.draws).toEqual([]);
    expect(context.fills).toHaveLength(1);
  });

  it("non disegna nulla fuori dall’intervallo delle clip", () => {
    const { canvas, context } = fakeCanvas(100, 100);
    const render = createVideoEditorFrameRenderer();
    render(canvas, settings([clip({ id: "c", startSeconds: 2, durationSeconds: 1 })]), 5, () => frameSource(100, 100, "media"));
    expect(context.draws).toEqual([]);
  });

  it("adotta `contain` e `fill` come richiesto dalla clip", () => {
    const contained = fakeCanvas(1000, 1000);
    createVideoEditorFrameRenderer()(contained.canvas, settings([clip({ id: "c", fit: "contain" })]), 1, () => frameSource(2000, 1000, "media"));
    expect(contained.context.draws[0]).toMatchObject({ x: 0, y: 250, width: 1000, height: 500 });

    const filled = fakeCanvas(1000, 1000);
    createVideoEditorFrameRenderer()(filled.canvas, settings([clip({ id: "c", fit: "fill" })]), 1, () => frameSource(2000, 1000, "media"));
    expect(filled.context.draws[0]).toMatchObject({ x: 0, y: 0, width: 1000, height: 1000 });
  });

  it("applica i look temporizzati al livello reale usato anche dall’export", () => {
    const { canvas, context } = fakeCanvas(1000, 600);
    const state = settings([clip({ id: "c" })], {
      effectClips: [effectClip("noir", "c", { parameters: { amount: .9 } })]
    });
    createVideoEditorFrameRenderer()(canvas, state, 1, () => frameSource(1000, 600, "media"));
    expect(context.draws[0]?.source).toBe("layer-canvas");
    expect(layerSurfaces[0]?.draws[0]?.filter).toContain("grayscale(0.9000)");
    expect(layerSurfaces[0]?.draws[0]?.filter).toContain("contrast(1.2340)");
  });

  it("compone RGB Split con due passate cromatiche e Light Leak in screen", () => {
    const rgb = fakeCanvas(1000, 600);
    createVideoEditorFrameRenderer()(rgb.canvas, settings([clip({ id: "c" })], {
      effectClips: [effectClip("rgb-split", "c", { parameters: { amount: .02, frequency: 6 } })]
    }), 1, () => frameSource(1000, 600, "media"));
    expect(rgb.context.draws).toHaveLength(3);
    expect(rgb.context.draws.slice(1).every((draw) => draw.mode === "screen")).toBe(true);
    expect(rgb.context.draws.slice(1).map((draw) => draw.filter)).toEqual([
      "hue-rotate(92deg) saturate(1.8)", "hue-rotate(-92deg) saturate(1.8)"
    ]);

    const leak = fakeCanvas(1000, 600);
    createVideoEditorFrameRenderer()(leak.canvas, settings([clip({ id: "c" })], {
      effectClips: [effectClip("light-leak", "c", { parameters: { amount: .7 } })]
    }), 1, () => frameSource(1000, 600, "media"));
    expect(layerSurfaces.at(-1)?.fills.some((fill) => fill.mode === "screen" && fill.alpha > 0)).toBe(true);
  });
});
