import type { ExportProgress } from "@rbs/export-engine";
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  StreamTarget,
  canEncodeAudio,
  canEncodeVideo,
  type Quality,
  type StreamTargetChunk,
  type WrappedCanvas
} from "mediabunny";
import type { ExportQuality } from "./offline-video-exporter";
import {
  videoEditorAsset,
  videoEditorClipEnd,
  videoEditorClipGain,
  videoEditorTimelineDuration,
  videoEditorVisibleLayers,
  type VideoEditorClip,
  type VideoEditorSettings
} from "./video-editor";
import { createVideoEditorFrameRenderer, videoEditorSettingsAtAutomationFrame, type VideoEditorFrameSource } from "./video-editor-renderer";
import { videoEditorSessionFile } from "./video-editor-import";
import { videoEditorInterpolateJob, videoEditorInterpolationCommand, videoEditorInterpolationHealth, type VideoEditorInterpolationJobStatus, type VideoEditorInterpolationMethod } from "./video-editor-interpolation-client";
import { videoEditorClipPlaybackRateAtLocalSeconds, videoEditorClipSourceDuration } from "./video-editor-speed";
import { videoEditorAudioMix, videoEditorDbToGain } from "./video-editor-audio-mix";

export interface VideoEditorOfflineExportSettings {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  projectName: string;
  quality: ExportQuality;
  videoEditorSettings: VideoEditorSettings;
  interpolationEnabled: boolean;
  interpolationTargetFps: number;
  interpolationMethod: VideoEditorInterpolationMethod;
}

export interface VideoEditorOfflineExportResult {
  fileName: string;
  formatLabel: string;
  encodedFrameCount: number;
  audioPacketCount: number;
  width: number;
  height: number;
  fps: number;
  interpolatedFps: number | null;
  interpolationNote: string | null;
}

interface FrameTiming { timestampSeconds: number; durationSeconds: number; sampleTimeSeconds: number }
interface OfflineTarget {
  target: BufferTarget | StreamTarget;
  buffer: BufferTarget | null;
  prepareCommit: () => void;
  abortPartial: () => Promise<void>;
  finalBlob: () => Promise<Blob | null>;
  finish: () => Promise<void>;
  /** Riscrive la destinazione già finalizzata: serve a consegnare il file interpolato al posto dell’originale. */
  rewrite: (blob: Blob) => Promise<boolean>;
  discardFinal: () => Promise<void>;
  cleanup: () => Promise<void>;
}

const BUFFER_LIMIT_BYTES = 512 * 1024 ** 2;
/** Frequenza di campionamento del mixdown: standard di consegna per l’audio compresso. */
const MIX_SAMPLE_RATE = 48_000;
const MIX_CHANNELS = 2;
/** Passo dell’inviluppo audio: 200 punti al secondo rendono ogni dissolvenza continua all’ascolto. */
const ENVELOPE_STEP_SECONDS = .005;
/** Gli effetti spettrali non richiedono 200 aggiornamenti/s: 30 Hz resta fluido e
 * mantiene leggero il grafo anche su montaggi lunghi con molti inviluppi. */
const AUDIO_EFFECT_STEP_SECONDS = 1 / 30;
const INTERPOLATION_FRAME_TOLERANCE = 1;
const INTERPOLATION_FPS_RELATIVE_TOLERANCE = .01;
const INTERPOLATION_DURATION_TOLERANCE_SECONDS = .05;

export interface VideoEditorAudioRatePoint { timeSeconds: number; rate: number }

/** Piecewise-constant playback-rate plan. Each output frame is sampled at its
 * midpoint, exactly like the canonical source-time integration used by video. */
export function videoEditorAudioRateAutomation(clip: VideoEditorClip, settings: VideoEditorSettings, clipEnd: number): VideoEditorAudioRatePoint[] {
  const start = Math.max(0, clip.startSeconds);
  const end = Math.max(start, clipEnd);
  const frameRate = settings.timebase.fpsNumerator / settings.timebase.fpsDenominator;
  const points: VideoEditorAudioRatePoint[] = [];
  const durationFrames = Math.max(0, (end - start) * frameRate);
  if (durationFrames <= 0) return points;
  points.push({ timeSeconds: start, rate: videoEditorClipPlaybackRateAtLocalSeconds(clip, 0, settings.timebase) });
  const origin = clip.speed?.sampleOriginFrame ?? 0;
  for (let frame = Math.floor(origin + 1e-9) + 1 - origin; frame < durationFrames - 1e-12; frame += 1) {
    const timeSeconds = start + frame / frameRate;
    points.push({ timeSeconds, rate: videoEditorClipPlaybackRateAtLocalSeconds(clip, frame / frameRate, settings.timebase) });
  }
  return points;
}

