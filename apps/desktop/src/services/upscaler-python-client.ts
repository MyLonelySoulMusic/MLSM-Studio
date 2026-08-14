import type { RhythmBallProject } from "@rbs/project-schema";
import type { ModelLoadProgress } from "./upscaler-ai";

type Settings = RhythmBallProject["animation"]["upscaler"];
export const pythonUpscalerBaseUrl = "http://127.0.0.1:8765";
export interface PythonUpscalerHealth { ok: boolean; apiVersion?: number; capabilities?: { imageUpscale?: boolean; videoJobs?: boolean }; mps: boolean; cuda: boolean; recommendedBackend: "metal" | "cuda" | "cpu"; gpuName: string; videoTempDirectory?: string; interpolation?: { ffmpeg?: boolean; ffmpegPath?: string } }
export interface PythonVideoUpscaleStatus {
  id: string;
  phase: "queued" | "extracting" | "upscaling" | "encoding" | "ready" | "error" | "cancelled";
  phaseLabel: string;
  progress: number;
  currentFrame: number;
  totalFrames: number;
  tempDirectory: string;
  originalFramesDirectory: string;
  upscaledFramesDirectory: string;
  requestedWidth?: number;
  requestedHeight?: number;
  effectiveWidth?: number;
  effectiveHeight?: number;
  sampleAspectRatio?: string;
  preserveAspectRatio?: boolean;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number | null;
  error?: string;
}
let healthPromise: Promise<PythonUpscalerHealth | null> | null = null;
let healthCheckedAt = 0;

export function reportUpscalerDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  const entry = { source: "browser", event, at: new Date().toISOString(), ...details };
  console.info("[MLSM Upscaler]", entry);
  void fetch(`${pythonUpscalerBaseUrl}/diagnostics/events`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry)
  }).catch(() => undefined);
}

export function pythonUpscalerHealth(refresh = false): Promise<PythonUpscalerHealth | null> {
  const stale = Date.now() - healthCheckedAt > 3_000;
  if (refresh || !healthPromise || stale) {
    healthCheckedAt = Date.now();
    healthPromise = fetch(`${pythonUpscalerBaseUrl}/health`, { signal: AbortSignal.timeout(2500) }).then((response) => response.ok ? response.json() as Promise<PythonUpscalerHealth> : null).catch(() => null);
  }
  return healthPromise;
}

export function shouldUsePythonUpscaler(webExecutable: boolean, backend: Settings["backend"], health: PythonUpscalerHealth | null): boolean {
  return !webExecutable || backend === "metal" || backend === "cuda" || (backend === "auto" && Boolean(health && (health.mps || health.cuda)));
}

export function pythonUpscalerSupportsVideoJobs(health: PythonUpscalerHealth | null | undefined): boolean {
  return Boolean(health && (health.apiVersion ?? 0) >= 2 && health.capabilities?.videoJobs);
}

export function buildUpscalerVideoForm(source: Blob, sourceName: string, settings: Settings, quality: "draft" | "high" | "maximum", clientId: string): FormData {
  const form = new FormData();
  form.set("file", source, sourceName || "source.mp4");
  form.set("model", settings.model);
  form.set("backend", settings.backend);
  form.set("tile", String(settings.tileSize));
  form.set("width", String(settings.finalWidth));
  form.set("height", String(settings.finalHeight));
  form.set("tta", String(settings.tta));
  form.set("preserve_aspect_ratio", String(settings.lockAspectRatio));
  form.set("quality", quality);
  form.set("client_id", clientId);
  const range = (settings as Settings & { sourceStartSeconds?: number; sourceDurationSeconds?: number });
  if (Number.isFinite(range.sourceStartSeconds)) form.set("source_start_seconds", String(Math.max(0, range.sourceStartSeconds ?? 0)));
  if (Number.isFinite(range.sourceDurationSeconds)) form.set("source_duration_seconds", String(Math.max(0, range.sourceDurationSeconds ?? 0)));
  return form;
}

async function prepareModel(model: Settings["model"], onProgress: (status: ModelLoadProgress) => void, signal?: AbortSignal): Promise<void> {
  const start = await fetch(`${pythonUpscalerBaseUrl}/models/${encodeURIComponent(model)}/prepare`, { method: "POST", ...(signal ? { signal } : {}) }); if (!start.ok) throw new Error(`Il servizio Python non riesce a preparare ${model}.`);
  while (true) {
    if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
    const response = await fetch(`${pythonUpscalerBaseUrl}/models/${encodeURIComponent(model)}/status`, signal ? { signal } : undefined); const item = await response.json() as { phase: string; progress?: number; loadedBytes?: number; totalBytes?: number; error?: string };
    if (item.phase === "error") throw new Error(item.error || "Download PyTorch fallito.");
    if (item.phase === "ready") { onProgress({ phase: "cache", progress: 1, ...(item.loadedBytes ? { loadedBytes: item.loadedBytes } : {}), ...(item.totalBytes ? { totalBytes: item.totalBytes } : {}) }); return; }
    onProgress({ phase: "download", progress: item.progress ?? 0, ...(item.loadedBytes ? { loadedBytes: item.loadedBytes } : {}), ...(item.totalBytes ? { totalBytes: item.totalBytes } : {}) });
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof HTMLCanvasElement || source instanceof OffscreenCanvas) return { width: source.width, height: source.height };
  return { width: 1, height: 1 };
}

