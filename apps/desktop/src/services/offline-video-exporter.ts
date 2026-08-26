import type { ExportProgress } from "@rbs/export-engine";
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
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
import type { BackgroundAppearance, BallAppearance } from "../store/scene-store";

export interface SharedViewportRenderer {
  canvas: HTMLCanvasElement;
  setExportSize: (width: number, height: number) => void;
  restorePreviewSize: () => void;
  renderNow: (sampleTimeSeconds?: number) => void;
}

export type ExportQuality = "high" | "maximum";
export type ExportMediaFit = "cover" | "contain" | "fill";

export interface OfflineSceneExportSettings {
  width: number;
  height: number;
  aspectRatio: "9:16" | "16:9" | "1:1" | "4:5" | "custom";
  fps: number;
  durationSeconds: number;
  projectName: string;
  quality: ExportQuality;
  sourceUrl: string;
  background: BackgroundAppearance;
  ball: BallAppearance;
  sourceDuration: number;
  backgroundDimming?: number;
  backgroundFit?: ExportMediaFit;
  audioLeadIn?: {
    durationSeconds: number;
    events: Array<{ timeSeconds: number; kind: "slide" | "door" | "play" }>;
    includeSourceAudio?: boolean;
    /** Optional mode-specific PCM renderer. It receives the encoder format. */
    renderPcm?: (sampleRate: number, channels: number) => Float32Array;
  };
}

export interface OfflineSceneExportResult {
  fileName: string;
  formatLabel: string;
  encodedFrameCount: number;
  audioPacketCount: number;
  width: number;
  height: number;
  fps: number;
}

export interface OfflineFrameTiming {
  timestampSeconds: number;
  durationSeconds: number;
  sampleTimeSeconds: number;
}

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

export function recordingBitrate(width: number, height: number, fps: number, quality: ExportQuality = "maximum"): number {
  const bitsPerPixel = quality === "maximum" ? .24 : .14;
  const minimum = quality === "maximum" ? 12_000_000 : 8_000_000;
  const maximum = quality === "maximum" ? 160_000_000 : 100_000_000;
  return Math.round(Math.max(minimum, Math.min(maximum, width * height * fps * bitsPerPixel)));
}

export function mediaDrawRect(sourceWidth: number, sourceHeight: number, width: number, height: number, fit: ExportMediaFit): { x: number; y: number; width: number; height: number } {
  if (fit === "fill") return { x: 0, y: 0, width, height };
  const scale = fit === "contain" ? Math.min(width / sourceWidth, height / sourceHeight) : Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
}

export function offlineFrameCount(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("La durata dell’export deve essere maggiore di zero.");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Il frame rate dell’export deve essere maggiore di zero.");
  return Math.ceil(durationSeconds * fps);
}

export function offlineFrameTiming(frameIndex: number, durationSeconds: number, fps: number): OfflineFrameTiming {
  const totalFrames = offlineFrameCount(durationSeconds, fps);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= totalFrames) throw new Error("Indice frame fuori dai limiti dell’export.");
  const timestampSeconds = frameIndex / fps;
  const duration = Math.min(1 / fps, durationSeconds - timestampSeconds);
  return {
    timestampSeconds,
    durationSeconds: duration,
    sampleTimeSeconds: Math.min(durationSeconds - Number.EPSILON, timestampSeconds + duration / 2)
  };
}

export function assertOfflineFrameIntegrity(expected: number, encoded: number): void {
  if (expected !== encoded) throw new Error(`Controllo anti-drop fallito: attesi ${expected} frame, codificati ${encoded}. Il file incompleto non è stato consegnato.`);
}

export function assertOfflineAspectRatio(aspectRatio: "9:16" | "16:9" | "1:1" | "4:5" | "custom", width: number, height: number): void {
  const validDimensions = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
  const matches = aspectRatio === "9:16" ? width * 16 === height * 9 : aspectRatio === "16:9" ? width * 9 === height * 16 : aspectRatio === "1:1" ? width === height : aspectRatio === "4:5" ? width * 5 === height * 4 : true;
  if (!validDimensions || !matches) throw new Error(`Risoluzione ${width} × ${height} incompatibile con il formato ${aspectRatio} selezionato.`);
}