/** Integral of the held audio-rate plan, used to prove parity with the video
 * source mapping and to cover a final partial project frame without overshoot. */
export function videoEditorAudioConsumedSourceSeconds(points: readonly VideoEditorAudioRatePoint[], clipEnd: number): number {
  return points.reduce((total, point, index) => {
    const nextBoundary = points[index + 1]?.timeSeconds ?? clipEnd;
    return total + point.rate * Math.max(0, nextBoundary - point.timeSeconds);
  }, 0);
}

/** Offset nel buffer usato dal mixdown. Un buffer invertito rappresenta il tempo
 * originale `duration - t`, quindi l'attacco è il bordo alto dell'intervallo. */
export function videoEditorAudioSourceOffset(clip: VideoEditorClip, settings: VideoEditorSettings, bufferDuration: number): number {
  if (!clip.reversed) return Math.max(0, Math.min(bufferDuration, clip.sourceInSeconds));
  const sourceEnd = Math.min(bufferDuration, clip.sourceInSeconds + videoEditorClipSourceDuration(clip, settings.timebase));
  return Math.max(0, bufferDuration - sourceEnd);
}

function reversedAudioBuffer(context: OfflineAudioContext, source: AudioBuffer): AudioBuffer {
  const output = context.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const input = source.getChannelData(channel);
    const target = output.getChannelData(channel);
    for (let index = 0; index < input.length; index += 1) target[index] = input[input.length - 1 - index] ?? 0;
  }
  return output;
}

function safeName(value: string): string {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "mlsm-studio";
}

export function videoEditorOfflineFrameCount(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("La durata dell’export deve essere maggiore di zero.");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Il frame rate dell’export deve essere maggiore di zero.");
  return Math.ceil(durationSeconds * fps);
}

export function videoEditorOfflineFrameTiming(frameIndex: number, durationSeconds: number, fps: number): FrameTiming {
  const totalFrames = videoEditorOfflineFrameCount(durationSeconds, fps);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= totalFrames) throw new Error("Indice frame fuori dai limiti dell’export.");
  const timestampSeconds = frameIndex / fps;
  const frameDuration = Math.min(1 / fps, durationSeconds - timestampSeconds);
  return { timestampSeconds, durationSeconds: frameDuration, sampleTimeSeconds: Math.min(durationSeconds - Number.EPSILON, timestampSeconds + frameDuration / 2) };
}

export function assertVideoEditorFrameIntegrity(expected: number, encoded: number): void {
  if (expected !== encoded) throw new Error(`Controllo anti-drop fallito: attesi ${expected} frame, codificati ${encoded}. Il file incompleto non è stato consegnato.`);
}

export function expectedVideoEditorInterpolationFrameCount(sourceFrames: number, sourceFps: number, targetFps: number): number {
  if (!Number.isInteger(sourceFrames) || sourceFrames < 3) throw new Error("Servono almeno tre frame sorgente per verificare l’interpolazione.");
  if (!Number.isFinite(sourceFps) || sourceFps <= 0 || !Number.isFinite(targetFps) || targetFps <= sourceFps) throw new Error("Frame rate non validi per la verifica dell’interpolazione.");
  return Math.floor((sourceFrames - 2) * targetFps / sourceFps) + 1;
}

export function assertVideoEditorInterpolationIntegrity(input: {
  sourceFrames: number;
  sourceFps: number;
  sourceDuration: number;
  outputFrames: number;
  outputFps: number;
  outputDuration: number;
  targetFps: number;
}): void {
  const expectedFrames = expectedVideoEditorInterpolationFrameCount(input.sourceFrames, input.sourceFps, input.targetFps);
  const fpsTolerance = Math.max(.05, input.targetFps * INTERPOLATION_FPS_RELATIVE_TOLERANCE);
  if (!Number.isFinite(input.outputFps) || Math.abs(input.outputFps - input.targetFps) > fpsTolerance) throw new Error(`Frame rate interpolato non valido: ottenuti ${input.outputFps} fps, target ${input.targetFps} fps.`);
  if (!Number.isInteger(input.outputFrames) || input.outputFrames < expectedFrames - INTERPOLATION_FRAME_TOLERANCE) throw new Error(`Conteggio interpolato incompleto: ottenuti ${input.outputFrames} frame, attesi almeno ${expectedFrames - INTERPOLATION_FRAME_TOLERANCE}.`);
  if (!Number.isFinite(input.outputDuration) || input.outputDuration <= 0) throw new Error("Durata del risultato interpolato non valida.");
  const durationTolerance = Math.max(INTERPOLATION_DURATION_TOLERANCE_SECONDS, 2 / input.targetFps);
  const expectedDuration = expectedFrames / input.targetFps;
  if (input.outputDuration + durationTolerance < expectedDuration) throw new Error(`Durata interpolata troncata: ottenuti ${input.outputDuration} s, attesi circa ${expectedDuration} s.`);
  const minimumFromSource = Math.max(0, input.sourceDuration - 2 / input.sourceFps);
  if (input.outputDuration + durationTolerance < minimumFromSource) throw new Error(`Durata interpolata troncata rispetto alla sorgente: ottenuti ${input.outputDuration} s, sorgente ${input.sourceDuration} s.`);
}

