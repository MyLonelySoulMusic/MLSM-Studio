import type { FrameInterpolationMediaAudit } from "./frame-interpolation-audit";

export type FrameInterpolationMethod = "blend" | "motion" | "rife";
export type FrameInterpolationDevice = "auto" | "mps" | "cuda" | "cpu";
export type FrameInterpolationPrecision = "auto" | "fp32" | "fp16";
export type FrameInterpolationPhase = "uploading" | "queued" | "probing" | "preparing" | "interpolating" | "remuxing" | "verifying" | "downloading" | "ready" | "error" | "cancelled";

export interface FrameInterpolationCapabilities {
  ffmpeg: boolean;
  jobs: boolean;
  device: "mps" | "cuda" | "cpu";
  automaticDevice: "mps" | "cuda" | null;
  rife: { installed: boolean; ready: boolean; verified: boolean; selfTest: boolean; modelId: string | null; supportedDevices: Array<"mps" | "cuda" | "cpu">; supportedPrecisions: Array<"fp32" | "fp16">; reason?: string };
}

export interface FrameInterpolationJobStatus {
  id: string;
  phase: FrameInterpolationPhase;
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
  error?: string;
}

export interface FrameInterpolationRequest {
  blob: Blob;
  fileName: string;
  method: FrameInterpolationMethod;
  sourceFps?: number;
  targetFps?: number;
  targetMultiplier?: number;
  device?: FrameInterpolationDevice;
  rifeModel?: "rife-v4.26";
  precision?: FrameInterpolationPrecision;
  signal: AbortSignal;
  clientId?: string;
  onStatus?: (status: FrameInterpolationJobStatus) => void;
}

export interface FrameInterpolationResult { blob: Blob; status: FrameInterpolationJobStatus; }

export const frameInterpolationBaseUrl = "http://127.0.0.1:8765";
export const frameInterpolationCommand = "npm run upscaler:server";

interface HealthPayload { interpolation?: { ffmpeg?: boolean; jobs?: boolean; device?: string; automaticDevice?: string | null; rife?: Partial<FrameInterpolationCapabilities["rife"]> & { ready?: boolean; verified?: boolean; reason?: string } } }

export async function frameInterpolationHealth(refresh = false): Promise<FrameInterpolationCapabilities | null> {
  try {
    // A first health check after installing/restarting RIFE performs a real
    // 64×64 inference and can legitimately take longer than a network ping.
    const response = await fetch(`${frameInterpolationBaseUrl}/interpolation/health${refresh ? `?t=${Date.now()}` : ""}`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return null;
    const payload = await response.json() as HealthPayload;
    const info = payload.interpolation ?? {};
    const rife = info.rife ?? {};
    const device = info.device === "mps" || info.device === "cuda" ? info.device : "cpu";
    return {
      ffmpeg: Boolean(info.ffmpeg), jobs: info.jobs !== false, device,
      automaticDevice: info.automaticDevice === "mps" || info.automaticDevice === "cuda" ? info.automaticDevice : null,
      rife: {
        installed: Boolean(rife.installed), ready: Boolean(rife.ready), verified: Boolean(rife.verified), selfTest: Boolean(rife.selfTest), modelId: rife.modelId ?? null,
        supportedDevices: rife.supportedDevices ?? [], supportedPrecisions: rife.supportedPrecisions ?? [], ...(rife.reason ? { reason: rife.reason } : {})
      }
    };
  } catch { return null; }
}

export async function frameInterpolationPrepareRife(): Promise<FrameInterpolationCapabilities> {
  const body = new FormData();
  body.set("model", "rife-v4.26");
  const response = await fetch(`${frameInterpolationBaseUrl}/interpolation/rife/prepare`, { method: "POST", body });
  const payload = await response.json().catch(() => null) as ({ detail?: string } & Partial<FrameInterpolationCapabilities["rife"]>) | null;
  if (!response.ok) throw new Error(payload?.detail || `Preparazione RIFE fallita (HTTP ${response.status}).`);
  const capabilities = await frameInterpolationHealth(true);
  if (!capabilities?.rife.ready || !capabilities.rife.verified || !capabilities.rife.selfTest) {
    throw new Error(capabilities?.rife.reason || "Il self-test RIFE non è stato superato.");
  }
  return capabilities;
}

export function resolveFrameInterpolationTarget(sourceFps: number | null | undefined, mode: "multiplier" | "fps", value: number): number | null {
  if (!sourceFps || !Number.isFinite(sourceFps) || sourceFps <= 0) return mode === "fps" && value > 0 ? value : null;
  const target = mode === "multiplier" ? sourceFps * value : value;
  return Number.isFinite(target) && target > sourceFps && target <= 480 ? target : null;
}

export function frameInterpolationMethodAvailable(method: FrameInterpolationMethod, capabilities: FrameInterpolationCapabilities | null, device: FrameInterpolationDevice = "auto", precision: FrameInterpolationPrecision = "auto"): boolean {
  if (!capabilities) return false;
  if (method !== "rife") return capabilities.ffmpeg;
  if (!capabilities.rife.ready || !capabilities.rife.verified || !capabilities.rife.selfTest) return false;
  const effective = device === "auto" ? capabilities.automaticDevice : device;
  if (!effective) return false;
  if (!capabilities.rife.supportedDevices.includes(effective)) return false;
  if (precision === "fp16" && effective !== "cuda") return false;
  return precision === "auto" || capabilities.rife.supportedPrecisions.includes(precision);
}

function uploadJob(body: FormData, signal: AbortSignal, onProgress: (loaded: number, total: number) => void): Promise<FrameInterpolationJobStatus> {
  return new Promise((resolve, reject) => {
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
  form.set("method", options.method);
  form.set("client_id", clientId);
  if (options.targetMultiplier !== undefined) {
    // In multiplier mode ffprobe is authoritative for source FPS. Never send a
    // rounded browser-derived target alongside the multiplier.
    form.set("target_multiplier", String(options.targetMultiplier));
  } else if (options.targetFps !== undefined) {
    form.set("target_fps", String(options.targetFps));
    if (options.sourceFps !== undefined) form.set("source_fps", String(options.sourceFps));
  }
  form.set("device", options.device ?? "auto");
  form.set("rife_model", options.rifeModel ?? "rife-v4.26");
  form.set("precision", options.precision ?? "auto");
  return form;
}

export async function frameInterpolationJob(options: FrameInterpolationRequest): Promise<FrameInterpolationResult> {
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
