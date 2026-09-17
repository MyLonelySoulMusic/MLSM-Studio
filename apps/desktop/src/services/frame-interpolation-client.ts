import { trackTask } from "./task-history";
export function frameInterpolationJob(...args: Parameters<typeof frameInterpolationJobImpl>): ReturnType<typeof frameInterpolationJobImpl> { return trackTask("Frame Booster", () => frameInterpolationJobImpl(...args)); }
import type { FrameInterpolationMediaAudit } from "./frame-interpolation-audit";
import { ensurePythonUpscalerService } from "./upscaler-python-client";

export type FrameInterpolationMethod = "blend" | "motion" | "motion-obmc";
export type FrameInterpolationPhase = "uploading" | "queued" | "probing" | "preparing" | "interpolating" | "remuxing" | "verifying" | "downloading" | "ready" | "error" | "cancelled";

export interface FrameInterpolationCapabilities {
  ffmpeg: boolean;
  jobs: boolean;
}

export interface FrameInterpolationJobStatus {
  id: string;
  phase: FrameInterpolationPhase;
  phaseLabel?: string;
  progress: number;
  stageProgress: number | null;
  currentFrame: number;
  totalFrames: number;
  sourceFrames?: number;
  processedBytes?: number;
  bytesProcessed?: number;
  totalBytes?: number;
  resultBytes?: number;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number | null;
  indeterminate: boolean;
  source?: FrameInterpolationMediaAudit;
  output?: FrameInterpolationMediaAudit;
  sourceFps?: number;
  targetFps?: number;
  method?: FrameInterpolationMethod;
  backend?: string;
  resultPath?: string;
  error?: string;
}

export interface FrameInterpolationRequest {
  blob: Blob;
  fileName: string;
  method: FrameInterpolationMethod;
  sourceFps?: number;
  targetFps?: number;
  targetMultiplier?: number;
  signal: AbortSignal;
  clientId?: string;
  onStatus?: (status: FrameInterpolationJobStatus) => void;
}

export interface FrameInterpolationResult { blob: Blob; status: FrameInterpolationJobStatus; }

export const frameInterpolationBaseUrl = "http://127.0.0.1:8765";
export const frameInterpolationCommand = "npm run upscaler:server";

export function normalizeFrameInterpolationMethod(value: unknown): FrameInterpolationMethod {
  if (value === "blend" || value === "motion-obmc") return value;
  return "motion";
}

interface HealthPayload { interpolation?: { ffmpeg?: boolean; jobs?: boolean } }

