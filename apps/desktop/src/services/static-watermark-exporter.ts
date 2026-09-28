import type { ExportProgress } from "@rbs/export-engine";
import type { RhythmBallProject } from "@rbs/project-schema";
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Conversion,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type InputAudioTrack,
  type StreamTargetChunk
} from "mediabunny";
import type { ExportQuality } from "./offline-video-exporter";
import { recordingBitrate } from "./offline-video-exporter";
import { createStaticWatermarkCompositor } from "./static-watermark-renderer";
import { analyzeStaticWatermarkVideoAlignment, createStaticWatermarkReferenceAligner, frameRatesDiffer } from "./static-watermark-alignment";
import { cleanReferenceTime } from "./static-watermark-time";

type WatermarkSettings = RhythmBallProject["animation"]["staticWatermark"];

export interface StaticWatermarkExportSettings {
  projectName: string;
  quality: ExportQuality;
  sourceVideoUrl: string;
  referenceImageUrl?: string | null;
  referenceVideoUrl?: string | null;
  referenceVideoFile?: Blob | null;
  watermarkSettings: WatermarkSettings;
  suppressDownload?: boolean;
  sourceVideoFile?: Blob | null;
  sourceStartSeconds?: number;
  sourceDurationSeconds?: number;
  onUnstableAlignment?: (warning: StaticWatermarkAlignmentWarning, signal: AbortSignal) => Promise<"continue" | "cancel">;
}

export interface StaticWatermarkAlignmentWarning {
  processedFrames: number;
  totalFrames: number;
  fallbackFrames: number;
  fallbackRatio: number;
}

export interface StaticWatermarkExportResult {
  fileName: string;
  width: number;
  height: number;
  sourceFrameCount: number;
  encodedFrameCount: number;
  audioPacketCount: number;
  blob?: Blob;
}

export interface ExportTarget {
  target: BufferTarget | StreamTarget;
  buffer: BufferTarget | null;
  prepareCommit: () => void;
  abortPartial: () => Promise<void>;
  finalBlob: () => Promise<Blob | null>;
  finish: () => Promise<void>;
  invalidateFinal: () => Promise<void>;
  cleanup: () => Promise<void>;
}

const BUFFER_LIMIT = 384 * 1024 ** 2;

export function safeName(value: string): string { return value.normalize("NFKD").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "dynamic-sound-animation"; }
function abortError(): DOMException { return new DOMException("Esportazione annullata", "AbortError"); }
export function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw abortError(); }

export function waitWithTimeout<T>(promise: Promise<T>, milliseconds: number, message: string, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
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
    image.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error("La fotografia pulita non è più accessibile. Ricaricala e riprova.")); };
    image.src = url;
  });
}

export async function fetchVideo(url: string, signal: AbortSignal, sourceVideoFile?: Blob | null): Promise<Blob> {
  if (sourceVideoFile) {
    if (!sourceVideoFile.size) throw new Error("Il video sorgente è vuoto.");
    return sourceVideoFile;
  }
  const response = await fetch(url, { signal }).catch((error: unknown) => { if (error instanceof DOMException && error.name === "AbortError") throw error; throw new Error("Il video sorgente non è più accessibile. Ricaricalo e riprova."); });
  if (!response.ok) throw new Error(`Impossibile leggere il video sorgente (HTTP ${response.status}).`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("Il video sorgente è vuoto.");
  return blob;
}

function managedStream(raw: FileSystemWritableFileStream): { stream: WritableStream<StreamTargetChunk>; commit: () => void; abort: () => Promise<void> } {
  let commit = false; let terminal: Promise<void> | null = null;
  const abort = () => { commit = false; if (!terminal) terminal = raw.abort ? raw.abort() : raw.close(); return terminal.catch(() => undefined); };
  return {
    stream: new WritableStream<StreamTargetChunk>({
      write: (chunk) => raw.write(chunk as unknown as Blob | BufferSource | string),
      close: () => { if (!terminal) terminal = commit ? raw.close() : abort(); return terminal; },
      abort
    }),
    commit: () => { commit = true; },
    abort
  };
}

function streamTarget(raw: FileSystemWritableFileStream, finalBlob: () => Promise<Blob | null>, finish: () => Promise<void>, invalidateFinal: () => Promise<void>, cleanup: () => Promise<void>): ExportTarget {
  const managed = managedStream(raw);
  return { target: new StreamTarget(managed.stream, { chunked: true }), buffer: null, prepareCommit: managed.commit, abortPartial: managed.abort, finalBlob, finish, invalidateFinal, cleanup };
}

export function beginDirectSave(fileName: string): Promise<FileSystemFileHandle | null> | null {
  if (typeof window.showSaveFilePicker !== "function") return null;
  return window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: "MP4 · H.264 + audio originale", accept: { "video/mp4": [".mp4"] } }] }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  });
}