export function videoEditorInterpolationExportProgress(status: VideoEditorInterpolationJobStatus & { uploadProgress?: number; downloadProgress?: number }): ExportProgress {
  const phase = status.phase === "uploading" ? "interpolation-upload"
    : status.phase === "downloading" ? "interpolation-download"
      : status.phase === "interpolating" ? "interpolation"
        : status.phase;
  const stageProgress = status.stageProgress === null ? null : status.stageProgress ?? status.progress;
  return {
    currentFrame: status.currentFrame ?? 0,
    totalFrames: status.totalFrames ?? 0,
    progress: stageProgress ?? 0,
    phase,
    stageProgress,
    stageCurrentFrame: status.currentFrame ?? 0,
    stageTotalFrames: status.totalFrames ?? 0,
    ...(status.processedBytes !== undefined || status.bytesProcessed !== undefined ? { processedBytes: status.processedBytes ?? status.bytesProcessed } : {}),
    ...(status.totalBytes !== undefined ? { totalBytes: status.totalBytes } : {}),
    indeterminate: status.indeterminate === true || stageProgress === null,
    elapsedMs: (status.elapsedSeconds ?? 0) * 1_000,
    estimatedRemainingMs: (status.estimatedRemainingSeconds ?? 0) * 1_000
  };
}

function abortError(): DOMException { return new DOMException("Esportazione annullata", "AbortError"); }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw abortError(); }

function waitWithTimeout<T>(promise: Promise<T>, milliseconds: number, message: string, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const timer = window.setTimeout(() => { signal.removeEventListener("abort", abort); reject(new Error(message)); }, milliseconds);
    const abort = () => { window.clearTimeout(timer); reject(abortError()); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => { window.clearTimeout(timer); signal.removeEventListener("abort", abort); resolve(value); }, (error: unknown) => { window.clearTimeout(timer); signal.removeEventListener("abort", abort); reject(error); });
  });
}

function managedStream(raw: FileSystemWritableFileStream): { stream: WritableStream<StreamTargetChunk>; commit: () => void; abort: () => Promise<void> } {
  let commit = false; let terminal: Promise<void> | null = null;
  const abort = () => { commit = false; if (!terminal) terminal = raw.abort ? raw.abort() : raw.close(); return terminal.catch(() => undefined); };
  const close = () => { if (!terminal) terminal = commit ? raw.close() : abort(); return terminal; };
  return { stream: new WritableStream<StreamTargetChunk>({ write: (chunk) => raw.write(chunk as unknown as Blob | BufferSource | string), close, abort }), commit: () => { commit = true; }, abort };
}

interface StreamTargetHooks {
  finalBlob: () => Promise<Blob | null>;
  finish: () => Promise<void>;
  rewrite: (blob: Blob) => Promise<boolean>;
  discardFinal: () => Promise<void>;
  cleanup: () => Promise<void>;
}

function streamTarget(raw: FileSystemWritableFileStream, hooks: StreamTargetHooks): OfflineTarget {
  const managed = managedStream(raw);
  return { target: new StreamTarget(managed.stream, { chunked: true }), buffer: null, prepareCommit: managed.commit, abortPartial: managed.abort, ...hooks };
}

