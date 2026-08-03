import type { RhythmBallProject } from "@rbs/project-schema";

export type UpscalerSettings = RhythmBallProject["animation"]["upscaler"];

function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }

export function resolvedUpscalerDimensions(settings: Pick<UpscalerSettings, "sourceWidth" | "sourceHeight" | "finalWidth" | "finalHeight" | "lockAspectRatio">, changed: "width" | "height" = "width"): { width: number; height: number } {
  let width = Math.round(clamp(settings.finalWidth, 64, 16384)); let height = Math.round(clamp(settings.finalHeight, 64, 16384));
  if (!settings.lockAspectRatio || !(settings.sourceWidth > 0 && settings.sourceHeight > 0)) return { width, height };
  const ratio = settings.sourceWidth / settings.sourceHeight;
  if (changed === "width") height = Math.round(clamp(width / ratio, 64, 16384)); else width = Math.round(clamp(height * ratio, 64, 16384));
  return { width, height };
}

export function fitUpscalerPreset(sourceWidth: number, sourceHeight: number, landscapeWidth: number, landscapeHeight: number): { width: number; height: number } {
  const safeSourceWidth = Math.max(1, sourceWidth); const safeSourceHeight = Math.max(1, sourceHeight);
  const portrait = safeSourceHeight > safeSourceWidth;
  const boundWidth = portrait ? landscapeHeight : landscapeWidth; const boundHeight = portrait ? landscapeWidth : landscapeHeight;
  const factor = Math.min(boundWidth / safeSourceWidth, boundHeight / safeSourceHeight);
  const even = (value: number) => Math.max(64, Math.min(16384, Math.round(value / 2) * 2));
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
