import type { RhythmBallProject } from "@rbs/project-schema";

export type StaticWatermarkSettings = RhythmBallProject["animation"]["staticWatermark"];
export interface PixelRect { x: number; y: number; width: number; height: number }

function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }

function sourceDimensions(source: CanvasImageSource): { width: number; height: number } {
  const item = source as CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  return { width: Math.max(1, item.naturalWidth ?? item.videoWidth ?? item.width ?? 1), height: Math.max(1, item.naturalHeight ?? item.videoHeight ?? item.height ?? 1) };
}

export function normalizedWatermarkRegion(settings: Pick<StaticWatermarkSettings, "region">): StaticWatermarkSettings["region"] {
  const width = clamp(settings.region.width, .005, 1);
  const height = clamp(settings.region.height, .005, 1);
  return { x: clamp(settings.region.x, 0, 1 - width), y: clamp(settings.region.y, 0, 1 - height), width, height };
}

export function watermarkPixelRect(width: number, height: number, settings: Pick<StaticWatermarkSettings, "region">): PixelRect {
  const region = normalizedWatermarkRegion(settings);
  const x = Math.round(region.x * width); const y = Math.round(region.y * height);
  return { x, y, width: Math.max(1, Math.round(region.width * width)), height: Math.max(1, Math.round(region.height * height)) };
}

