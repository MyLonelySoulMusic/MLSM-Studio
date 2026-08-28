import type { ExportProgress } from "@rbs/export-engine";
import type { CommentsInvasionSettings } from "@rbs/project-schema";
import {
  ALL_FORMATS, BlobSource, CanvasSink, CanvasSource, Conversion, Input, Mp4OutputFormat, Output,
  QUALITY_HIGH, QUALITY_VERY_HIGH, canEncodeAudio, canEncodeVideo, type Quality
} from "mediabunny";
import type { ExportQuality } from "./offline-video-exporter";
import { recordingBitrate } from "./offline-video-exporter";
import { audit, beginDirectSave, createTarget, downloadBuffer, fetchVideo, safeName, throwIfAborted, waitWithTimeout } from "./static-watermark-exporter";
import { commentsInvasionVisibleIndices, renderCommentsInvasionFrame, type CommentsInvasionImage } from "./comments-invasion-renderer";
import type { CommentsInvasionAsset } from "../store/comments-invasion-store";

export interface CommentsInvasionOfflineExportSettings {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  projectName: string;
  projectSeed: number;
  quality: ExportQuality;
  sourceVideoUrl: string;
  comments: readonly CommentsInvasionAsset[];
  commentsInvasionSettings: CommentsInvasionSettings;
}

export interface CommentsInvasionOfflineExportResult {
  fileName: string;
  width: number;
  height: number;
  fps: number;
  encodedFrameCount: number;
  audioPacketCount: number;
}

interface FrameTiming { timestampSeconds: number; durationSeconds: number; sampleTimeSeconds: number; }

export function commentsInvasionFrameCount(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("La durata del video deve essere maggiore di zero.");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Il frame rate deve essere maggiore di zero.");
  return Math.ceil(durationSeconds * fps);
}

export function commentsInvasionFrameTiming(index: number, durationSeconds: number, fps: number): FrameTiming {
  const total = commentsInvasionFrameCount(durationSeconds, fps); if (!Number.isInteger(index) || index < 0 || index >= total) throw new Error("Indice frame Comments Invasion non valido.");
  const timestampSeconds = index / fps; const frameDuration = Math.min(1 / fps, durationSeconds - timestampSeconds);
  return { timestampSeconds, durationSeconds: frameDuration, sampleTimeSeconds: Math.min(durationSeconds - Number.EPSILON, timestampSeconds + frameDuration / 2) };
}

export function assertCommentsInvasionFrameIntegrity(expected: number, actual: number): void {
  if (expected !== actual) throw new Error(`Controllo anti-drop fallito: attesi ${expected} frame, codificati ${actual}. Il file parziale è stato annullato.`);
}

interface CachedImage { value: CommentsInvasionImage; dispose: () => void; }

class CommentImageCache {
  private readonly loaded = new Map<number, CachedImage>();
  constructor(private readonly assets: readonly CommentsInvasionAsset[]) {}
  private async load(index: number, signal: AbortSignal): Promise<CachedImage> {
    throwIfAborted(signal); const asset = this.assets[index]; if (!asset) throw new Error(`Screenshot commento ${index + 1} non disponibile.`);
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(asset.file);
      if (signal.aborted) { bitmap.close(); throwIfAborted(signal); }
      return { value: { id: asset.id, index, width: asset.width, height: asset.height, image: bitmap }, dispose: () => bitmap.close() };
    }
    return new Promise((resolve, reject) => {
      const image = new Image(); const abort = () => { image.src = ""; reject(new DOMException("Esportazione annullata", "AbortError")); };
      signal.addEventListener("abort", abort, { once: true }); image.onload = () => { signal.removeEventListener("abort", abort); resolve({ value: { id: asset.id, index, width: asset.width, height: asset.height, image }, dispose: () => { image.src = ""; } }); }; image.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error(`Impossibile decodificare ${asset.name}.`)); }; image.src = asset.url;
    });
  }
  async visible(indices: readonly number[], signal: AbortSignal): Promise<CommentsInvasionImage[]> {
    const wanted = new Set(indices); for (const [index, item] of this.loaded) if (!wanted.has(index)) { item.dispose(); this.loaded.delete(index); }
    for (const index of indices) if (!this.loaded.has(index)) this.loaded.set(index, await this.load(index, signal));
    return indices.map((index) => this.loaded.get(index)!.value);
  }
  dispose(): void { for (const item of this.loaded.values()) item.dispose(); this.loaded.clear(); }
}

