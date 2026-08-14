export interface RationalFps { numerator: number; denominator: number; }
/**
 * A progress update is deliberately phased.  Long exports can have a second,
 * server-side pass (for example frame interpolation) after the base render has
 * already reached 100%; consumers must be able to reset the visible stage
 * without inventing a fake percentage for work we cannot measure.
 */
export type ExportProgressPhase =
  | "preparing"
  | "queued"
  | "rendering"
  | "extracting"
  | "upscaling"
  | "encoding"
  | "verifying"
  | "interpolation-upload"
  | "interpolation"
  | "interpolation-download"
  | "complete"
  | "ready"
  | "cancelled"
  | "error";

export interface ExportProgress {
  currentFrame: number;
  totalFrames: number;
  /** Progress of the currently active phase (0..1). */
  progress: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  phase?: ExportProgressPhase;
  phaseLabel?: string;
  /** Explicit stage values are useful when a phase is indeterminate. */
  stageProgress?: number | null;
  stageCurrentFrame?: number;
  stageTotalFrames?: number;
  processedBytes?: number;
  totalBytes?: number;
  indeterminate?: boolean;
}
export interface OfflineExportOptions<T> { durationSeconds: number; fps: RationalFps; signal?: AbortSignal; evaluate: (timeSeconds: number, frameIndex: number) => T; writeFrame: (state: T, frameIndex: number, timeSeconds: number) => Promise<void>; onProgress?: (progress: ExportProgress) => void; }
export function frameTime(frameIndex: number, fps: RationalFps): number { return frameIndex * fps.denominator / fps.numerator; }
export function totalFrames(durationSeconds: number, fps: RationalFps): number { return Math.ceil(durationSeconds * fps.numerator / fps.denominator); }
export interface ExportResourceEstimate { frames: number; workingMemoryBytes: number; estimatedDiskBytes: number; rawVideoBytes: number; }
export function estimateExportResources(width: number, height: number, durationSeconds: number, fps: RationalFps): ExportResourceEstimate { const frames = totalFrames(durationSeconds, fps); const frameBytes = width * height * 4; return { frames, workingMemoryBytes: frameBytes * 2, estimatedDiskBytes: Math.round(frameBytes * frames * .22), rawVideoBytes: frameBytes * frames }; }
export async function runOfflineExport<T>(options: OfflineExportOptions<T>): Promise<number> {
  if (options.fps.numerator <= 0 || options.fps.denominator <= 0) throw new Error("Frame rate non valido"); const frames = totalFrames(options.durationSeconds, options.fps); const started = performance.now();
  for (let frame = 0; frame < frames; frame += 1) { if (options.signal?.aborted) throw new DOMException("Esportazione annullata", "AbortError"); const time = frameTime(frame, options.fps); await options.writeFrame(options.evaluate(time, frame), frame, time); const elapsedMs = performance.now() - started; const completed = frame + 1; options.onProgress?.({ currentFrame: completed, totalFrames: frames, progress: completed / Math.max(1, frames), elapsedMs, estimatedRemainingMs: elapsedMs / completed * (frames - completed) }); }
  return frames;
}
