/**
 * Client del servizio locale di interpolazione. Il calcolo dei fotogrammi intermedi
 * richiede ffmpeg (filtro `minterpolate`) oppure un modello RIFE su GPU: nessuno dei
 * due esiste nel browser, quindi vive nello stesso servizio Python locale già usato
 * dall’Upscaler. Il servizio va avviato dall’utente e non parte mai da solo.
 */
import { localUpscalerApiBaseUrl } from "./local-python-api";

export type VideoEditorInterpolationMethod = "blend" | "motion" | "rife";

export interface VideoEditorInterpolationHealth {
  available: boolean;
  ffmpeg: boolean;
  rife: boolean;
  device: string;
  jobs?: boolean;
}

export type VideoEditorInterpolationJobPhase = "uploading" | "queued" | "interpolating" | "verifying" | "downloading" | "ready" | "error" | "cancelled";

export interface VideoEditorInterpolationJobStatus {
  id: string;
  phase: VideoEditorInterpolationJobPhase;
  /** Diagnostic-only server text. UI copy is selected from `phase`. */
  phaseLabel?: string;
  progress: number;
  stageProgress?: number | null;
  currentFrame: number;
  totalFrames: number;
  sourceFrames?: number;
  processedBytes?: number;
  bytesProcessed?: number;
  totalBytes?: number;
  resultBytes?: number;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number | null;
  indeterminate?: boolean;
  sourceFps?: number;
  targetFps?: number;
  method?: VideoEditorInterpolationMethod;
  backend?: string;
  error?: string;
}

export interface VideoEditorInterpolationResult {
  blob: Blob;
  method: VideoEditorInterpolationMethod;
  sourceFps: number;
  targetFps: number;
  backend: string;
}

export const videoEditorInterpolationBaseUrl = localUpscalerApiBaseUrl();
/** Guida mostrata quando il servizio non risponde: la stessa dell’Upscaler, per non moltiplicare i riti. */
export const videoEditorInterpolationCommand = "npm run upscaler:server";

const healthTimeoutMs = 2_500;

interface HealthPayload { interpolation?: { ffmpeg?: boolean; rife?: boolean | { ready?: boolean; verified?: boolean }; jobs?: boolean; device?: string } }

export async function videoEditorInterpolationHealth(): Promise<VideoEditorInterpolationHealth | null> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), healthTimeoutMs);
    const response = await fetch(`${videoEditorInterpolationBaseUrl}/interpolation/health`, { signal: controller.signal }).finally(() => window.clearTimeout(timer));
    if (!response.ok) return null;
    const payload = await response.json() as HealthPayload;
    const info = payload.interpolation ?? {};
    const rife = typeof info.rife === "object" ? Boolean(info.rife.ready && info.rife.verified) : Boolean(info.rife);
    return { available: Boolean(info.ffmpeg || rife), ffmpeg: Boolean(info.ffmpeg), rife, ...(info.jobs === undefined ? {} : { jobs: Boolean(info.jobs) }), device: info.device ?? "cpu" };
  } catch {
    // Servizio assente: l’export continua al frame rate reso, senza interpolazione.
    return null;
  }
}

export function videoEditorInterpolationMethodLabel(method: VideoEditorInterpolationMethod): string {
  if (method === "blend") return "Fusione fotogrammi · veloce";
  if (method === "motion") return "Stima del movimento ffmpeg · consigliata";
  return "RIFE su GPU · qualità massima";
}

/**
 * Invia il file già codificato al servizio locale e restituisce la versione al frame
 * rate richiesto. Un errore qui non deve mai far perdere il montaggio: chi chiama
 * conserva il file di partenza e riporta il motivo del mancato aumento.
 */
