import type { RhythmBallProject } from "@rbs/project-schema";

export type UpscalerSettings = RhythmBallProject["animation"]["upscaler"];

export function formatUpscalerViewportFooter(settings: Pick<UpscalerSettings, "sourceWidth" | "sourceHeight" | "finalWidth" | "finalHeight">): string {
  return `● Upscaler · Originale ${settings.sourceWidth || "—"} × ${settings.sourceHeight || "—"} · Output ${settings.finalWidth} × ${settings.finalHeight}`;
}

export function resolveUpscalerPreviewSize(width: number, height: number, maxDimension = 1400): { width: number; height: number } {
  const ratio = safePositive(width, 1) / safePositive(height, 1);
  const edge = Math.max(2, Math.round(safePositive(maxDimension, 1400)));
  return ratio >= 1
    ? { width: edge, height: Math.max(2, Math.round(edge / ratio)) }
    : { width: Math.max(2, Math.round(edge * ratio)), height: edge };
}

/** Fits the preview inside its real viewport while preserving its aspect ratio. */
export function fitUpscalerPreviewToViewport(
  previewWidth: number, previewHeight: number, viewportWidth: number, viewportHeight: number,
): { width: number; height: number } {
  const width = safePositive(previewWidth, 1); const height = safePositive(previewHeight, 1);
  const availableWidth = safePositive(viewportWidth, width); const availableHeight = safePositive(viewportHeight, height);
  const scale = Math.min(1, availableWidth / width, availableHeight / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/** Resolves the outer preview frame against both available stage axes. */
export function fitUpscalerFrameToStage(
  stageWidth: number, stageHeight: number, outputWidth: number, outputHeight: number,
): { width: number; height: number } {
  const availableWidth = Math.max(1, safePositive(stageWidth, 1));
  const availableHeight = Math.max(1, safePositive(stageHeight, 1));
  const aspect = safePositive(outputWidth, 1) / safePositive(outputHeight, 1);
  if (availableWidth / availableHeight > aspect) {
    return { width: Math.max(1, Math.floor(availableHeight * aspect)), height: Math.floor(availableHeight) };
  }
  return { width: Math.floor(availableWidth), height: Math.max(1, Math.floor(availableWidth / aspect)) };
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }

export const UPSCALER_MIN_DIMENSION = 64;
export const UPSCALER_MAX_DIMENSION = 16384;

function safePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function encoderDimension(value: number): number {
  const safe = safePositive(value, UPSCALER_MIN_DIMENSION);
  return clamp(Math.round(safe / 2) * 2, UPSCALER_MIN_DIMENSION, UPSCALER_MAX_DIMENSION);
}

/**
 * Resolves a source size and requested scale to an encoder-safe target.
 * Both limits are applied to the same scale factor so the source ratio is
 * never changed while fitting the output in the supported range.
 */
export function resolveUpscalerTarget(sourceWidth: number, sourceHeight: number, scale: number): { width: number; height: number } {
  const width = safePositive(sourceWidth, 0); const height = safePositive(sourceHeight, 0);
  if (!width || !height) return { width: UPSCALER_MIN_DIMENSION, height: UPSCALER_MIN_DIMENSION };
  const requestedScale = safePositive(scale, 1);
  const maximumScale = Math.min(UPSCALER_MAX_DIMENSION / width, UPSCALER_MAX_DIMENSION / height);
  const minimumScale = Math.max(UPSCALER_MIN_DIMENSION / width, UPSCALER_MIN_DIMENSION / height);
  // Extremely wide/tall sources can make the lower and upper bounds overlap
  // impossibly. In that case the maximum bound wins and preserves the ratio.
  const resolvedScale = maximumScale < minimumScale ? maximumScale : clamp(requestedScale, minimumScale, maximumScale);
  return { width: encoderDimension(width * resolvedScale), height: encoderDimension(height * resolvedScale) };
}

/**
 * Keeps MLX-DLSS output geometry coherent when a source is imported or the
 * provider changes. Enhance is always 1x, native SR is 2x and custom is
 * constrained to the range the native image pipeline can actually produce.
 */
export function resolveMlxDlssTarget(
  sourceWidth: number, sourceHeight: number, mode: UpscalerSettings["mlxDlss"]["mode"], requestedScale = 1,
): { width: number; height: number; scale: number } {
  const scale = mode === "enhance" ? 1 : mode === "native-2x" ? 2 : clamp(safePositive(requestedScale, 1), 1, 2);
  const target = resolveUpscalerTarget(sourceWidth, sourceHeight, scale);
  return { ...target, scale: sourceWidth > 0 ? target.width / sourceWidth : scale };
}

export function resolvedUpscalerDimensions(settings: Pick<UpscalerSettings, "sourceWidth" | "sourceHeight" | "finalWidth" | "finalHeight" | "lockAspectRatio"> & Partial<Pick<UpscalerSettings, "scale">>, changed: "width" | "height" = "width"): { width: number; height: number } {
  const width = encoderDimension(settings.finalWidth); const height = encoderDimension(settings.finalHeight);
  if (!settings.lockAspectRatio || !(settings.sourceWidth > 0 && settings.sourceHeight > 0)) return { width, height };
  const preferred = changed === "width" ? settings.finalWidth : settings.finalHeight;
  const requestedScale = Number.isFinite(preferred) && preferred > 0 ? (changed === "width" ? width / settings.sourceWidth : height / settings.sourceHeight) : safePositive(settings.scale ?? 1, 1);
  return resolveUpscalerTarget(settings.sourceWidth, settings.sourceHeight, requestedScale);
}

export function fitUpscalerPreset(sourceWidth: number, sourceHeight: number, landscapeWidth: number, landscapeHeight: number): { width: number; height: number } {
  const safeSourceWidth = Math.max(1, sourceWidth); const safeSourceHeight = Math.max(1, sourceHeight);
  const portrait = safeSourceHeight > safeSourceWidth;
  const boundWidth = portrait ? landscapeHeight : landscapeWidth; const boundHeight = portrait ? landscapeWidth : landscapeHeight;
  const factor = Math.min(boundWidth / safeSourceWidth, boundHeight / safeSourceHeight);
  const even = (value: number) => encoderDimension(value);
  return { width: even(safeSourceWidth * factor), height: even(safeSourceHeight * factor) };
}

export function upscalerFilter(settings: Pick<UpscalerSettings, "adjustments">): string {
  const item = settings.adjustments;
  const brightness = Math.pow(2, item.exposure) * (1 + (item.whites + item.highlights * .35 + item.shadows * .15 + item.blacks * .1) / 500);
  const contrast = 1 + item.contrast / 100 + (item.whites - item.blacks) / 600;
  const saturation = 1 + (item.saturation + item.vibrance * .65) / 100;
  const blur = item.denoise > 0 ? Math.min(1.2, item.denoise / 90) : 0;
  return `brightness(${Math.max(.05, brightness)}) contrast(${Math.max(.05, contrast)}) saturate(${Math.max(0, saturation)}) blur(${blur}px)`;
}

function correctionOverlay(context: CanvasRenderingContext2D, width: number, height: number, settings: UpscalerSettings): void {
  const { temperature, tint, sharpness } = settings.adjustments;
  if (temperature !== 0 || tint !== 0) {
    context.save(); context.globalCompositeOperation = "soft-light"; context.globalAlpha = Math.min(.28, (Math.abs(temperature) + Math.abs(tint)) / 500);
    const red = temperature > 0 ? 255 : 35; const blue = temperature < 0 ? 255 : 35; const green = tint > 0 ? 55 : tint < 0 ? 230 : 128;
    context.fillStyle = `rgb(${red} ${green} ${blue})`; context.fillRect(0, 0, width, height); context.restore();
  }
  if (sharpness > 0) {
    context.save(); context.globalCompositeOperation = "overlay"; context.globalAlpha = Math.min(.18, sharpness / 420); context.filter = `contrast(${1 + sharpness / 180})`;
    context.drawImage(context.canvas, 0, 0); context.restore();
  }
}

function drawEnhanced(context: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number, settings: UpscalerSettings): void {
  context.save(); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; context.filter = upscalerFilter(settings); context.drawImage(source, 0, 0, width, height); context.restore();
  correctionOverlay(context, width, height, settings);
}

/**
 * Draws a lightweight batch-card preview. This deliberately uses the same
 * correction pipeline as the live preview, but never invokes an AI model (or
 * comparison/blend compositing): cards should remain cheap and deterministic.
 */
export function renderUpscalerThumbnail(target: CanvasRenderingContext2D | HTMLCanvasElement, source: CanvasImageSource, settings: UpscalerSettings): void {
  const context = typeof HTMLCanvasElement !== "undefined" && target instanceof HTMLCanvasElement ? target.getContext("2d", { alpha: false }) : target as CanvasRenderingContext2D;
  if (!context) return;
  const width = Math.max(1, context.canvas.width || settings.finalWidth || settings.sourceWidth || 1);
  const height = Math.max(1, context.canvas.height || settings.finalHeight || settings.sourceHeight || 1);
  context.clearRect(0, 0, width, height);
  drawEnhanced(context, source, width, height, settings);
}

export function createUpscalerFrameRenderer(width: number, height: number) {
  const original = document.createElement("canvas"); original.width = width; original.height = height;
  const enhanced = document.createElement("canvas"); enhanced.width = width; enhanced.height = height;
  const originalContext = original.getContext("2d", { alpha: false }); const enhancedContext = enhanced.getContext("2d", { alpha: false });
  return (target: CanvasRenderingContext2D, source: CanvasImageSource, settings: UpscalerSettings, comparison = true, aiEnhancedSource?: CanvasImageSource | null) => {
    if (!originalContext || !enhancedContext) return;
    originalContext.clearRect(0, 0, width, height); originalContext.imageSmoothingEnabled = true; originalContext.imageSmoothingQuality = "high"; originalContext.drawImage(source, 0, 0, width, height);
    enhancedContext.clearRect(0, 0, width, height); drawEnhanced(enhancedContext, aiEnhancedSource ?? source, width, height, settings);
    target.clearRect(0, 0, width, height);
    const mode = comparison ? settings.comparisonMode : "enhanced";
    if (mode === "original") target.drawImage(original, 0, 0);
    else if (mode === "split") {
      const split = Math.round(width * settings.comparisonPosition); target.drawImage(original, 0, 0);
      target.save(); target.beginPath(); target.rect(split, 0, width - split, height); target.clip(); target.drawImage(enhanced, 0, 0); target.restore();
      target.fillStyle = "#ffffff"; target.fillRect(Math.max(0, split - 1), 0, 2, height);
    } else {
      target.drawImage(enhanced, 0, 0);
      const blend = mode === "blend" ? Math.max(settings.originalBlend, .01) : settings.originalBlend;
      if (blend > 0) { target.save(); target.globalAlpha = blend; target.drawImage(original, 0, 0); target.restore(); }
    }
  };
}
