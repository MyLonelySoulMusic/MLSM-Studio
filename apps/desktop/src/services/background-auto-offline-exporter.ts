import type { EnergyFrame } from "@rbs/audio-analysis";
import type { ExportProgress } from "@rbs/export-engine";
import type { RhythmBallProject } from "@rbs/project-schema";
import { ALL_FORMATS, BlobSource, BufferTarget, CanvasSource, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_VERY_HIGH, canEncodeAudio, canEncodeVideo, type Quality } from "mediabunny";
import type { ExportQuality } from "./offline-video-exporter";
import { resolveCoverSpectrum } from "./cover-spectrum";
import { backgroundAutoConfigurationError, backgroundAutoOutputDimensions, normalizeBackgroundAutoProjectSeed, renderBackgroundAutoFrame } from "./background-auto-renderer";

type Settings = RhythmBallProject["animation"]["backgroundAuto"];
export interface BackgroundAutoOfflineExportSettings {
  width: number; height: number; fps: number; durationSeconds: number; projectName: string; projectSeed: number; quality: ExportQuality; audioUrl: string; imageUrl: string; backgroundAutoSettings: Settings; energyFrames: readonly EnergyFrame[];
  subtitleCues?: RhythmBallProject["subtitles"]["cues"];
  proSubtitlesSettings?: RhythmBallProject["animation"]["proSubtitles"];
}
export interface BackgroundAutoOfflineExportResult { fileName: string; formatLabel: string; encodedFrameCount: number; audioPacketCount: number; width: number; height: number; fps: number }

export function backgroundAutoOfflineFrameCount(durationSeconds: number, fps: number): number { if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Export duration must be greater than zero."); if (!Number.isFinite(fps) || fps <= 0) throw new Error("Export frame rate must be greater than zero."); return Math.ceil(durationSeconds * fps); }
export function backgroundAutoOfflineFrameTiming(frameIndex: number, durationSeconds: number, fps: number) { const total = backgroundAutoOfflineFrameCount(durationSeconds, fps); if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= total) throw new Error("Export frame index is out of range."); const timestampSeconds = frameIndex / fps; const duration = Math.min(1 / fps, durationSeconds - timestampSeconds); return { timestampSeconds, durationSeconds: duration, sampleTimeSeconds: Math.min(durationSeconds - Number.EPSILON, timestampSeconds + duration / 2) }; }
function abortError(): DOMException { return new DOMException("Export cancelled", "AbortError"); }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw abortError(); }
function safeName(value: string): string { return value.normalize("NFKD").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "mlsm-studio"; }
function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> { return new Promise((resolve, reject) => { if (signal.aborted) { reject(abortError()); return; } const image = new Image(); const abort = () => { image.src = ""; reject(abortError()); }; signal.addEventListener("abort", abort, { once: true }); image.onload = () => { signal.removeEventListener("abort", abort); resolve(image); }; image.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error("Unable to load the image for export.")); }; image.src = url; }); }

const BUFFER_LIMIT_BYTES = 512 * 1024 ** 2;
export function estimateBackgroundAutoBufferBytes(width: number, height: number, fps: number, durationSeconds: number, quality: ExportQuality): number {
  const videoBytes = width * height * fps * durationSeconds * (quality === "maximum" ? .04 : .025);
  return Math.ceil(videoBytes + durationSeconds * 40_000);
}

