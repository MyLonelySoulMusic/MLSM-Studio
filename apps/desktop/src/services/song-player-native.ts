import { invoke, isTauri } from "@tauri-apps/api/core";

export interface SongPlayerCapabilities { desktop: boolean; importFullTrack: boolean; analysis: boolean; matching: boolean; download: boolean; vocalSeparation?: boolean; audioExtraction?: boolean; waveformAlignment?: boolean; alignmentRefinement?: boolean; visualSpeech?: boolean; wordTranscription?: boolean; nativeAnalysis?: boolean; nativeMatching?: boolean; reasons: string[]; }
export interface SongPlayerRuntimeSetup { status: "idle" | "installing" | "ready" | "failed"; progress: number; message: string; error: string | null; updatedAtMs: number; }
export type SongPlayerJobKind = "download" | "analyze" | "match" | "separateVocals" | "extractAudio" | "alignWaveform" | "refineAlignment" | "analyzeVisemes" | "transcribeWords";
export interface SongPlayerRefineAnchorRequest { id: string; cueIndex: number; sourceStart: number; sourceCenter: number; sourceEnd: number; targetStart: number; targetCenter: number; targetEnd: number; maxShiftMs: number; }
export interface SongPlayerVisualAnchorRequest { id: string; text: string; canonicalIndex: number; cueIndex: number; sourceStart: number; sourceCenter: number; sourceEnd: number; sourceConfidence: number; }
export type SongPlayerJobRequest =
  | { kind: "download"; youtubeUrl: string }
  | { kind: "analyze"; inputPath: string }
  | { kind: "match"; referencePath: string; targetPath: string }
  | { kind: "separateVocals"; inputPath: string; startSeconds?: number; endSeconds?: number }
  | { kind: "extractAudio"; inputPath: string }
  | { kind: "alignWaveform"; sourcePath: string; targetPath: string }
  | { kind: "refineAlignment"; sourcePath: string; targetPath: string; anchors: SongPlayerRefineAnchorRequest[] }
  | { kind: "analyzeVisemes"; inputPath: string; anchors: SongPlayerVisualAnchorRequest[]; language: string }
  | { kind: "transcribeWords"; inputPath: string; language: string; model: string; startSeconds?: number; endSeconds?: number };