export async function frameInterpolationHealth(refresh = false, timeoutMs = 8_000): Promise<FrameInterpolationCapabilities | null> {
  try {
    const response = await fetch(`${frameInterpolationBaseUrl}/interpolation/health${refresh ? `?t=${Date.now()}` : ""}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const payload = await response.json() as HealthPayload;
    const info = payload.interpolation ?? {};
    return { ffmpeg: Boolean(info.ffmpeg), jobs: info.jobs !== false };
  } catch { return null; }
}

export async function waitForFrameInterpolationHealth(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<FrameInterpolationCapabilities | null> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 15_000);
  const deadline = Date.now() + timeoutMs;
  let startRequested = false;
  do {
    if (options.signal?.aborted) return null;
    const remaining = deadline - Date.now();
    const capabilities = await frameInterpolationHealth(true, Math.max(250, Math.min(2_500, remaining)));
    if (capabilities) return capabilities;
    if (!startRequested) {
      startRequested = true;
      if (!await ensurePythonUpscalerService() || options.signal?.aborted) return null;
    }
    if (Date.now() >= deadline || options.signal?.aborted) return null;
    await new Promise<void>((resolve) => {
      const abort = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        options.signal?.removeEventListener("abort", abort);
        resolve();
      }, 350);
      options.signal?.addEventListener("abort", abort, { once: true });
    });
  } while (Date.now() < deadline);
  return null;
}

export async function probeFrameInterpolationSource(file: File, signal?: AbortSignal): Promise<FrameInterpolationMediaAudit> {
  const form = new FormData();
  form.set("file", file, file.name || "source.mp4");
  const response = await fetch(`${frameInterpolationBaseUrl}/interpolation/probe`, { method: "POST", body: form, ...(signal ? { signal } : {}) });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = typeof payload?.detail === "string" ? payload.detail : `HTTP ${response.status}`;
    throw new Error(`Rilevamento FPS non riuscito: ${detail}`);
  }
  const result = await response.json() as Partial<FrameInterpolationMediaAudit>;
  if (!Number.isFinite(result.fps) || Number(result.fps) <= 0 || !Number.isFinite(result.width) || Number(result.width) <= 0 || !Number.isFinite(result.height) || Number(result.height) <= 0) {
    throw new Error("Il server non ha restituito metadati video validi.");
  }
  return {
    frameCount: Math.max(0, Math.round(Number(result.frameCount) || 0)),
    fps: Number(result.fps),
    durationSeconds: Math.max(0, Number(result.durationSeconds) || 0),
    width: Math.round(Number(result.width)),
    height: Math.round(Number(result.height)),
    hasAudio: Boolean(result.hasAudio),
    ...(typeof result.sampleAspectRatio === "string" ? { sampleAspectRatio: result.sampleAspectRatio } : {}),
    ...(Number.isFinite(result.displayAspectRatio) ? { displayAspectRatio: Number(result.displayAspectRatio) } : {}),
  };
}

export function resolveFrameInterpolationTarget(sourceFps: number | null | undefined, mode: "multiplier" | "fps", value: number): number | null {
  if (!sourceFps || !Number.isFinite(sourceFps) || sourceFps <= 0) return mode === "fps" && value > 0 ? value : null;
  const target = mode === "multiplier" ? sourceFps * value : value;
  return Number.isFinite(target) && target > sourceFps && target <= 480 ? target : null;
}

function uploadJob(body: FormData, signal: AbortSignal, onProgress: (loaded: number, total: number) => void): Promise<FrameInterpolationJobStatus> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Operazione annullata", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest(); const abort = () => request.abort(); request.open("POST", `${frameInterpolationBaseUrl}/interpolation/jobs`); request.responseType = "json";
    request.upload.onprogress = (event) => onProgress(event.loaded, event.lengthComputable ? event.total : 0);
    request.onload = () => { signal.removeEventListener("abort", abort); if (request.status >= 200 && request.status < 300) resolve(request.response as FrameInterpolationJobStatus); else reject(new Error(typeof request.response === "string" ? request.response : request.response?.detail || `Avvio interpolazione fallito (HTTP ${request.status}).`)); };
    request.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error("Il servizio locale non ha ricevuto il video.")); };
    request.onabort = () => { signal.removeEventListener("abort", abort); reject(new DOMException("Operazione annullata", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true }); request.send(body);
  });
}

function downloadResult(url: string, signal: AbortSignal, onProgress: (loaded: number, total: number) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Operazione annullata", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest(); const abort = () => request.abort(); request.open("GET", url); request.responseType = "blob";
    request.onprogress = (event) => onProgress(event.loaded, event.lengthComputable ? event.total : 0);
    request.onload = () => { signal.removeEventListener("abort", abort); if (request.status >= 200 && request.status < 300 && request.response?.size) resolve(request.response as Blob); else reject(new Error(`Download del video interpolato fallito (HTTP ${request.status}).`)); };
    request.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error("Download del video interpolato fallito.")); };
    request.onabort = () => { signal.removeEventListener("abort", abort); reject(new DOMException("Operazione annullata", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true }); request.send();
  });
}

export async function frameInterpolationCancel(clientId: string, jobId?: string): Promise<void> {
  const requests = [`${frameInterpolationBaseUrl}/interpolation/clients/${encodeURIComponent(clientId)}`];
  if (jobId) requests.push(`${frameInterpolationBaseUrl}/interpolation/jobs/${encodeURIComponent(jobId)}`);
  await Promise.all(requests.map((url) => fetch(url, { method: "DELETE", keepalive: true }).catch(() => undefined)));
}

export function createFrameInterpolationFormData(options: Omit<FrameInterpolationRequest, "signal" | "onStatus">, clientId: string): FormData {
  const form = new FormData();
  form.set("file", options.blob, options.fileName || "source.mp4");
  // Old in-memory projects may still contain `rife` from before the standalone
  // Frame Booster model was removed. Never let that stale value reach the API.
  form.set("method", normalizeFrameInterpolationMethod(options.method));
  form.set("client_id", clientId);
  if (options.targetMultiplier !== undefined) {
    // In multiplier mode ffprobe is authoritative for source FPS. Never send a
    // rounded browser-derived target alongside the multiplier.
    form.set("target_multiplier", String(options.targetMultiplier));
  } else if (options.targetFps !== undefined) {
    form.set("target_fps", String(options.targetFps));
    if (options.sourceFps !== undefined) form.set("source_fps", String(options.sourceFps));
  }
  return form;
}

async function frameInterpolationJobImpl(options: FrameInterpolationRequest): Promise<FrameInterpolationResult> {
  if (options.signal.aborted) throw new DOMException("Operazione annullata", "AbortError");
  const capabilities = await waitForFrameInterpolationHealth({ timeoutMs: 15_000, signal: options.signal });
  if (options.signal.aborted) throw new DOMException("Operazione annullata", "AbortError");
  if (!capabilities?.ffmpeg || capabilities.jobs === false) throw new Error("Il backend Frame Booster non è disponibile. Verifica Python 3.11, l’ambiente .venv e FFmpeg, quindi riprova.");
  const clientId = options.clientId ?? globalThis.crypto?.randomUUID?.() ?? `frame-booster-${Date.now()}`;
  const form = createFrameInterpolationFormData(options, clientId);
  let status: FrameInterpolationJobStatus | undefined; let cleanup = false;
  const abort = () => { void frameInterpolationCancel(clientId, status?.id); }; options.signal.addEventListener("abort", abort, { once: true });
  try {
    status = await uploadJob(form, options.signal, (loaded, total) => { const progress = total ? loaded / total : 0; options.onStatus?.({ id: "upload", phase: "uploading", progress, stageProgress: total ? progress : null, currentFrame: 0, totalFrames: 0, processedBytes: loaded, totalBytes: total, indeterminate: !total, ...(options.sourceFps === undefined ? {} : { sourceFps: options.sourceFps }), ...(options.targetFps === undefined ? {} : { targetFps: options.targetFps }), method: options.method }); });
    options.onStatus?.(status);
    while (status.phase !== "ready") {
      if (options.signal.aborted) throw new DOMException("Operazione annullata", "AbortError");
      if (status.phase === "error") throw new Error(status.error || "Interpolazione interrotta dal servizio locale.");
      if (status.phase === "cancelled") throw new DOMException("Operazione annullata", "AbortError");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      const response = await fetch(`${frameInterpolationBaseUrl}/interpolation/jobs/${encodeURIComponent(status.id)}`, { signal: options.signal });
      if (!response.ok) { cleanup = true; throw new Error(`Impossibile leggere lo stato dell'interpolazione (HTTP ${response.status}).`); }
      status = await response.json() as FrameInterpolationJobStatus; options.onStatus?.(status);
    }
    const blob = await downloadResult(`${frameInterpolationBaseUrl}/interpolation/jobs/${encodeURIComponent(status.id)}/result`, options.signal, (loaded, total) => options.onStatus?.({ ...status!, phase: "downloading", progress: total ? loaded / total : 0, stageProgress: total ? loaded / total : null, processedBytes: loaded, totalBytes: total, indeterminate: !total }));
    status = { ...status, phase: "ready", progress: 1, stageProgress: 1, processedBytes: blob.size, totalBytes: blob.size, resultBytes: blob.size };
    options.onStatus?.(status); return { blob, status };
  } catch (error) {
    cleanup = cleanup || !(error instanceof DOMException && error.name === "AbortError"); throw error;
  } finally { options.signal.removeEventListener("abort", abort); if (cleanup && status?.id) await frameInterpolationCancel(clientId, status.id); }
}