async function createTarget(fileName: string, handle: FileSystemFileHandle | null, estimatedBytes: number): Promise<OfflineTarget> {
  if (handle) {
    try {
      const writable = await handle.createWritable();
      return streamTarget(writable, {
        finalBlob: async () => handle.getFile(),
        finish: async () => undefined,
        // Il file scelto dall’utente viene riscritto con la versione interpolata: resta
        // un solo file, quello che ha chiesto, al frame rate che ha chiesto.
        rewrite: async (blob) => { const replacement = await handle.createWritable(); await replacement.truncate(0); await replacement.write(blob); await replacement.close(); return true; },
        discardFinal: async () => { const invalid = await handle.createWritable(); await invalid.truncate(0); await invalid.close(); },
        cleanup: async () => undefined
      });
    } catch { /* OPFS come fallback progressivo. */ }
  }
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("mlsm-studio-temp", { create: true });
    const tempName = `video-editor-${crypto.randomUUID()}.part`;
    const tempHandle = await directory.getFileHandle(tempName, { create: true });
    const writable = await tempHandle.createWritable();
    let url: string | null = null;
    const download = (blob: Blob, name: string) => { url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); };
    return streamTarget(writable, {
      finalBlob: async () => tempHandle.getFile(),
      finish: async () => { download(await tempHandle.getFile(), fileName); },
      // Il temporaneo non è la consegna: basta scaricare direttamente il file interpolato.
      rewrite: async () => false,
      discardFinal: async () => undefined,
      cleanup: async () => { await directory.removeEntry(tempName).catch(() => undefined); if (url) window.setTimeout(() => URL.revokeObjectURL(url!), 30_000); }
    });
  } catch { /* Buffer limitato come ultima possibilità. */ }
  if (estimatedBytes > BUFFER_LIMIT_BYTES) throw new Error("Export troppo grande per la memoria del browser. Usa Chrome/Edge e scegli direttamente il file di destinazione.");
  const buffer = new BufferTarget();
  return { target: buffer, buffer, prepareCommit: () => undefined, abortPartial: async () => undefined, finalBlob: async () => buffer.buffer ? new Blob([buffer.buffer], { type: "video/mp4" }) : null, finish: async () => undefined, rewrite: async () => false, discardFinal: async () => undefined, cleanup: async () => undefined };
}

function directSave(fileName: string): Promise<FileSystemFileHandle | null> | null {
  if (typeof window.showSaveFilePicker !== "function") return null;
  return window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: "MP4 · H.264/AAC offline", accept: { "video/mp4": [".mp4"] } }] }).catch((error: unknown) => { if (error instanceof DOMException && error.name === "AbortError") throw error; return null; });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function audit(blob: Blob, requireAudio: boolean, signal: AbortSignal): Promise<{ videoFrames: number; videoFps: number; videoDuration: number; audioPackets: number }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob, { maxCacheSize: 8 * 1024 ** 2 }) });
  try {
    throwIfAborted(signal);
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    if (!video) throw new Error("Il file finalizzato non contiene la traccia video.");
    if (requireAudio && !audio) throw new Error("Il file finalizzato non contiene la traccia audio del montaggio.");
    const [videoStats, videoDuration, audioStats] = await Promise.all([video.computePacketStats(Infinity, { skipLiveWait: true }), video.computeDuration({ skipLiveWait: true }), audio?.computePacketStats(Infinity, { skipLiveWait: true })]);
    return { videoFrames: videoStats.packetCount, videoFps: videoStats.averagePacketRate, videoDuration, audioPackets: audioStats?.packetCount ?? 0 };
  } finally { input.dispose(); }
}

