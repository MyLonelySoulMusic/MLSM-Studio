import type { ExportProgress } from "@rbs/export-engine";
import type { RhythmBallProject } from "@rbs/project-schema";
import type { ExportQuality } from "./offline-video-exporter";
import { generatePythonUpscaledVideo } from "./upscaler-python-client";
import { resolvedUpscalerDimensions } from "./upscaler-renderer";

type UpscalerSettings = RhythmBallProject["animation"]["upscaler"];

export interface UpscalerVideoExportSettings {
  projectName: string;
  quality: ExportQuality;
  sourceVideoUrl: string;
  sourceVideoFile?: File | null;
  upscalerSettings: UpscalerSettings;
  suppressDownload?: boolean;
  sourceStartSeconds?: number;
  sourceDurationSeconds?: number;
}

export interface UpscalerVideoExportResult {
  fileName: string;
  width: number;
  height: number;
  sourceFrameCount: number;
  encodedFrameCount: number;
  audioPacketCount: number;
  tempDirectory: string;
  originalFramesDirectory: string;
  blob?: Blob;
}

export interface UpscalerVideoExportProgress extends ExportProgress {
  phaseLabel?: string;
  tempDirectory?: string;
  originalFramesDirectory?: string;
  width?: number;
  height?: number;
}

function safeName(value: string): string {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "mlsm-studio";
}

function downloadVideoBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * L’export video non usa più una preview catturata dal browser. Il servizio locale
 * estrae tutti i frame nella cartella temp del progetto, li elabora uno per uno e
 * ricompone il video soltanto dopo aver verificato il conteggio completo.
 */
export async function exportUpscaledVideo(
  settings: UpscalerVideoExportSettings,
  signal: AbortSignal,
  onProgress: (progress: UpscalerVideoExportProgress) => void
): Promise<UpscalerVideoExportResult> {
  // Old projects can retain a 16:9 target after a non-16:9 video is loaded.
  // Normalize the target at the last boundary while leaving unlocked custom
  // dimensions independent of the source ratio.
  const dimensions = resolvedUpscalerDimensions(settings.upscalerSettings, "width");
  const width = dimensions.width;
  const height = dimensions.height;
  const result = await generatePythonUpscaledVideo({
    sourceUrl: settings.sourceVideoUrl,
    ...(settings.sourceVideoFile ? { sourceBlob: settings.sourceVideoFile } : {}),
    sourceName: settings.upscalerSettings.sourceName,
    settings: {
      ...settings.upscalerSettings,
      finalWidth: width,
      finalHeight: height,
      ...(settings.sourceStartSeconds !== undefined ? { sourceStartSeconds: settings.sourceStartSeconds } : {}),
      ...(settings.sourceDurationSeconds !== undefined ? { sourceDurationSeconds: settings.sourceDurationSeconds } : {})
    },
    quality: settings.quality,
    signal,
    onStatus: (status) => onProgress({
      currentFrame: status.currentFrame,
      totalFrames: status.totalFrames,
      progress: status.progress,
      elapsedMs: (status.elapsedSeconds ?? 0) * 1_000,
      estimatedRemainingMs: (status.estimatedRemainingSeconds ?? 0) * 1_000,
      phase: status.phase,
      phaseLabel: status.phaseLabel,
      tempDirectory: status.tempDirectory,
      originalFramesDirectory: status.originalFramesDirectory,
      ...(status.effectiveWidth ? { width: status.effectiveWidth } : {}),
      ...(status.effectiveHeight ? { height: status.effectiveHeight } : {})
    })
  });
  if (signal.aborted) throw new DOMException("Esportazione annullata", "AbortError");
  if (result.status.totalFrames <= 0 || result.status.currentFrame !== result.status.totalFrames) {
    throw new Error(`Controllo anti-drop fallito: elaborati ${result.status.currentFrame}/${result.status.totalFrames} frame.`);
  }
  const effectiveWidth = result.status.effectiveWidth ?? width;
  const effectiveHeight = result.status.effectiveHeight ?? height;
  const fileName = `${safeName(settings.projectName)}-upscaled-${effectiveWidth}x${effectiveHeight}.mp4`;
  if (!settings.suppressDownload) downloadVideoBlob(result.blob, fileName);
  return {
    fileName,
    width: effectiveWidth,
    height: effectiveHeight,
    sourceFrameCount: result.status.totalFrames,
    encodedFrameCount: result.status.currentFrame,
    audioPacketCount: 0,
    tempDirectory: result.status.tempDirectory,
    originalFramesDirectory: result.status.originalFramesDirectory
    , blob: result.blob
  };
}

export async function processUpscaledVideo(settings: UpscalerVideoExportSettings, signal: AbortSignal, onProgress: (progress: UpscalerVideoExportProgress) => void): Promise<UpscalerVideoExportResult & { blob: Blob }> {
  const result = await exportUpscaledVideo({ ...settings, suppressDownload: true }, signal, onProgress);
  if (!result.blob) throw new Error("Upscaler non ha prodotto un artifact video.");
  return result as UpscalerVideoExportResult & { blob: Blob };
}