export async function videoEditorInterpolate(options: {
  blob: Blob;
  fileName: string;
  sourceFps: number;
  targetFps: number;
  method: VideoEditorInterpolationMethod;
  signal: AbortSignal;
}): Promise<VideoEditorInterpolationResult> {
  if (options.targetFps <= options.sourceFps) throw new Error("Il frame rate di destinazione deve superare quello del montaggio.");
  const body = new FormData();
  body.append("file", options.blob, options.fileName);
  body.append("source_fps", String(options.sourceFps));
  body.append("target_fps", String(options.targetFps));
  body.append("method", options.method);
  const response = await fetch(`${videoEditorInterpolationBaseUrl}/interpolate`, { method: "POST", body, signal: options.signal });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Interpolazione non riuscita (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}.`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("Il servizio di interpolazione ha restituito un file vuoto.");
  return {
    blob,
    method: (response.headers.get("X-Interpolation-Method") as VideoEditorInterpolationMethod | null) ?? options.method,
    sourceFps: options.sourceFps,
    targetFps: Number(response.headers.get("X-Interpolation-Target-Fps") ?? options.targetFps),
    backend: response.headers.get("X-Interpolation-Backend") ?? "ffmpeg"
  };
}

function uploadInterpolationJob(body: FormData, signal: AbortSignal, onUpload: (progress: number, loaded: number, total: number) => void): Promise<VideoEditorInterpolationJobStatus> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open("POST", `${videoEditorInterpolationBaseUrl}/interpolation/jobs`);
    request.responseType = "json";
    request.upload.onprogress = (event) => { if (event.lengthComputable) onUpload(event.loaded / Math.max(1, event.total), event.loaded, event.total); };
    request.onload = () => {
      signal.removeEventListener("abort", abort);
      if (request.status >= 200 && request.status < 300) resolve(request.response as VideoEditorInterpolationJobStatus);
      else reject(new Error(typeof request.response === "string" ? request.response : request.response?.detail || `Avvio interpolazione fallito: HTTP ${request.status}.`));
    };
    request.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error("Il servizio locale non ha ricevuto il video.")); };
    request.onabort = () => { signal.removeEventListener("abort", abort); reject(new DOMException("Operazione annullata", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    request.send(body);
  });
}

function downloadInterpolationResult(url: string, signal: AbortSignal, onProgress: (loaded: number, total: number) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open("GET", url);
    request.responseType = "blob";
    request.onprogress = (event) => onProgress(event.loaded, event.lengthComputable ? event.total : 0);
    request.onload = () => {
      signal.removeEventListener("abort", abort);
      if (request.status >= 200 && request.status < 300 && request.response?.size) resolve(request.response as Blob);
      else reject(new Error(`Download del video interpolato fallito (HTTP ${request.status}).`));
    };
    request.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error("Download del video interpolato fallito.")); };
    request.onabort = () => { signal.removeEventListener("abort", abort); reject(new DOMException("Operazione annullata", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    request.send();
  });
}

/**
 * Job-based interpolation.  Upload and result download use XHR so the UI can
 * report byte progress; frame progress comes from the server's ffmpeg `-progress`
 * stream.  The legacy synchronous `/interpolate` client above remains untouched.
 */
export async function videoEditorInterpolateJob(options: {
  blob: Blob;
  fileName: string;
  sourceFps: number;
  targetFps: number;
  method: VideoEditorInterpolationMethod;
  signal: AbortSignal;
  clientId?: string;
  onStatus?: (status: VideoEditorInterpolationJobStatus & { uploadProgress?: number; downloadProgress?: number }) => void;
}): Promise<{ blob: Blob; status: VideoEditorInterpolationJobStatus }> {
  if (options.targetFps <= options.sourceFps) throw new Error("Il frame rate di destinazione deve superare quello di partenza.");
  const clientId = options.clientId ?? globalThis.crypto?.randomUUID?.() ?? `interpolation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = new FormData();
  body.append("file", options.blob, options.fileName);
  body.append("source_fps", String(options.sourceFps));
  body.append("target_fps", String(options.targetFps));
  body.append("method", options.method);
  body.append("client_id", clientId);
  let status: VideoEditorInterpolationJobStatus | undefined;
  const cancelRemote = async () => {
    const urls = [`${videoEditorInterpolationBaseUrl}/interpolation/clients/${encodeURIComponent(clientId)}`];
    if (status?.id) urls.push(`${videoEditorInterpolationBaseUrl}/interpolation/jobs/${encodeURIComponent(status.id)}`);
    await Promise.all(urls.map((url) => Promise.resolve()
      .then(() => fetch(url, { method: "DELETE", keepalive: true }))
      .catch(() => undefined)));
  };
  const cancelOnAbort = () => { void cancelRemote(); };
  options.signal.addEventListener("abort", cancelOnAbort, { once: true });
  let cancelAfterFailure = false;
  try {
    status = await uploadInterpolationJob(body, options.signal, (uploadProgress, loaded, total) => options.onStatus?.({
      id: "upload", phase: "uploading", progress: uploadProgress, stageProgress: uploadProgress,
      currentFrame: 0, totalFrames: 0, sourceFps: options.sourceFps, targetFps: options.targetFps, method: options.method, uploadProgress, processedBytes: loaded, bytesProcessed: loaded, totalBytes: total
    }));
    options.onStatus?.(status);
    while (status.phase !== "ready") {
      if (options.signal.aborted) throw new DOMException("Operazione annullata", "AbortError");
      if (status.phase === "error") throw new Error(status.error || "Interpolazione interrotta dal servizio locale.");
      if (status.phase === "cancelled") throw new DOMException("Operazione annullata", "AbortError");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      const response = await fetch(`${videoEditorInterpolationBaseUrl}/interpolation/jobs/${encodeURIComponent(status.id)}`, { signal: options.signal });
      if (!response.ok) throw new Error(`Impossibile leggere l’avanzamento dell’interpolazione (HTTP ${response.status}).`);
      status = await response.json() as VideoEditorInterpolationJobStatus;
      options.onStatus?.(status);
    }
    const resultUrl = `${videoEditorInterpolationBaseUrl}/interpolation/jobs/${encodeURIComponent(status.id)}/result`;
    const blob = await downloadInterpolationResult(resultUrl, options.signal, (loaded, total) => options.onStatus?.({
      ...status!, phase: "downloading", progress: total ? loaded / total : 0,
      stageProgress: total ? loaded / total : null, processedBytes: loaded, totalBytes: total,
      downloadProgress: total ? loaded / total : 0, indeterminate: !total
    }));
    const downloaded = { ...status, phase: "ready" as const, progress: 1, stageProgress: 1, processedBytes: blob.size, bytesProcessed: blob.size, totalBytes: blob.size, resultBytes: blob.size };
    options.onStatus?.(downloaded);
    return { blob, status: downloaded };
  } catch (error) {
    cancelAfterFailure = !(error instanceof DOMException && error.name === "AbortError") && Boolean(status?.id);
    throw error;
  } finally {
    options.signal.removeEventListener("abort", cancelOnAbort);
    // Polling/JSON/download failures must not orphan CPU/GPU work.  Cleanup is
    // best-effort and deliberately cannot replace the original client error.
    if (cancelAfterFailure) await cancelRemote();
  }
}