export async function exportBackgroundAutoOfflineVideo(settings: BackgroundAutoOfflineExportSettings, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<BackgroundAutoOfflineExportResult> {
  throwIfAborted(signal);
  const sourceWidth = settings.backgroundAutoSettings.sourceWidth; const sourceHeight = settings.backgroundAutoSettings.sourceHeight;
  const effectiveDimensions = backgroundAutoOutputDimensions(sourceWidth, sourceHeight, settings.width, settings.height); const width = effectiveDimensions.width; const height = effectiveDimensions.height;
  const fileName = `${safeName(settings.projectName)}-background-auto-${width}x${height}-${settings.fps}fps.mp4`;
  const configurationError = backgroundAutoConfigurationError(settings.backgroundAutoSettings); if (configurationError) throw new Error(configurationError);
  const quality: Quality = settings.quality === "maximum" ? QUALITY_VERY_HIGH : QUALITY_HIGH;
  let input: Input | null = null; let output: Output | null = null; let conversion: Conversion | null = null; let source: CanvasSource | null = null; let audioPromise: Promise<void> | null = null; let sourceClosed = false; let finalized = false;
  const abort = () => { void conversion?.cancel(); void output?.cancel(); }; signal.addEventListener("abort", abort, { once: true });
  try {
    const [videoCapable, audioCapable, image, response] = await Promise.all([canEncodeVideo("avc", { width, height, bitrate: quality, latencyMode: "quality", hardwareAcceleration: "prefer-hardware" }), canEncodeAudio("aac", { bitrate: 320_000 }), loadImage(settings.imageUrl, signal), fetch(settings.audioUrl, { signal })]);
    if (!videoCapable) throw new Error("The offline H.264 encoder does not support the selected resolution."); if (!audioCapable) throw new Error("The offline AAC encoder is unavailable."); if (!response.ok) throw new Error(`Unable to read the original audio (HTTP ${response.status}).`);
    if (image.naturalWidth !== sourceWidth || image.naturalHeight !== sourceHeight) throw new Error(`Image dimensions (${image.naturalWidth}×${image.naturalHeight}) do not match the saved source (${sourceWidth}×${sourceHeight}). Reload the image and run detection again.`);
    const audioBlob = await response.blob(); input = new Input({ formats: ALL_FORMATS, source: new BlobSource(audioBlob) }); const audioTrack = await input.getPrimaryAudioTrack(); if (!audioTrack) throw new Error("The audio file has no usable track.");
    const duration = Math.min(settings.durationSeconds, await audioTrack.computeDuration({ skipLiveWait: true }));
    if (estimateBackgroundAutoBufferBytes(width, height, settings.fps, duration, settings.quality) > BUFFER_LIMIT_BYTES) throw new Error("The export is too large for browser memory. Reduce the duration, resolution, or frame rate.");
    const totalFrames = backgroundAutoOfflineFrameCount(duration, settings.fps); const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const target = new BufferTarget(); output = new Output({ format: new Mp4OutputFormat(), target }); source = new CanvasSource(canvas, { codec: "avc", bitrate: quality, alpha: "discard", latencyMode: "quality", hardwareAcceleration: "prefer-hardware", keyFrameInterval: 2, contentHint: "animation" }); output.addVideoTrack(source, { frameRate: settings.fps }); conversion = await Conversion.init({ input, output, tracks: "primary", trim: { start: 0, end: duration }, video: { discard: true }, audio: { codec: "aac", bitrate: 320_000, forceTranscode: true }, composable: true, showWarnings: false }); if (!conversion.isValid) throw new Error("The audio track cannot be converted to AAC.");
    const startedAt = performance.now(); let encoded = 0; await output.start(); audioPromise = conversion.execute();
    // Registra subito un rejection handler: il loop video può fallire prima del
    // primo await della conversione audio. La promise originale resta awaitable
    // e conserva il proprio errore per il percorso principale/di cleanup.
    void audioPromise.catch(() => undefined);
    for (let index = 0; index < totalFrames; index += 1) { throwIfAborted(signal); const timing = backgroundAutoOfflineFrameTiming(index, duration, settings.fps); const spectrum = resolveCoverSpectrum(settings.energyFrames, timing.sampleTimeSeconds); renderBackgroundAutoFrame({ canvas, image, settings: settings.backgroundAutoSettings, timeSeconds: timing.sampleTimeSeconds, spectrumBands: spectrum.bands, audioPulse: spectrum.pulse, stereoLeftBands: spectrum.leftBands, stereoRightBands: spectrum.rightBands, stereoLeftPulse: spectrum.leftPulse, stereoRightPulse: spectrum.rightPulse, ...(settings.subtitleCues ? { subtitleCues: settings.subtitleCues } : {}), ...(settings.proSubtitlesSettings ? { proSubtitlesSettings: settings.proSubtitlesSettings } : {}), seed: normalizeBackgroundAutoProjectSeed(settings.projectSeed) }); await source.add(timing.timestampSeconds, timing.durationSeconds); encoded += 1; const elapsedMs = performance.now() - startedAt; onProgress({ currentFrame: encoded, totalFrames, progress: encoded / totalFrames, elapsedMs, estimatedRemainingMs: encoded === totalFrames ? 0 : elapsedMs / encoded * (totalFrames - encoded) }); }
    source.close(); sourceClosed = true; await audioPromise; if (encoded !== totalFrames) throw new Error(`Anti-drop check failed: expected ${totalFrames} frames, encoded ${encoded}.`); await output.finalize(); finalized = true; if (!target.buffer) throw new Error("The MP4 buffer is unavailable."); if (target.buffer.byteLength > BUFFER_LIMIT_BYTES) throw new Error("The MP4 file exceeds the safe browser memory limit."); const blob = new Blob([target.buffer], { type: "video/mp4" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000); const audioStats = await audioTrack.computePacketStats(Infinity, { skipLiveWait: true }); return { fileName, formatLabel: "MP4 · H.264/AAC offline", encodedFrameCount: encoded, audioPacketCount: audioStats.packetCount, width, height, fps: settings.fps };
  } catch (error) {
    if (!sourceClosed) { try { source?.close(); } catch { /* La sorgente può essere già stata chiusa dall'encoder. */ } }
    await Promise.allSettled([conversion?.cancel(), finalized ? Promise.resolve() : output?.cancel()]);
    if (audioPromise) await Promise.allSettled([audioPromise]);
    throw error;
  } finally { signal.removeEventListener("abort", abort); try { input?.dispose(); } catch { /* Cleanup best effort: non deve mascherare l'errore di export. */ } }
}
