import { mediaDrawRect, type ExportMediaFit } from "./offline-video-exporter";
import { videoEditorVisibleLayers, type VideoEditorAdjustments, type VideoEditorClip, type VideoEditorSettings } from "./video-editor";
import {
  videoEditorEffectCssFilter,
  videoEditorEffectFrameState,
  type VideoEditorEffectFrameState
} from "./video-editor-effects";

export interface VideoEditorFrameSource { width: number; height: number; source: CanvasImageSource }
/** La preview e l’export offline condividono questa funzione: ogni clip risolve il proprio fotogramma. */
export type VideoEditorSourceResolver = (clip: VideoEditorClip, sourceTimeSeconds: number) => VideoEditorFrameSource | null;

/**
 * Catena colore professionale espressa come filtro CSS: gli stessi coefficienti
 * dell’Upscaler, estesi con la rotazione di tonalità richiesta dal montaggio.
 */
export function videoEditorFilter(item: VideoEditorAdjustments): string {
  const brightness = Math.pow(2, item.exposure) * (1 + (item.whites + item.highlights * .35 + item.shadows * .15 + item.blacks * .1) / 500);
  const contrast = 1 + item.contrast / 100 + (item.whites - item.blacks) / 600;
  const saturation = 1 + (item.saturation + item.vibrance * .65) / 100;
  const blur = item.denoise > 0 ? Math.min(1.2, item.denoise / 90) : 0;
  const hue = item.hue !== 0 ? ` hue-rotate(${item.hue}deg)` : "";
  return `brightness(${Math.max(.05, brightness).toFixed(4)}) contrast(${Math.max(.05, contrast).toFixed(4)}) saturate(${Math.max(0, saturation).toFixed(4)}) blur(${blur.toFixed(3)}px)${hue}`;
}

export function videoEditorAdjustmentsAreNeutral(item: VideoEditorAdjustments): boolean {
  return item.exposure === 0 && item.contrast === 0 && item.highlights === 0 && item.shadows === 0
    && item.whites === 0 && item.blacks === 0 && item.saturation === 0 && item.vibrance === 0
    && item.temperature === 0 && item.tint === 0 && item.hue === 0 && item.sharpness === 0 && item.denoise === 0;
}

/**
 * Temperatura, tinta e nitidezza non esistono come filtri CSS: vengono composte
 * come passate di fusione sul livello isolato, prima che entri nella scena.
 */
