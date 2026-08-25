import type { RhythmBallProject } from "@rbs/project-schema";
import { generateAiUpscalerPreview, type ModelLoadProgress } from "./upscaler-ai";
import { createUpscalerFrameRenderer } from "./upscaler-renderer";
import { shouldGenerateUpscalerAi } from "./remote-upscaler-client";

export type UpscalerImageSettings = RhythmBallProject["animation"]["upscaler"];

export interface UpscalerImageExportOptions {
  source: CanvasImageSource;
  settings: UpscalerImageSettings;
  /** A previously inferred AI image. Supplying it prevents a second inference. */
  aiEnhancedSource?: CanvasImageSource | null;
  signal?: AbortSignal;
  onModelProgress?: (status: ModelLoadProgress) => void;
  /** Overrides the name derived from settings.sourceName. */
  sourceName?: string;
}

export interface UpscalerImageExportResult {
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  aiEnhancedSource: CanvasImageSource | null;
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/").split("/").pop() ?? "image";
  return normalized.replace(/\.[^.]+$/, "") || "image";
}

export function upscalerImageFileName(sourceName: string, width: number, height: number): string {
  return `${basename(sourceName)}-upscaled-${width}x${height}.png`;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
}

/**
 * Canonical image export pipeline shared by the single-image preview and the
 * batch runner. AI inference is intentionally performed only when an enhanced
 * source was not supplied by the caller.
 */
export async function exportUpscalerImage(options: UpscalerImageExportOptions): Promise<UpscalerImageExportResult> {
  const { source, settings, signal, onModelProgress } = options;
  assertNotAborted(signal);
  let aiEnhancedSource = options.aiEnhancedSource ?? null;
  const needsAi = shouldGenerateUpscalerAi(settings);
  if (needsAi && !aiEnhancedSource) {
    aiEnhancedSource = await generateAiUpscalerPreview(source, settings, onModelProgress ?? (() => undefined), signal);
  }
  assertNotAborted(signal);
  const width = Math.max(1, Math.round(settings.finalWidth));
  const height = Math.max(1, Math.round(settings.finalHeight));
  const output = document.createElement("canvas"); output.width = width; output.height = height;
  const context = output.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas di esportazione non disponibile.");
  createUpscalerFrameRenderer(width, height)(context, source, settings, false, needsAi ? aiEnhancedSource : null);
  assertNotAborted(signal);
  const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error("Impossibile codificare l’immagine finale.")), "image/png"));
  assertNotAborted(signal);
  return {
    blob,
    fileName: upscalerImageFileName(options.sourceName ?? settings.sourceName, width, height),
    width,
    height,
    aiEnhancedSource
  };
}

/** Alias kept explicit for callers that prefer a verb describing the operation. */
export const renderUpscalerImageExport = exportUpscalerImage;
