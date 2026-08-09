import type { ExportProgress } from "@rbs/export-engine";
import type { RhythmBallProject } from "@rbs/project-schema";
import type { ExportQuality } from "./offline-video-exporter";
import { generatePythonUpscaledVideo } from "./upscaler-python-client";

type UpscalerSettings = RhythmBallProject["animation"]["upscaler"];

export interface UpscalerVideoExportSettings {
  projectName: string;
  quality: ExportQuality;
  sourceVideoUrl: string;
  sourceVideoFile?: File | null;
  upscalerSettings: UpscalerSettings;
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
}

export interface UpscalerVideoExportProgress extends ExportProgress {
  phase?: string;
  phaseLabel?: string;
  tempDirectory?: string;
  originalFramesDirectory?: string;
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
  const width = Math.max(64, Math.min(16384, Math.round(settings.upscalerSettings.finalWidth / 2) * 2));
  const height = Math.max(64, Math.min(16384, Math.round(settings.upscalerSettings.finalHeight / 2) * 2));
  const fileName = `${safeName(settings.projectName)}-upscaled-${width}x${height}.mp4`;
  const result = await generatePythonUpscaledVideo({
    sourceUrl: settings.sourceVideoUrl,
    ...(settings.sourceVideoFile ? { sourceBlob: settings.sourceVideoFile } : {}),
    sourceName: settings.upscalerSettings.sourceName,
    settings: { ...settings.upscalerSettings, finalWidth: width, finalHeight: height },
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
      originalFramesDirectory: status.originalFramesDirectory
    })
  });
  if (signal.aborted) throw new DOMException("Esportazione annullata", "AbortError");
  if (result.status.totalFrames <= 0 || result.status.currentFrame !== result.status.totalFrames) {
    throw new Error(`Controllo anti-drop fallito: elaborati ${result.status.currentFrame}/${result.status.totalFrames} frame.`);
  }
  downloadVideoBlob(result.blob, fileName);
  return {
    fileName,
    width,
    height,
    sourceFrameCount: result.status.totalFrames,
    encodedFrameCount: result.status.currentFrame,
    audioPacketCount: 0,
    tempDirectory: result.status.tempDirectory,
    originalFramesDirectory: result.status.originalFramesDirectory
  };
}