function correctionOverlay(context: CanvasRenderingContext2D, width: number, height: number, item: VideoEditorAdjustments): void {
  if (item.temperature !== 0 || item.tint !== 0) {
    context.save();
    context.globalCompositeOperation = "soft-light";
    context.globalAlpha = Math.min(.28, (Math.abs(item.temperature) + Math.abs(item.tint)) / 500);
    const red = item.temperature > 0 ? 255 : 35;
    const blue = item.temperature < 0 ? 255 : 35;
    const green = item.tint > 0 ? 55 : item.tint < 0 ? 230 : 128;
    context.fillStyle = `rgb(${red} ${green} ${blue})`;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
  if (item.sharpness > 0) {
    context.save();
    context.globalCompositeOperation = "overlay";
    context.globalAlpha = Math.min(.18, item.sharpness / 420);
    context.filter = `contrast(${(1 + item.sharpness / 180).toFixed(4)})`;
    context.drawImage(context.canvas, 0, 0);
    context.restore();
  }
}

function effectNeedsIsolation(state: VideoEditorEffectFrameState): boolean {
  return state.brightness !== 1 || state.contrast !== 1 || state.saturation !== 1 || state.grayscale !== 0
    || state.sepia !== 0 || state.hueRotateDegrees !== 0 || state.blurPixels !== 0
    || state.chromaticOffsetPixels !== 0 || state.vignette !== 0 || state.lightLeak !== 0 || state.scanlines !== 0;
}

/** Passate ottiche confinate all’alpha del livello, mai all’intera composizione. */
function effectOverlay(context: CanvasRenderingContext2D, width: number, height: number, state: VideoEditorEffectFrameState): void {
  if (state.lightLeak > 0) {
    context.save();
    context.globalCompositeOperation = "screen";
    context.globalAlpha = Math.min(.72, state.lightLeak * .68);
    const leak = context.createRadialGradient(width * .12, height * .18, 0, width * .12, height * .18, Math.max(width, height) * .82);
    leak.addColorStop(0, "#fff7dc");
    leak.addColorStop(.24, "#ff8f5c");
    leak.addColorStop(.58, "#d839a8aa");
    leak.addColorStop(1, "#00000000");
    context.fillStyle = leak;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
  if (state.vignette > 0) {
    context.save();
    context.globalCompositeOperation = "source-atop";
    context.globalAlpha = Math.min(.88, state.vignette * .82);
    const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .18, width / 2, height / 2, Math.max(width, height) * .68);
    vignette.addColorStop(0, "#00000000");
    vignette.addColorStop(.58, "#00000010");
    vignette.addColorStop(1, "#000000");
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
  if (state.scanlines > 0) {
    context.save();
    context.globalCompositeOperation = "source-atop";
    context.globalAlpha = Math.min(.36, state.scanlines * .08);
    context.fillStyle = "#050208";
    const gap = Math.max(4, Math.round(height / 120));
    for (let y = 0; y < height; y += gap) context.fillRect(0, y, width, Math.max(1, Math.round(gap * .24)));
    context.restore();
  }
}

export interface VideoEditorFrameRenderer {
  (target: HTMLCanvasElement | OffscreenCanvas, settings: VideoEditorSettings, timeSeconds: number, resolve: VideoEditorSourceResolver): void;
}

/**
 * Compositor multitraccia. Ogni clip viene disegnata su una tela di servizio così che
 * correzione colore e opacità restino confinate al livello, e solo il risultato finito
 * entra nella scena con la modalità di fusione scelta: è la stessa disciplina di un
 * compositing professionale, dove un livello non contamina quelli sotto di sé.
 */
export function createVideoEditorFrameRenderer(): VideoEditorFrameRenderer {
  let layerCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  let layerContext: CanvasRenderingContext2D | null = null;

  const layerSurface = (width: number, height: number): CanvasRenderingContext2D | null => {
    if (!layerCanvas || layerCanvas.width !== width || layerCanvas.height !== height) {
      layerCanvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : document.createElement("canvas");
      layerCanvas.width = width;
      layerCanvas.height = height;
      layerContext = layerCanvas.getContext("2d", { alpha: true }) as CanvasRenderingContext2D | null;
      if (layerContext) { layerContext.imageSmoothingEnabled = true; layerContext.imageSmoothingQuality = "high"; }
    }
    if (layerContext) layerContext.clearRect(0, 0, width, height);
    return layerContext;
  };

  return (target, settings, timeSeconds, resolve) => {
    const context = target.getContext("2d", { alpha: false }) as CanvasRenderingContext2D | null;
    if (!context) return;
    const width = target.width;
    const height = target.height;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.filter = "none";
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = settings.backgroundColor;
    context.fillRect(0, 0, width, height);

    for (const layer of videoEditorVisibleLayers(settings, timeSeconds)) {
      const frame = resolve(layer.clip, layer.sourceTimeSeconds);
      if (!frame || frame.width <= 0 || frame.height <= 0) continue;
      const rect = mediaDrawRect(frame.width, frame.height, width, height, layer.clip.fit as ExportMediaFit);
      const effectState = videoEditorEffectFrameState(settings.effectClips, layer.clip.id, timeSeconds, width, height);
      const drawTransformed = (destination: CanvasRenderingContext2D, source: CanvasImageSource) => {
        const transform = layer.clip.transform ?? { x: 0, y: 0, scale: 1, rotation: 0 };
        if (transform.x === 0 && transform.y === 0 && transform.scale === 1 && transform.rotation === 0
          && effectState.translateX === 0 && effectState.translateY === 0 && effectState.scale === 1 && effectState.rotationDegrees === 0) {
          destination.drawImage(source, rect.x, rect.y, rect.width, rect.height);
          return;
        }
        destination.save();
        destination.translate(
          width / 2 + transform.x * width / 2 + effectState.translateX,
          height / 2 + transform.y * height / 2 + effectState.translateY
        );
        destination.rotate((transform.rotation + effectState.rotationDegrees) * Math.PI / 180);
        destination.scale(transform.scale * effectState.scale, transform.scale * effectState.scale);
        destination.drawImage(source, rect.x - width / 2, rect.y - height / 2, rect.width, rect.height);
        destination.restore();
      };
      const neutral = videoEditorAdjustmentsAreNeutral(layer.clip.adjustments);
      const surface = neutral && !effectNeedsIsolation(effectState) ? null : layerSurface(width, height);
      if (surface && layerCanvas) {
        surface.save();
        surface.filter = `${videoEditorFilter(layer.clip.adjustments)} ${videoEditorEffectCssFilter(effectState)}`;
        drawTransformed(surface, frame.source);
        surface.restore();
        correctionOverlay(surface, width, height, layer.clip.adjustments);
        effectOverlay(surface, width, height, effectState);
      }

      // L’intensità di fusione miscela il livello fuso con la stessa immagine in
      // modalità normale: al 100% vale la modalità scelta, sotto sfuma verso di essa.
      const draw = (mode: GlobalCompositeOperation, alpha: number) => {
        if (alpha <= 0) return;
        context.save();
        context.globalCompositeOperation = mode;
        context.globalAlpha = alpha;
        if (surface && layerCanvas) context.drawImage(layerCanvas, 0, 0);
        else drawTransformed(context, frame.source);
        context.restore();
      };

      const blendMode = layer.clip.blendMode as GlobalCompositeOperation;
      if (layer.clip.blendMode === "normal") draw("source-over", layer.opacity);
      else {
        draw("source-over", layer.opacity * (1 - layer.clip.blendIntensity));
        draw(blendMode, layer.opacity * layer.clip.blendIntensity);
      }
      if (surface && layerCanvas && effectState.chromaticOffsetPixels > 0) {
        const offset = Math.max(.5, effectState.chromaticOffsetPixels);
        context.save();
        context.globalCompositeOperation = "screen";
        context.globalAlpha = Math.min(.3, layer.opacity * .2);
        context.filter = "hue-rotate(92deg) saturate(1.8)";
        context.drawImage(layerCanvas, -offset, 0, width, height);
        context.filter = "hue-rotate(-92deg) saturate(1.8)";
        context.drawImage(layerCanvas, offset, 0, width, height);
        context.restore();
      }
    }
    context.restore();
  };
}
