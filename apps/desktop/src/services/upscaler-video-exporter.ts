import type { ExportProgress } from "@rbs/export-engine";
import type { RhythmBallProject } from "@rbs/project-schema";
import { ALL_FORMATS, BlobSource, Conversion, EncodedAudioPacketSource, Input, Mp4OutputFormat, Output } from "mediabunny";
import { recordingBitrate, type ExportQuality } from "./live-video-exporter";
import { createUpscalerFrameRenderer } from "./upscaler-renderer";
import { generateAiUpscalerPreview } from "./upscaler-ai";
import { assertStaticWatermarkFrameIntegrity, audit, beginDirectSave, copyOriginalAudio, createTarget, downloadBuffer, fetchVideo, frameCount, safeName, staticWatermarkEncodingError, throwIfAborted, waitWithTimeout } from "./static-watermark-exporter";

type UpscalerSettings = RhythmBallProject["animation"]["upscaler"];
export interface UpscalerVideoExportSettings { projectName: string; quality: ExportQuality; sourceVideoUrl: string; upscalerSettings: UpscalerSettings }
export interface UpscalerVideoExportResult { fileName: string; width: number; height: number; sourceFrameCount: number; encodedFrameCount: number; audioPacketCount: number }

export async function exportUpscaledVideo(settings: UpscalerVideoExportSettings, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<UpscalerVideoExportResult> {
  const width = Math.max(64, Math.min(16384, Math.round(settings.upscalerSettings.finalWidth / 2) * 2)); const height = Math.max(64, Math.min(16384, Math.round(settings.upscalerSettings.finalHeight / 2) * 2));
  const fileName = `${safeName(settings.projectName)}-upscaled-${width}x${height}.mp4`; const handlePromise = beginDirectSave(fileName); const startedAt = performance.now();
  let input: Input | null = null; let output: Output | null = null; let conversion: Conversion | null = null; let target: Awaited<ReturnType<typeof createTarget>> | null = null; let finalized = false; let composed = 0; let sourceFrameCount = 0;
  try {
    throwIfAborted(signal); const [videoBlob, handle] = await Promise.all([fetchVideo(settings.sourceVideoUrl, signal), handlePromise ?? Promise.resolve(null)]);
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoBlob, { maxCacheSize: 32 * 1024 ** 2 }) }); if (!await input.canRead()) throw new Error("Il contenitore video non è supportato.");
    const [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]); if (!videoTrack || !await videoTrack.canDecode()) throw new Error("La traccia video non può essere decodificata su questo dispositivo.");
    const tracks = audioTrack ? [videoTrack, audioTrack] : [videoTrack]; const [sourceWidth, sourceHeight, firstTimestamp, endTimestamp, sourceBitrate] = await Promise.all([videoTrack.getDisplayWidth(), videoTrack.getDisplayHeight(), input.getFirstTimestamp(tracks), input.computeDuration(tracks), videoTrack.getAverageBitrate()]);
    const start = Math.max(0, firstTimestamp); const duration = endTimestamp - start; sourceFrameCount = await frameCount(videoTrack, start, endTimestamp, signal); assertStaticWatermarkFrameIntegrity(sourceFrameCount, sourceFrameCount);
    const fps = sourceFrameCount / duration; const bitrate = Math.round(Math.max(recordingBitrate(width, height, fps, settings.quality), (sourceBitrate ?? 0) * Math.max(1, width * height / Math.max(1, sourceWidth * sourceHeight))));
    target = await createTarget(fileName, handle, bitrate / 8 * duration * 1.12); const sourceCanvas = document.createElement("canvas"); sourceCanvas.width = sourceWidth; sourceCanvas.height = sourceHeight; const sourceContext = sourceCanvas.getContext("2d", { alpha: false });
    const outputCanvas = document.createElement("canvas"); outputCanvas.width = width; outputCanvas.height = height; const outputContext = outputCanvas.getContext("2d", { alpha: false }); if (!sourceContext || !outputContext) throw new Error("Canvas offline non disponibile.");
    const render = createUpscalerFrameRenderer(width, height); output = new Output({ format: new Mp4OutputFormat(), target: target.target }); let lastTimestamp = -Infinity; let audioSource: EncodedAudioPacketSource | null = null;
    if (audioTrack) { const codec = await audioTrack.getCodec(); if (!codec) throw new Error("Codec audio non riconoscibile."); audioSource = new EncodedAudioPacketSource(codec); output.addAudioTrack(audioSource); }
    conversion = await Conversion.init({ input, output, tracks: "primary", trim: { start, end: endTimestamp }, video: { codec: "avc", bitrate, alpha: "discard", keyFrameInterval: 2, hardwareAcceleration: "no-preference", forceTranscode: true, allowRotationMetadata: false, processedWidth: width, processedHeight: height, process: async (sample) => {
      throwIfAborted(signal); if (!Number.isFinite(sample.timestamp) || sample.timestamp + 1e-9 < lastTimestamp) throw new Error(`Timing non valido al frame ${composed + 1}.`); lastTimestamp = sample.timestamp;
      sourceContext.clearRect(0, 0, sourceWidth, sourceHeight); sample.draw(sourceContext, 0, 0, sourceWidth, sourceHeight); const aiFrame = settings.upscalerSettings.model === "canvas" ? null : await generateAiUpscalerPreview(sourceCanvas, settings.upscalerSettings, () => undefined, signal); render(outputContext, sourceCanvas, settings.upscalerSettings, false, aiFrame); composed += 1;
      const elapsedMs = performance.now() - startedAt; onProgress({ currentFrame: composed, totalFrames: sourceFrameCount, progress: composed / sourceFrameCount, elapsedMs, estimatedRemainingMs: composed ? elapsedMs / composed * (sourceFrameCount - composed) : 0 }); return outputCanvas;
    } }, audio: { discard: true }, composable: true, showWarnings: false });
    if (!conversion.isValid || !conversion.utilizedTracks.includes(videoTrack)) throw new Error("L’encoder H.264 non supporta la risoluzione finale selezionata.");
    const abort = () => { void conversion?.cancel(); void output?.cancel(); }; signal.addEventListener("abort", abort, { once: true });
    try {
      await waitWithTimeout(output.start(), 60_000, "L’encoder non è partito entro 60 secondi.", signal); let copiedAudioPackets = 0; const operations: Promise<unknown>[] = [conversion.execute()];
      if (audioTrack && audioSource) operations.push(copyOriginalAudio(audioTrack, audioSource, start, endTimestamp, signal).then((count) => { copiedAudioPackets = count; }));
      const results = await Promise.allSettled(operations); const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected"); if (failure) throw failure.reason;
      assertStaticWatermarkFrameIntegrity(sourceFrameCount, composed); target.prepareCommit(); await waitWithTimeout(output.finalize(), 180_000, "Il contenitore MP4 non ha completato la finalizzazione.", signal);
      const blob = await target.finalBlob(); if (!blob) throw new Error("Impossibile rileggere il video finale."); const checked = await audit(blob, Boolean(audioTrack), signal); assertStaticWatermarkFrameIntegrity(sourceFrameCount, checked.videoFrames); if (audioTrack && checked.audioPackets !== copiedAudioPackets) throw new Error("La verifica della traccia audio non è riuscita.");
      finalized = true; if (target.buffer?.buffer) downloadBuffer(target.buffer.buffer, fileName); else await target.finish(); return { fileName, width, height, sourceFrameCount, encodedFrameCount: checked.videoFrames, audioPacketCount: checked.audioPackets };
    } finally { signal.removeEventListener("abort", abort); }
  } catch (error) { throw staticWatermarkEncodingError(error, composed, sourceFrameCount); }
  finally { input?.dispose(); if (finalized) await target?.cleanup(); else { await conversion?.cancel().catch(() => undefined); await output?.cancel().catch(() => undefined); await target?.abortPartial(); await target?.invalidateFinal().catch(() => undefined); await target?.cleanup(); } }
}
