import type { EnergyFrame } from "@rbs/audio-analysis";
import type { ExportProgress } from "@rbs/export-engine";
import type { RhythmBallProject } from "@rbs/project-schema";
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  StreamTarget,
  canEncodeAudio,
  canEncodeVideo,
  type Quality,
  type StreamTargetChunk
} from "mediabunny";
import type { ExportQuality } from "./offline-video-exporter";
import { resolveCoverSpectrum } from "./cover-spectrum";
import { pixelsSubFontWeight, renderPixelsSubFrame, type PixelsSubRhythmHit } from "./pixels-sub-renderer";

type PixelsSubSettings = RhythmBallProject["animation"]["pixelsSub"];
type SubtitleCue = RhythmBallProject["subtitles"]["cues"][number];

export interface PixelsSubOfflineExportSettings {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  projectName: string;
  quality: ExportQuality;
  audioUrl: string;
  imageUrl: string;
  pixelsSubSettings: PixelsSubSettings;
  subtitleCues: readonly SubtitleCue[];
  subtitlesEnabled: boolean;
  energyFrames: readonly EnergyFrame[];
  rhythmEvents: readonly { timeSeconds: number; strength: number }[];
  rhythmHits: readonly PixelsSubRhythmHit[];
}

export interface PixelsSubOfflineExportResult {
  fileName: string;
  formatLabel: string;
  encodedFrameCount: number;
  audioPacketCount: number;
}

interface FrameTiming { timestampSeconds: number; durationSeconds: number; sampleTimeSeconds: number }
interface OfflineTarget {
  target: BufferTarget | StreamTarget;
  buffer: BufferTarget | null;
  prepareCommit: () => void;
  abortPartial: () => Promise<void>;
  finalBlob: () => Promise<Blob | null>;
  finish: () => Promise<void>;
  discardFinal: () => Promise<void>;
  cleanup: () => Promise<void>;
}

const BUFFER_LIMIT_BYTES = 512 * 1024 ** 2;

function safeName(value: string): string {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "dynamic-sound-animation";
}

export function pixelsSubOfflineFrameCount(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("La durata dell’export deve essere maggiore di zero.");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Il frame rate dell’export deve essere maggiore di zero.");
  return Math.ceil(durationSeconds * fps);
}

export function pixelsSubOfflineFrameTiming(frameIndex: number, durationSeconds: number, fps: number): FrameTiming {
  const totalFrames = pixelsSubOfflineFrameCount(durationSeconds, fps);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= totalFrames) throw new Error("Indice frame fuori dai limiti dell’export.");
  const timestampSeconds = frameIndex / fps;
  const duration = Math.min(1 / fps, durationSeconds - timestampSeconds);
  return { timestampSeconds, durationSeconds: duration, sampleTimeSeconds: Math.min(durationSeconds - Number.EPSILON, timestampSeconds + duration / 2) };
}

export function assertPixelsSubFrameIntegrity(expected: number, encoded: number): void {
  if (expected !== encoded) throw new Error(`Controllo anti-drop fallito: attesi ${expected} frame, codificati ${encoded}. Il file non è stato consegnato.`);
}

export function resolvePixelsSubOfflineRhythmPulse(timeSeconds: number, events: readonly { timeSeconds: number; strength: number }[], fallback: number): number {
  let previous: { timeSeconds: number; strength: number } | undefined;
  for (const event of events) {
    if (event.timeSeconds > timeSeconds) break;
    previous = event;
  }
  return previous ? Math.max(0, Math.min(1, previous.strength * Math.exp(-(timeSeconds - previous.timeSeconds) / .18))) : fallback;
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

function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const image = new Image();
    const abort = () => { image.src = ""; reject(abortError()); };
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => { signal.removeEventListener("abort", abort); resolve(image); };
    image.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error("Impossibile caricare la cover per l’export offline.")); };
    image.src = url;
  });
}

function managedStream(raw: FileSystemWritableFileStream): { stream: WritableStream<StreamTargetChunk>; commit: () => void; abort: () => Promise<void> } {
  let commit = false;
  let terminal: Promise<void> | null = null;
  const abort = () => {
    commit = false;
    if (!terminal) terminal = raw.abort ? raw.abort() : raw.close();
    return terminal.catch(() => undefined);
  };
  const close = () => {
    if (!terminal) terminal = commit ? raw.close() : abort();
    return terminal;
  };
  return {
    stream: new WritableStream<StreamTargetChunk>({
      write: (chunk) => raw.write(chunk as unknown as Blob | BufferSource | string),
      close,
      abort
    }),
    commit: () => { commit = true; },
    abort
  };
}

function streamTarget(raw: FileSystemWritableFileStream, finalBlob: () => Promise<Blob | null>, finish: () => Promise<void>, discardFinal: () => Promise<void>, cleanup: () => Promise<void>): OfflineTarget {
  const managed = managedStream(raw);
  return { target: new StreamTarget(managed.stream, { chunked: true }), buffer: null, prepareCommit: managed.commit, abortPartial: managed.abort, finalBlob, finish, discardFinal, cleanup };
}