export async function createTarget(fileName: string, handle: FileSystemFileHandle | null, estimatedBytes: number): Promise<ExportTarget> {
  if (handle) {
    try { const writable = await handle.createWritable(); return streamTarget(writable, async () => handle.getFile(), async () => undefined, async () => { const invalid = await handle.createWritable(); await invalid.truncate(0); await invalid.close(); }, async () => undefined); }
    catch { /* OPFS fallback below. */ }
  }
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("dynamic-sound-animation-studio-temp", { create: true });
    const tempName = `static-watermark-${crypto.randomUUID()}.part`;
    const tempHandle = await directory.getFileHandle(tempName, { create: true });
    const writable = await tempHandle.createWritable(); let url: string | null = null;
    return streamTarget(writable, async () => tempHandle.getFile(), async () => { const file = await tempHandle.getFile(); url = URL.createObjectURL(file); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); }, async () => undefined, async () => { await directory.removeEntry(tempName).catch(() => undefined); if (url) window.setTimeout(() => URL.revokeObjectURL(url!), 30_000); });
  } catch { /* bounded memory fallback below. */ }
  if (estimatedBytes > BUFFER_LIMIT) throw new Error("Il video è troppo grande per la memoria del browser. Usa Chrome/Edge e scegli direttamente il file di destinazione.");
  const buffer = new BufferTarget();
  return { target: buffer, buffer, prepareCommit: () => undefined, abortPartial: async () => undefined, finalBlob: async () => buffer.buffer ? new Blob([buffer.buffer], { type: "video/mp4" }) : null, finish: async () => undefined, invalidateFinal: async () => undefined, cleanup: async () => undefined };
}

export async function frameCount(track: NonNullable<Awaited<ReturnType<Input["getPrimaryVideoTrack"]>>>, start: number, end: number, signal: AbortSignal): Promise<number> {
  const sink = new EncodedPacketSink(track); let count = 0;
  for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) { throwIfAborted(signal); if (packet.timestamp >= start && packet.timestamp < end) count += 1; }
  return count;
}

export async function frameTimestamps(track: NonNullable<Awaited<ReturnType<Input["getPrimaryVideoTrack"]>>>, start: number, end: number, signal: AbortSignal): Promise<number[]> {
  const sink = new EncodedPacketSink(track); const timestamps: number[] = [];
  for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
    throwIfAborted(signal);
    if (packet.timestamp >= start && packet.timestamp < end) timestamps.push(packet.timestamp);
  }
  // Packets arrive in decode order (DTS), not display order (PTS), when the source
  // contains B-frames. Only sort this sampling schedule, never the encoded packets:
  // CanvasSink must decode those in their original order internally.
  return timestamps.sort((a, b) => a - b);
}

export function referenceFrameTimestamps(sourceTimestamps: readonly number[], sourceStart: number, referenceStart: number, offsetSeconds: number): number[] {
  return sourceTimestamps.map(timestamp => referenceStart + (timestamp - sourceStart) + offsetSeconds);
}

export function regularFrameTimestamps(start: number, duration: number, frameRate: number): number[] {
  if (!(duration > 0 && frameRate > 0)) return [];
  const count = Math.max(1, Math.ceil(duration * frameRate - 1e-9));
  return Array.from({ length: count }, (_, index) => start + index / frameRate).filter(timestamp => timestamp < start + duration - 1e-9);
}

