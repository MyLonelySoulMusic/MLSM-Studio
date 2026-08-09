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
import { createVideoEditorFrameRenderer, type VideoEditorFrameSource } from "./video-editor-renderer";
import { videoEditorSessionFile } from "./video-editor-import";
import { videoEditorInterpolate, videoEditorInterpolationCommand, videoEditorInterpolationHealth, type VideoEditorInterpolationMethod } from "./video-editor-interpolation-client";

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

async function audit(blob: Blob, requireAudio: boolean, signal: AbortSignal): Promise<{ videoFrames: number; audioPackets: number }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob, { maxCacheSize: 8 * 1024 ** 2 }) });
  try {
    throwIfAborted(signal);
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    if (!video) throw new Error("Il file finalizzato non contiene la traccia video.");
    if (requireAudio && !audio) throw new Error("Il file finalizzato non contiene la traccia audio del montaggio.");
    const [videoStats, audioStats] = await Promise.all([video.computePacketStats(Infinity, { skipLiveWait: true }), audio?.computePacketStats(Infinity, { skipLiveWait: true })]);
    return { videoFrames: videoStats.packetCount, audioPackets: audioStats?.packetCount ?? 0 };
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
    const offset = Math.max(0, clip.sourceInSeconds);
    const clipEnd = Math.min(durationSeconds, videoEditorClipEnd(clip));
    const playDuration = Math.max(0, Math.min(clip.durationSeconds, buffer.duration - offset, durationSeconds - clip.startSeconds));
    if (playDuration <= 0) continue;
    const track = settings.tracks.find((item) => item.id === clip.trackId) ?? null;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);
    gain.gain.setValueAtTime(videoEditorClipGain(clip, track, clip.startSeconds), Math.max(0, clip.startSeconds));
    for (let time = clip.startSeconds + ENVELOPE_STEP_SECONDS; time < clipEnd; time += ENVELOPE_STEP_SECONDS) {
      gain.gain.linearRampToValueAtTime(videoEditorClipGain(clip, track, time), time);
    }
    gain.gain.linearRampToValueAtTime(videoEditorClipGain(clip, track, clipEnd), Math.max(0, clipEnd));
    source.start(Math.max(0, clip.startSeconds), offset, playDuration);
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
        onProgress({ currentFrame: encodedFrames, totalFrames, progress: encodedFrames / totalFrames, elapsedMs, estimatedRemainingMs: encodedFrames === totalFrames ? 0 : elapsedMs / encodedFrames * (totalFrames - encodedFrames) });
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

      // L’aumento reale del frame rate è l’ultimo passaggio e agisce su un file già
      // verificato: se il servizio locale manca, il montaggio è comunque consegnato.
      let interpolatedFps: number | null = null;
      let interpolationNote: string | null = null;
      let delivered: Blob | null = null;
      let deliveredName = fileName;
      if (settings.interpolationEnabled && settings.interpolationTargetFps > settings.fps) {
        const health = await videoEditorInterpolationHealth();
        if (!health?.available) interpolationNote = `Servizio di interpolazione non raggiungibile: file consegnato a ${settings.fps} fps. Avvia "${videoEditorInterpolationCommand}" in un secondo terminale e riprova.`;
        else if (settings.interpolationMethod === "rife" && !health.rife) interpolationNote = `Modello RIFE non disponibile sul servizio locale: file consegnato a ${settings.fps} fps.`;
        else if (settings.interpolationMethod !== "rife" && !health.ffmpeg) interpolationNote = `ffmpeg non disponibile sul servizio locale: file consegnato a ${settings.fps} fps.`;
        else {
          try {
            const result = await videoEditorInterpolate({ blob, fileName, sourceFps: settings.fps, targetFps: settings.interpolationTargetFps, method: settings.interpolationMethod, signal });
            const audited = await audit(result.blob, Boolean(mix), signal);
            if (audited.videoFrames <= finalAudit.videoFrames) throw new Error("il file restituito non contiene fotogrammi aggiuntivi");
            delivered = result.blob;
            deliveredName = fileName.replace(/-\d+fps\.mp4$/, `-${result.targetFps}fps.mp4`);
            interpolatedFps = result.targetFps;
            interpolationNote = `Frame rate portato a ${result.targetFps} fps con ${result.backend}: ${audited.videoFrames} fotogrammi verificati.`;
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
