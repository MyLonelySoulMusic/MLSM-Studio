import type { RhythmBallProject } from "@rbs/project-schema";
import { pythonUpscalerBaseUrl, type PythonVideoUpscaleStatus } from "./upscaler-python-client";

type Settings = RhythmBallProject["animation"]["upscaler"];

interface RecoverableRemoteVideoJobsResponse {
  jobs?: PythonVideoUpscaleStatus[];
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
}

function sameOptionalFps(left: number | null | undefined, right: number | null): boolean {
  return left == null ? right === null : right !== null && Math.abs(left - right) < 0.000_001;
}

export function plausibleRemoteCheckpointJobs(
  jobs: readonly PythonVideoUpscaleStatus[],
  sourceBytes: number,
  settings: Settings
): PythonVideoUpscaleStatus[] {
  return jobs.filter((job) => {
    const segmentFrames = job.remoteChunkFrames ?? job.segmentFrames ?? 100;
    // `outputFps` is the effective encoded FPS. `remoteOutputFps: null` is an
    // intentional policy meaning “preserve source”, so it must not fall
    // through to the effective numeric value.
    const outputFps = Object.hasOwn(job, "remoteOutputFps") ? job.remoteOutputFps ?? null : null;
    return job.remote === true
      && job.sourceBytes === sourceBytes
      && job.model === settings.remote.model
      && segmentFrames === settings.remote.segmentFrames
      && sameOptionalFps(outputFps, settings.remote.outputFps)
      && typeof job.sourceHash === "string"
      && job.sourceHash.length > 0;
  });
}

async function sha256(blob: Blob, signal?: AbortSignal): Promise<string> {
  abortIfNeeded(signal);
  const bytes = typeof blob.arrayBuffer === "function"
    ? await blob.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      const abort = () => reader.abort();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error("Lettura del video fallita."));
      reader.onabort = () => reject(new DOMException("Operazione annullata", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      reader.onloadend = () => signal?.removeEventListener("abort", abort);
      reader.readAsArrayBuffer(blob);
    });
  abortIfNeeded(signal);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 non disponibile in questo runtime.");
  const digest = await subtle.digest("SHA-256", bytes);
  abortIfNeeded(signal);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Avoids asking a cache question for every new video. The potentially costly
 * full-file hash runs only when a terminal checkpoint has the same byte size,
 * remote model and segmentation policy. The backend repeats the authoritative
 * SHA-256 check when a resume job is actually submitted.
 */
export async function hasCompatibleRemoteUpscalerCheckpoint(
  source: File,
  settings: Settings,
  signal?: AbortSignal
): Promise<boolean> {
  abortIfNeeded(signal);
  let response: Response;
  try {
    response = await fetch(`${pythonUpscalerBaseUrl}/upscale/remote/video/jobs`, signal ? { signal } : undefined);
  } catch {
    abortIfNeeded(signal);
    // Cache discovery is optional. A safe restart will surface any real
    // backend connection error through the normal export flow.
    return false;
  }
  if (!response.ok) return false;
  const payload = await response.json() as RecoverableRemoteVideoJobsResponse;
  abortIfNeeded(signal);
  const candidates = plausibleRemoteCheckpointJobs(Array.isArray(payload.jobs) ? payload.jobs : [], source.size, settings);
  if (!candidates.length) return false;
  try {
    const digest = await sha256(source, signal);
    return candidates.some((candidate) => candidate.sourceHash?.toLowerCase() === digest);
  } catch {
    abortIfNeeded(signal);
    // If hashing is unavailable, preserve the explicit choice rather than
    // silently discarding a plausible checkpoint.
    return true;
  }
}