function abortError(): DOMException { return new DOMException("Esportazione annullata", "AbortError"); }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw abortError(); }
function safeName(value: string): string { return value.normalize("NFKD").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "mlsm-studio"; }

export function cassetteMechanicalLeadIn(sampleRate: number, channels: number, durationSeconds: number, events: Array<{ timeSeconds: number; kind: "slide" | "door" | "play" }>): Float32Array {
  const frames = Math.ceil(durationSeconds * sampleRate); const data = new Float32Array(frames * channels);
  const noise = (index: number) => { const value = Math.sin(index * 12.9898) * 43758.5453; return (value - Math.floor(value)) * 2 - 1; };
  events.forEach((event, eventIndex) => { const start = Math.floor(event.timeSeconds * sampleRate); const length = Math.floor(sampleRate * (event.kind === "slide" ? .32 : event.kind === "door" ? .16 : .09)); for (let frame = 0; frame < length && start + frame < frames; frame += 1) { const t = frame / sampleRate; const envelope = Math.pow(1 - frame / Math.max(1, length), event.kind === "slide" ? 1.8 : 4); const tone = event.kind === "slide" ? Math.sin(t * Math.PI * 2 * 86) * .16 + noise(frame + eventIndex * 991) * .12 : event.kind === "door" ? Math.sin(t * Math.PI * 2 * 132) * .34 + noise(frame) * .09 : Math.sin(t * Math.PI * 2 * 920) * .24 + noise(frame) * .06; for (let channel = 0; channel < channels; channel += 1) data[(start + frame) * channels + channel] = tone * envelope; } });
  return data;
}

function renderAudioLeadIn(
  leadIn: NonNullable<OfflineSceneExportSettings["audioLeadIn"]>,
  sampleRate: number,
  channels: number
): Float32Array {
  return leadIn.renderPcm?.(sampleRate, channels)
    ?? cassetteMechanicalLeadIn(sampleRate, channels, leadIn.durationSeconds, leadIn.events);
}

function waitWithTimeout<T>(promise: Promise<T>, milliseconds: number, message: string, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const timer = window.setTimeout(() => { signal.removeEventListener("abort", abort); reject(new Error(message)); }, milliseconds);
    const abort = () => { window.clearTimeout(timer); reject(abortError()); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => { window.clearTimeout(timer); signal.removeEventListener("abort", abort); resolve(value); }, (error: unknown) => { window.clearTimeout(timer); signal.removeEventListener("abort", abort); reject(error); });
  });
}

function loadImage(url: string | null, label: string, signal: AbortSignal): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const image = new Image();
    const abort = () => { image.src = ""; reject(abortError()); };
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => { signal.removeEventListener("abort", abort); resolve(image); };
    image.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error(`Impossibile caricare ${label} per l’export offline.`)); };
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
    stream: new WritableStream<StreamTargetChunk>({ write: (chunk) => raw.write(chunk as unknown as Blob | BufferSource | string), close, abort }),
    commit: () => { commit = true; },
    abort
  };
}

function streamTarget(raw: FileSystemWritableFileStream, finalBlob: () => Promise<Blob | null>, finish: () => Promise<void>, discardFinal: () => Promise<void>, cleanup: () => Promise<void>): OfflineTarget {
  const managed = managedStream(raw);
  return { target: new StreamTarget(managed.stream, { chunked: true }), buffer: null, prepareCommit: managed.commit, abortPartial: managed.abort, finalBlob, finish, discardFinal, cleanup };
}

