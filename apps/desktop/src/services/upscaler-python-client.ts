import type { RhythmBallProject } from "@rbs/project-schema";
import type { ModelLoadProgress } from "./upscaler-ai";
import { canvasImageSourceSize } from "./canvas-image-source";
import { activeRemoteUpscalerEndpoints, normalizeRemoteUpscalerEndpoint, usesRemoteUpscaler } from "./remote-upscaler-client";
import { pythonServiceLifecycleRevision, waitForAreaPythonServicesShutdown } from "./python-service-lifecycle";

type Settings = RhythmBallProject["animation"]["upscaler"];
export type RemoteVideoCheckpointPolicy = "resume" | "restart";
export const pythonUpscalerBaseUrl = "http://127.0.0.1:8765";
export const UPSCALER_REMOTE_CACHE_CLEARED_EVENT = "upscaler:remote-cache-cleared";
export interface PythonUpscalerHealth {
  ok: boolean;
  apiVersion?: number;
  capabilities?: { imageUpscale?: boolean; videoJobs?: boolean; remoteUpscale?: boolean; remoteVideoPartialEndpointPreflight?: boolean; canvasVideoStreaming?: boolean };
  mps: boolean;
  cuda: boolean;
  recommendedBackend: "metal" | "cuda" | "cpu";
  gpuName: string;
  videoTempDirectory?: string;
  remoteVideoDirectory?: string;
  ownerKind?: "vite" | "tauri" | "cli" | "external";
  parentPid?: number | null;
  pid?: number;
  interpolation?: { ffmpeg?: boolean; ffmpegPath?: string };
}
export interface RemoteUpscalerVideoCacheInfo { jobs: number; bytes: number; activeJobs: number }
export interface RemoteUpscalerVideoCacheClearResult { removedJobs: number; removedBytes: number }
export interface ActiveUpscalerVideoJob { id: string; phase: string; phaseLabel: string; sourceName: string; remote: boolean; cancelRequested: boolean }
export interface RemoteVideoEndpointFailure { url: string; error: string }
export interface RemoteVideoEndpointPreflight {
  ok: boolean;
  reachableEndpoints: string[];
  failures: RemoteVideoEndpointFailure[];
}
export type RemoteVideoEndpointDecision = "continue" | "cancel";
export interface RemoteUpscalerEndpointActivity {
  url: string;
  state: "idle" | "busy" | "error";
  activeFrame: string | null;
  activeSegment?: string | null;
  completed: number;
  completedSegments?: number;
  completedFrames?: number;
  failures: number;
  segmentFrame?: number;
  segmentTotalFrames?: number;
  segmentProgress?: number;
  segmentPhase?: string;
  segmentElapsedSeconds?: number;
  segmentEstimatedRemainingSeconds?: number | null;
  secondsPerFrame?: number | null;
  updatedAtMs?: number | null;
}
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
  inputSegmentsDirectory?: string;
  upscaledSegmentsDirectory?: string;
  completedSegments?: number;
  totalSegments?: number;
  requestedWidth?: number;
  requestedHeight?: number;
  effectiveWidth?: number;
  effectiveHeight?: number;
  sampleAspectRatio?: string;
  preserveAspectRatio?: boolean;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number | null;
  error?: string;
  remote?: boolean;
  resumable?: boolean;
  sourceName?: string;
  sourceBytes?: number;
  sourceHash?: string;
  model?: string;
  width?: number;
  height?: number;
  activeEndpoint?: string;
  endpointFailures?: Array<{ endpoint: string; frame?: string; segment?: string; error: string }>;
  sourceAudioPackets?: number;
  audioPacketCount?: number;
  audioRestored?: boolean;
  encodedFrameCount?: number;
  durationSeconds?: number;
  sourceFps?: number;
  outputFps?: number;
  segmentFrames?: number;
  remoteChunkFrames?: number;
  remoteOutputFps?: number | null;
  remoteProcessingKey?: string;
  resultPath?: string;
  resultBytes?: number;
  activeEndpoints?: string[];
  endpointActivity?: RemoteUpscalerEndpointActivity[];
}
let healthPromise: Promise<PythonUpscalerHealth | null> | null = null;
let healthCheckedAt = 0;
let healthLifecycleRevision = pythonServiceLifecycleRevision();

