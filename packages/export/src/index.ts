export interface RationalFps { numerator: number; denominator: number; }
export interface ExportProgress { currentFrame: number; totalFrames: number; progress: number; elapsedMs: number; estimatedRemainingMs: number; }
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