async function createTarget(fileName: string, handle: FileSystemFileHandle | null, settings: PixelsSubOfflineExportSettings): Promise<OfflineTarget> {
  if (handle) {
    try {
      const writable = await handle.createWritable();
      return streamTarget(
        writable,
        async () => handle.getFile(),
        async () => undefined,
        async () => {
          const invalid = await handle.createWritable();
          await invalid.truncate(0);
          await invalid.close();
        },
        async () => undefined
      );
    } catch { /* OPFS resta disponibile come fallback progressivo. */ }
  }
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("dynamic-sound-animation-studio-temp", { create: true });
    const tempName = `pixels-subtitles-${crypto.randomUUID()}.part`;
    const tempHandle = await directory.getFileHandle(tempName, { create: true });
    const writable = await tempHandle.createWritable();
    let url: string | null = null;
    return streamTarget(
      writable,
      async () => tempHandle.getFile(),
      async () => {
        const file = await tempHandle.getFile();
        url = URL.createObjectURL(file);
        const link = document.createElement("a"); link.href = url; link.download = fileName; link.click();
      },
      async () => undefined,
      async () => { await directory.removeEntry(tempName).catch(() => undefined); if (url) window.setTimeout(() => URL.revokeObjectURL(url!), 30_000); }
    );
  } catch { /* Buffer limitato come ultima possibilità. */ }

  const estimatedBytes = settings.width * settings.height * settings.durationSeconds * settings.fps * .055;
  if (estimatedBytes > BUFFER_LIMIT_BYTES) throw new Error("Export troppo grande per la memoria del browser. Usa Chrome/Edge e scegli direttamente il file di destinazione.");
  const buffer = new BufferTarget();
  return { target: buffer, buffer, prepareCommit: () => undefined, abortPartial: async () => undefined, finalBlob: async () => buffer.buffer ? new Blob([buffer.buffer], { type: "video/mp4" }) : null, finish: async () => undefined, discardFinal: async () => undefined, cleanup: async () => undefined };
}

function directSave(fileName: string): Promise<FileSystemFileHandle | null> | null {
  if (typeof window.showSaveFilePicker !== "function") return null;
  return window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: "MP4 · H.264/AAC offline", accept: { "video/mp4": [".mp4"] } }] }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  });
}

function downloadBuffer(buffer: ArrayBuffer, fileName: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: "video/mp4" }));
  const link = document.createElement("a"); link.href = url; link.download = fileName; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function audit(blob: Blob, signal: AbortSignal): Promise<{ videoFrames: number; audioPackets: number }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob, { maxCacheSize: 8 * 1024 ** 2 }) });
  try {
    throwIfAborted(signal);
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    if (!video) throw new Error("Il file finalizzato non contiene la traccia video.");
    if (!audio) throw new Error("Il file finalizzato non contiene la traccia audio.");
    const [videoStats, audioStats] = await Promise.all([video.computePacketStats(Infinity, { skipLiveWait: true }), audio.computePacketStats(Infinity, { skipLiveWait: true })]);
    return { videoFrames: videoStats.packetCount, audioPackets: audioStats.packetCount };
  } finally { input.dispose(); }
}