async function createTarget(fileName: string, handle: FileSystemFileHandle | null, settings: OfflineSceneExportSettings): Promise<OfflineTarget> {
  if (handle) {
    try {
      const writable = await handle.createWritable();
      return streamTarget(writable, async () => handle.getFile(), async () => undefined, async () => {
        const invalid = await handle.createWritable(); await invalid.truncate(0); await invalid.close();
      }, async () => undefined);
    } catch { /* OPFS è il fallback progressivo. */ }
  }
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("mlsm-studio-temp", { create: true });
    const tempName = `offline-scene-${crypto.randomUUID()}.part`;
    const tempHandle = await directory.getFileHandle(tempName, { create: true });
    const writable = await tempHandle.createWritable();
    let url: string | null = null;
    return streamTarget(writable, async () => tempHandle.getFile(), async () => {
      const file = await tempHandle.getFile();
      url = URL.createObjectURL(file);
      const link = document.createElement("a"); link.href = url; link.download = fileName; link.click();
    }, async () => undefined, async () => {
      await directory.removeEntry(tempName).catch(() => undefined);
      if (url) window.setTimeout(() => URL.revokeObjectURL(url!), 30_000);
    });
  } catch { /* Buffer limitato come ultima possibilità. */ }

  const estimatedBytes = settings.width * settings.height * settings.durationSeconds * settings.fps * .055;
  if (estimatedBytes > BUFFER_LIMIT_BYTES) throw new Error("Export troppo grande per la memoria del browser. Usa Chrome/Edge e scegli direttamente il file di destinazione.");
  const buffer = new BufferTarget();
  return { target: buffer, buffer, prepareCommit: () => undefined, abortPartial: async () => undefined, finalBlob: async () => buffer.buffer ? new Blob([buffer.buffer], { type: "video/mp4" }) : null, finish: async () => undefined, discardFinal: async () => undefined, cleanup: async () => undefined };
}

function directSave(fileName: string): Promise<FileSystemFileHandle | null> | null {
  if (typeof window.showSaveFilePicker !== "function") return null;
  return window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: "MP4 · H.264/AAC offline verificato", accept: { "video/mp4": [".mp4"] } }] }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  });
}

function downloadBuffer(buffer: ArrayBuffer, fileName: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: "video/mp4" }));
  const link = document.createElement("a"); link.href = url; link.download = fileName; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function audit(blob: Blob, expectAudio: boolean, signal: AbortSignal): Promise<{ videoFrames: number; audioPackets: number }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob, { maxCacheSize: 8 * 1024 ** 2 }) });
  try {
    throwIfAborted(signal);
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    if (!video) throw new Error("Il file finalizzato non contiene la traccia video.");
    if (expectAudio && !audio) throw new Error("Il file finalizzato non contiene la traccia audio.");
    const [videoStats, audioStats] = await Promise.all([video.computePacketStats(Infinity, { skipLiveWait: true }), audio?.computePacketStats(Infinity, { skipLiveWait: true })]);
    return { videoFrames: videoStats.packetCount, audioPackets: audioStats?.packetCount ?? 0 };
  } finally { input.dispose(); }
}

function drawMedia(context: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, opacity: number, fit: ExportMediaFit): void {
  if (!sourceWidth || !sourceHeight) return;
  const rect = mediaDrawRect(sourceWidth, sourceHeight, width, height, fit);
  context.save(); context.globalAlpha = opacity; context.drawImage(source, rect.x, rect.y, rect.width, rect.height); context.restore();
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, background: BackgroundAppearance, image: HTMLImageElement | null, videoFrame: HTMLCanvasElement | OffscreenCanvas | null, frame: number, fit: ExportMediaFit): void {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, background.colors[0]); gradient.addColorStop(1, background.colors[1]);
  context.fillStyle = gradient; context.fillRect(0, 0, width, height);
  const source = background.mediaType === "video" ? videoFrame : image;
  const sourceWidth = source instanceof HTMLImageElement ? source.naturalWidth : source?.width ?? 0;
  const sourceHeight = source instanceof HTMLImageElement ? source.naturalHeight : source?.height ?? 0;
  if (source) drawMedia(context, source, sourceWidth, sourceHeight, width, height, background.opacity, fit);
  if (background.effects.glow) {
    const glow = context.createRadialGradient(width * .5, height * .36, 0, width * .5, height * .36, width * .68);
    glow.addColorStop(0, "rgba(117,168,255,.15)"); glow.addColorStop(.42, "rgba(128,82,255,.08)"); glow.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = glow; context.fillRect(0, 0, width, height);
  }
  if (background.effects.particles) {
    context.fillStyle = "rgba(214,236,255,.42)"; const size = Math.max(1, width / 1100);
    for (let index = 0; index < 80; index += 1) {
      const x = (Math.sin(index * 91.17) * .5 + .5) * width;
      const y = ((Math.cos(index * 37.31) * .5 + .5) * height + frame * .32) % height;
      context.beginPath(); context.arc(x, y, size, 0, Math.PI * 2); context.fill();
    }
  }
  if (background.finish === "worn") {
    context.strokeStyle = "rgba(238,218,181,.09)"; context.lineWidth = Math.max(1, width / 1300);
    for (let index = 0; index < 32; index += 1) {
      const x = (Math.sin(index * 43.71) * .5 + .5) * width; const y = (Math.cos(index * 19.33) * .5 + .5) * height;
      context.beginPath(); context.moveTo(x, y); context.lineTo(x + width * (.018 + index % 4 * .008), y - height * .05); context.stroke();
    }
  }
}

