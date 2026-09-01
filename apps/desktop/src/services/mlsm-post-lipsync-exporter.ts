import type { ExportProgress } from "@rbs/export-engine";
import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  CanvasSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  canEncodeVideo
} from "mediabunny";
import { recordingBitrate, type ExportQuality } from "./offline-video-exporter";
import { auditLipsyncRenderPlan, buildLipsyncRenderPlan } from "./mlsm-post-lipsync-render-plan";
import type { MlsmPostLipsyncAnalysis } from "./mlsm-post-lipsync-types";
import {
  audit,
  beginDirectSave,
  createTarget,
  downloadBuffer,
  fetchVideo,
  frameCount,
  safeName,
  staticWatermarkEncodingError,
  throwIfAborted,
  waitWithTimeout
} from "./static-watermark-exporter";

export interface MlsmPostLipsyncExportSettings {
  projectName: string;
  sourceVideoUrl: string;
  targetAudioUrl: string;
  analysis: MlsmPostLipsyncAnalysis;
  quality?: ExportQuality;
}

export interface MlsmPostLipsyncExportResult {
  fileName: string;
  width: number;
  height: number;
  fps: number;
  encodedFrameCount: number;
  audioPacketCount: number;
}

async function fetchMedia(url: string, label: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { signal }).catch((reason: unknown) => {
    if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
    throw new Error(`${label} non è più accessibile. Ricaricalo e riprova.`);
  });
  if (!response.ok) throw new Error(`Impossibile leggere ${label} (HTTP ${response.status}).`);
  const blob = await response.blob();
  if (!blob.size) throw new Error(`${label} è vuoto.`);
  return blob;
}

export function lipsyncExportFps(frameCountValue: number, durationSeconds: number): number {
  if (!Number.isFinite(frameCountValue) || frameCountValue <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Il frame rate del video sorgente non è determinabile.");
  }
  return Math.max(1, Math.min(120, frameCountValue / durationSeconds));
}