export async function exportPixelsSubOfflineVideo(settings: PixelsSubOfflineExportSettings, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<PixelsSubOfflineExportResult> {
  const fileName = `${safeName(settings.projectName)}-pixels-subtitles-${settings.width}x${settings.height}-${settings.fps}fps.mp4`;
  // Il picker deve aprirsi prima del primo await per conservare l’attivazione utente.
  const handlePromise = directSave(fileName);
  const quality: Quality = settings.quality === "maximum" ? QUALITY_VERY_HIGH : QUALITY_HIGH;
  const startedAt = performance.now();
  let target: OfflineTarget | null = null;
  let output: Output | null = null;
  let conversion: Conversion | null = null;
  let input: Input | null = null;
  let finalized = false;
  let verified = false;
  try {
    throwIfAborted(signal);
    const [avc, aac, handle, image, response] = await Promise.all([
      canEncodeVideo("avc", { width: settings.width, height: settings.height, bitrate: quality, latencyMode: "quality", hardwareAcceleration: "prefer-hardware" }),
      canEncodeAudio("aac", { bitrate: 320_000 }),
      handlePromise ?? Promise.resolve(null),
      loadImage(settings.imageUrl, signal),
      fetch(settings.audioUrl, { signal })
    ]);
    if (!avc) throw new Error("L’encoder H.264 offline non supporta la risoluzione selezionata su questo dispositivo.");
    if (!aac) throw new Error("L’encoder AAC offline non è disponibile su questo dispositivo.");
    if (!response.ok) throw new Error(`Impossibile leggere il brano originale (HTTP ${response.status}).`);
    const audioBlob = await response.blob();
    if (!audioBlob.size) throw new Error("Il file audio caricato è vuoto.");
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(audioBlob, { maxCacheSize: 16 * 1024 ** 2 }) });
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) throw new Error("Il file caricato non contiene una traccia audio utilizzabile.");
    const audioDuration = await audioTrack.computeDuration({ skipLiveWait: true });
    const duration = Math.min(settings.durationSeconds, audioDuration);
    const totalFrames = pixelsSubOfflineFrameCount(duration, settings.fps);
    await document.fonts.load(`${pixelsSubFontWeight(settings.pixelsSubSettings.subtitleFontFamily)} 64px "${settings.pixelsSubSettings.subtitleFontFamily}"`);
    await document.fonts.ready;

    target = await createTarget(fileName, handle, { ...settings, durationSeconds: duration });
    const canvas = document.createElement("canvas"); canvas.width = settings.width; canvas.height = settings.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas offline non disponibile.");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";

    output = new Output({ format: new Mp4OutputFormat(), target: target.target });
    const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: quality, alpha: "discard", latencyMode: "quality", hardwareAcceleration: "prefer-hardware", keyFrameInterval: 2, contentHint: "animation" });
    output.addVideoTrack(videoSource, { frameRate: settings.fps });
    conversion = await Conversion.init({ input, output, tracks: "primary", trim: { start: 0, end: duration }, video: { discard: true }, audio: { codec: "aac", bitrate: 320_000, forceTranscode: true }, composable: true, showWarnings: false });
    if (!conversion.isValid || !conversion.utilizedTracks.includes(audioTrack)) throw new Error("La traccia audio non può essere convertita in AAC senza riproduzione live.");

    const abort = () => { void conversion?.cancel(); void output?.cancel(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await waitWithTimeout(output.start(), 60_000, "L’encoder offline non è partito entro 60 secondi.", signal);
      const audioPromise = conversion.execute();
      let encodedFrames = 0;
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
        throwIfAborted(signal);
        const timing = pixelsSubOfflineFrameTiming(frameIndex, duration, settings.fps);
        const spectrum = resolveCoverSpectrum(settings.energyFrames, timing.sampleTimeSeconds);
        const rhythmPulse = resolvePixelsSubOfflineRhythmPulse(timing.sampleTimeSeconds, settings.rhythmEvents, spectrum.pulse);
        renderPixelsSubFrame(canvas, { timeSeconds: timing.sampleTimeSeconds, audioPulse: spectrum.pulse, rhythmPulse, spectrumBands: spectrum.bands, rhythmHits: settings.rhythmHits, image, cues: settings.subtitlesEnabled ? settings.subtitleCues : [], settings: settings.pixelsSubSettings });
        await waitWithTimeout(videoSource.add(timing.timestampSeconds, timing.durationSeconds), 120_000, `L’encoder è fermo sul frame ${frameIndex + 1}; l’export è stato annullato senza consegnare un file incompleto.`, signal);
        encodedFrames += 1;
        const elapsedMs = performance.now() - startedAt;
        onProgress({ currentFrame: encodedFrames, totalFrames, progress: encodedFrames / totalFrames, elapsedMs, estimatedRemainingMs: encodedFrames === totalFrames ? 0 : elapsedMs / encodedFrames * (totalFrames - encodedFrames) });
      }
      videoSource.close();
      await waitWithTimeout(audioPromise, Math.max(300_000, duration * 4_000), "La codifica audio offline non è terminata.", signal);
      assertPixelsSubFrameIntegrity(totalFrames, encodedFrames);
      target.prepareCommit();
      await waitWithTimeout(output.finalize(), 180_000, "La finalizzazione MP4 non è terminata entro 180 secondi.", signal);
      finalized = true;
      const blob = await target.finalBlob();
      if (!blob?.size) throw new Error("L’encoder non ha prodotto un file verificabile.");
      const finalAudit = await audit(blob, signal);
      assertPixelsSubFrameIntegrity(totalFrames, finalAudit.videoFrames);
      if (finalAudit.audioPackets <= 0) throw new Error("Controllo audio fallito: nessun pacchetto nel file finale.");
      if (target.buffer) downloadBuffer(target.buffer.buffer!, fileName); else await target.finish();
      verified = true;
      return { fileName, formatLabel: "MP4 · H.264/AAC offline", encodedFrameCount: encodedFrames, audioPacketCount: finalAudit.audioPackets };
    } finally { signal.removeEventListener("abort", abort); }
  } finally {
    if (!finalized) { await output?.cancel().catch(() => undefined); await target?.abortPartial(); }
    else if (!verified) await target?.discardFinal().catch(() => undefined);
    input?.dispose();
    await target?.cleanup();
  }
}