function drawVignette(context: CanvasRenderingContext2D, width: number, height: number): void {
  const vignette = context.createRadialGradient(width / 2, height / 2, width * .3, width / 2, height / 2, width * .82);
  vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(.72, "rgba(0,0,0,0)"); vignette.addColorStop(1, "rgba(2,4,11,.24)");
  context.fillStyle = vignette; context.fillRect(0, 0, width, height);
}

function revealProgress(ball: BallAppearance, time: number, sourceDuration: number): number {
  if (!ball.endRevealEnabled || !ball.innerImageUrl) return 0;
  const start = ball.revealMode === "end" ? Math.max(0, sourceDuration - 1.15) : Math.max(0, Math.min(sourceDuration, ball.revealTimeSeconds));
  return Math.max(0, Math.min(1, (time - start) / 1.15));
}

function drawFinalImage(context: CanvasRenderingContext2D, image: HTMLImageElement | null, ball: BallAppearance, time: number, sourceDuration: number, width: number, height: number): void {
  if (!image) return;
  const progress = Math.max(0, Math.min(1, (revealProgress(ball, time, sourceDuration) - .16) / .84));
  if (progress <= 0) return;
  const eased = 1 - Math.pow(1 - progress, 3); const scale = .9 * Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale; const drawHeight = image.naturalHeight * scale;
  context.save(); context.fillStyle = `rgba(3,5,12,${eased * .68})`; context.fillRect(0, 0, width, height); context.globalAlpha = eased;
  context.translate(width / 2, height / 2); context.scale(Math.max(.04, Math.sin(eased * Math.PI / 2)), 1);
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight); context.restore();
}

