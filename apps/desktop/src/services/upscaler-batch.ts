import type { RhythmBallProject } from "@rbs/project-schema";
import { resolveUpscalerTarget } from "./upscaler-renderer";
import { exportUpscalerImage, upscalerImageFileName, type UpscalerImageExportResult } from "./upscaler-image-exporter";
import { classifyUpscalerMediaFile } from "./upscaler-media-file";
import { createUpscalerBatchThumbnail } from "./upscaler-batch-thumbnail";

export type UpscalerSettings = RhythmBallProject["animation"]["upscaler"];
export type UpscalerBatchItemStatus = "queued" | "processing" | "done" | "error" | "cancelled";

export interface UpscalerBatchTarget { width: number; height: number; }

export interface UpscalerBatchItem {
  id: string;
  file: File;
  url: string;
  /** Owned reduced preview URL. Absent only when thumbnail rendering is unavailable. */
  thumbnailUrl?: string | null;
  name: string;
  sourceWidth: number;
  sourceHeight: number;
  target: UpscalerBatchTarget;
  outputName: string;
  selected: boolean;
  status: UpscalerBatchItemStatus;
  progress: number;
  error: string | null;
}

export type UpscalerBatchSettingsSnapshot = UpscalerSettings;

export interface UpscalerBatchItemUpdate {
  itemId: string;
  status: UpscalerBatchItemStatus;
  progress: number;
  error?: string | null;
  target?: UpscalerBatchTarget;
  outputName?: string;
  output?: UpscalerImageExportResult;
}

export interface UpscalerBatchRunResult {
  completed: string[];
  failed: string[];
  cancelled: string[];
}

export interface UpscalerBatchImportFailure {
  name: string;
  error: string;
}

export interface UpscalerBatchImportResult {
  items: UpscalerBatchItem[];
  failures: UpscalerBatchImportFailure[];
}

export interface UpscalerBatchImportOptions {
  signal?: AbortSignal;
  isGenerationCurrent?: () => boolean;
}

export interface UpscalerBatchRunnerOptions {
  items: readonly UpscalerBatchItem[];
  settings: UpscalerBatchSettingsSnapshot;
  signal?: AbortSignal;
  exportImage?: (options: Parameters<typeof exportUpscalerImage>[0]) => Promise<UpscalerImageExportResult>;
  writeOutput?: (output: UpscalerImageExportResult, item: UpscalerBatchItem) => Promise<void>;
  onUpdate?: (update: UpscalerBatchItemUpdate) => void;
}

function uniqueId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function revokeObjectUrl(url: string): void {
  if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

function abortError(): DOMException {
  return new DOMException("Operazione annullata.", "AbortError");
}

function throwIfImportInvalid(options: UpscalerBatchImportOptions): void {
  if (options.signal?.aborted || options.isGenerationCurrent?.() === false) throw abortError();
}

function revokeBatchItems(items: readonly UpscalerBatchItem[]): void {
  for (const item of items) {
    const urls = new Set([item.url, item.thumbnailUrl].filter((url): url is string => Boolean(url?.startsWith("blob:"))));
    for (const url of urls) revokeObjectUrl(url);
  }
}

async function loadBatchImageSource(file: File, url: string): Promise<{ source: CanvasImageSource; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      try {
      // A canvas is a stable DOM-realm boundary for both ONNX and the Python
      // serializer. Keeping the ImageBitmap here used to make both backends
      // mis-detect it as a 1x1 source.
        const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas sorgente batch non disponibile.");
        context.drawImage(bitmap, 0, 0);
        return { source: canvas, close: () => undefined };
      } finally { bitmap.close(); }
    } catch {
      // Some browsers expose createImageBitmap but reject specific codecs. The
      // DOM decoder can still read those images, so retain it as a real fallback.
    }
  }
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("Immagine non leggibile.")); element.src = url;
  });
  return { source: image, close: () => undefined };
}

export function cloneUpscalerSettings(settings: UpscalerSettings): UpscalerBatchSettingsSnapshot {
  return {
    ...settings,
    remote: { ...settings.remote, endpoints: settings.remote.endpoints.map((endpoint) => ({ ...endpoint })) },
    adjustments: { ...settings.adjustments }
  };
}

/** Alias that makes the session-bound nature clear at call sites and tests. */
export const snapshotUpscalerSettings = cloneUpscalerSettings;

export function resolveUpscalerBatchTarget(sourceWidth: number, sourceHeight: number, settings: Pick<UpscalerSettings, "lockAspectRatio" | "scale" | "finalWidth" | "finalHeight">): UpscalerBatchTarget {
  if (settings.lockAspectRatio) return resolveUpscalerTarget(sourceWidth, sourceHeight, settings.scale);
  return { width: settings.finalWidth, height: settings.finalHeight };
}

export const resolveBatchTarget = resolveUpscalerBatchTarget;

export function settingsForUpscalerBatchItem(snapshot: UpscalerBatchSettingsSnapshot, item: Pick<UpscalerBatchItem, "url" | "name" | "sourceWidth" | "sourceHeight" | "target">): UpscalerSettings {
  return {
    ...snapshot,
    sourceUrl: item.url,
    sourceName: item.name,
    sourceKind: "image",
    sourceWidth: item.sourceWidth,
    sourceHeight: item.sourceHeight,
    durationSeconds: 0,
    finalWidth: item.target.width,
    finalHeight: item.target.height,
    adjustments: { ...snapshot.adjustments }
  };
}

/**
 * Resolves the settings consumed by the live Upscaler viewport.
 *
 * Batch cards are runtime-only sources: selecting one must never write the
 * project settings (and therefore must not mark the project dirty). Keeping
 * this as a pure helper also makes the source/dimension boundary explicit for
 * both the App shell and integration tests.
 */