export function expandedWatermarkPixelRect(width: number, height: number, region: PixelRect, featherPixels: number): PixelRect {
  const radius = clamp(Math.round(featherPixels), 0, 24);
  const x = Math.max(0, region.x - radius); const y = Math.max(0, region.y - radius);
  const right = Math.min(width, region.x + region.width + radius); const bottom = Math.min(height, region.y + region.height + radius);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function watermarkContextPixelRect(width: number, height: number, region: PixelRect): PixelRect {
  const horizontalMargin = Math.max(48, Math.round(region.width * .85));
  const verticalMargin = Math.max(48, Math.round(region.height * .85));
  const x = Math.max(0, region.x - horizontalMargin); const y = Math.max(0, region.y - verticalMargin);
  const right = Math.min(width, region.x + region.width + horizontalMargin);
  const bottom = Math.min(height, region.y + region.height + verticalMargin);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function resolveReferencePlacement(referenceWidth: number, referenceHeight: number, frameWidth: number, frameHeight: number, settings: Pick<StaticWatermarkSettings, "referenceFit" | "referenceScale" | "referenceOffsetX" | "referenceOffsetY">): PixelRect {
  const fitScale = settings.referenceFit === "stretch" ? 1 : settings.referenceFit === "contain"
    ? Math.min(frameWidth / referenceWidth, frameHeight / referenceHeight)
    : Math.max(frameWidth / referenceWidth, frameHeight / referenceHeight);
  const width = settings.referenceFit === "stretch" ? frameWidth * settings.referenceScale : referenceWidth * fitScale * settings.referenceScale;
  const height = settings.referenceFit === "stretch" ? frameHeight * settings.referenceScale : referenceHeight * fitScale * settings.referenceScale;
  return {
    x: (frameWidth - width) / 2 + settings.referenceOffsetX * frameWidth,
    y: (frameHeight - height) / 2 + settings.referenceOffsetY * frameHeight,
    width,
    height
  };
}

function averageLuminance(sampleContext: CanvasRenderingContext2D, source: CanvasImageSource, sourceRect: PixelRect): number {
  sampleContext.clearRect(0, 0, 8, 8);
  sampleContext.drawImage(source, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height, 0, 0, 8, 8);
  const pixels = sampleContext.getImageData(0, 0, 8, 8).data;
  let total = 0; let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if ((pixels[index + 3] ?? 0) < 12) continue;
    total += (pixels[index] ?? 0) * .2126 + (pixels[index + 1] ?? 0) * .7152 + (pixels[index + 2] ?? 0) * .0722;
    count += 1;
  }
  return count ? total / count : 128;
}

export interface StaticWatermarkCompositor {
  applyPatch: (context: CanvasRenderingContext2D, reference: CanvasImageSource, settings: StaticWatermarkSettings) => void;
  render: (context: CanvasRenderingContext2D, sourceFrame: CanvasImageSource, reference: CanvasImageSource, settings: StaticWatermarkSettings) => void;
}

export function createStaticWatermarkCompositor(width: number, height: number): StaticWatermarkCompositor {
  const patch = document.createElement("canvas");
  const adjusted = document.createElement("canvas");
  const sourceSample = document.createElement("canvas"); sourceSample.width = 8; sourceSample.height = 8;
  const referenceSample = document.createElement("canvas"); referenceSample.width = 8; referenceSample.height = 8;
  const sourceSampleContext = sourceSample.getContext("2d", { willReadFrequently: true });
  const referenceSampleContext = referenceSample.getContext("2d", { willReadFrequently: true });
  const applyPatch = (context: CanvasRenderingContext2D, reference: CanvasImageSource, settings: StaticWatermarkSettings) => {
      const region = watermarkPixelRect(width, height, settings);
      const compositeRegion = expandedWatermarkPixelRect(width, height, region, settings.feather);
      const leftInset = region.x - compositeRegion.x; const topInset = region.y - compositeRegion.y;
      const rightInset = leftInset + region.width; const bottomInset = topInset + region.height;
      patch.width = compositeRegion.width; patch.height = compositeRegion.height;
      adjusted.width = compositeRegion.width; adjusted.height = compositeRegion.height;
      const patchContext = patch.getContext("2d", { alpha: true });
      const adjustedContext = adjusted.getContext("2d", { alpha: true });
      if (!patchContext || !adjustedContext) return;
      patchContext.imageSmoothingEnabled = true; patchContext.imageSmoothingQuality = "high";
      const dimensions = sourceDimensions(reference);
      const placement = resolveReferencePlacement(dimensions.width, dimensions.height, width, height, settings);
      patchContext.clearRect(0, 0, compositeRegion.width, compositeRegion.height);
      patchContext.drawImage(reference, placement.x - compositeRegion.x, placement.y - compositeRegion.y, placement.width, placement.height);

      let brightness = 1;
      if (settings.colorMatch && settings.colorMatchStrength > 0 && sourceSampleContext && referenceSampleContext) {
        const sourceLum = averageLuminance(sourceSampleContext, context.canvas, region);
        const referenceLum = averageLuminance(referenceSampleContext, patch, { x: leftInset, y: topInset, width: region.width, height: region.height });
        const ratio = clamp(sourceLum / Math.max(8, referenceLum), .68, 1.42);
        brightness = 1 + (ratio - 1) * settings.colorMatchStrength;
      }
      adjustedContext.clearRect(0, 0, compositeRegion.width, compositeRegion.height);
      adjustedContext.filter = `brightness(${brightness})`;
      adjustedContext.drawImage(patch, 0, 0);
      adjustedContext.filter = "none";

      if (settings.feather > 0 && (leftInset > 0 || topInset > 0 || rightInset < compositeRegion.width || bottomInset < compositeRegion.height)) {
        adjustedContext.globalCompositeOperation = "destination-in";
        const horizontal = adjustedContext.createLinearGradient(0, 0, compositeRegion.width, 0);
        horizontal.addColorStop(0, leftInset > 0 ? "transparent" : "#000"); horizontal.addColorStop(leftInset / compositeRegion.width, "#000"); horizontal.addColorStop(rightInset / compositeRegion.width, "#000"); horizontal.addColorStop(1, rightInset < compositeRegion.width ? "transparent" : "#000");
        adjustedContext.fillStyle = horizontal; adjustedContext.fillRect(0, 0, compositeRegion.width, compositeRegion.height);
        const vertical = adjustedContext.createLinearGradient(0, 0, 0, compositeRegion.height);
        vertical.addColorStop(0, topInset > 0 ? "transparent" : "#000"); vertical.addColorStop(topInset / compositeRegion.height, "#000"); vertical.addColorStop(bottomInset / compositeRegion.height, "#000"); vertical.addColorStop(1, bottomInset < compositeRegion.height ? "transparent" : "#000");
        adjustedContext.fillStyle = vertical; adjustedContext.fillRect(0, 0, compositeRegion.width, compositeRegion.height);
        adjustedContext.globalCompositeOperation = "source-over";
      }
      context.save(); context.globalAlpha = settings.patchOpacity; context.drawImage(adjusted, compositeRegion.x, compositeRegion.y); context.restore();
  };
  return {
    applyPatch,
    render(context, sourceFrame, reference, settings) {
      context.save(); context.globalAlpha = 1; context.filter = "none";
      context.drawImage(sourceFrame, 0, 0, width, height); context.restore();
      applyPatch(context, reference, settings);
    }
  };
}