export async function generatePythonUpscale(source: CanvasImageSource, settings: Settings, onProgress: (status: ModelLoadProgress) => void, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  const health = await pythonUpscalerHealth(true); if (!health) throw new Error("Nessun servizio PyTorch risponde su 127.0.0.1:8765. Lascia aperto un secondo terminale con `npm run upscaler:server`, poi premi Riprova connessione nell’Upscaler.");
  await prepareModel(settings.model, onProgress, signal); onProgress({ phase: "initializing", progress: 0 });
  const size = sourceSize(source); const input = document.createElement("canvas"); input.width = size.width; input.height = size.height; const context = input.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas sorgente non disponibile."); context.drawImage(source, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob>((resolve, reject) => input.toBlob((value) => value ? resolve(value) : reject(new Error("Codifica sorgente fallita.")), "image/png")); const form = new FormData(); form.set("file", blob, "source.png"); form.set("model", settings.model); form.set("backend", settings.backend); form.set("tile", String(settings.tileSize)); form.set("width", String(settings.finalWidth)); form.set("height", String(settings.finalHeight)); form.set("tta", String(settings.tta));
  onProgress({ phase: "inference", progress: 0 }); const response = await fetch(`${pythonUpscalerBaseUrl}/upscale`, { method: "POST", body: form, ...(signal ? { signal } : {}) }); if (!response.ok) throw new Error(await response.text() || `Upscaling PyTorch fallito: HTTP ${response.status}.`);
  const resultBlob = await response.blob(); const bitmap = await createImageBitmap(resultBlob); const result = document.createElement("canvas"); result.width = bitmap.width; result.height = bitmap.height; const resultContext = result.getContext("2d", { alpha: false }); if (!resultContext) throw new Error("Canvas PyTorch risultato non disponibile."); resultContext.drawImage(bitmap, 0, 0); bitmap.close(); onProgress({ phase: "ready", progress: 1 }); return result;
}

function uploadVideoJob(form: FormData, signal: AbortSignal, onUpload: (progress: number) => void): Promise<PythonVideoUpscaleStatus> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open("POST", `${pythonUpscalerBaseUrl}/upscale/video/jobs`);
    request.responseType = "json";
    request.upload.onprogress = (event) => { if (event.lengthComputable) onUpload(event.loaded / Math.max(1, event.total)); };
    request.onload = () => {
      signal.removeEventListener("abort", abort);
      if (request.status >= 200 && request.status < 300) resolve(request.response as PythonVideoUpscaleStatus);
      else reject(new Error(typeof request.response === "string" ? request.response : request.response?.detail || `Avvio job video fallito: HTTP ${request.status}.`));
    };
    request.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error("Il servizio locale non ha ricevuto il video.")); };
    request.onabort = () => { signal.removeEventListener("abort", abort); reject(new DOMException("Operazione annullata", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    request.send(form);
  });
}