export async function exportOfflineSceneVideo(settings: OfflineSceneExportSettings, renderer: SharedViewportRenderer, setRenderTime: (time: number | null) => void, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<OfflineSceneExportResult> {
  assertOfflineAspectRatio(settings.aspectRatio, settings.width, settings.height);
  const fileName = `${safeName(settings.projectName)}-${settings.width}x${settings.height}-${settings.fps}fps-offline.mp4`;
  // Il picker precede ogni await per conservare l'attivazione del gesto utente.
  const handlePromise = directSave(fileName);
  const quality: Quality = settings.quality === "maximum" ? QUALITY_VERY_HIGH : QUALITY_HIGH;
  const startedAt = performance.now();
  let target: OfflineTarget | null = null; let output: Output | null = null; let conversion: Conversion | null = null;let effectsAudioSource:AudioSampleSource|null=null;
  let sourceInput: Input | null = null; let backgroundInput: Input | null = null; let finalized = false; let verified = false;
  try {
    throwIfAborted(signal);
    const [avc, handle, sourceResponse, backgroundImage, innerImage] = await Promise.all([
      canEncodeVideo("avc", { width: settings.width, height: settings.height, bitrate: quality, latencyMode: "quality", hardwareAcceleration: "prefer-hardware" }),
      handlePromise ?? Promise.resolve(null),
      fetch(settings.sourceUrl, { signal }),
      settings.background.mediaType === "image" ? loadImage(settings.background.imageUrl, "lo sfondo", signal) : Promise.resolve(null),
      loadImage(settings.ball.innerImageUrl, "l’immagine interna della sfera", signal)
    ]);
    if (!avc) throw new Error("L’encoder H.264 offline non supporta risoluzione e frame rate selezionati su questo dispositivo.");
    if (!sourceResponse.ok) throw new Error(`Impossibile leggere la sorgente audio/video (HTTP ${sourceResponse.status}).`);
    const sourceBlob = await sourceResponse.blob(); if (!sourceBlob.size) throw new Error("La sorgente audio/video è vuota.");
    sourceInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(sourceBlob, { maxCacheSize: 32 * 1024 ** 2 }) });
    const audioTrack = await sourceInput.getPrimaryAudioTrack();
    const includeSourceAudio=settings.audioLeadIn?.includeSourceAudio!==false;const expectAudio=Boolean((audioTrack&&includeSourceAudio)||settings.audioLeadIn);
    if (expectAudio && !await canEncodeAudio("aac", { bitrate: 320_000 })) throw new Error("L’encoder AAC offline non è disponibile su questo dispositivo.");
    const audioDuration = audioTrack ? await audioTrack.computeDuration({ skipLiveWait: true }) : 0;
    const duration = settings.durationSeconds;
    const totalFrames = offlineFrameCount(duration, settings.fps);

    let backgroundSink: CanvasSink | null = null; let backgroundDuration = 0;
    if (settings.background.mediaType === "video" && settings.background.imageUrl) {
      const backgroundResponse = await fetch(settings.background.imageUrl, { signal });
      if (!backgroundResponse.ok) throw new Error(`Impossibile leggere il video di sfondo (HTTP ${backgroundResponse.status}).`);
      const backgroundBlob = await backgroundResponse.blob();
      backgroundInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(backgroundBlob, { maxCacheSize: 32 * 1024 ** 2 }) });
      const backgroundTrack = await backgroundInput.getPrimaryVideoTrack();
      if (!backgroundTrack) throw new Error("Il file scelto come sfondo non contiene una traccia video.");
      backgroundDuration = await backgroundTrack.computeDuration({ skipLiveWait: true });
      backgroundSink = new CanvasSink(backgroundTrack, { poolSize: 2 });
    }

    target = await createTarget(fileName, handle, settings);
    const canvas = document.createElement("canvas"); canvas.width = settings.width; canvas.height = settings.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas offline non disponibile.");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    output = new Output({ format: new Mp4OutputFormat(), target: target.target });
    const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: quality, alpha: "discard", latencyMode: "quality", hardwareAcceleration: "prefer-hardware", keyFrameInterval: 2, contentHint: "animation" });
    output.addVideoTrack(videoSource, { frameRate: settings.fps });
    if (audioTrack&&includeSourceAudio) {
      const leadIn = settings.audioLeadIn; let emittedLeadIn = false;
      conversion = await Conversion.init({ input: sourceInput, output, tracks: "primary", trim: { start: 0, end: Math.min(settings.sourceDuration, audioDuration) }, video: { discard: true }, audio: leadIn ? { codec: "aac", bitrate: 320_000, forceTranscode: true, sampleFormat: "f32", process: (sample: AudioSample) => { sample.setTimestamp(sample.timestamp + leadIn.durationSeconds); if (emittedLeadIn) return sample; emittedLeadIn = true; const data = renderAudioLeadIn(leadIn, sample.sampleRate, sample.numberOfChannels); return [new AudioSample({ data, format: "f32", numberOfChannels: sample.numberOfChannels, sampleRate: sample.sampleRate, timestamp: 0 }), sample]; } } : { codec: "aac", bitrate: 320_000, forceTranscode: true }, composable: true, showWarnings: false });
      if (!conversion.isValid || !conversion.utilizedTracks.includes(audioTrack)) throw new Error("La traccia audio non può essere codificata senza riproduzione live.");
    }else if(settings.audioLeadIn){effectsAudioSource=new AudioSampleSource({codec:"aac",bitrate:320_000});output.addAudioTrack(effectsAudioSource);}
    const abort = () => { void conversion?.cancel();effectsAudioSource?.close(); void output?.cancel(); };
    signal.addEventListener("abort", abort, { once: true });
    renderer.setExportSize(settings.width, settings.height);
    try {
      await waitWithTimeout(output.start(), 60_000, "L’encoder offline non è partito entro 60 secondi.", signal);
      const audioPromise = conversion?.execute() ?? (effectsAudioSource&&settings.audioLeadIn?(async()=>{const sampleRate=48_000,channels=2;const data=renderAudioLeadIn(settings.audioLeadIn!,sampleRate,channels);await effectsAudioSource!.add(new AudioSample({data,format:"f32",numberOfChannels:channels,sampleRate,timestamp:0}));effectsAudioSource!.close();})():Promise.resolve()); let encodedFrames = 0;
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
        throwIfAborted(signal);
        const timing = offlineFrameTiming(frameIndex, duration, settings.fps);
        setRenderTime(timing.sampleTimeSeconds);
        renderer.renderNow(timing.sampleTimeSeconds);
        const backgroundTime = backgroundDuration > 0 ? timing.sampleTimeSeconds % backgroundDuration : 0;
        const wrappedBackground = backgroundSink ? await backgroundSink.getCanvas(backgroundTime, { skipLiveWait: true }) : null;
        drawBackground(context, settings.width, settings.height, settings.background, backgroundImage, wrappedBackground?.canvas ?? null, frameIndex, settings.backgroundFit ?? "cover");
        if ((settings.backgroundDimming ?? 0) > 0) {
          context.save(); context.globalAlpha = Math.max(0, Math.min(.8, settings.backgroundDimming ?? 0)); context.fillStyle = "#000000"; context.fillRect(0, 0, settings.width, settings.height); context.restore();
        }
        context.drawImage(renderer.canvas, 0, 0, settings.width, settings.height);
        if (settings.background.effects.vignette) drawVignette(context, settings.width, settings.height);
        drawFinalImage(context, innerImage, settings.ball, timing.sampleTimeSeconds, settings.sourceDuration, settings.width, settings.height);
        await waitWithTimeout(videoSource.add(timing.timestampSeconds, timing.durationSeconds), 120_000, `L’encoder è fermo sul frame ${frameIndex + 1}; il file incompleto non è stato consegnato.`, signal);
        encodedFrames += 1;
        const elapsedMs = performance.now() - startedAt;
        onProgress({ currentFrame: encodedFrames, totalFrames, progress: encodedFrames / totalFrames, elapsedMs, estimatedRemainingMs: encodedFrames === totalFrames ? 0 : elapsedMs / encodedFrames * (totalFrames - encodedFrames) });
      }
      videoSource.close();
      await waitWithTimeout(audioPromise, Math.max(300_000, duration * 4_000), "La codifica audio offline non è terminata.", signal);
      assertOfflineFrameIntegrity(totalFrames, encodedFrames);
      target.prepareCommit();
      await waitWithTimeout(output.finalize(), 240_000, "La finalizzazione MP4 non è terminata entro 240 secondi.", signal);
      finalized = true;
      const blob = await target.finalBlob(); if (!blob?.size) throw new Error("L’encoder non ha prodotto un file verificabile.");
      const finalAudit = await audit(blob, expectAudio, signal);
      assertOfflineFrameIntegrity(totalFrames, finalAudit.videoFrames);
      if (expectAudio && finalAudit.audioPackets <= 0) throw new Error("Controllo audio fallito: nessun pacchetto nel file finale.");
      if (target.buffer) downloadBuffer(target.buffer.buffer!, fileName); else await target.finish();
      verified = true;
      return { fileName, formatLabel: "MP4 · H.264/AAC offline verificato", encodedFrameCount: encodedFrames, audioPacketCount: finalAudit.audioPackets, width: settings.width, height: settings.height, fps: settings.fps };
    } finally { signal.removeEventListener("abort", abort); }
  } finally {
    setRenderTime(null); renderer.restorePreviewSize();
    if (!finalized) { await output?.cancel().catch(() => undefined); await target?.abortPartial(); }
    else if (!verified) await target?.discardFinal().catch(() => undefined);
    sourceInput?.dispose(); backgroundInput?.dispose(); await target?.cleanup();
  }
}