/** Byte del media di una clip: prima il file di sessione, poi la URL registrata nel progetto. */
async function assetBlob(url: string, assetId: string, signal: AbortSignal): Promise<Blob> {
  const file = videoEditorSessionFile(assetId);
  if (file) return file;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Impossibile rileggere un media del montaggio (HTTP ${response.status}). Ricaricalo nel pool.`);
  return response.blob();
}

/**
 * Sorgente video di una clip letta in un’unica passata. I fotogrammi richiesti sono già
 * in ordine crescente, quindi il decoder avanza in lockstep col ciclo di export e in
 * memoria resta un solo fotogramma per clip: un montaggio lungo non gonfia la RAM.
 */
interface ClipVideoStream {
  frameIndices: readonly number[];
  iterator: AsyncGenerator<WrappedCanvas | null, void, unknown>;
  position: number;
  current: { frameIndex: number; frame: VideoEditorFrameSource } | null;
}

function decodeImage(blob: Blob, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const url = URL.createObjectURL(blob);
    const image = new Image();
    const settle = (error?: Error) => {
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(image);
    };
    const abort = () => { image.src = ""; settle(abortError() as unknown as Error); };
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => settle();
    image.onerror = () => settle(new Error("Impossibile decodificare un’immagine del montaggio."));
    image.src = url;
  });
}

/**
 * Mixdown audio del montaggio. Ogni media audibile viene decodificato una sola volta e
 * riversato nel bus alla posizione di timeline con il proprio inviluppo: dissolvenze
 * audio, volume di clip e volume di traccia confluiscono nella stessa curva di guadagno,
 * la stessa che si ascolta nella preview.
 */
export async function renderVideoEditorAudioMix(settings: VideoEditorSettings, durationSeconds: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  const audible = settings.clips.filter((clip) => {
    const asset = videoEditorAsset(settings, clip.assetId);
    if (!asset || (asset.kind !== "audio" && !asset.hasAudio)) return false;
    const track = settings.tracks.find((item) => item.id === clip.trackId) ?? null;
    return !clip.muted && !track?.muted && clip.startSeconds < durationSeconds;
  });
  if (!audible.length) return null;
  const context = new OfflineAudioContext({ numberOfChannels: MIX_CHANNELS, length: Math.max(1, Math.ceil(durationSeconds * MIX_SAMPLE_RATE)), sampleRate: MIX_SAMPLE_RATE });
  const decoded = new Map<string, AudioBuffer | null>();
  const reversed = new Map<string, AudioBuffer>();
  let scheduled = 0;
  for (const clip of audible) {
    throwIfAborted(signal);
    const asset = videoEditorAsset(settings, clip.assetId);
    if (!asset) continue;
    if (!decoded.has(asset.id)) {
      try {
        const blob = await assetBlob(asset.url, asset.id, signal);
        decoded.set(asset.id, await context.decodeAudioData(await blob.arrayBuffer()));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        // Un media che non si decodifica resta muto: il resto del mixdown va consegnato.
        decoded.set(asset.id, null);
      }
    }
    const buffer = decoded.get(asset.id);
    if (!buffer) continue;
    const playbackBuffer = clip.reversed
      ? reversed.get(asset.id) ?? (() => { const value = reversedAudioBuffer(context, buffer); reversed.set(asset.id, value); return value; })()
      : buffer;
    const offset = videoEditorAudioSourceOffset(clip, settings, buffer.duration);
    const clipEnd = Math.min(durationSeconds, videoEditorClipEnd(clip));
    const playDuration = Math.max(0, Math.min(clip.durationSeconds, durationSeconds - clip.startSeconds));
    if (playDuration <= 0 || offset >= buffer.duration) continue;
    const track = settings.tracks.find((item) => item.id === clip.trackId) ?? null;
    const source = context.createBufferSource();
    source.buffer = playbackBuffer;
    const rateAutomation = videoEditorAudioRateAutomation(clip, settings, clipEnd);
    for (const point of rateAutomation) source.playbackRate.setValueAtTime(point.rate, point.timeSeconds);
    const lowEq = context.createBiquadFilter();
    lowEq.type = "lowshelf";
    const midEq = context.createBiquadFilter();
    midEq.type = "peaking";
    const highEq = context.createBiquadFilter();
    highEq.type = "highshelf";
    const compressor = context.createDynamicsCompressor();
    const panner = context.createStereoPanner();
    const makeup = context.createGain();
    const gain = context.createGain();
    source.connect(lowEq);
    lowEq.connect(midEq);
    midEq.connect(highEq);
    highEq.connect(compressor);
    compressor.connect(panner);
    panner.connect(makeup);
    makeup.connect(gain);
    gain.connect(context.destination);
    const gainAt = (time: number): number => {
      const snapshot = videoEditorSettingsAtAutomationFrame(settings, time);
      const currentClip = snapshot.clips.find((item) => item.id === clip.id) ?? clip;
      const currentTrack = snapshot.tracks.find((item) => item.id === clip.trackId) ?? track;
      return videoEditorClipGain(currentClip, currentTrack, time);
    };
    gain.gain.setValueAtTime(gainAt(clip.startSeconds), Math.max(0, clip.startSeconds));
    for (let time = clip.startSeconds + ENVELOPE_STEP_SECONDS; time < clipEnd; time += ENVELOPE_STEP_SECONDS) {
      gain.gain.linearRampToValueAtTime(gainAt(time), time);
    }
    gain.gain.linearRampToValueAtTime(gainAt(clipEnd), Math.max(0, clipEnd));
    const scheduleAt = (time: number, initial: boolean) => {
      const snapshot = videoEditorSettingsAtAutomationFrame(settings, time);
      const currentClip = snapshot.clips.find((item) => item.id === clip.id) ?? clip;
      const mix = videoEditorAudioMix(currentClip);
      const schedule = (parameter: AudioParam, value: number) => {
        if (initial) parameter.setValueAtTime(value, time);
        else parameter.linearRampToValueAtTime(value, time);
      };
      schedule(panner.pan, mix.pan);
      const nyquist = context.sampleRate / 2;
      schedule(lowEq.frequency, Math.min(nyquist, mix.eq.lowFrequencyHz));
      schedule(lowEq.gain, mix.eq.enabled ? mix.eq.lowGainDb : 0);
      schedule(midEq.frequency, Math.min(nyquist, mix.eq.midFrequencyHz));
      schedule(midEq.Q, mix.eq.midQ);
      schedule(midEq.gain, mix.eq.enabled ? mix.eq.midGainDb : 0);
      schedule(highEq.frequency, Math.min(nyquist, mix.eq.highFrequencyHz));
      schedule(highEq.gain, mix.eq.enabled ? mix.eq.highGainDb : 0);
      schedule(compressor.threshold, mix.compressor.enabled ? mix.compressor.thresholdDb : 0);
      schedule(compressor.ratio, mix.compressor.enabled ? mix.compressor.ratio : 1);
      schedule(compressor.attack, mix.compressor.enabled ? Math.min(1, mix.compressor.attackMs / 1_000) : 0);
      schedule(compressor.release, mix.compressor.enabled ? Math.min(1, mix.compressor.releaseMs / 1_000) : .01);
      schedule(compressor.knee, mix.compressor.enabled ? mix.compressor.kneeDb : 0);
      schedule(makeup.gain, mix.compressor.enabled ? videoEditorDbToGain(mix.compressor.makeupGainDb) : 1);
    };
    scheduleAt(Math.max(0, clip.startSeconds), true);
    for (let time = clip.startSeconds + AUDIO_EFFECT_STEP_SECONDS; time < clipEnd; time += AUDIO_EFFECT_STEP_SECONDS) scheduleAt(time, false);
    scheduleAt(Math.max(0, clipEnd), false);
    source.start(Math.max(0, clip.startSeconds), offset);
    source.stop(Math.max(0, clip.startSeconds) + playDuration);
    scheduled += 1;
  }
  throwIfAborted(signal);
  return scheduled ? context.startRendering() : null;
}

export async function exportVideoEditorOfflineVideo(settings: VideoEditorOfflineExportSettings, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<VideoEditorOfflineExportResult> {
  const editor = settings.videoEditorSettings;
  const timelineDuration = videoEditorTimelineDuration(editor);
  const duration = Math.min(settings.durationSeconds > 0 ? settings.durationSeconds : timelineDuration, timelineDuration);
  if (duration <= 0) throw new Error("La timeline è vuota: aggiungi almeno una clip prima di esportare.");
  const fileName = `${safeName(settings.projectName)}-video-editor-${settings.width}x${settings.height}-${settings.fps}fps.mp4`;
  const handlePromise = directSave(fileName);
  const quality: Quality = settings.quality === "maximum" ? QUALITY_VERY_HIGH : QUALITY_HIGH;
  const startedAt = performance.now();
  let target: OfflineTarget | null = null;
  let output: Output | null = null;
  let finalized = false;
  let verified = false;
  const inputs: Input[] = [];
  const streams = new Map<string, ClipVideoStream>();
  const images = new Map<string, HTMLImageElement>();

  try {
    throwIfAborted(signal);
    const [avc, handle] = await Promise.all([
      canEncodeVideo("avc", { width: settings.width, height: settings.height, bitrate: quality, latencyMode: "quality", hardwareAcceleration: "prefer-hardware" }),
      handlePromise ?? Promise.resolve(null)
    ]);
    if (!avc) throw new Error("L’encoder H.264 offline non supporta risoluzione e frame rate selezionati su questo dispositivo.");

    const totalFrames = videoEditorOfflineFrameCount(duration, settings.fps);
    const timings = Array.from({ length: totalFrames }, (_, index) => videoEditorOfflineFrameTiming(index, duration, settings.fps));

    // Prima si stabilisce quali fotogrammi servono a ogni clip: un elenco crescente per
    // clip permette al decoder una lettura sequenziale, l’unica praticabile su file lunghi.
    const requests = new Map<string, { clip: VideoEditorClip; timestamps: number[]; frameIndices: number[] }>();
    for (const [frameIndex, timing] of timings.entries()) {
      for (const layer of videoEditorVisibleLayers(editor, timing.sampleTimeSeconds)) {
        const asset = videoEditorAsset(editor, layer.clip.assetId);
        if (!asset || asset.kind === "audio") continue;
        let entry = requests.get(layer.clip.id);
        if (!entry) { entry = { clip: layer.clip, timestamps: [], frameIndices: [] }; requests.set(layer.clip.id, entry); }
        entry.timestamps.push(layer.sourceTimeSeconds);
        entry.frameIndices.push(frameIndex);
      }
    }
    if (!requests.size) throw new Error("Nessuna clip visibile nell’intervallo esportato: controlla tracce nascoste e opacità.");

    for (const entry of requests.values()) {
      throwIfAborted(signal);
      const asset = videoEditorAsset(editor, entry.clip.assetId);
      if (!asset) continue;
      if (asset.kind === "image") {
        if (!images.has(asset.id)) images.set(asset.id, await decodeImage(await assetBlob(asset.url, asset.id, signal), signal));
        continue;
      }
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await assetBlob(asset.url, asset.id, signal), { maxCacheSize: 32 * 1024 ** 2 }) });
      inputs.push(input);
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) throw new Error(`${asset.name}: il file non contiene una traccia video utilizzabile.`);
      streams.set(entry.clip.id, {
        frameIndices: entry.frameIndices,
        iterator: new CanvasSink(videoTrack, { poolSize: 2 }).canvasesAtTimestamps(entry.timestamps, { skipLiveWait: true }),
        position: 0,
        current: null
      });
    }

    const mix = await renderVideoEditorAudioMix(editor, duration, signal);
    if (mix && !await canEncodeAudio("aac", { bitrate: 320_000, numberOfChannels: MIX_CHANNELS, sampleRate: MIX_SAMPLE_RATE })) throw new Error("L’encoder AAC offline non è disponibile su questo dispositivo.");

    target = await createTarget(fileName, handle, settings.width * settings.height * duration * settings.fps * .055);
    const canvas = document.createElement("canvas");
    canvas.width = settings.width;
    canvas.height = settings.height;
    output = new Output({ format: new Mp4OutputFormat(), target: target.target });
    const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: quality, alpha: "discard", latencyMode: "quality", hardwareAcceleration: "prefer-hardware", keyFrameInterval: 2, contentHint: "detail" });
    output.addVideoTrack(videoSource, { frameRate: settings.fps });
    const audioSource = mix ? new AudioBufferSource({ codec: "aac", bitrate: 320_000 }) : null;
    if (audioSource) output.addAudioTrack(audioSource);

    const abort = () => { void output?.cancel(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await waitWithTimeout(output.start(), 60_000, "L’encoder offline non è partito entro 60 secondi.", signal);
      if (audioSource && mix) {
        await waitWithTimeout(audioSource.add(mix), Math.max(120_000, duration * 3_000), "La codifica del mixdown audio non è terminata.", signal);
        audioSource.close();
      }
      const render = createVideoEditorFrameRenderer();
      let encodedFrames = 0;
      for (const [frameIndex, timing] of timings.entries()) {
        throwIfAborted(signal);
        // Ogni sorgente attesa a questo fotogramma avanza di un passo: dopo il ciclo il
        // compositor trova esattamente il fotogramma che le compete.
        for (const stream of streams.values()) {
          if (stream.frameIndices[stream.position] !== frameIndex) continue;
          const next = await waitWithTimeout(stream.iterator.next(), 120_000, `Un media del montaggio non ha fornito il fotogramma ${frameIndex + 1} entro 120 secondi.`, signal);
          stream.position += 1;
          const wrapped = next.done ? null : next.value;
          stream.current = wrapped ? { frameIndex, frame: { width: wrapped.canvas.width, height: wrapped.canvas.height, source: wrapped.canvas } } : null;
        }
        render(canvas, editor, timing.sampleTimeSeconds, (clip) => {
          const stream = streams.get(clip.id);
          if (stream) return stream.current?.frameIndex === frameIndex ? stream.current.frame : null;
          const asset = videoEditorAsset(editor, clip.assetId);
          const image = asset ? images.get(asset.id) : undefined;
          return image && image.naturalWidth > 0 ? { width: image.naturalWidth, height: image.naturalHeight, source: image } : null;
        });
        await waitWithTimeout(videoSource.add(timing.timestampSeconds, timing.durationSeconds), 120_000, `L’encoder è fermo sul frame ${frameIndex + 1}; l’export è stato annullato senza consegnare un file incompleto.`, signal);
        encodedFrames += 1;
        const elapsedMs = performance.now() - startedAt;
        onProgress({ currentFrame: encodedFrames, totalFrames, progress: encodedFrames / totalFrames, phase: "rendering", phaseLabel: "Rendering del montaggio", stageProgress: encodedFrames / totalFrames, stageCurrentFrame: encodedFrames, stageTotalFrames: totalFrames, elapsedMs, estimatedRemainingMs: encodedFrames === totalFrames ? 0 : elapsedMs / encodedFrames * (totalFrames - encodedFrames) });
      }
      videoSource.close();
      assertVideoEditorFrameIntegrity(totalFrames, encodedFrames);
      target.prepareCommit();
      await waitWithTimeout(output.finalize(), 240_000, "La finalizzazione MP4 non è terminata entro 240 secondi.", signal);
      finalized = true;
      const blob = await target.finalBlob();
      if (!blob?.size) throw new Error("L’encoder non ha prodotto un file verificabile.");
      const finalAudit = await audit(blob, Boolean(mix), signal);
      assertVideoEditorFrameIntegrity(totalFrames, finalAudit.videoFrames);
      if (mix && finalAudit.audioPackets <= 0) throw new Error("Controllo audio fallito: nessun pacchetto nel file finale.");
      onProgress({ currentFrame: totalFrames, totalFrames, progress: 1, phase: "verifying", phaseLabel: "Verifica del render base completata", stageProgress: 1, stageCurrentFrame: totalFrames, stageTotalFrames: totalFrames, elapsedMs: performance.now() - startedAt, estimatedRemainingMs: 0 });

      // L’aumento reale del frame rate è l’ultimo passaggio e agisce su un file già
      // verificato: se il servizio locale manca, il montaggio è comunque consegnato.
      let interpolatedFps: number | null = null;
      let interpolationNote: string | null = null;
      let delivered: Blob | null = null;
      let deliveredName = fileName;
      if (settings.interpolationEnabled && settings.interpolationTargetFps > settings.fps) {
        // Reset the visible stage deliberately: the first bar is complete, while
        // interpolation is a separate operation whose progress starts at zero.
        onProgress({ currentFrame: 0, totalFrames: 0, progress: 0, phase: "interpolation", phaseLabel: "Preparazione interpolazione fotogrammi", stageProgress: 0, stageCurrentFrame: 0, stageTotalFrames: 0, elapsedMs: performance.now() - startedAt, estimatedRemainingMs: 0 });
        const health = await videoEditorInterpolationHealth();
        if (!health?.available || health.jobs === false) interpolationNote = `Servizio di interpolazione non raggiungibile: file consegnato a ${settings.fps} fps. Avvia "${videoEditorInterpolationCommand}" in un secondo terminale e riprova.`;
        else if (settings.interpolationMethod === "rife" && !health.rife) interpolationNote = `Modello RIFE non disponibile sul servizio locale: file consegnato a ${settings.fps} fps.`;
        else if (settings.interpolationMethod !== "rife" && !health.ffmpeg) interpolationNote = `ffmpeg non disponibile sul servizio locale: file consegnato a ${settings.fps} fps.`;
        else {
          try {
            const result = await videoEditorInterpolateJob({ blob, fileName, sourceFps: settings.fps, targetFps: settings.interpolationTargetFps, method: settings.interpolationMethod, signal, onStatus: (status) => {
              onProgress(videoEditorInterpolationExportProgress(status));
            } });
            const audited = await audit(result.blob, Boolean(mix), signal);
            assertVideoEditorInterpolationIntegrity({
              sourceFrames: finalAudit.videoFrames, sourceFps: settings.fps, sourceDuration: finalAudit.videoDuration,
              outputFrames: audited.videoFrames, outputFps: audited.videoFps, outputDuration: audited.videoDuration,
              targetFps: settings.interpolationTargetFps
            });
            delivered = result.blob;
            const resultTargetFps = settings.interpolationTargetFps;
            deliveredName = fileName.replace(/-\d+fps\.mp4$/, `-${resultTargetFps}fps.mp4`);
            interpolatedFps = resultTargetFps;
            interpolationNote = `Frame rate portato a ${resultTargetFps} fps con ${result.status.backend ?? "servizio locale"}: ${audited.videoFrames} fotogrammi verificati.`;
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            interpolationNote = `Interpolazione non riuscita (${error instanceof Error ? error.message : "errore sconosciuto"}): file consegnato a ${settings.fps} fps.`;
          }
        }
      }

      if (delivered) {
        // Si prova prima a sostituire il file scelto dall’utente; se la destinazione non
        // lo consente si scarica il file interpolato e il temporaneo viene ripulito.
        if (!await target.rewrite(delivered)) downloadBlob(delivered, deliveredName);
      } else if (target.buffer) downloadBlob(blob, fileName);
      else await target.finish();
      verified = true;
      return {
        fileName: deliveredName,
        formatLabel: interpolatedFps ? `MP4 · H.264/AAC offline verificato · interpolato a ${interpolatedFps} fps` : "MP4 · H.264/AAC offline verificato",
        encodedFrameCount: encodedFrames,
        audioPacketCount: finalAudit.audioPackets,
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        interpolatedFps,
        interpolationNote
      };
    } finally { signal.removeEventListener("abort", abort); }
  } finally {
    if (!finalized) { await output?.cancel().catch(() => undefined); await target?.abortPartial(); }
    else if (!verified) await target?.discardFinal().catch(() => undefined);
    for (const stream of streams.values()) await stream.iterator.return(undefined).catch(() => undefined);
    for (const input of inputs) input.dispose();
    await target?.cleanup();
  }
}