export async function exportCommentsInvasionOfflineVideo(settings: CommentsInvasionOfflineExportSettings, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<CommentsInvasionOfflineExportResult> {
  if (!settings.comments.length) throw new Error("Carica almeno uno screenshot di commento prima dell’export.");
  const fileName = `${safeName(settings.projectName)}-comments-invasion-${settings.width}x${settings.height}-${settings.fps}fps.mp4`;
  const handlePromise = beginDirectSave(fileName); const quality: Quality = settings.quality === "maximum" ? QUALITY_VERY_HIGH : QUALITY_HIGH; const startedAt = performance.now();
  let input: Input | null = null; let output: Output | null = null; let conversion: Conversion | null = null; let target: Awaited<ReturnType<typeof createTarget>> | null = null; let finalized = false; let verified = false; const imageCache = new CommentImageCache(settings.comments);
  try {
    throwIfAborted(signal); const [sourceBlob, handle, avc] = await Promise.all([fetchVideo(settings.sourceVideoUrl, signal), handlePromise ?? Promise.resolve(null), canEncodeVideo("avc", { width: settings.width, height: settings.height, bitrate: quality, latencyMode: "quality", hardwareAcceleration: "prefer-hardware" })]);
    if (!avc) throw new Error("L’encoder H.264 non supporta la risoluzione scelta su questo dispositivo.");
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(sourceBlob, { maxCacheSize: 32 * 1024 ** 2 }) });
    if (!await input.canRead()) throw new Error("Il contenitore del video sorgente non è supportato.");
    const [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]); if (!videoTrack) throw new Error("Il file caricato non contiene una traccia video utilizzabile.");
    if (!await videoTrack.canDecode()) throw new Error("Il browser non riesce a decodificare la traccia video sorgente.");
    const tracks = audioTrack ? [videoTrack, audioTrack] : [videoTrack];
    const [firstTimestamp, sourceEndTimestamp] = await Promise.all([input.getFirstTimestamp(tracks), input.computeDuration(tracks)]);
    const sourceStartTimestamp = Math.max(0, firstTimestamp); const sourceDuration = sourceEndTimestamp - sourceStartTimestamp; const duration = Math.min(settings.durationSeconds, sourceDuration); const totalFrames = commentsInvasionFrameCount(duration, settings.fps); if (audioTrack && !await canEncodeAudio("aac", { bitrate: 320_000 })) throw new Error("L’encoder AAC non è disponibile su questo dispositivo.");
    const bitrate = recordingBitrate(settings.width, settings.height, settings.fps, settings.quality); target = await createTarget(fileName, handle, bitrate / 8 * duration * 1.15);
    const canvas = document.createElement("canvas"); canvas.width = settings.width; canvas.height = settings.height; const context = canvas.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas offline non disponibile."); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    output = new Output({ format: new Mp4OutputFormat(), target: target.target }); const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: quality, alpha: "discard", latencyMode: "quality", hardwareAcceleration: "prefer-hardware", keyFrameInterval: 2, contentHint: "animation" }); output.addVideoTrack(videoSource, { frameRate: settings.fps });
    if (audioTrack) { conversion = await Conversion.init({ input, output, tracks: "primary", trim: { start: sourceStartTimestamp, end: sourceStartTimestamp + duration }, video: { discard: true }, audio: { codec: "aac", bitrate: 320_000, forceTranscode: true }, composable: true, showWarnings: false }); if (!conversion.isValid || !conversion.utilizedTracks.includes(audioTrack)) throw new Error("La traccia audio originale non può essere codificata."); }
    const timings = Array.from({ length: totalFrames }, (_, index) => commentsInvasionFrameTiming(index, duration, settings.fps)); const sink = new CanvasSink(videoTrack, { poolSize: 3 }); const abort = () => { void conversion?.cancel(); void output?.cancel(); }; signal.addEventListener("abort", abort, { once: true });
    try {
      await waitWithTimeout(output.start(), 60_000, "L’encoder offline non è partito entro 60 secondi.", signal); const audioPromise = conversion?.execute() ?? Promise.resolve(); let encoded = 0; let frameIndex = 0;
      for await (const decoded of sink.canvasesAtTimestamps(timings.map((timing) => sourceStartTimestamp + timing.sampleTimeSeconds), { skipLiveWait: true })) {
        throwIfAborted(signal); const timing = timings[frameIndex]!; if (!decoded) throw new Error(`Il decoder non ha restituito il frame sorgente ${frameIndex + 1}; il file parziale è stato annullato.`); const visibleIndices = commentsInvasionVisibleIndices(timing.sampleTimeSeconds, settings.comments.length, settings.commentsInvasionSettings); const comments = await imageCache.visible(visibleIndices, signal);
        renderCommentsInvasionFrame(canvas, { timeSeconds: timing.sampleTimeSeconds, videoFrame: decoded.canvas, comments, totalComments: settings.comments.length, settings: settings.commentsInvasionSettings, seed: settings.projectSeed });
        await waitWithTimeout(videoSource.add(timing.timestampSeconds, timing.durationSeconds), 120_000, `L’encoder è fermo sul frame ${frameIndex + 1}.`, signal); frameIndex += 1; encoded += 1; const elapsedMs = performance.now() - startedAt; onProgress({ currentFrame: encoded, totalFrames, progress: encoded / totalFrames, elapsedMs, estimatedRemainingMs: encoded === totalFrames ? 0 : elapsedMs / encoded * (totalFrames - encoded) });
      }
      videoSource.close(); await waitWithTimeout(audioPromise, Math.max(300_000, duration * 4_000), "La codifica audio non è terminata.", signal); assertCommentsInvasionFrameIntegrity(totalFrames, encoded); target.prepareCommit(); await waitWithTimeout(output.finalize(), 240_000, "La finalizzazione MP4 non è terminata.", signal); finalized = true;
      const blob = await target.finalBlob(); if (!blob?.size) throw new Error("L’encoder non ha prodotto un file verificabile."); const finalAudit = await audit(blob, Boolean(audioTrack), signal); assertCommentsInvasionFrameIntegrity(totalFrames, finalAudit.videoFrames); if (audioTrack && finalAudit.audioPackets <= 0) throw new Error("Controllo audio fallito: nessun pacchetto nel file finale.");
      if (target.buffer?.buffer) downloadBuffer(target.buffer.buffer, fileName); else await target.finish(); verified = true; return { fileName, width: settings.width, height: settings.height, fps: settings.fps, encodedFrameCount: encoded, audioPacketCount: finalAudit.audioPackets };
    } finally { signal.removeEventListener("abort", abort); }
  } finally {
    imageCache.dispose(); if (!finalized) { await output?.cancel().catch(() => undefined); await target?.abortPartial(); } else if (!verified) await target?.invalidateFinal().catch(() => undefined); input?.dispose(); await target?.cleanup();
  }
}