export async function generatePythonUpscaledVideo(options: {
  sourceUrl: string;
  sourceBlob?: Blob;
  sourceName: string;
  settings: Settings;
  quality: "draft" | "high" | "maximum";
  signal: AbortSignal;
  onStatus: (status: PythonVideoUpscaleStatus & { uploadProgress?: number }) => void;
}): Promise<{ blob: Blob; status: PythonVideoUpscaleStatus }> {
  const clientId = globalThis.crypto?.randomUUID?.() ?? `upscaler-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  reportUpscalerDiagnostic("video-export-start", { sourceName: options.sourceName, model: options.settings.model, backend: options.settings.backend, target: `${options.settings.finalWidth}x${options.settings.finalHeight}`, directFile: Boolean(options.sourceBlob) });
  const health = await pythonUpscalerHealth(true);
  reportUpscalerDiagnostic("health-check", { available: Boolean(health), apiVersion: health?.apiVersion, videoJobs: health?.capabilities?.videoJobs, ffmpeg: health?.interpolation?.ffmpeg, gpuName: health?.gpuName });
  if (!health) throw new Error("Servizio locale non disponibile: il video deve essere elaborato frame per frame dal backend PyTorch/ffmpeg.");
  if (!pythonUpscalerSupportsVideoJobs(health)) throw new Error("Il servizio Upscaler attualmente in esecuzione è una versione precedente e supporta soltanto immagini/frame di anteprima. Arrestalo e riavvialo una volta: il nuovo backend esporrà /upscale/video/jobs.");
  if (!health.interpolation?.ffmpeg) throw new Error("ffmpeg non è disponibile nel servizio locale: installalo con `brew install ffmpeg`, poi riavvia l’app.");
  if (options.settings.model !== "canvas") await prepareModel(options.settings.model, (model) => options.onStatus({
    id: "model", phase: "queued", phaseLabel: model.phase === "download" ? `Download modello · ${Math.round(model.progress * 100)}%` : "Preparazione modello AI",
    progress: Math.min(.015, model.progress * .015), currentFrame: 0, totalFrames: 0,
    tempDirectory: health.videoTempDirectory ?? "temp/upscaler", originalFramesDirectory: "", upscaledFramesDirectory: ""
  }), options.signal);
  let source = options.sourceBlob;
  if (!source) {
    let response: Response;
    try { response = await fetch(options.sourceUrl, { signal: options.signal }); }
    catch (error) { throw new Error("Il file video originale non è più disponibile nel browser. Ricaricalo nell’Upscaler e riprova.", { cause: error }); }
    if (!response.ok) throw new Error(`Impossibile leggere il video sorgente (HTTP ${response.status}).`);
    source = await response.blob();
  }
  if (!source.size) throw new Error("Il file video sorgente è vuoto o non è più disponibile. Ricaricalo e riprova.");
  reportUpscalerDiagnostic("source-ready", { sourceName: options.sourceName, bytes: source.size, mimeType: source.type, directFile: Boolean(options.sourceBlob) });
  const form = buildUpscalerVideoForm(source, options.sourceName, options.settings, options.quality, clientId);
  reportUpscalerDiagnostic("upload-start", { bytes: source.size, endpoint: "/upscale/video/jobs" });
  let status: PythonVideoUpscaleStatus | undefined;
  const cancelRemote = () => {
    void fetch(`${pythonUpscalerBaseUrl}/upscale/video/clients/${encodeURIComponent(clientId)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    if (status?.id && status.id !== "upload") void fetch(`${pythonUpscalerBaseUrl}/upscale/video/jobs/${encodeURIComponent(status.id)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
  };
  options.signal.addEventListener("abort", cancelRemote, { once: true });
  try {
    status = await uploadVideoJob(form, options.signal, (uploadProgress) => options.onStatus({
      id: "upload", phase: "queued", phaseLabel: "Copia del video nel job locale", progress: uploadProgress * .02,
      currentFrame: 0, totalFrames: 0, tempDirectory: health.videoTempDirectory ?? "temp/upscaler",
      originalFramesDirectory: "", upscaledFramesDirectory: "", uploadProgress
    }));
    reportUpscalerDiagnostic("job-created", { jobId: status.id, phase: status.phase, tempDirectory: status.tempDirectory });
    options.onStatus(status);
    let lastLogKey = "";
    while (status.phase !== "ready") {
      if (options.signal.aborted) throw new DOMException("Operazione annullata", "AbortError");
      if (status.phase === "error") throw new Error(status.error || "Upscaling video interrotto dal servizio locale.");
      if (status.phase === "cancelled") throw new DOMException("Operazione annullata", "AbortError");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      const current = await fetch(`${pythonUpscalerBaseUrl}/upscale/video/jobs/${encodeURIComponent(status.id)}`, { signal: options.signal });
      if (!current.ok) throw new Error(`Impossibile leggere l’avanzamento del job (HTTP ${current.status}).`);
      status = await current.json() as PythonVideoUpscaleStatus;
      options.onStatus(status);
      const logKey = `${status.phase}:${Math.floor(status.progress * 10)}:${status.currentFrame}/${status.totalFrames}`;
      if (logKey !== lastLogKey) {
        lastLogKey = logKey;
        reportUpscalerDiagnostic("job-progress", { jobId: status.id, phase: status.phase, progress: status.progress, currentFrame: status.currentFrame, totalFrames: status.totalFrames, error: status.error });
      }
    }
    const result = await fetch(`${pythonUpscalerBaseUrl}/upscale/video/jobs/${encodeURIComponent(status.id)}/result`, { signal: options.signal });
    if (!result.ok) throw new Error(`Download del video elaborato fallito (HTTP ${result.status}).`);
    const blob = await result.blob();
    reportUpscalerDiagnostic("video-export-ready", { jobId: status.id, bytes: blob.size, totalFrames: status.totalFrames, elapsedSeconds: status.elapsedSeconds });
    return { blob, status };
  } finally { options.signal.removeEventListener("abort", cancelRemote); }
}