export function shouldPromptForUnstableAlignment(processedFrames: number, fallbackFrames: number, alreadyAccepted: boolean): boolean {
  return !alreadyAccepted && processedFrames >= 30 && fallbackFrames / Math.max(1, processedFrames) > .35;
}

export function assertReferenceCoverage(timestamps: readonly number[], start: number, end: number): void {
  if (!timestamps.length || timestamps.some(timestamp => !Number.isFinite(timestamp) || timestamp < start - 1e-6 || timestamp >= end - 1e-6)) {
    throw new Error("Il video pulito non copre l’intero intervallo da esportare con l’offset rilevato. Usa un riferimento più lungo o correggi manualmente l’offset.");
  }
}

export function assertStaticWatermarkFrameIntegrity(expected: number, actual: number): void {
  if (!Number.isInteger(expected) || expected <= 0) throw new Error("Il video sorgente non contiene fotogrammi esportabili.");
  if (expected !== actual) throw new Error(`Controllo anti-drop fallito: attesi ${expected} frame, codificati ${actual}. Il file parziale è stato annullato.`);
}

export async function audit(blob: Blob, requireAudio: boolean, signal: AbortSignal): Promise<{ videoFrames: number; audioPackets: number }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob, { maxCacheSize: 8 * 1024 ** 2 }) });
  try {
    throwIfAborted(signal); const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    if (!video) throw new Error("Il file finalizzato non contiene la traccia video.");
    if (requireAudio && !audio) throw new Error("La traccia audio originale non è presente nel file finalizzato.");
    const [videoStats, audioStats] = await Promise.all([video.computePacketStats(Infinity, { skipLiveWait: true }), audio?.computePacketStats(Infinity, { skipLiveWait: true })]);
    return { videoFrames: videoStats.packetCount, audioPackets: audioStats?.packetCount ?? 0 };
  } finally { input.dispose(); }
}

export async function copyOriginalAudio(track: InputAudioTrack, source: EncodedAudioPacketSource, start: number, end: number, signal: AbortSignal): Promise<number> {
  const sink = new EncodedPacketSink(track);
  const decoderConfig = await track.getDecoderConfig();
  const metadata: EncodedAudioChunkMetadata = decoderConfig ? { decoderConfig } : {};
  let packets = 0;
  try {
    for await (const packet of sink.packets()) {
      throwIfAborted(signal);
      if (packet.timestamp < start || packet.timestamp >= end) continue;
      // MP4 sync flags may incorrectly classify audio as delta, especially after
      // skipping encoder priming or trimming. Ask the audio codec, not the container.
      // This changes metadata only: compressed bytes and audio timing stay intact.
      const type = packet.type === "delta" ? await track.determinePacketType(packet) ?? packet.type : packet.type;
      await source.add(packet.clone({ timestamp: packet.timestamp - start, type }), metadata);
      packets += 1;
    }
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new Error(`Ripristino dell’audio originale non riuscito al pacchetto ${packets + 1}: ${error instanceof Error ? error.message : String(error)}`);
  } finally { source.close(); }
  return packets;
}

export function staticWatermarkEncodingError(error: unknown, currentFrame: number, totalFrames: number): Error {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  const raw = error instanceof Error ? error.message : String(error);
  if (/previous GOP|largest timestamp/i.test(raw)) {
    const position = currentFrame > 0 ? ` al frame ${currentFrame}${totalFrames > 0 ? ` di ${totalFrames}` : ""}` : " durante l’avvio";
    return new Error(`Esportazione interrotta per fotogrammi fuori ordine${position}. Dettaglio tecnico: ${raw}`);
  }
  if (!/encoding error/i.test(raw) && !(error instanceof DOMException && error.name === "EncodingError")) return error instanceof Error ? error : new Error(raw);
  const position = currentFrame > 0 ? ` al frame ${currentFrame}${totalFrames > 0 ? ` di ${totalFrames}` : ""}` : " durante l’avvio";
  return new Error(`L’encoder H.264 del browser si è interrotto${position}. Il file parziale è stato eliminato. Prova il profilo Alta se il video è 4K/60 fps oppure aggiorna Chrome/Edge. Dettaglio WebCodecs: ${raw}.`);
}

