import { trackTask } from "./task-history";
export function frameInterpolationJob(...args: Parameters<typeof frameInterpolationJobImpl>): ReturnType<typeof frameInterpolationJobImpl> { return trackTask("Frame Booster", () => frameInterpolationJobImpl(...args)); }
import type { FrameInterpolationMediaAudit } from "./frame-interpolation-audit";
import { ensurePythonUpscalerService, pythonUpscalerRuntimeDiagnostic, refreshPythonUpscalerStartupStatus, reportUpscalerDiagnostic, setPythonUpscalerRuntimeDiagnostic } from "./upscaler-python-client";
import { localUpscalerApiBaseUrl } from "./local-python-api";
import { pythonServiceLifecycleRevision, waitForAreaPythonServicesShutdown } from "./python-service-lifecycle";

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

export const frameInterpolationBaseUrl = localUpscalerApiBaseUrl();
export const frameInterpolationCommand = "npm run upscaler:server";

function frameBoosterConnectionError(action: string, cause?: unknown): Error {
  const diagnostic = pythonUpscalerRuntimeDiagnostic();
  const causeText = cause instanceof Error ? cause.message : cause ? String(cause) : "connessione interrotta";
  const log = diagnostic.logPath ? ` Log backend: ${diagnostic.logPath}` : "";
  return new Error(`${action}: il backend locale non risponde (${causeText}). ${diagnostic.message}${log}`);
}

export function normalizeFrameInterpolationMethod(value: unknown): FrameInterpolationMethod {
  if (value === "blend" || value === "motion-obmc") return value;
  return "motion";
}

interface HealthPayload { interpolation?: { ffmpeg?: boolean; jobs?: boolean } }