export async function exportMlsmPostLipsyncVideo(
  settings: MlsmPostLipsyncExportSettings,
  signal: AbortSignal,
  onProgress: (progress: ExportProgress) => void
): Promise<MlsmPostLipsyncExportResult> {
  const quality = settings.quality ?? "maximum";
  const fileName = `${safeName(settings.projectName)}-post-lipsync.mp4`;
  // Open the native/browser picker synchronously from the Export click.
  const handlePromise = beginDirectSave(fileName);
  const startedAt = performance.now();
  let sourceInput: Input | null = null;
  let targetInput: Input | null = null;
  let output: Output | null = null;
  let conversion: Conversion | null = null;
  let target: Awaited<ReturnType<typeof createTarget>> | null = null;
  let finalized = false;
  let verified = false;
  let encoded = 0;
  let totalFrames = 0;
  try {
    throwIfAborted(signal);
    const [sourceBlob, targetBlob, handle] = await Promise.all([
      fetchVideo(settings.sourceVideoUrl, signal),
      fetchMedia(settings.targetAudioUrl, "il master audio", signal),
      handlePromise ?? Promise.resolve(null)
    ]);
    sourceInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(sourceBlob, { maxCacheSize: 48 * 1024 ** 2 }) });
    targetInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(targetBlob, { maxCacheSize: 24 * 1024 ** 2 }) });
    if (!await sourceInput.canRead()) throw new Error("Il contenitore del video sorgente non è supportato.");
    if (!await targetInput.canRead()) throw new Error("Il contenitore del master audio non è supportato.");
    const [videoTrack, audioTrack] = await Promise.all([sourceInput.getPrimaryVideoTrack(), targetInput.getPrimaryAudioTrack()]);
    if (!videoTrack) throw new Error("Il file sorgente non contiene una traccia video.");
    if (!audioTrack) throw new Error("Il master non contiene una traccia audio.");
    if (!await videoTrack.canDecode()) throw new Error("Il browser non riesce a decodificare il video sorgente.");
    const [width, height, sourceFirstTimestamp, sourceEndTimestamp, targetFirstTimestamp, targetEndTimestamp] = await Promise.all([
      videoTrack.getDisplayWidth(),
      videoTrack.getDisplayHeight(),
      sourceInput.getFirstTimestamp([videoTrack]),
      sourceInput.computeDuration([videoTrack]),
      targetInput.getFirstTimestamp([audioTrack]),
      targetInput.computeDuration([audioTrack])
    ]);
    const sourceStart = Math.max(0, sourceFirstTimestamp);
    const sourceDuration = sourceEndTimestamp - sourceStart;
    const targetStart = Math.max(0, targetFirstTimestamp) + settings.analysis.targetAudioStartSeconds;
    const targetEnd = targetStart + settings.analysis.targetDurationSeconds;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || sourceDuration <= 0) throw new Error("Risoluzione o durata del video sorgente non valida.");
    if (targetEnd > targetEndTimestamp + .05) throw new Error("La porzione del master richiesta dalla time-map supera la durata audio disponibile.");
    const sourceFrames = await frameCount(videoTrack, sourceStart, sourceEndTimestamp, signal);
    const fps = lipsyncExportFps(sourceFrames, sourceDuration);
    const plan = buildLipsyncRenderPlan({
      timeMap: settings.analysis.timeMap,
      sourceFps: fps,
      outputFps: fps,
      targetAudioStartSeconds: settings.analysis.targetAudioStartSeconds
    });
    const planAudit = auditLipsyncRenderPlan(plan);
    if (!planAudit.valid) throw new Error("La time-map modificata non è valida per l’export.");
    totalFrames = plan.samples.length;
    const bitrate = recordingBitrate(width, height, fps, quality);
    const avc = await canEncodeVideo("avc", { width, height, bitrate, latencyMode: "quality", hardwareAcceleration: "prefer-hardware" });
    if (!avc) throw new Error("L’encoder H.264 non supporta la risoluzione originale su questo dispositivo.");
    if (!await canEncodeAudio("aac", { bitrate: 320_000 })) throw new Error("L’encoder AAC non è disponibile su questo dispositivo.");
    target = await createTarget(fileName, handle, bitrate / 8 * plan.outputDurationSeconds * 1.18);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas offline non disponibile.");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    output = new Output({ format: new Mp4OutputFormat(), target: target.target });
    const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate, alpha: "discard", latencyMode: "quality", hardwareAcceleration: "prefer-hardware", keyFrameInterval: 2, contentHint: "motion" });
    output.addVideoTrack(videoSource, { frameRate: fps });
    conversion = await Conversion.init({
      input: targetInput,
      output,
      tracks: "primary",
      trim: { start: targetStart, end: targetEnd },
      video: { discard: true },
      audio: { codec: "aac", bitrate: 320_000, forceTranscode: true },
      composable: true,
      showWarnings: false
    });
    if (!conversion.isValid || !conversion.utilizedTracks.includes(audioTrack)) throw new Error("Il master audio non può essere inserito nell’MP4 finale.");
    const sink = new CanvasSink(videoTrack, { poolSize: 3 });
    const sampleTimes = plan.samples.map((sample) => sourceStart + Math.min(sourceDuration - Number.EPSILON, Math.max(0, sample.sourceTime)));
    const abort = () => { void conversion?.cancel(); void output?.cancel(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      onProgress({ currentFrame: 0, totalFrames, progress: 0, elapsedMs: 0, estimatedRemainingMs: 0 });
      await waitWithTimeout(output.start(), 60_000, "L’encoder LIP SYNC non è partito entro 60 secondi.", signal);
      const audioPromise = conversion.execute();
      let index = 0;
      for await (const decoded of sink.canvasesAtTimestamps(sampleTimes, { skipLiveWait: true })) {
        throwIfAborted(signal);
        const sample = plan.samples[index];
        if (!sample || !decoded) throw new Error(`Il decoder non ha restituito il frame LIP SYNC ${index + 1}.`);
        context.clearRect(0, 0, width, height);
        context.drawImage(decoded.canvas, 0, 0, width, height);
        await waitWithTimeout(videoSource.add(index / fps, sample.durationSeconds), 120_000, `L’encoder è fermo sul frame ${index + 1}.`, signal);
        index += 1; encoded = index;
        const elapsedMs = performance.now() - startedAt;
        onProgress({ currentFrame: encoded, totalFrames, progress: encoded / totalFrames, elapsedMs, estimatedRemainingMs: encoded === totalFrames ? 0 : elapsedMs / encoded * (totalFrames - encoded) });
      }
      videoSource.close();
      await waitWithTimeout(audioPromise, Math.max(300_000, plan.outputDurationSeconds * 4_000), "La codifica del master audio non è terminata.", signal);
      if (encoded !== totalFrames) throw new Error(`Controllo anti-drop fallito: attesi ${totalFrames} frame, codificati ${encoded}.`);
      target.prepareCommit();
      await waitWithTimeout(output.finalize(), 240_000, "La finalizzazione MP4 LIP SYNC non è terminata.", signal);
      finalized = true;
      const blob = await target.finalBlob();
      if (!blob?.size) throw new Error("L’export LIP SYNC non ha prodotto un file verificabile.");
      const finalAudit = await audit(blob, true, signal);
      if (finalAudit.videoFrames !== totalFrames) throw new Error(`Controllo anti-drop finale fallito: attesi ${totalFrames} frame, riletti ${finalAudit.videoFrames}.`);
      if (finalAudit.audioPackets <= 0) throw new Error("Controllo audio fallito: il master non è presente nel file finale.");
      if (target.buffer?.buffer) downloadBuffer(target.buffer.buffer, fileName); else await target.finish();
      verified = true;
      return { fileName, width, height, fps, encodedFrameCount: encoded, audioPacketCount: finalAudit.audioPackets };
    } finally { signal.removeEventListener("abort", abort); }
  } catch (reason) {
    throw staticWatermarkEncodingError(reason, encoded, totalFrames);
  } finally {
    if (!finalized) { await conversion?.cancel().catch(() => undefined); await output?.cancel().catch(() => undefined); await target?.abortPartial(); }
    else if (!verified) await target?.invalidateFinal().catch(() => undefined);
    sourceInput?.dispose(); targetInput?.dispose(); await target?.cleanup();
  }
}