async function probePythonUpscalerHealth(timeoutMs = 2_500): Promise<PythonUpscalerHealth | null> {
  try {
    const response = await fetch(`${pythonUpscalerBaseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? response.json() as Promise<PythonUpscalerHealth> : null;
  } catch { return null; }
}

async function requestNativeUpscalerStart(): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in globalThis)) {
    try {
      const response = await fetch("/__mlsm/python/upscaler/start", { method: "POST" });
      return response.ok;
    } catch { return false; }
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ensure_upscaler_service");
    return true;
  } catch { return false; }
}

/**
 * Requests the shared Upscaler / Frame Booster backend only after an area
 * transition has finished stopping the previous Python process tree.
 */
export async function ensurePythonUpscalerService(): Promise<boolean> {
  await waitForAreaPythonServicesShutdown();
  return requestNativeUpscalerStart();
}

async function probeOrStartPythonUpscaler(): Promise<PythonUpscalerHealth | null> {
  await waitForAreaPythonServicesShutdown();
  const current = await probePythonUpscalerHealth();
  if (current) return current;
  if (!await ensurePythonUpscalerService()) return null;
  // Importing Torch/OpenCV can take a few seconds. Keep this wait inside the
  // shared health promise so repeated clicks cannot spawn duplicate services.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const health = await probePythonUpscalerHealth(800);
    if (health) return health;
  }
  return null;
}

export function reportUpscalerDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  const entry = { source: "browser", event, at: new Date().toISOString(), ...details };
  console.info("[MLSM Upscaler]", entry);
  void fetch(`${pythonUpscalerBaseUrl}/diagnostics/events`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry)
  }).catch(() => undefined);
}

export function pythonUpscalerHealth(refresh = false): Promise<PythonUpscalerHealth | null> {
  const lifecycleRevision = pythonServiceLifecycleRevision();
  if (healthLifecycleRevision !== lifecycleRevision) {
    healthLifecycleRevision = lifecycleRevision;
    healthPromise = null;
    healthCheckedAt = 0;
  }
  const stale = Date.now() - healthCheckedAt > 3_000;
  if (refresh || !healthPromise || stale) {
    healthCheckedAt = Date.now();
    healthPromise = probeOrStartPythonUpscaler();
  }
  return healthPromise;
}

export function shouldUsePythonUpscaler(webExecutable: boolean, backend: Settings["backend"], health: PythonUpscalerHealth | null): boolean {
  return !webExecutable || backend === "metal" || backend === "cuda" || (backend === "auto" && Boolean(health && (health.mps || health.cuda)));
}

export function pythonUpscalerSupportsVideoJobs(health: PythonUpscalerHealth | null | undefined): boolean {
  return Boolean(
    health
    && (health.apiVersion ?? 0) >= 7
    && health.capabilities?.videoJobs === true
    && health.capabilities?.canvasVideoStreaming === true
  );
}

async function upscalerResponseError(response: Response, fallback: string): Promise<Error> {
  try {
    const payload = await response.json() as { detail?: string | { message?: string } };
    const detail = typeof payload.detail === "string" ? payload.detail : payload.detail?.message;
    return new Error(detail || fallback);
  } catch { return new Error(fallback); }
}

export async function getRemoteUpscalerVideoCache(signal?: AbortSignal): Promise<RemoteUpscalerVideoCacheInfo> {
  const response = await fetch(`${pythonUpscalerBaseUrl}/upscale/remote/video/cache`, signal ? { signal } : undefined);
  if (!response.ok) throw await upscalerResponseError(response, `Lettura cache remota fallita: HTTP ${response.status}.`);
  return response.json() as Promise<RemoteUpscalerVideoCacheInfo>;
}

export async function clearRemoteUpscalerVideoCache(signal?: AbortSignal): Promise<RemoteUpscalerVideoCacheClearResult> {
  const response = await fetch(`${pythonUpscalerBaseUrl}/upscale/remote/video/cache`, { method: "DELETE", ...(signal ? { signal } : {}) });
  if (!response.ok) throw await upscalerResponseError(response, `Pulizia cache remota fallita: HTTP ${response.status}.`);
  return response.json() as Promise<RemoteUpscalerVideoCacheClearResult>;
}

export async function activeUpscalerVideoJobs(signal?: AbortSignal): Promise<ActiveUpscalerVideoJob[]> {
  const response = await fetch(`${pythonUpscalerBaseUrl}/upscale/video/jobs/active`, signal ? { signal } : undefined);
  if (!response.ok) throw await upscalerResponseError(response, `Controllo job video attivi fallito: HTTP ${response.status}.`);
  const payload = await response.json() as { jobs?: ActiveUpscalerVideoJob[] };
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}

export async function preflightRemoteUpscalerVideo(
  settings: Settings, signal?: AbortSignal,
): Promise<RemoteVideoEndpointPreflight> {
  const response = await fetch(`${pythonUpscalerBaseUrl}/upscale/remote/video/preflight`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoints: activeRemoteUpscalerEndpoints(settings),
      model: settings.remote.model,
      segmentFrames: settings.remote.segmentFrames,
      ...(settings.remote.outputFps === null ? {} : { outputFps: settings.remote.outputFps }),
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await upscalerResponseError(response, `Verifica endpoint fallita: HTTP ${response.status}.`);
  return response.json() as Promise<RemoteVideoEndpointPreflight>;
}

export function settingsWithReachableRemoteEndpoints(
  settings: Settings, reachableEndpoints: readonly string[],
): Settings {
  const reachable = new Set(reachableEndpoints.map(normalizeRemoteUpscalerEndpoint));
  return {
    ...settings,
    remote: {
      ...settings.remote,
      endpoints: settings.remote.endpoints.map((endpoint) => ({
        ...endpoint,
        enabled: endpoint.enabled && reachable.has(normalizeRemoteUpscalerEndpoint(endpoint.url)),
      })),
    },
  };
}

export function buildUpscalerVideoForm(source: Blob, sourceName: string, settings: Settings, quality: "draft" | "high" | "maximum", clientId: string, checkpointPolicy: RemoteVideoCheckpointPolicy = "restart"): FormData {
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
  form.set("apply_video_adjustments", String(settings.applyVideoAdjustments));
  form.set("adjustments", JSON.stringify(settings.adjustments));
  if (usesRemoteUpscaler(settings)) {
    form.set("remote_config", JSON.stringify({
      endpoints: activeRemoteUpscalerEndpoints(settings),
      model: settings.remote.model,
      retries: settings.remote.frameRetries,
      segmentFrames: settings.remote.segmentFrames,
      ...(settings.remote.outputFps === null ? {} : { outputFps: settings.remote.outputFps })
    }));
    // The backend default is intentionally restart as well: cache reuse must
    // always be an explicit choice made for this export operation.
    form.set("checkpoint_policy", checkpointPolicy);
  }
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

export async function generatePythonUpscale(source: CanvasImageSource, settings: Settings, onProgress: (status: ModelLoadProgress) => void, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  const health = await pythonUpscalerHealth(true); if (!health) throw new Error("Nessun servizio PyTorch risponde su 127.0.0.1:8765. Lascia aperto un secondo terminale con `npm run upscaler:server`, poi premi Riprova connessione nell’Upscaler.");
  await prepareModel(settings.model, onProgress, signal); onProgress({ phase: "initializing", progress: 0 });
  const size = canvasImageSourceSize(source); const input = document.createElement("canvas"); input.width = size.width; input.height = size.height; const context = input.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas sorgente non disponibile."); context.drawImage(source, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob>((resolve, reject) => input.toBlob((value) => value ? resolve(value) : reject(new Error("Codifica sorgente fallita.")), "image/png")); const form = new FormData(); form.set("file", blob, "source.png"); form.set("model", settings.model); form.set("backend", settings.backend); form.set("tile", String(settings.tileSize)); form.set("width", String(settings.finalWidth)); form.set("height", String(settings.finalHeight)); form.set("tta", String(settings.tta));
  onProgress({ phase: "inference", progress: 0 }); const response = await fetch(`${pythonUpscalerBaseUrl}/upscale`, { method: "POST", body: form, ...(signal ? { signal } : {}) }); if (!response.ok) throw new Error(await response.text() || `Upscaling PyTorch fallito: HTTP ${response.status}.`);
  const resultBlob = await response.blob(); const bitmap = await createImageBitmap(resultBlob); const result = document.createElement("canvas"); result.width = bitmap.width; result.height = bitmap.height; const resultContext = result.getContext("2d", { alpha: false }); if (!resultContext) throw new Error("Canvas PyTorch risultato non disponibile."); resultContext.drawImage(bitmap, 0, 0); bitmap.close(); onProgress({ phase: "ready", progress: 1 }); return result;
}

function uploadVideoJob(form: FormData, signal: AbortSignal, onUpload: (progress: number) => void): Promise<PythonVideoUpscaleStatus> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Operazione annullata", "AbortError")); return; }
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
    if (signal.aborted) { signal.removeEventListener("abort", abort); reject(new DOMException("Operazione annullata", "AbortError")); return; }
    request.send(form);
  });
}

export async function generatePythonUpscaledVideo(options: {
  sourceUrl: string;
  sourceBlob?: Blob;
  sourceName: string;
  settings: Settings;
  quality: "draft" | "high" | "maximum";
  checkpointPolicy?: RemoteVideoCheckpointPolicy;
  signal: AbortSignal;
  onStatus: (status: PythonVideoUpscaleStatus & { uploadProgress?: number }) => void;
  onRemoteEndpointDecision?: (
    preflight: RemoteVideoEndpointPreflight, signal: AbortSignal,
  ) => Promise<RemoteVideoEndpointDecision>;
}): Promise<{ blob: Blob; status: PythonVideoUpscaleStatus }> {
  const throwIfAborted = () => { if (options.signal.aborted) throw new DOMException("Operazione annullata", "AbortError"); };
  throwIfAborted();
  const clientId = globalThis.crypto?.randomUUID?.() ?? `upscaler-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  reportUpscalerDiagnostic("video-export-start", { sourceName: options.sourceName, model: options.settings.model, backend: options.settings.backend, target: `${options.settings.finalWidth}x${options.settings.finalHeight}`, directFile: Boolean(options.sourceBlob), checkpointPolicy: options.checkpointPolicy ?? "restart" });
  const health = await pythonUpscalerHealth(true);
  // The health probe has its own short timeout and is shared across callers.
  // An operation can be replaced while it is pending, so re-check ownership
  // before any model preparation, blob read or XHR upload is allowed to start.
  throwIfAborted();
  reportUpscalerDiagnostic("health-check", { available: Boolean(health), apiVersion: health?.apiVersion, videoJobs: health?.capabilities?.videoJobs, ffmpeg: health?.interpolation?.ffmpeg, gpuName: health?.gpuName });
  if (!health) throw new Error("Servizio locale non disponibile: il video deve essere elaborato frame per frame dal backend PyTorch/ffmpeg.");
  if (!pythonUpscalerSupportsVideoJobs(health)) throw new Error("Il servizio Upscaler in ascolto è obsoleto o non espone Canvas video diretto. Chiudi il vecchio processo e riavvia MLSM Studio: serve API 7 con canvasVideoStreaming.");
  if (!health.interpolation?.ffmpeg) throw new Error("ffmpeg non è disponibile nel servizio locale: installalo con `brew install ffmpeg`, poi riavvia l’app.");
  let effectiveSettings = options.settings;
  if (usesRemoteUpscaler(effectiveSettings)) {
    if (!effectiveSettings.remote.model.trim()) {
      throw new Error("Upscaling remoto attivo, ma nessun modello remoto è selezionato. Verifica gli endpoint e scegli un modello: il job locale non verrà avviato al suo posto.");
    }
    if (health.capabilities?.remoteVideoPartialEndpointPreflight !== true) {
      throw new Error("Il servizio Upscaler locale è precedente al controllo parziale degli endpoint. Riavvia MLSM Studio una volta e riprova.");
    }
    const preflight = await preflightRemoteUpscalerVideo(effectiveSettings, options.signal);
    throwIfAborted();
    if (preflight.failures.length) {
      const decision = options.onRemoteEndpointDecision
        ? await options.onRemoteEndpointDecision(preflight, options.signal)
        : "cancel";
      throwIfAborted();
      if (decision !== "continue") throw new DOMException("Avvio Upscaler remoto annullato", "AbortError");
      if (!preflight.reachableEndpoints.length) {
        throw new Error("Nessun endpoint remoto è raggiungibile: riavvia almeno un Colab e riprova.");
      }
      effectiveSettings = settingsWithReachableRemoteEndpoints(
        effectiveSettings, preflight.reachableEndpoints,
      );
      reportUpscalerDiagnostic("remote-endpoints-skipped", {
        reachable: preflight.reachableEndpoints,
        skipped: preflight.failures.map((failure) => failure.url),
      });
    }
  }
  const activeJobs = await activeUpscalerVideoJobs(options.signal);
  throwIfAborted();
  if (activeJobs.length) {
    const active = activeJobs[0]!;
    throw new Error(`È già attivo il job ${active.id}${active.sourceName ? ` (${active.sourceName})` : ""}: ${active.phaseLabel}. Annullalo oppure attendi il completamento; il video non è stato copiato nuovamente.`);
  }
  if (!usesRemoteUpscaler(effectiveSettings) && effectiveSettings.model !== "canvas") await prepareModel(effectiveSettings.model, (model) => options.onStatus({
    id: "model", phase: "queued", phaseLabel: model.phase === "download" ? `Download modello · ${Math.round(model.progress * 100)}%` : "Preparazione modello AI",
    progress: Math.min(.015, model.progress * .015), currentFrame: 0, totalFrames: 0,
    tempDirectory: health.videoTempDirectory ?? "temp/upscaler", originalFramesDirectory: "", upscaledFramesDirectory: ""
  }), options.signal);
  throwIfAborted();
  let source = options.sourceBlob;
  if (!source) {
    let response: Response;
    try { response = await fetch(options.sourceUrl, { signal: options.signal }); }
    catch (error) { throw new Error("Il file video originale non è più disponibile nel browser. Ricaricalo nell’Upscaler e riprova.", { cause: error }); }
    if (!response.ok) throw new Error(`Impossibile leggere il video sorgente (HTTP ${response.status}).`);
    source = await response.blob();
  }
  throwIfAborted();
  if (!source.size) throw new Error("Il file video sorgente è vuoto o non è più disponibile. Ricaricalo e riprova.");
  reportUpscalerDiagnostic("source-ready", { sourceName: options.sourceName, bytes: source.size, mimeType: source.type, directFile: Boolean(options.sourceBlob) });
  const form = buildUpscalerVideoForm(source, options.sourceName, effectiveSettings, options.quality, clientId, options.checkpointPolicy ?? "restart");
  throwIfAborted();
  reportUpscalerDiagnostic("upload-start", { bytes: source.size, endpoint: "/upscale/video/jobs" });
  let status: PythonVideoUpscaleStatus | undefined;
  const cancelRemote = () => {
    void fetch(`${pythonUpscalerBaseUrl}/upscale/video/clients/${encodeURIComponent(clientId)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    if (status?.id && status.id !== "upload") void fetch(`${pythonUpscalerBaseUrl}/upscale/video/jobs/${encodeURIComponent(status.id)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
  };
  options.signal.addEventListener("abort", cancelRemote, { once: true });
  try {
    status = await uploadVideoJob(form, options.signal, (uploadProgress) => options.onStatus({
      id: "upload", phase: "queued", phaseLabel: usesRemoteUpscaler(effectiveSettings) ? "Verifica sorgente e checkpoint remoti" : "Copia del video nel job locale", progress: uploadProgress * .02,
      currentFrame: 0, totalFrames: 0, tempDirectory: usesRemoteUpscaler(effectiveSettings) ? health.remoteVideoDirectory ?? ".upscaler-cache/remote-video-jobs" : health.videoTempDirectory ?? "temp/upscaler",
      originalFramesDirectory: "", upscaledFramesDirectory: "", uploadProgress
    }));
    reportUpscalerDiagnostic(status.remote && status.currentFrame > 0 ? "remote-job-resumed" : "job-created", { jobId: status.id, phase: status.phase, tempDirectory: status.tempDirectory, completedFrames: status.currentFrame });
    options.onStatus(status);
    let lastLogKey = "";
    while (status.phase !== "ready") {
      if (options.signal.aborted) throw new DOMException("Operazione annullata", "AbortError");
      if (status.phase === "error") throw new Error(`${status.error || "Upscaling video interrotto dal servizio locale."}${status.resumable ? ` I frame completati sono salvati in ${status.upscaledFramesDirectory}; premi di nuovo Esporta per riprendere il job ${status.id}.` : ""}`);
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
    if (blob.size <= 0) throw new Error("Il backend ha dichiarato il job completo ma ha restituito un video vuoto.");
    if (status.resultBytes && blob.size !== status.resultBytes) throw new Error(`Download del risultato incompleto: ricevuti ${blob.size}/${status.resultBytes} byte.`);
    if (status.encodedFrameCount !== status.totalFrames) throw new Error(`Audit MP4 fallito: il file contiene ${status.encodedFrameCount ?? 0}/${status.totalFrames} frame.`);
    if (!status.durationSeconds || !Number.isFinite(status.durationSeconds) || status.durationSeconds <= 0) throw new Error("Audit MP4 fallito: il file non contiene una timeline riproducibile.");
    reportUpscalerDiagnostic("video-export-ready", { jobId: status.id, bytes: blob.size, totalFrames: status.totalFrames, elapsedSeconds: status.elapsedSeconds });
    return { blob, status };
  } finally { options.signal.removeEventListener("abort", cancelRemote); }
}