export async function frameInterpolationHealth(refresh = false, timeoutMs = 8_000, signal?: AbortSignal): Promise<FrameInterpolationCapabilities | null> {
  try {
    const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
    const response = await fetch(`${frameInterpolationBaseUrl}/interpolation/health${refresh ? `?t=${Date.now()}` : ""}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) return null;
    const payload = await response.json() as HealthPayload;
    const info = payload.interpolation;
    if (!info || typeof info.ffmpeg !== "boolean" || typeof info.jobs !== "boolean") return null;
    return { ffmpeg: Boolean(info.ffmpeg), jobs: info.jobs !== false };
  } catch { return null; }
}

export async function waitForFrameInterpolationHealth(options: { timeoutMs?: number; signal?: AbortSignal; onStatus?: (message: string, elapsedSeconds: number) => void } = {}): Promise<FrameInterpolationCapabilities | null> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 60_000);
  const beganAt = Date.now();
  const deadline = beganAt + timeoutMs;
  const revision = pythonServiceLifecycleRevision();
  const cancelled = () => options.signal?.aborted || revision !== pythonServiceLifecycleRevision();
  const report = () => options.onStatus?.(pythonUpscalerRuntimeDiagnostic().message, (Date.now() - beganAt) / 1000);
  if (cancelled()) return null;
  setPythonUpscalerRuntimeDiagnostic("probing", "Verifica del backend Frame Booster locale…");
  report();
  await waitForAreaPythonServicesShutdown();
  let started = false;
  let lastStatusRequest = beganAt;
  do {
    if (cancelled() || Date.now() >= deadline) break;
    const remaining = deadline - Date.now();
    const capabilities = await frameInterpolationHealth(true, Math.min(2_500, remaining), options.signal);
    if (cancelled()) return null;
    if (capabilities) {
      setPythonUpscalerRuntimeDiagnostic(capabilities.ffmpeg && capabilities.jobs ? "ready" : "error", capabilities.ffmpeg && capabilities.jobs
        ? "Frame Booster pronto: FFmpeg e servizio interpolazione disponibili."
        : "Il backend risponde ma FFmpeg o il servizio interpolazione non sono disponibili. Apri Impostazioni → Restore per verificare il runtime.");
      report();
      return capabilities;
    }
    if (Date.now() >= deadline) break;
    if (!started) {
      started = await ensurePythonUpscalerService(options.signal, Math.min(10_000, deadline - Date.now()));
      if (cancelled()) return null;
      report();
      if (!started) return null;
      lastStatusRequest = Date.now();
    } else if (Date.now() - lastStatusRequest >= 2_000) {
      lastStatusRequest = Date.now();
      const phase = await refreshPythonUpscalerStartupStatus(options.signal, Math.min(4_000, deadline - Date.now()));
      if (cancelled()) return null;
      report();
      if (phase === "error") return null;
    }
    report();
    if (Date.now() >= deadline || cancelled()) break;
    await new Promise<void>((resolve) => {
      const abort = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        options.signal?.removeEventListener("abort", abort);
        resolve();
      }, 750);
      options.signal?.addEventListener("abort", abort, { once: true });
    });
  } while (Date.now() < deadline);
  if (!cancelled() && pythonUpscalerRuntimeDiagnostic().phase !== "error") {
    setPythonUpscalerRuntimeDiagnostic("error", `Il backend non è pronto dopo ${Math.round(timeoutMs / 1000)} secondi. Consulta i log di avvio per l’ultimo passaggio eseguito e riprova.`);
    report();
  }
  return null;
}

export async function probeFrameInterpolationSource(file: File, signal?: AbortSignal): Promise<FrameInterpolationMediaAudit> {
  const capabilities = await waitForFrameInterpolationHealth({ timeoutMs: 60_000, ...(signal ? { signal } : {}) });
  signal?.throwIfAborted();
  if (!capabilities?.ffmpeg) throw frameBoosterConnectionError("Rilevamento FPS non riuscito");
  const form = new FormData();
  form.set("file", file, file.name || "source.mp4");
  reportUpscalerDiagnostic("frame-booster-probe-start", { fileName: file.name, bytes: file.size });
  let response: Response;
  try {
    response = await fetch(`${frameInterpolationBaseUrl}/interpolation/probe`, { method: "POST", body: form, ...(signal ? { signal } : {}) });
  } catch (error) {
    signal?.throwIfAborted();
    console.error("[MLSM Frame Booster] source probe failed", error, pythonUpscalerRuntimeDiagnostic());
    throw frameBoosterConnectionError("Rilevamento FPS non riuscito", error);
  }
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
    request.onerror = () => {
      signal.removeEventListener("abort", abort);
      const error = frameBoosterConnectionError("Invio del video non riuscito");
      console.error("[MLSM Frame Booster] job upload failed", error, pythonUpscalerRuntimeDiagnostic());
      reject(error);
    };
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
  const capabilities = await waitForFrameInterpolationHealth({ timeoutMs: 60_000, signal: options.signal, onStatus: (phaseLabel, elapsedSeconds) => {
    options.onStatus?.({ id: "startup", phase: "preparing", phaseLabel, elapsedSeconds, progress: 0, stageProgress: null, currentFrame: 0, totalFrames: 0, indeterminate: true });
  } });
  if (options.signal.aborted) throw new DOMException("Operazione annullata", "AbortError");
  if (!capabilities?.ffmpeg || capabilities.jobs === false) throw frameBoosterConnectionError("Avvio interpolazione non riuscito");
  const clientId = options.clientId ?? globalThis.crypto?.randomUUID?.() ?? `frame-booster-${Date.now()}`;
  const form = createFrameInterpolationFormData(options, clientId);
  let status: FrameInterpolationJobStatus | undefined; let cleanup = false;
  const abort = () => { void frameInterpolationCancel(clientId, status?.id); }; options.signal.addEventListener("abort", abort, { once: true });
  try {
    reportUpscalerDiagnostic("frame-booster-job-upload", { clientId, fileName: options.fileName, bytes: options.blob.size, method: options.method });
    status = await uploadJob(form, options.signal, (loaded, total) => { const progress = total ? loaded / total : 0; options.onStatus?.({ id: "upload", phase: "uploading", progress, stageProgress: total ? progress : null, currentFrame: 0, totalFrames: 0, processedBytes: loaded, totalBytes: total, indeterminate: !total, ...(options.sourceFps === undefined ? {} : { sourceFps: options.sourceFps }), ...(options.targetFps === undefined ? {} : { targetFps: options.targetFps }), method: options.method }); });
    reportUpscalerDiagnostic("frame-booster-job-created", { clientId, jobId: status.id, phase: status.phase });
    options.onStatus?.(status);
    while (status.phase !== "ready") {
      if (options.signal.aborted) throw new DOMException("Operazione annullata", "AbortError");
      if (status.phase === "error") throw new Error(status.error || "Interpolazione interrotta dal servizio locale.");
      if (status.phase === "cancelled") throw new DOMException("Operazione annullata", "AbortError");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      let response: Response;
      try {
        response = await fetch(`${frameInterpolationBaseUrl}/interpolation/jobs/${encodeURIComponent(status.id)}`, { signal: options.signal });
      } catch (error) {
        options.signal.throwIfAborted();
        console.error("[MLSM Frame Booster] status polling failed", { jobId: status.id, error, diagnostic: pythonUpscalerRuntimeDiagnostic() });
        throw frameBoosterConnectionError("Lettura avanzamento non riuscita", error);
      }
      if (!response.ok) { cleanup = true; throw new Error(`Impossibile leggere lo stato dell'interpolazione (HTTP ${response.status}).`); }
      status = await response.json() as FrameInterpolationJobStatus; options.onStatus?.(status);
    }
    const blob = await downloadResult(`${frameInterpolationBaseUrl}/interpolation/jobs/${encodeURIComponent(status.id)}/result`, options.signal, (loaded, total) => options.onStatus?.({ ...status!, phase: "downloading", progress: total ? loaded / total : 0, stageProgress: total ? loaded / total : null, processedBytes: loaded, totalBytes: total, indeterminate: !total }));
    status = { ...status, phase: "ready", progress: 1, stageProgress: 1, processedBytes: blob.size, totalBytes: blob.size, resultBytes: blob.size };
    reportUpscalerDiagnostic("frame-booster-job-ready", { clientId, jobId: status.id, bytes: blob.size });
    options.onStatus?.(status); return { blob, status };
  } catch (error) {
    cleanup = cleanup || !(error instanceof DOMException && error.name === "AbortError"); throw error;
  } finally { options.signal.removeEventListener("abort", abort); if (cleanup && status?.id) await frameInterpolationCancel(clientId, status.id); }
}