export function downloadBuffer(buffer: ArrayBuffer, fileName: string): void { const url = URL.createObjectURL(new Blob([buffer], { type: "video/mp4" })); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000); }

export async function exportStaticWatermarkVideo(settings: StaticWatermarkExportSettings, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<StaticWatermarkExportResult> {
  const fileName = `${safeName(settings.projectName)}-watermark-removed.mp4`;
  const handlePromise = settings.suppressDownload ? null : beginDirectSave(fileName);
  const startedAt = performance.now(); let input: Input | null = null; let referenceInput: Input | null = null; let output: Output | null = null; let conversion: Conversion | null = null; let target: ExportTarget | null = null; let finalized = false; let composed = 0; let sourceFrameCount = 0;
  try {
    throwIfAborted(signal);
    const useVideoReference = settings.watermarkSettings.referenceKind === "video";
    const imageUrl = settings.referenceImageUrl ?? settings.watermarkSettings.referenceImageUrl;
    const referenceVideoUrl = settings.referenceVideoUrl ?? settings.watermarkSettings.referenceVideoUrl;
    if (useVideoReference && !referenceVideoUrl) throw new Error("Carica il video originale pulito prima dell’esportazione.");
    if (!useVideoReference && !imageUrl) throw new Error("Carica la fotografia originale pulita prima dell’esportazione.");
    const [videoBlob, reference, referenceVideoBlob, directHandle] = await Promise.all([
      fetchVideo(settings.sourceVideoUrl, signal, settings.sourceVideoFile),
      useVideoReference ? Promise.resolve(null) : loadImage(imageUrl!, signal),
      useVideoReference ? fetchVideo(referenceVideoUrl!, signal, settings.referenceVideoFile) : Promise.resolve(null),
      handlePromise ?? Promise.resolve(null),
    ]);
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoBlob, { maxCacheSize: 32 * 1024 ** 2 }) });
    if (!await input.canRead()) throw new Error("Il contenitore del video sorgente non è supportato.");
    const [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    if (!videoTrack) throw new Error("Il file caricato non contiene una traccia video.");
    if (!await videoTrack.canDecode()) throw new Error("Il browser non riesce a decodificare la traccia video sorgente.");
    const tracks = audioTrack ? [videoTrack, audioTrack] : [videoTrack];
    const [width, height, firstTimestamp, endTimestamp, averageBitrate, peakBitrate] = await Promise.all([videoTrack.getDisplayWidth(), videoTrack.getDisplayHeight(), input.getFirstTimestamp(tracks), input.computeDuration(tracks), videoTrack.getAverageBitrate(), videoTrack.getBitrate()]);
    const startTimestamp = Math.max(0, firstTimestamp); const fullDuration = endTimestamp - startTimestamp;
    const sourceStartOffset = Math.max(0, Math.min(settings.sourceStartSeconds ?? 0, Math.max(0, fullDuration - 1e-9)));
    const selectedStartTimestamp = startTimestamp + sourceStartOffset;
    const duration = Math.min(fullDuration - sourceStartOffset, Math.max(1e-6, settings.sourceDurationSeconds ?? fullDuration));
    const selectedEndTimestamp = selectedStartTimestamp + duration;
    if (!(width > 0 && height > 0 && duration > 0)) throw new Error("Dimensioni o durata del video sorgente non valide.");
    sourceFrameCount = await frameCount(videoTrack, selectedStartTimestamp, selectedEndTimestamp, signal); assertStaticWatermarkFrameIntegrity(sourceFrameCount, sourceFrameCount);
    const sourceFps = sourceFrameCount / duration; const sourceBitrate = averageBitrate ?? peakBitrate ?? 0;
    const targetBitrate = Math.round(Math.max(recordingBitrate(width, height, sourceFps, settings.quality), sourceBitrate * (settings.quality === "maximum" ? 1.35 : 1.12)));
    target = await createTarget(fileName, directHandle, targetBitrate / 8 * duration * 1.12);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas di composizione offline non disponibile.");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    const compositor = createStaticWatermarkCompositor(width, height);
    output = new Output({ format: new Mp4OutputFormat(), target: target.target }); let lastTimestamp = -Infinity;
    let originalAudioSource: EncodedAudioPacketSource | null = null;
    if (audioTrack) {
      const codec = await audioTrack.getCodec();
      if (!codec) throw new Error("Il codec della traccia audio originale non è riconoscibile.");
      originalAudioSource = new EncodedAudioPacketSource(codec);
      const [name, disposition] = await Promise.all([audioTrack.getName(), audioTrack.getDisposition()]);
      output.addAudioTrack(originalAudioSource, { ...(name ? { name } : {}), disposition });
    }
    if (useVideoReference) {
      if (!referenceVideoBlob || !referenceVideoUrl) throw new Error("Il video originale pulito non è disponibile.");
      referenceInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(referenceVideoBlob, { maxCacheSize: 32 * 1024 ** 2 }) });
      if (!await referenceInput.canRead()) throw new Error("Il contenitore del video pulito non è supportato.");
      const referenceTrack = await referenceInput.getPrimaryVideoTrack();
      if (!referenceTrack) throw new Error("Il video pulito non contiene una traccia video.");
      if (!await referenceTrack.canDecode()) throw new Error("Il browser non riesce a decodificare il video pulito.");
      const [referenceFirst, referenceEnd, nativeTimestamps, referenceStats] = await Promise.all([
        referenceInput.getFirstTimestamp([referenceTrack]),
        referenceInput.computeDuration([referenceTrack]),
        frameTimestamps(videoTrack, selectedStartTimestamp, selectedEndTimestamp, signal),
        referenceTrack.computePacketStats(Infinity, { skipLiveWait: true }),
      ]);
      const referenceDuration = referenceEnd - referenceFirst;
      const referenceFrameRate = referenceStats.packetCount / referenceDuration;
      const differentFrameRates = frameRatesDiffer(sourceFps, referenceFrameRate);
      if (differentFrameRates && !settings.watermarkSettings.frameRateBasis) throw new Error(`I video hanno frame rate diversi (${sourceFps.toFixed(3)} e ${referenceFrameRate.toFixed(3)} fps). Scegli nel pannello quale frame rate mantenere.`);
      const frameRateBasis = differentFrameRates ? settings.watermarkSettings.frameRateBasis! : "source";
      const outputFrameRate = frameRateBasis === "reference" ? referenceFrameRate : sourceFps;
      const timestamps = frameRateBasis === "reference" ? regularFrameTimestamps(selectedStartTimestamp, duration, outputFrameRate) : nativeTimestamps;
      const startsTogether = duration > referenceDuration + Math.max(.05, 1 / Math.max(1, sourceFps));
      let offset = startsTogether && settings.watermarkSettings.autoTemporalAlignment ? 0 : settings.watermarkSettings.referenceTimeOffsetSeconds;
      if (!startsTogether && settings.watermarkSettings.autoTemporalAlignment) {
        const alignment = await analyzeStaticWatermarkVideoAlignment({
          sourceUrl: settings.sourceVideoUrl,
          referenceUrl: referenceVideoUrl,
          region: settings.watermarkSettings.region,
          searchSeconds: settings.watermarkSettings.temporalSearchSeconds,
          signal,
          sourceFile: videoBlob,
          referenceFile: referenceVideoBlob,
          sourceStartSeconds: sourceStartOffset,
        });
        if (alignment.confidence < .55) throw new Error(`Sincronizzazione non affidabile (${Math.round(alignment.confidence * 100)}%). Verifica che i due video mostrino la stessa sequenza oppure imposta manualmente l’offset.`);
        offset = alignment.offsetSeconds;
      }
      if (frameRateBasis === "source") assertStaticWatermarkFrameIntegrity(sourceFrameCount, timestamps.length);
      else { sourceFrameCount = timestamps.length; assertStaticWatermarkFrameIntegrity(sourceFrameCount, sourceFrameCount); }
      // A shorter reference shares the same clock, not the same normalized duration.
      // Decode only covered instants; outside them preserve the original source.
      const referenceTimes = timestamps.map(timestamp => cleanReferenceTime(timestamp - selectedStartTimestamp, offset, referenceDuration));
      const referenceTimestamps = referenceTimes.filter((time): time is number => time !== null).map(time => referenceFirst + time);
      const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: targetBitrate, alpha: "discard", latencyMode: "quality", keyFrameInterval: 2, hardwareAcceleration: "no-preference", contentHint: "detail" });
      output.addVideoTrack(videoSource, { frameRate: outputFrameRate });
      const sourceSink = new CanvasSink(videoTrack, { poolSize: 3 });
      const referenceSink = new CanvasSink(referenceTrack, { poolSize: 3 });
      const sourceIterator = sourceSink.canvasesAtTimestamps(timestamps, { skipLiveWait: true })[Symbol.asyncIterator]();
      const referenceIterator = referenceSink.canvasesAtTimestamps(referenceTimestamps, { skipLiveWait: true })[Symbol.asyncIterator]();
      const aligner = createStaticWatermarkReferenceAligner(width, height);
      const neutralSettings = { ...settings.watermarkSettings, referenceFit: "stretch" as const, referenceScale: 1, referenceOffsetX: 0, referenceOffsetY: 0 };
      let fallbackFrames = 0; let unstableAlignmentAccepted = false;
      const abort = () => { videoSource.close(); void output?.cancel(); }; signal.addEventListener("abort", abort, { once: true });
      try {
        onProgress({ currentFrame: 0, totalFrames: sourceFrameCount, progress: 0, elapsedMs: 0, estimatedRemainingMs: 0 });
        await waitWithTimeout(output.start(), 60_000, "L’encoder non è partito entro 60 secondi.", signal);
        for (let index = 0; index < timestamps.length; index += 1) {
          throwIfAborted(signal);
          const hasReference = referenceTimes[index] !== null;
          const [sourceFrame, referenceFrame] = await Promise.all([sourceIterator.next(), hasReference ? referenceIterator.next() : Promise.resolve(null)]);
          if (sourceFrame.done || !sourceFrame.value) throw new Error(`Il frame sorgente ${index + 1} non è decodificabile.`);
          if (hasReference && (!referenceFrame || referenceFrame.done || !referenceFrame.value)) throw new Error(`Il frame pulito corrispondente al frame ${index + 1} non è decodificabile.`);
          context.clearRect(0, 0, width, height); context.drawImage(sourceFrame.value.canvas, 0, 0, width, height);
          const aligned = referenceFrame?.value ? aligner.align(sourceFrame.value.canvas, referenceFrame.value.canvas, settings.watermarkSettings) : null;
          if (aligned?.usedFallback) fallbackFrames += 1;
          if (settings.watermarkSettings.autoSpatialAlignment && shouldPromptForUnstableAlignment(index + 1, fallbackFrames, unstableAlignmentAccepted)) {
            const warning = { processedFrames: index + 1, totalFrames: sourceFrameCount, fallbackFrames, fallbackRatio: fallbackFrames / (index + 1) };
            const decision = settings.onUnstableAlignment ? await settings.onUnstableAlignment(warning, signal) : "cancel";
            if (decision !== "continue") throw new DOMException("Esportazione interrotta dopo l’avviso di allineamento spaziale.", "AbortError");
            unstableAlignmentAccepted = true;
          }
          if (aligned) compositor.applyPatch(context, aligned.canvas, neutralSettings);
          const timestamp = timestamps[index]! - selectedStartTimestamp;
          const nextTimestamp = index + 1 < timestamps.length ? timestamps[index + 1]! - selectedStartTimestamp : duration;
          const frameDuration = nextTimestamp - timestamp;
          if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp < lastTimestamp || !(frameDuration > 0)) throw new Error(`Timing non valido nel frame sorgente ${index + 1}: ${timestamp} s, precedente ${lastTimestamp} s.`);
          lastTimestamp = timestamp;
          await waitWithTimeout(videoSource.add(timestamp, Math.min(frameDuration, duration - timestamp)), 120_000, `L’encoder è fermo sul frame ${index + 1}.`, signal);
          composed += 1;
          const elapsedMs = performance.now() - startedAt; onProgress({ currentFrame: composed, totalFrames: sourceFrameCount, progress: .94 * composed / sourceFrameCount, phase: "rendering", elapsedMs, estimatedRemainingMs: composed === sourceFrameCount ? 0 : elapsedMs / composed * (sourceFrameCount - composed) });
        }
        videoSource.close();
        let copiedAudioPackets = 0;
        onProgress({ currentFrame: composed, totalFrames: sourceFrameCount, progress: .95, phase: "encoding", phaseLabel: "Ripristino audio originale e chiusura MP4", indeterminate: true, elapsedMs: performance.now() - startedAt, estimatedRemainingMs: 0 });
        if (audioTrack && originalAudioSource) copiedAudioPackets = await copyOriginalAudio(audioTrack, originalAudioSource, selectedStartTimestamp, selectedEndTimestamp, signal);
        throwIfAborted(signal); assertStaticWatermarkFrameIntegrity(sourceFrameCount, composed);
        target.prepareCommit(); await waitWithTimeout(output.finalize(), 180_000, "Il contenitore MP4 non ha completato la finalizzazione.", signal);
        onProgress({ currentFrame: composed, totalFrames: sourceFrameCount, progress: .98, phase: "verifying", phaseLabel: "Verifica del video e dell’audio esportati", indeterminate: true, elapsedMs: performance.now() - startedAt, estimatedRemainingMs: 0 });
        const blob = await target.finalBlob(); if (!blob) throw new Error("Impossibile rileggere il video finalizzato per il controllo anti-drop.");
        const final = await audit(blob, Boolean(audioTrack), signal); assertStaticWatermarkFrameIntegrity(sourceFrameCount, final.videoFrames);
        if (audioTrack && final.audioPackets !== copiedAudioPackets) throw new Error(`Controllo audio fallito: copiati ${copiedAudioPackets} pacchetti, riletti ${final.audioPackets}.`);
        finalized = true;
        if (!settings.suppressDownload) { if (target.buffer?.buffer) downloadBuffer(target.buffer.buffer, fileName); else await target.finish(); }
        onProgress({ currentFrame: composed, totalFrames: sourceFrameCount, progress: 1, phase: "complete", elapsedMs: performance.now() - startedAt, estimatedRemainingMs: 0 });
        return { fileName, width, height, sourceFrameCount, encodedFrameCount: final.videoFrames, audioPacketCount: final.audioPackets, blob };
      } finally { signal.removeEventListener("abort", abort); }
    }
    if (!reference) throw new Error("La fotografia originale pulita non è disponibile.");
    conversion = await Conversion.init({
      input, output, tracks: "primary", trim: { start: selectedStartTimestamp, end: selectedEndTimestamp },
      video: {
        codec: "avc", bitrate: targetBitrate, alpha: "discard", keyFrameInterval: 2, hardwareAcceleration: "no-preference", forceTranscode: true, allowRotationMetadata: false, processedWidth: width, processedHeight: height,
        process: (sample) => {
          throwIfAborted(signal);
          if (!Number.isFinite(sample.timestamp) || !Number.isFinite(sample.duration) || sample.duration <= 0 || sample.timestamp + 1e-9 < lastTimestamp) throw new Error(`Timing non valido nel frame sorgente ${composed + 1}.`);
          lastTimestamp = sample.timestamp; context.clearRect(0, 0, width, height); sample.draw(context, 0, 0, width, height); compositor.applyPatch(context, reference, settings.watermarkSettings); composed += 1;
          const elapsedMs = performance.now() - startedAt; onProgress({ currentFrame: composed, totalFrames: sourceFrameCount, progress: .94 * Math.min(1, composed / sourceFrameCount), phase: "rendering", elapsedMs, estimatedRemainingMs: composed ? elapsedMs / composed * (sourceFrameCount - composed) : 0 });
          return canvas;
        }
      },
      audio: { discard: true },
      composable: true, showWarnings: false
    });
    if (!conversion.isValid || !conversion.utilizedTracks.includes(videoTrack)) throw new Error("L’encoder H.264 non è disponibile per la risoluzione originale del video.");
    const abort = () => { void conversion?.cancel(); void output?.cancel(); }; signal.addEventListener("abort", abort, { once: true });
    try {
      onProgress({ currentFrame: 0, totalFrames: sourceFrameCount, progress: 0, elapsedMs: 0, estimatedRemainingMs: 0 });
      await waitWithTimeout(output.start(), 60_000, "L’encoder non è partito entro 60 secondi.", signal);
      const operations: Array<Promise<unknown>> = [conversion.execute()];
      let copiedAudioPackets = 0;
      if (audioTrack && originalAudioSource) operations.push(copyOriginalAudio(audioTrack, originalAudioSource, selectedStartTimestamp, selectedEndTimestamp, signal).then((count) => { copiedAudioPackets = count; }));
      const results = await Promise.allSettled(operations);
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
      throwIfAborted(signal); assertStaticWatermarkFrameIntegrity(sourceFrameCount, composed);
      onProgress({ currentFrame: composed, totalFrames: sourceFrameCount, progress: .95, phase: "encoding", phaseLabel: "Ripristino audio originale e chiusura MP4", indeterminate: true, elapsedMs: performance.now() - startedAt, estimatedRemainingMs: 0 });
      target.prepareCommit(); await waitWithTimeout(output.finalize(), 180_000, "Il contenitore MP4 non ha completato la finalizzazione.", signal);
      onProgress({ currentFrame: composed, totalFrames: sourceFrameCount, progress: .98, phase: "verifying", phaseLabel: "Verifica del video e dell’audio esportati", indeterminate: true, elapsedMs: performance.now() - startedAt, estimatedRemainingMs: 0 });
      const blob = await target.finalBlob(); if (!blob) throw new Error("Impossibile rileggere il video finalizzato per il controllo anti-drop.");
      const final = await audit(blob, Boolean(audioTrack), signal); assertStaticWatermarkFrameIntegrity(sourceFrameCount, final.videoFrames);
      if (audioTrack && final.audioPackets !== copiedAudioPackets) throw new Error(`Controllo audio fallito: copiati ${copiedAudioPackets} pacchetti, riletti ${final.audioPackets}.`);
      finalized = true;
      if (!settings.suppressDownload) { if (target.buffer?.buffer) downloadBuffer(target.buffer.buffer, fileName); else await target.finish(); }
      onProgress({ currentFrame: composed, totalFrames: sourceFrameCount, progress: 1, phase: "complete", elapsedMs: performance.now() - startedAt, estimatedRemainingMs: 0 });
      return { fileName, width, height, sourceFrameCount, encodedFrameCount: final.videoFrames, audioPacketCount: final.audioPackets, blob };
    } finally { signal.removeEventListener("abort", abort); }
  } catch (error) {
    if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.message.toLowerCase().includes("storage quota"))) throw new Error("Spazio temporaneo del browser insufficiente. Scegli direttamente un file di destinazione con Chrome/Edge oppure libera spazio e riprova.");
    throw staticWatermarkEncodingError(error, composed, sourceFrameCount);
  } finally {
    input?.dispose();
    referenceInput?.dispose();
    if (finalized) await target?.cleanup(); else { await conversion?.cancel().catch(() => undefined); await output?.cancel().catch(() => undefined); await target?.abortPartial(); await target?.invalidateFinal().catch(() => undefined); await target?.cleanup(); }
  }
}

export async function processStaticWatermarkVideo(settings: StaticWatermarkExportSettings, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<StaticWatermarkExportResult & { blob: Blob }> {
  const result = await exportStaticWatermarkVideo({ ...settings, suppressDownload: true }, signal, onProgress);
  if (!result.blob) throw new Error("Watermark Remover non ha prodotto un artifact video.");
  return result as StaticWatermarkExportResult & { blob: Blob };
}