export interface SongPlayerJobSnapshot { jobId: string; kind?: SongPlayerJobKind; status: "queued" | "running" | "completed" | "succeeded" | "failed" | "cancelled"; stage?: string | null; progress?: number; message?: string | null; result?: Record<string, unknown> | null; error?: { code?: string; message?: string } | string | null; createdAtMs?: number; updatedAtMs?: number; }
export type SongPlayerJobEvent = SongPlayerJobSnapshot;
export interface SongPlayerDownloadResult { kind: "download"; path: string; sourceUrl: string; videoId: string | null; title: string | null; }
export interface SongPlayerMatchResult { kind: "match"; status: "matched" | "ambiguous" | "unrelated"; offsetMs: number; confidence: number; candidates: Array<{ offsetMs: number; score: number }>; }
type Listener = (event: SongPlayerJobEvent) => void;
const listeners = new Map<string, Set<Listener>>();
let activeNativeJobId: string | null = null;
const activityListeners = new Set<(active: boolean) => void>();
function setActiveNativeJob(jobId: string | null): void { const wasActive = Boolean(activeNativeJobId); activeNativeJobId = jobId; if (wasActive !== Boolean(jobId)) activityListeners.forEach((listener) => listener(Boolean(jobId))); }
export function hasActiveSongPlayerNativeJob(): boolean { return Boolean(activeNativeJobId); }
export function subscribeSongPlayerNativeActivity(listener: (active: boolean) => void): () => void { activityListeners.add(listener); return () => activityListeners.delete(listener); }
const invokeTauri = <T>(command: string, args?: Record<string, unknown>): Promise<T> => invoke<T>(command, args);
function snapshot(value: unknown): SongPlayerJobSnapshot {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const status = source.status; const normalized: SongPlayerJobSnapshot["status"] = status === "queued" || status === "running" || status === "completed" || status === "succeeded" || status === "failed" || status === "cancelled" ? status : "failed";
  const kind = source.kind === "download" || source.kind === "analyze" || source.kind === "match" || source.kind === "separateVocals" || source.kind === "extractAudio" || source.kind === "alignWaveform" || source.kind === "refineAlignment" || source.kind === "analyzeVisemes" || source.kind === "transcribeWords" ? source.kind : null;
  return { jobId: typeof source.jobId === "string" ? source.jobId : typeof source.id === "string" ? source.id : "", ...(kind ? { kind } : {}), status: normalized, stage: typeof source.stage === "string" ? source.stage : null, progress: typeof source.progress === "number" ? Math.max(0, Math.min(1, source.progress)) : 0, message: typeof source.message === "string" ? source.message : null, result: source.result && typeof source.result === "object" ? source.result as Record<string, unknown> : null, error: source.error as SongPlayerJobSnapshot["error"] ?? null, ...(typeof source.createdAtMs === "number" ? { createdAtMs: source.createdAtMs } : {}), ...(typeof source.updatedAtMs === "number" ? { updatedAtMs: source.updatedAtMs } : {}) };
}
export function decodeSongPlayerTerminalResult(kind: SongPlayerJobKind, value: unknown): SongPlayerDownloadResult | SongPlayerMatchResult | Record<string, unknown> {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : null; if (!source) throw new Error("Il worker Song Player ha restituito un risultato non valido.");
  if (kind === "analyze" || kind === "separateVocals" || kind === "extractAudio" || kind === "alignWaveform" || kind === "refineAlignment" || kind === "analyzeVisemes" || kind === "transcribeWords") return source;
  if (kind === "download") { const path = typeof source.path === "string" ? source.path : typeof source.outputPath === "string" ? source.outputPath : typeof source.targetPath === "string" ? source.targetPath : null; const sourceUrl = typeof source.youtubeUrl === "string" ? source.youtubeUrl : null; if (!path || !sourceUrl) throw new Error("Il download Song Player non contiene percorso e URL canonico validi."); return { kind, path, sourceUrl, videoId: typeof source.videoId === "string" ? source.videoId : null, title: typeof source.title === "string" ? source.title : null }; }
  const offsetValue = typeof source.offsetMs === "number" ? source.offsetMs : typeof source.offsetSeconds === "number" ? source.offsetSeconds * 1000 : null; const status = source.status; const confidenceValue = typeof source.confidence === "number" ? source.confidence : typeof source.similarity === "number" ? source.similarity : null;
  if (offsetValue === null || !Number.isFinite(offsetValue) || offsetValue < 0 || (status !== "matched" && status !== "ambiguous" && status !== "unrelated") || confidenceValue === null || !Number.isFinite(confidenceValue)) throw new Error("Il matching Song Player ha restituito un risultato incompleto o non valido.");
  const candidates = Array.isArray(source.candidates) ? source.candidates.flatMap((candidate) => { if (!candidate || typeof candidate !== "object") return []; const item = candidate as Record<string, unknown>; const offset = typeof item.offsetMs === "number" ? item.offsetMs : typeof item.offsetSeconds === "number" ? item.offsetSeconds * 1000 : null; const score = typeof item.score === "number" ? item.score : typeof item.similarity === "number" ? item.similarity : null; return offset !== null && Number.isFinite(offset) && offset >= 0 && score !== null && Number.isFinite(score) ? [{ offsetMs: Math.round(offset), score: Math.max(0, Math.min(1, score)) }] : []; }).slice(0, 5) : [];
  return { kind, status, offsetMs: Math.round(offsetValue), confidence: Math.max(0, Math.min(1, confidenceValue)), candidates };
}
export async function getSongPlayerCapabilities(): Promise<SongPlayerCapabilities> {
  if (!isTauri()) return { desktop: false, importFullTrack: true, analysis: true, matching: true, download: false, vocalSeparation: true, audioExtraction: false, alignmentRefinement: false, nativeAnalysis: false, nativeMatching: false, reasons: ["Analisi FFT, matching e separazione vocale Demucs funzionano tramite i servizi locali integrati."] };
  try {
    const raw = await invokeTauri<Record<string, unknown>>("song_player_capabilities");
    const features = raw.features && typeof raw.features === "object" ? raw.features as Record<string, unknown> : raw;
    const reasons = Array.isArray(raw.reasons) ? raw.reasons.filter((reason): reason is string => typeof reason === "string") : typeof raw.reason === "string" ? [raw.reason] : [];
    const runtimeReady = raw.runtimeReady !== false && raw.workerReady !== false;
    const nativeAnalysis = runtimeReady && (features.analyze === true || raw.analysis === true); const nativeMatching = runtimeReady && (features.match === true || raw.matching === true);
    return { desktop: true, importFullTrack: raw.importFullTrack !== false, analysis: true, matching: true, download: runtimeReady && (features.download === true || raw.download === true), vocalSeparation: runtimeReady && features.separateVocals === true, audioExtraction: runtimeReady && features.extractAudio === true, waveformAlignment: runtimeReady && features.alignWaveform === true, alignmentRefinement: runtimeReady && features.refineAlignment === true, visualSpeech: runtimeReady && features.analyzeVisemes === true, wordTranscription: runtimeReady && features.transcribeWords === true, nativeAnalysis, nativeMatching, reasons };
  } catch { return { desktop: true, importFullTrack: true, analysis: true, matching: true, download: false, vocalSeparation: false, audioExtraction: false, alignmentRefinement: false, nativeAnalysis: false, nativeMatching: false, reasons: ["Worker Song Player non disponibile: analisi e matching useranno il fallback FFT locale."] }; }
}
function runtimeSetup(value: unknown): SongPlayerRuntimeSetup { const source=value&&typeof value==="object"?value as Record<string,unknown>:{};const status=source.status;return{status:status==="idle"||status==="installing"||status==="ready"||status==="failed"?status:"failed",progress:typeof source.progress==="number"?Math.max(0,Math.min(100,source.progress)):0,message:typeof source.message==="string"?source.message:"Stato runtime non disponibile",error:typeof source.error==="string"?source.error:null,updatedAtMs:typeof source.updatedAtMs==="number"?source.updatedAtMs:Date.now()}; }
export async function ensureSongPlayerRuntime():Promise<SongPlayerRuntimeSetup>{if(!isTauri())throw new Error("L’installazione automatica del runtime vocale richiede l’app desktop.");return runtimeSetup(await invokeTauri("song_player_ensure_runtime"));}
export async function getSongPlayerRuntimeSetup():Promise<SongPlayerRuntimeSetup>{if(!isTauri())throw new Error("Runtime vocale non disponibile nel browser.");return runtimeSetup(await invokeTauri("song_player_get_runtime_setup"));}
export async function startSongPlayerJob(request: SongPlayerJobRequest): Promise<SongPlayerJobSnapshot> {
  if (!isTauri()) throw new Error("native_feature_unavailable");
  if (activeNativeJobId) throw new Error("Un job Song Player è già in corso."); setActiveNativeJob("starting");
  try { const result = snapshot(await invokeTauri<unknown>("song_player_start_job", { request })); setActiveNativeJob(isSongPlayerJobTerminal(result.status) ? null : result.jobId || null); return result; } catch (error) { setActiveNativeJob(null); throw error; }
}
export async function getSongPlayerJob(jobId: string): Promise<SongPlayerJobSnapshot> {
  if (!isTauri()) throw new Error("native_feature_unavailable");
  try {
    const result = snapshot(await invokeTauri("song_player_get_job", { jobId })); if (activeNativeJobId === jobId && isSongPlayerJobTerminal(result.status)) setActiveNativeJob(null); return result;
  } catch (error) {
    // A failed poll is terminal from the frontend's point of view. Best-effort
    // cancellation prevents an orphan native worker, while the facade lease is
    // always released even if the cancellation command fails too.
    await cancelSongPlayerJob(jobId).catch(() => undefined);
    throw error;
  }
}
export async function cancelSongPlayerJob(jobId: string): Promise<void> {
  try { if (isTauri()) await invokeTauri("song_player_cancel_job", { jobId }); }
  finally { if (activeNativeJobId === jobId) setActiveNativeJob(null); }
}
export function isSongPlayerJobTerminal(status: SongPlayerJobSnapshot["status"]): boolean { return status === "completed" || status === "succeeded" || status === "failed" || status === "cancelled"; }
export async function waitForSongPlayerJob(jobId: string, options: { signal?: AbortSignal; pollMs?: number; onSnapshot?: (snapshot: SongPlayerJobSnapshot) => void } = {}): Promise<SongPlayerJobSnapshot> {
  const pollMs = Math.max(25, options.pollMs ?? 250);
  try {
    while (true) {
      if (options.signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
      const next = await getSongPlayerJob(jobId); options.onSnapshot?.(next);
      if (isSongPlayerJobTerminal(next.status)) return next;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { globalThis.clearTimeout(timer); reject(new DOMException("Operazione annullata", "AbortError")); };
        const timer = globalThis.setTimeout(() => { options.signal?.removeEventListener("abort", abort); resolve(); }, pollMs);
        options.signal?.addEventListener("abort", abort, { once: true });
      });
    }
  } catch (error) {
    if (activeNativeJobId === jobId) await cancelSongPlayerJob(jobId).catch(() => undefined);
    throw error;
  }
}
export function emitSongPlayerJobEvent(value: unknown): void { const event = snapshot(value); if (!event.jobId) return; listeners.get(event.jobId)?.forEach((listener) => listener(event)); }
export function subscribeSongPlayerJob(jobId: string, listener: Listener): () => void { const current = listeners.get(jobId) ?? new Set<Listener>(); current.add(listener); listeners.set(jobId, current); return () => { current.delete(listener); if (!current.size) listeners.delete(jobId); }; }