export function resolveUpscalerDisplaySettings(settings: UpscalerSettings, item: Pick<UpscalerBatchItem, "url" | "name" | "sourceWidth" | "sourceHeight" | "target"> | null | undefined): UpscalerSettings {
  if (!item) return { ...settings, adjustments: { ...settings.adjustments } };
  return {
    ...settings,
    sourceUrl: item.url,
    sourceName: item.name,
    sourceKind: "image",
    sourceWidth: item.sourceWidth,
    sourceHeight: item.sourceHeight,
    durationSeconds: 0,
    finalWidth: item.target.width,
    finalHeight: item.target.height,
    adjustments: { ...settings.adjustments }
  };
}

export async function createUpscalerBatchItems(files: readonly File[], settings: UpscalerSettings, options: UpscalerBatchImportOptions = {}): Promise<UpscalerBatchImportResult> {
  const snapshot = cloneUpscalerSettings(settings);
  const items: UpscalerBatchItem[] = []; const failures: UpscalerBatchImportFailure[] = [];
  try {
    throwIfImportInvalid(options);
    for (const file of files) {
      throwIfImportInvalid(options);
      const classification = classifyUpscalerMediaFile(file);
      if (!classification.supported) { failures.push({ name: file.name, error: classification.message }); continue; }
      if (classification.kind !== "image") { failures.push({ name: file.name, error: "Il batch Upscaler accetta solo immagini." }); continue; }
      let ownedUrl: string | null = null;
      let ownedThumbnailUrl: string | null = null;
      try {
        throwIfImportInvalid(options);
        ownedUrl = URL.createObjectURL(file);
        throwIfImportInvalid(options);
        const thumbnail = await createUpscalerBatchThumbnail(file, ownedUrl, options.signal ? { signal: options.signal } : {});
        throwIfImportInvalid(options);
        if (thumbnail.blob) ownedThumbnailUrl = URL.createObjectURL(thumbnail.blob);
        throwIfImportInvalid(options);
        const target = resolveUpscalerBatchTarget(thumbnail.width, thumbnail.height, snapshot);
        const item: UpscalerBatchItem = {
          id: uniqueId(), file, url: ownedUrl, thumbnailUrl: ownedThumbnailUrl, name: file.name, sourceWidth: thumbnail.width, sourceHeight: thumbnail.height,
          target, outputName: upscalerImageFileName(file.name, target.width, target.height),
          selected: true, status: "queued", progress: 0, error: null
        };
        items.push(item);
        ownedUrl = null;
        ownedThumbnailUrl = null;
      } catch (error) {
        if (ownedUrl) revokeObjectUrl(ownedUrl);
        if (ownedThumbnailUrl) revokeObjectUrl(ownedThumbnailUrl);
        if (isAbortError(error) || options.signal?.aborted || options.isGenerationCurrent?.() === false) throw abortError();
        failures.push({ name: file.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    throwIfImportInvalid(options);
    return { items, failures };
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted || options.isGenerationCurrent?.() === false) revokeBatchItems(items);
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Runs selected items strictly sequentially and continues after per-file errors. */
export async function runUpscalerBatch(options: UpscalerBatchRunnerOptions): Promise<UpscalerBatchRunResult> {
  const exportImage = options.exportImage ?? exportUpscalerImage;
  const completed: string[] = []; const failed: string[] = []; const cancelled: string[] = [];
  const snapshot = cloneUpscalerSettings(options.settings);
  const selected = options.items.filter((item) => item.selected && item.status !== "done");
  for (const item of selected) {
    if (options.signal?.aborted) {
      cancelled.push(item.id); options.onUpdate?.({ itemId: item.id, status: "cancelled", progress: item.progress, error: "Operazione annullata." });
      continue;
    }
    const target = resolveUpscalerBatchTarget(item.sourceWidth, item.sourceHeight, snapshot);
    const runItem = { ...item, target, outputName: upscalerImageFileName(item.name, target.width, target.height) };
    options.onUpdate?.({ itemId: item.id, status: "processing", progress: 0, error: null, target, outputName: runItem.outputName });
    const settings = settingsForUpscalerBatchItem(snapshot, runItem);
    try {
      const imageSource = await loadBatchImageSource(item.file, item.url);
      try {
        const exportOptions: Parameters<typeof exportUpscalerImage>[0] = { source: imageSource.source, settings, onModelProgress: (progress) => options.onUpdate?.({ itemId: item.id, status: "processing", progress: progress.progress, error: null }), sourceName: item.name };
        if (options.signal) exportOptions.signal = options.signal;
        const output = await exportImage(exportOptions);
        if (options.signal?.aborted) throw abortError();
        await options.writeOutput?.(output, runItem);
        if (options.signal?.aborted) throw abortError();
        completed.push(item.id); options.onUpdate?.({ itemId: item.id, status: "done", progress: 1, error: null, output });
      } finally {
        imageSource.close();
      }
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        cancelled.push(item.id); options.onUpdate?.({ itemId: item.id, status: "cancelled", progress: item.progress, error: "Operazione annullata." });
        for (const remaining of selected.slice(selected.indexOf(item) + 1)) { cancelled.push(remaining.id); options.onUpdate?.({ itemId: remaining.id, status: "cancelled", progress: 0, error: "Operazione annullata." }); }
        break;
      }
      const message = error instanceof Error ? error.message : String(error);
      failed.push(item.id); options.onUpdate?.({ itemId: item.id, status: "error", progress: 1, error: message });
    }
  }
  return { completed, failed, cancelled };
}

export type UpscalerBatchExportImage = (options: Parameters<typeof exportUpscalerImage>[0]) => Promise<UpscalerImageExportResult>;
