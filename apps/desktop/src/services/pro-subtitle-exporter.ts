import type { ExportProgress } from "@rbs/export-engine";
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Conversion,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  StreamTarget,
  WebMOutputFormat,
  canEncodeVideo,
  type Quality,
  type InputAudioTrack,
  type StreamTargetChunk
} from "mediabunny";
import {
  recordingBitrate,
  type ExportQuality,
  type SharedViewportRenderer
} from "./offline-video-exporter";
import {
  renderProSubtitleCompositionFrame,
  type ProSubtitleCue,
  type ProSubtitleSettings
} from "./pro-subtitles";

export type ProSubtitleBackgroundMode = "transparent" | "solid";
export type ProSubtitleExportFormatId =
  | "webmVp9Alpha"
  | "movProRes4444"
  | "mp4H264Solid"
  | "webmVp9Solid";

export interface ProSubtitleExportSettings {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  projectName: string;
  quality: ExportQuality;
  /** Selects a transparent/solid subtitle layer or a frame-accurate burn-in. */
  outputMode?: "subtitleLayer" | "completeVideo";
  backgroundMode: ProSubtitleBackgroundMode;
  backgroundColor: string;
  sourceVideoUrl?: string | null;
  sourceVideoName?: string | null;
  sourceVideoFile?: Blob | null;
  /** Optional source-relative range used by Video Editor artifact jobs. */
  sourceStartSeconds?: number;
  sourceDurationSeconds?: number;
  /** Keep the encoded Blob in memory for insertion into Video Editor. */
  suppressDownload?: boolean;
  subtitleCues: readonly ProSubtitleCue[];
  subtitleSettings: ProSubtitleSettings;
  /**
   * When omitted, transparent exports use WebM VP9 alpha and solid exports use
   * MP4 H.264. ProRes is intentionally rejected by the web exporter.
   */
  format?: ProSubtitleExportFormatId;
  /**
   * An opaque WebM fallback can change the expected editing workflow, so it is
   * only used after an explicit opt-in when AVC is unavailable.
   */
  allowOpaqueWebmFallback?: boolean;
}

export interface ProSubtitleFormatDescriptor {
  id: ProSubtitleExportFormatId;
  label: string;
  mimeType: "video/webm" | "video/mp4" | "video/quicktime";
  extension: ".webm" | ".mp4" | ".mov";
  codec: "vp9" | "avc" | "prores-4444";
  alpha: boolean;
  desktopRequired: boolean;
}

export interface ProSubtitleFormatCapability extends ProSubtitleFormatDescriptor {
  supported: boolean;
  reason: string | null;
}

export type ProSubtitleExportCapabilities = Readonly<Record<
  ProSubtitleExportFormatId,
  ProSubtitleFormatCapability
>>;

export interface ProSubtitleCodecSupport {
  vp9Alpha: boolean;
  avcSolid: boolean;
  vp9Solid: boolean;
}

export interface ProSubtitleExportPlan {
  descriptor: ProSubtitleFormatDescriptor;
  alpha: "keep" | "discard";
  usedOpaqueWebmFallback: boolean;
}

export interface ProSubtitleExportResult {
  format: ProSubtitleFormatDescriptor;
  fileName: string;
  usedOpaqueWebmFallback: boolean;
  sourceFrameCount?: number;
  encodedFrameCount?: number;
  copiedAudioPacketCount?: number;
  blob?: Blob;
}

export interface ProSubtitleFrameTiming {
  timestampSeconds: number;
  durationSeconds: number;
}

export const PRO_SUBTITLE_BUFFER_LIMIT_BYTES = 512 * 1024 ** 2;

const PRORES_WEB_REASON =
  "Apple ProRes 4444 con canale alpha non è disponibile nell’export web: richiede l’encoder desktop FFmpeg/VideoToolbox. Usa WebM VP9 alpha oppure la build desktop quando disponibile.";

export const PRO_SUBTITLE_FORMAT_DESCRIPTORS: Readonly<Record<
  ProSubtitleExportFormatId,
  ProSubtitleFormatDescriptor
>> = Object.freeze({
  webmVp9Alpha: Object.freeze({
    id: "webmVp9Alpha",
    label: "WebM · VP9 con alpha",
    mimeType: "video/webm",
    extension: ".webm",
    codec: "vp9",
    alpha: true,
    desktopRequired: false
  }),
  movProRes4444: Object.freeze({
    id: "movProRes4444",
    label: "MOV · Apple ProRes 4444 con alpha",
    mimeType: "video/quicktime",
    extension: ".mov",
    codec: "prores-4444",
    alpha: true,
    desktopRequired: true
  }),
  mp4H264Solid: Object.freeze({
    id: "mp4H264Solid",
    label: "MP4 · H.264 su sfondo pieno",
    mimeType: "video/mp4",
    extension: ".mp4",
    codec: "avc",
    alpha: false,
    desktopRequired: false
  }),
  webmVp9Solid: Object.freeze({
    id: "webmVp9Solid",
    label: "WebM · VP9 su sfondo pieno",
    mimeType: "video/webm",
    extension: ".webm",
    codec: "vp9",
    alpha: false,
    desktopRequired: false
  })
});

function capability(
  id: ProSubtitleExportFormatId,
  supported: boolean,
  reason: string | null
): ProSubtitleFormatCapability {
  return { ...PRO_SUBTITLE_FORMAT_DESCRIPTORS[id], supported, reason };
}

/**
 * Pure capability mapper, kept separate from WebCodecs probing so the UI and
 * tests can reason about every format without requiring a browser encoder.
 */
export function createProSubtitleExportCapabilities(
  support: ProSubtitleCodecSupport
): ProSubtitleExportCapabilities {
  return {
    webmVp9Alpha: capability(
      "webmVp9Alpha",
      support.vp9Alpha,
      support.vp9Alpha
        ? null
        : "Questo browser non dispone di un encoder VP9 compatibile con il canale alpha."
    ),
    movProRes4444: capability("movProRes4444", false, PRORES_WEB_REASON),
    mp4H264Solid: capability(
      "mp4H264Solid",
      support.avcSolid,
      support.avcSolid
        ? null
        : "Questo browser non dispone di un encoder H.264/AVC utilizzabile per l’export MP4."
    ),
    webmVp9Solid: capability(
      "webmVp9Solid",
      support.vp9Solid,
      support.vp9Solid
        ? null
        : "Questo browser non dispone di un encoder VP9 utilizzabile per l’export WebM opaco."
    )
  };
}

function encodingQuality(quality: ExportQuality): Quality {
  return quality === "maximum" ? QUALITY_VERY_HIGH : QUALITY_HIGH;
}

async function safeCanEncode(
  codec: "vp9" | "avc",
  width: number,
  height: number,
  quality: Quality,
  alpha: "keep" | "discard"
): Promise<boolean> {
  try {
    return await canEncodeVideo(codec, {
      width,
      height,
      bitrate: quality,
      alpha,
      latencyMode: "quality"
    });
  } catch {
    return false;
  }
}

export async function probeProSubtitleExportCapabilities(
  width: number,
  height: number,
  quality: ExportQuality = "maximum"
): Promise<ProSubtitleExportCapabilities> {
  const bitrate = encodingQuality(quality);
  const [vp9Alpha, avcSolid, vp9Solid] = await Promise.all([
    safeCanEncode("vp9", width, height, bitrate, "keep"),
    safeCanEncode("avc", width, height, bitrate, "discard"),
    safeCanEncode("vp9", width, height, bitrate, "discard")
  ]);
  return createProSubtitleExportCapabilities({ vp9Alpha, avcSolid, vp9Solid });
}

export function resolveProSubtitleExportPlan(
  settings: ProSubtitleExportSettings,
  capabilities: ProSubtitleExportCapabilities
): ProSubtitleExportPlan {
  if (settings.format === "movProRes4444") throw new Error(PRORES_WEB_REASON);

  if (settings.backgroundMode === "transparent") {
    if (settings.format === "mp4H264Solid" || settings.format === "webmVp9Solid") {
      throw new Error(
        "Il formato opaco selezionato non conserva la trasparenza. Scegli WebM VP9 con alpha."
      );
    }
    const selected = capabilities.webmVp9Alpha;
    if (!selected.supported) throw new Error(selected.reason ?? "Encoder VP9 alpha non disponibile.");
    return {
      descriptor: PRO_SUBTITLE_FORMAT_DESCRIPTORS.webmVp9Alpha,
      alpha: "keep",
      usedOpaqueWebmFallback: false
    };
  }

  if (capabilities.mp4H264Solid.supported) {
    return {
      descriptor: PRO_SUBTITLE_FORMAT_DESCRIPTORS.mp4H264Solid,
      alpha: "discard",
      usedOpaqueWebmFallback: false
    };
  }

  if (settings.allowOpaqueWebmFallback) {
    const fallback = capabilities.webmVp9Solid;
    if (!fallback.supported) {
      throw new Error(
        fallback.reason ?? "Nessun encoder compatibile è disponibile per l’export opaco."
      );
    }
    return {
      descriptor: PRO_SUBTITLE_FORMAT_DESCRIPTORS.webmVp9Solid,
      alpha: "discard",
      usedOpaqueWebmFallback: true
    };
  }

  throw new Error(
    "Encoder H.264/AVC non disponibile. Il fallback WebM VP9 opaco non viene applicato automaticamente: abilitalo esplicitamente per continuare."
  );
}

export function proSubtitleFrameCount(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("La durata dell’export deve essere maggiore di zero.");
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("Il frame rate dell’export deve essere maggiore di zero.");
  }
  return Math.max(1, Math.ceil(durationSeconds * fps));
}

export function proSubtitleFrameTiming(
  frameIndex: number,
  durationSeconds: number,
  fps: number
): ProSubtitleFrameTiming {
  const totalFrames = proSubtitleFrameCount(durationSeconds, fps);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= totalFrames) {
    throw new Error("Indice frame fuori dai limiti dell’export.");
  }
  const timestampSeconds = frameIndex / fps;
  return {
    timestampSeconds,
    durationSeconds: Math.min(1 / fps, durationSeconds - timestampSeconds)
  };
}

export function estimateProSubtitleBufferBytes(
  settings: Pick<
    ProSubtitleExportSettings,
    "width" | "height" | "fps" | "durationSeconds" | "quality"
  >
): number {
  const encodedBytes = recordingBitrate(
    settings.width,
    settings.height,
    settings.fps,
    settings.quality
  ) / 8 * settings.durationSeconds;
  // Container headers and encoder variability are deliberately included in
  // the preflight because BufferTarget must retain the complete file in RAM.
  return Math.ceil(encodedBytes * 1.15);
}

function validateSettings(settings: ProSubtitleExportSettings): void {
  if (!Number.isInteger(settings.width) || settings.width <= 0) {
    throw new Error("La larghezza dell’export deve essere un intero maggiore di zero.");
  }
  if (!Number.isInteger(settings.height) || settings.height <= 0) {
    throw new Error("L’altezza dell’export deve essere un intero maggiore di zero.");
  }
  proSubtitleFrameCount(settings.durationSeconds, settings.fps);
  if (settings.backgroundMode === "solid" && !settings.backgroundColor.trim()) {
    throw new Error("Scegli un colore per lo sfondo pieno.");
  }
  const hasVisibleCue = settings.subtitleCues.some((cue) => (
    cue.text.trim().length > 0
    && cue.endSeconds > 0
    && cue.startSeconds < settings.durationSeconds
    && cue.endSeconds > cue.startSeconds
  ));
  if (!hasVisibleCue) {
    throw new Error("Nessun sottotitolo visibile nell’intervallo da esportare. Controlla testo e timestamp della timeline.");
  }
}

/** Rebase project cues into the local clock of a selected source fragment. */
export function rebaseProSubtitleCues(
  cues: readonly ProSubtitleCue[],
  sourceStartSeconds: number,
  sourceDurationSeconds: number
): ProSubtitleCue[] {
  const start = Math.max(0, Number.isFinite(sourceStartSeconds) ? sourceStartSeconds : 0);
  const duration = Math.max(0, Number.isFinite(sourceDurationSeconds) ? sourceDurationSeconds : 0);
  return cues.flatMap((cue) => {
    const localStart = Math.max(0, cue.startSeconds - start);
    const localEnd = Math.min(duration, cue.endSeconds - start);
    if (localEnd <= localStart || !cue.text.trim()) return [];
    return [{ ...cue, startSeconds: localStart, endSeconds: localEnd }];
  });
}

function safeName(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "dynamic-sound-animation";
}

export function buildProSubtitleFileName(
  projectName: string,
  width: number,
  height: number,
  fps: number,
  format: ProSubtitleFormatDescriptor
): string {
  return `${safeName(projectName)}-pro-subtitles-${width}x${height}-${fps}fps${format.extension}`;
}

export function buildCompleteProSubtitleFileName(projectName: string): string {
  return `${safeName(projectName)}-video-originale-con-sottotitoli.mp4`;
}

export function assertCompleteVideoFrameIntegrity(
  sourceFrameCount: number,
  encodedFrameCount: number
): void {
  if (!Number.isInteger(sourceFrameCount) || sourceFrameCount <= 0) {
    throw new Error("Il video sorgente non contiene frame validi.");
  }
  if (encodedFrameCount !== sourceFrameCount) {
    throw new Error(
      `Controllo anti-drop fallito: letti ${sourceFrameCount} frame dal video originale, composti ${encodedFrameCount}. Il file parziale è stato annullato.`
    );
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Esportazione annullata", "AbortError");
}

function waitWithTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
  signal: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Esportazione annullata", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      reject(new Error(message));
    }, milliseconds);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Esportazione annullata", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, (error: unknown) => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function waitForDocumentFonts(signal: AbortSignal): Promise<void> {
  const fontSet = document.fonts;
  if (!fontSet?.ready) return;
  await waitWithTimeout(
    Promise.resolve(fontSet.ready).then(() => undefined),
    30_000,
    "I font dei sottotitoli non sono pronti dopo 30 secondi. Attendi il caricamento dei font e riprova l’export.",
    signal
  );
}

function settlesWithin(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(true);
    };
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, milliseconds);
    promise.then(finish, finish);
  });
}

function bufferLimitError(requiredBytes?: number): Error {
  const estimate = requiredBytes
    ? ` La stima è ${(requiredBytes / 1024 ** 2).toFixed(0)} MB, oltre il limite sicuro di ${PRO_SUBTITLE_BUFFER_LIMIT_BYTES / 1024 ** 2} MB.`
    : "";
  return new Error(
    `Questo export è troppo grande per il salvataggio completo nella memoria del browser.${estimate} Usa Chrome/Edge e scegli il file direttamente, oppure riduci durata, risoluzione, frame rate o qualità.`
  );
}

function createCappedBufferTarget(): BufferTarget {
  const target = new BufferTarget();
  // Mediabunny's runtime target exposes this internal writer even though it is
  // intentionally omitted from the public declaration file.
  const writableTarget = target as BufferTarget & {
    _write: (data: Uint8Array, pos: number) => void;
  };
  const write = writableTarget._write.bind(target);
  writableTarget._write = (data, pos) => {
    if (pos + data.byteLength > PRO_SUBTITLE_BUFFER_LIMIT_BYTES) {
      throw bufferLimitError();
    }
    write(data, pos);
  };
  return target;
}

interface ManagedFileStream {
  stream: WritableStream<StreamTargetChunk>;
  prepareCommit: () => void;
  abortPartial: () => Promise<void>;
}

/**
 * FileSystemWritableFileStream is structurally close to the stream expected by
 * Mediabunny, but wrapping it lets us choose close (commit) only after all
 * frames are accepted. Every earlier close/cancel aborts the partial file.
 */
function createManagedFileStream(raw: FileSystemWritableFileStream): ManagedFileStream {
  let commitOnClose = false;
  let terminalPromise: Promise<void> | null = null;
  let terminalMode: "commit" | "abort" | null = null;

  const abortRaw = (): Promise<void> => {
    commitOnClose = false;
    if (terminalMode === "abort" && terminalPromise) return terminalPromise;
    if (terminalMode === "commit") {
      return raw.abort?.().catch(() => undefined) ?? Promise.resolve();
    }
    terminalMode = "abort";
    terminalPromise = raw.abort ? raw.abort() : raw.close();
    return terminalPromise;
  };

  const closeRaw = (): Promise<void> => {
    if (terminalPromise) return terminalPromise;
    terminalMode = "commit";
    terminalPromise = raw.close();
    return terminalPromise;
  };

  const stream = new WritableStream<StreamTargetChunk>({
    write: (chunk) => {
      if (terminalPromise) {
        throw new Error("Il file di destinazione è già stato chiuso.");
      }
      return raw.write(chunk as unknown as Blob | BufferSource | string);
    },
    close: () => commitOnClose ? closeRaw() : abortRaw(),
    abort: () => abortRaw()
  });

  return {
    stream,
    prepareCommit: () => { commitOnClose = true; },
    abortPartial: () => abortRaw().catch(() => undefined)
  };
}

interface ExportTarget {
  target: BufferTarget | StreamTarget;
  bufferTarget: BufferTarget | null;
  prepareCommit: () => void;
  abortPartial: () => Promise<void>;
  getFinalBlob: () => Promise<Blob | null>;
  finish: () => Promise<void>;
  cleanup: () => Promise<void>;
}

interface DirectSaveRequest {
  descriptorId: ProSubtitleExportFormatId;
  handlePromise: Promise<FileSystemFileHandle | null>;
}

interface CompleteVideoDirectSaveRequest {
  handlePromise: Promise<FileSystemFileHandle | null>;
}

function provisionalDescriptor(settings: ProSubtitleExportSettings): ProSubtitleFormatDescriptor {
  return settings.backgroundMode === "transparent"
    ? PRO_SUBTITLE_FORMAT_DESCRIPTORS.webmVp9Alpha
    : PRO_SUBTITLE_FORMAT_DESCRIPTORS.mp4H264Solid;
}

/**
 * Must run in the same JavaScript turn as the export button click. Calling the
 * picker after a codec probe loses transient user activation in some browsers.
 */
function beginDirectSaveRequest(
  settings: ProSubtitleExportSettings
): DirectSaveRequest | null {
  const picker = window.showSaveFilePicker;
  if (typeof picker !== "function") return null;
  const descriptor = provisionalDescriptor(settings);
  const fileName = buildProSubtitleFileName(
    settings.projectName,
    settings.width,
    settings.height,
    settings.fps,
    descriptor
  );
  const handlePromise = picker.call(window, {
    suggestedName: fileName,
    types: [{
      description: descriptor.label,
      accept: { [descriptor.mimeType]: [descriptor.extension] }
    }]
  }).catch((error: unknown) => {
    if (isAbortError(error)) throw error;
    // SecurityError and browser-specific picker failures fall through to OPFS.
    return null;
  });
  return { descriptorId: descriptor.id, handlePromise };
}

function beginCompleteVideoDirectSaveRequest(
  settings: ProSubtitleExportSettings
): CompleteVideoDirectSaveRequest | null {
  const picker = window.showSaveFilePicker;
  if (typeof picker !== "function") return null;
  const descriptor = PRO_SUBTITLE_FORMAT_DESCRIPTORS.mp4H264Solid;
  const handlePromise = picker.call(window, {
    suggestedName: buildCompleteProSubtitleFileName(settings.projectName),
    types: [{
      description: "MP4 · H.264 con audio originale",
      accept: { [descriptor.mimeType]: [descriptor.extension] }
    }]
  }).catch((error: unknown) => {
    if (isAbortError(error)) throw error;
    return null;
  });
  return { handlePromise };
}

function streamExportTarget(
  raw: FileSystemWritableFileStream,
  getFinalBlob: () => Promise<Blob | null>,
  finish: () => Promise<void>,
  cleanup: () => Promise<void>
): ExportTarget {
  const managed = createManagedFileStream(raw);
  return {
    target: new StreamTarget(managed.stream, { chunked: true }),
    bufferTarget: null,
    prepareCommit: managed.prepareCommit,
    abortPartial: managed.abortPartial,
    getFinalBlob,
    finish,
    cleanup
  };
}

async function createExportTarget(
  fileName: string,
  format: ProSubtitleFormatDescriptor,
  settings: ProSubtitleExportSettings,
  directHandle: FileSystemFileHandle | null
): Promise<ExportTarget> {
  if (directHandle) {
    try {
      const writable = await directHandle.createWritable();
      return streamExportTarget(
        writable,
        async () => directHandle.getFile(),
        async () => undefined,
        async () => undefined
      );
    } catch {
      // If a browser exposes the picker but cannot open its writable, OPFS is
      // still a safe progressive fallback and avoids holding the video in RAM.
    }
  }

  let opfsWritable: FileSystemWritableFileStream | null = null;
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(
      "dynamic-sound-animation-studio-temp",
      { create: true }
    );
    const tempName = `pro-subtitles-${crypto.randomUUID()}.part`;
    const handle = await directory.getFileHandle(tempName, { create: true });
    opfsWritable = await handle.createWritable();
    let downloadUrl: string | null = null;
    let cleaned = false;
    return streamExportTarget(
      opfsWritable,
      async () => handle.getFile(),
      async () => {
        const file = await handle.getFile();
        downloadUrl = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = fileName;
        link.click();
      },
      async () => {
        if (cleaned) return;
        cleaned = true;
        await directory.removeEntry(tempName).catch(() => undefined);
        if (downloadUrl) window.setTimeout(() => URL.revokeObjectURL(downloadUrl!), 30_000);
      }
    );
  } catch {
    if (opfsWritable) {
      if (opfsWritable.abort) await opfsWritable.abort().catch(() => undefined);
      else await opfsWritable.close().catch(() => undefined);
    }
    // OPFS is unavailable (for example in a private browser context); the
    // in-memory target below remains a last-resort fallback.
  }

  const requiredBytes = estimateProSubtitleBufferBytes(settings);
  if (requiredBytes > PRO_SUBTITLE_BUFFER_LIMIT_BYTES) {
    throw bufferLimitError(requiredBytes);
  }
  const target = createCappedBufferTarget();
  return {
    target,
    bufferTarget: target,
    prepareCommit: () => undefined,
    abortPartial: async () => undefined,
    getFinalBlob: async () => target.buffer
      ? new Blob([target.buffer], { type: format.mimeType })
      : null,
    finish: async () => undefined,
    cleanup: async () => undefined
  };
}

function downloadBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: ProSubtitleFormatDescriptor["mimeType"]
): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function countPresentedVideoFrames(
  track: Awaited<ReturnType<Input["getPrimaryVideoTrack"]>>,
  startTimestamp: number,
  endTimestamp: number,
  signal: AbortSignal
): Promise<number> {
  if (!track) return 0;
  const sink = new EncodedPacketSink(track);
  let count = 0;
  for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
    throwIfAborted(signal);
    if (packet.timestamp >= startTimestamp && packet.timestamp < endTimestamp) count += 1;
  }
  return count;
}

async function fetchSourceVideo(url: string, signal: AbortSignal, sourceBlob?: Blob | null): Promise<Blob> {
  if (sourceBlob) {
    if (sourceBlob.size === 0) throw new Error("Il video originale caricato è vuoto.");
    return sourceBlob;
  }
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error("Il video originale caricato non è più accessibile. Ricaricalo e riprova.");
  }
  if (!response.ok) {
    throw new Error(`Impossibile leggere il video originale (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("Il video originale caricato è vuoto.");
  return blob;
}

interface FinalMediaAudit {
  videoFrameCount: number;
  audioPacketCount: number;
  audioPayloadBytes: number;
}

interface CopiedAudioAudit {
  packetCount: number;
  payloadBytes: number;
}

async function auditFinalMedia(blob: Blob, signal: AbortSignal): Promise<FinalMediaAudit> {
  throwIfAborted(signal);
  const auditInput = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(blob, { maxCacheSize: 8 * 1024 ** 2 })
  });
  try {
    const [videoTrack, audioTrack] = await Promise.all([
      auditInput.getPrimaryVideoTrack(),
      auditInput.getPrimaryAudioTrack()
    ]);
    if (!videoTrack) throw new Error("Il file MP4 finalizzato non contiene una traccia video.");
    const videoStats = await videoTrack.computePacketStats(Infinity, { skipLiveWait: true });
    let audioPacketCount = 0;
    let audioPayloadBytes = 0;
    if (audioTrack) {
      const sink = new EncodedPacketSink(audioTrack);
      for await (const packet of sink.packets()) {
        throwIfAborted(signal);
        audioPacketCount += 1;
        audioPayloadBytes += packet.byteLength;
      }
    }
    throwIfAborted(signal);
    return {
      videoFrameCount: videoStats.packetCount,
      audioPacketCount,
      audioPayloadBytes
    };
  } finally {
    auditInput.dispose();
  }
}

async function copyOriginalAudioPackets(
  track: InputAudioTrack,
  source: EncodedAudioPacketSource,
  startTimestamp: number,
  endTimestamp: number,
  signal: AbortSignal
): Promise<CopiedAudioAudit> {
  const sink = new EncodedPacketSink(track);
  const decoderConfig = await track.getDecoderConfig();
  const metadata: EncodedAudioChunkMetadata = decoderConfig
    ? { decoderConfig }
    : {};
  let packetCount = 0;
  let payloadBytes = 0;

  try {
    for await (const packet of sink.packets()) {
      throwIfAborted(signal);
      // Negative AAC priming packets are marked for discard and are not part
      // of the presented soundtrack. Keeping packets from t=0 onward retains
      // the actual compressed audio payload without a decode/re-encode pass.
      if (packet.timestamp < startTimestamp || packet.timestamp >= endTimestamp) continue;
      const timestamp = packet.timestamp - startTimestamp;
      const copiedPacket = packet.clone({ timestamp });
      await source.add(copiedPacket, metadata);
      packetCount += 1;
      payloadBytes += copiedPacket.byteLength;
    }
  } finally {
    source.close();
  }
  return { packetCount, payloadBytes };
}

/**
 * Burns ProSubtitles into the uploaded source without using real-time playback.
 * Every decoded source sample is rendered exactly once using its original
 * presentation timestamp and duration. No output frame-rate normalization is
 * configured, so variable-frame-rate inputs remain variable-frame-rate.
 */
async function exportCompleteProSubtitleVideo(
  settings: ProSubtitleExportSettings,
  renderer: SharedViewportRenderer,
  setRenderTime: (time: number | null) => void,
  signal: AbortSignal,
  onProgress: (progress: ExportProgress) => void
): Promise<ProSubtitleExportResult> {
  let input: Input | null = null;
  let output: Output | null = null;
  let conversion: Conversion | null = null;
  let exportTarget: ExportTarget | null = null;
  let finalized = false;
  const startedAt = performance.now();
  const descriptor: ProSubtitleFormatDescriptor = {
    ...PRO_SUBTITLE_FORMAT_DESCRIPTORS.mp4H264Solid,
    label: "MP4 · H.264 con audio originale"
  };

  try {
    const sourceVideoUrl = settings.sourceVideoUrl?.trim();
    if (!sourceVideoUrl) {
      throw new Error("Carica prima il video originale da sottotitolare.");
    }
    throwIfAborted(signal);

    // Keep the save picker inside the click's transient activation. All media
    // probing and codec checks happen only after the user selected a target.
    const directRequest = settings.suppressDownload ? null : beginCompleteVideoDirectSaveRequest(settings);
    const [blob, directHandle] = await Promise.all([
      fetchSourceVideo(sourceVideoUrl, signal, settings.sourceVideoFile),
      directRequest?.handlePromise ?? Promise.resolve(null)
    ]);
    throwIfAborted(signal);

    input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(blob, { maxCacheSize: 32 * 1024 ** 2 })
    });
    if (!await input.canRead()) {
      throw new Error("Il contenitore del video originale non è supportato.");
    }

    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack()
    ]);
    if (!videoTrack) throw new Error("Il file caricato non contiene una traccia video.");
    if (!await videoTrack.canDecode()) {
      throw new Error("Il browser non riesce a decodificare la traccia video originale.");
    }

    const selectedTracks = audioTrack ? [videoTrack, audioTrack] : [videoTrack];
    const [sourceWidth, sourceHeight, firstTimestamp, endTimestamp] = await Promise.all([
      videoTrack.getDisplayWidth(),
      videoTrack.getDisplayHeight(),
      input.getFirstTimestamp(selectedTracks),
      input.computeDuration(selectedTracks)
    ]);
    const startTimestamp = Math.max(0, firstTimestamp);
    if (
      !Number.isInteger(sourceWidth)
      || !Number.isInteger(sourceHeight)
      || sourceWidth <= 0
      || sourceHeight <= 0
    ) {
      throw new Error("Il video originale dichiara una risoluzione non valida.");
    }
    if (!(endTimestamp > startTimestamp)) {
      throw new Error("La timeline del video originale non contiene un intervallo esportabile.");
    }

    const fullSourceDuration = endTimestamp - startTimestamp;
    const requestedStart = Number.isFinite(settings.sourceStartSeconds)
      ? Math.max(0, settings.sourceStartSeconds ?? 0)
      : 0;
    const requestedDuration = Number.isFinite(settings.sourceDurationSeconds)
      ? Math.max(0, settings.sourceDurationSeconds ?? 0)
      : fullSourceDuration;
    const sourceStartOffset = Math.min(requestedStart, Math.max(0, fullSourceDuration - 1e-9));
    const sourceStartTimestamp = startTimestamp + sourceStartOffset;
    const sourceEndTimestamp = Math.min(
      endTimestamp,
      sourceStartTimestamp + Math.max(1 / 1_000_000, requestedDuration)
    );
    const sourceDuration = sourceEndTimestamp - sourceStartTimestamp;
    if (!(sourceDuration > 0)) throw new Error("Il frammento selezionato non contiene un intervallo esportabile.");
    const localSubtitleCues = rebaseProSubtitleCues(
      settings.subtitleCues,
      sourceStartOffset,
      sourceDuration
    );
    const localSettings: ProSubtitleExportSettings = {
      ...settings,
      durationSeconds: sourceDuration,
      subtitleCues: localSubtitleCues
    };
    validateSettings(localSettings);
    const sourceFrameCount = await countPresentedVideoFrames(
      videoTrack,
      sourceStartTimestamp,
      sourceEndTimestamp,
      signal
    );
    assertCompleteVideoFrameIntegrity(sourceFrameCount, sourceFrameCount);
    const sourceFps = sourceFrameCount / sourceDuration;
    const [averageBitrate, peakBitrate] = await Promise.all([
      videoTrack.getAverageBitrate(),
      videoTrack.getBitrate()
    ]);
    const inputBitrate = averageBitrate ?? peakBitrate ?? 0;
    const targetBitrate = Math.round(Math.max(
      recordingBitrate(sourceWidth, sourceHeight, sourceFps, settings.quality),
      inputBitrate * (settings.quality === "maximum" ? 1.35 : 1.1)
    ));
    const fileName = buildCompleteProSubtitleFileName(settings.projectName);
    exportTarget = await createExportTarget(
      fileName,
      descriptor,
      {
        ...localSettings,
        width: sourceWidth,
        height: sourceHeight,
        fps: sourceFps,
        durationSeconds: sourceDuration
      },
      directHandle
    );
    throwIfAborted(signal);
    await waitForDocumentFonts(signal);
    throwIfAborted(signal);

    const composite = document.createElement("canvas");
    composite.width = sourceWidth;
    composite.height = sourceHeight;
    const context = composite.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas di composizione del video non disponibile.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    output = new Output({
      format: new Mp4OutputFormat(),
      target: exportTarget.target
    });
    let originalAudioSource: EncodedAudioPacketSource | null = null;
    if (audioTrack) {
      const audioCodec = await audioTrack.getCodec();
      if (!audioCodec) {
        throw new Error("Il codec della traccia audio originale non è riconoscibile.");
      }
      originalAudioSource = new EncodedAudioPacketSource(audioCodec);
      const [audioName, audioDisposition] = await Promise.all([
        audioTrack.getName(),
        audioTrack.getDisposition()
      ]);
      output.addAudioTrack(originalAudioSource, {
        ...(audioName ? { name: audioName } : {}),
        disposition: audioDisposition
      });
    }
    let composedFrameCount = 0;
    let encodedFrameCount = 0;
    let copiedAudioAudit: CopiedAudioAudit = { packetCount: 0, payloadBytes: 0 };
    let lastTimestamp = -Infinity;

    conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      trim: { start: sourceStartTimestamp, end: sourceEndTimestamp },
      video: {
        codec: "avc",
        bitrate: targetBitrate,
        alpha: "discard",
        keyFrameInterval: 2,
        hardwareAcceleration: "prefer-hardware",
        forceTranscode: true,
        allowRotationMetadata: false,
        processedWidth: sourceWidth,
        processedHeight: sourceHeight,
        process: (sample) => {
          throwIfAborted(signal);
          if (!Number.isFinite(sample.timestamp) || !Number.isFinite(sample.duration) || sample.duration <= 0) {
            throw new Error(`Timing non valido nel frame sorgente ${composedFrameCount + 1}.`);
          }
          if (sample.timestamp + 1e-9 < lastTimestamp) {
            throw new Error("Il decoder ha restituito frame fuori ordine; l’export è stato annullato.");
          }
          lastTimestamp = sample.timestamp;

          context.clearRect(0, 0, sourceWidth, sourceHeight);
          sample.draw(context, 0, 0, sourceWidth, sourceHeight);
          renderProSubtitleCompositionFrame(
            context,
            localSettings.subtitleCues,
            localSettings.subtitleSettings,
            {
              timeSeconds: Math.min(
                sourceDuration - Number.EPSILON,
                Math.max(0, sample.timestamp - sourceStartTimestamp) + sample.duration / 2
              ),
              width: sourceWidth,
              height: sourceHeight,
              clear: false
            }
          );

          composedFrameCount += 1;
          const elapsedMs = performance.now() - startedAt;
          onProgress({
            currentFrame: composedFrameCount,
            totalFrames: sourceFrameCount,
            progress: Math.min(1, composedFrameCount / sourceFrameCount),
            elapsedMs,
            estimatedRemainingMs: composedFrameCount >= sourceFrameCount
              ? 0
              : elapsedMs / composedFrameCount * (sourceFrameCount - composedFrameCount)
          });
          return composite;
        }
      },
      // Audio is driven manually below so AAC priming never forces the generic
      // conversion path to decode and re-encode the soundtrack.
      audio: { discard: true },
      composable: true,
      showWarnings: false
    });
    if (!conversion.isValid || !conversion.utilizedTracks.includes(videoTrack)) {
      throw new Error("L’encoder H.264 non è disponibile per la risoluzione originale del video.");
    }
    onProgress({
      currentFrame: 0,
      totalFrames: sourceFrameCount,
      progress: 0,
      elapsedMs: performance.now() - startedAt,
      estimatedRemainingMs: 0
    });
    const abortConversion = () => {
      void conversion?.cancel();
      void output?.cancel();
    };
    signal.addEventListener("abort", abortConversion, { once: true });
    try {
      await waitWithTimeout(
        output.start(),
        60_000,
        "L’encoder del video completo non è partito entro 60 secondi.",
        signal
      );
      const operations: Array<Promise<unknown>> = [conversion.execute()];
      if (audioTrack && originalAudioSource) {
        operations.push(copyOriginalAudioPackets(
          audioTrack,
          originalAudioSource,
          sourceStartTimestamp,
          sourceEndTimestamp,
          signal
        ).then((audit) => { copiedAudioAudit = audit; }));
      }
      const operationResults = await Promise.allSettled(operations);
      const failedOperation = operationResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (failedOperation) throw failedOperation.reason;
      throwIfAborted(signal);
      assertCompleteVideoFrameIntegrity(sourceFrameCount, composedFrameCount);

      exportTarget.prepareCommit();
      await waitWithTimeout(
        output.finalize(),
        180_000,
        "Il contenitore MP4 non ha completato la finalizzazione entro 180 secondi.",
        signal
      );
      const finalizedBlob = await exportTarget.getFinalBlob();
      if (!finalizedBlob) {
        throw new Error("Impossibile rileggere il video finalizzato per il controllo anti-drop.");
      }
      const finalAudit = await auditFinalMedia(finalizedBlob, signal);
      encodedFrameCount = finalAudit.videoFrameCount;
      assertCompleteVideoFrameIntegrity(sourceFrameCount, encodedFrameCount);
      if (
        copiedAudioAudit.packetCount !== finalAudit.audioPacketCount
        || copiedAudioAudit.payloadBytes !== finalAudit.audioPayloadBytes
      ) {
        throw new Error(
          `Controllo audio fallito: copiati ${copiedAudioAudit.packetCount} pacchetti (${copiedAudioAudit.payloadBytes} byte), riletti ${finalAudit.audioPacketCount} pacchetti (${finalAudit.audioPayloadBytes} byte).`
        );
      }
      finalized = true;
    } finally {
      signal.removeEventListener("abort", abortConversion);
    }

    let artifactBlob: Blob | null = null;
    if (settings.suppressDownload) {
      await exportTarget.finish();
      artifactBlob = await exportTarget.getFinalBlob();
      if (!artifactBlob) throw new Error("Pro Subtitles non ha prodotto l’artifact video.");
    } else if (exportTarget.bufferTarget) {
      if (!exportTarget.bufferTarget.buffer) {
        throw new Error("L’encoder non ha prodotto alcun file video.");
      }
      downloadBuffer(exportTarget.bufferTarget.buffer, fileName, descriptor.mimeType);
    } else {
      await exportTarget.finish();
    }

    return {
      format: descriptor,
      fileName,
      usedOpaqueWebmFallback: false,
      sourceFrameCount,
      encodedFrameCount,
      copiedAudioPacketCount: copiedAudioAudit.packetCount,
      ...(artifactBlob ? { blob: artifactBlob } : {})
    };
  } catch (error) {
    if (
      error instanceof DOMException
      && (error.name === "QuotaExceededError" || error.message.toLowerCase().includes("storage quota"))
    ) {
      throw new Error("Spazio temporaneo del browser insufficiente. Scegli il file direttamente con Chrome/Edge oppure libera spazio e riprova.");
    }
    throw error;
  } finally {
    renderer.restorePreviewSize();
    setRenderTime(null);
    input?.dispose();

    if (finalized) {
      await exportTarget?.cleanup();
    } else {
      await conversion?.cancel().catch(() => undefined);
      await output?.cancel().catch(() => undefined);
      await exportTarget?.abortPartial();
      await exportTarget?.cleanup();
    }
  }
}

/**
 * Exports only the transparent subtitle renderer. The uploaded guide video is
 * deliberately absent from this composition pipeline.
 */
export async function exportProSubtitleVideo(
  settings: ProSubtitleExportSettings,
  renderer: SharedViewportRenderer,
  setRenderTime: (time: number | null) => void,
  signal: AbortSignal,
  onProgress: (progress: ExportProgress) => void
): Promise<ProSubtitleExportResult> {
  if (settings.outputMode === "completeVideo") {
    return exportCompleteProSubtitleVideo(
      settings,
      renderer,
      setRenderTime,
      signal,
      onProgress
    );
  }

  let output: Output | null = null;
  let exportTarget: ExportTarget | null = null;
  let finalized = false;
  const pendingOperations = new Set<Promise<unknown>>();
  const startedAt = performance.now();

  const trackOperation = <T,>(promise: Promise<T>): Promise<T> => {
    pendingOperations.add(promise);
    void promise.then(
      () => pendingOperations.delete(promise),
      () => pendingOperations.delete(promise)
    );
    return promise;
  };

  try {
    validateSettings(settings);
    throwIfAborted(signal);

    if (settings.format === "movProRes4444") throw new Error(PRORES_WEB_REASON);
    // Acquire the handle before the first await/probe, while the export button
    // still grants a transient user activation.
    const directRequest = beginDirectSaveRequest(settings);
    const capabilitiesPromise = probeProSubtitleExportCapabilities(
      settings.width,
      settings.height,
      settings.quality
    );
    const [capabilities, requestedHandle] = await Promise.all([
      capabilitiesPromise,
      directRequest?.handlePromise ?? Promise.resolve(null)
    ]);
    throwIfAborted(signal);
    const plan = resolveProSubtitleExportPlan(settings, capabilities);
    // The preview requests every global/local subtitle family through
    // document.fonts. Waiting for that same FontFaceSet prevents the first
    // exported frames from falling back to a system font while the preview
    // already shows the intended typography.
    await waitForDocumentFonts(signal);
    throwIfAborted(signal);
    const fileName = buildProSubtitleFileName(
      settings.projectName,
      settings.width,
      settings.height,
      settings.fps,
      plan.descriptor
    );
    // An AVC -> explicit VP9 fallback changes the extension. Never write WebM
    // bytes into the MP4 file selected optimistically before the codec probe.
    const directHandle = directRequest?.descriptorId === plan.descriptor.id
      ? requestedHandle
      : null;
    exportTarget = await createExportTarget(
      fileName,
      plan.descriptor,
      settings,
      directHandle
    );
    throwIfAborted(signal);

    const composite = document.createElement("canvas");
    composite.width = settings.width;
    composite.height = settings.height;
    const context = composite.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas di composizione trasparente non disponibile.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const source = new CanvasSource(composite, {
      codec: plan.descriptor.codec === "avc" ? "avc" : "vp9",
      bitrate: encodingQuality(settings.quality),
      alpha: plan.alpha,
      latencyMode: "quality",
      keyFrameInterval: 2,
      contentHint: "text"
    });
    const outputFormat = plan.descriptor.mimeType === "video/mp4"
      ? new Mp4OutputFormat()
      : new WebMOutputFormat();
    output = new Output({ format: outputFormat, target: exportTarget.target });
    output.addVideoTrack(source, { frameRate: settings.fps });

    const startPromise = trackOperation(output.start());
    await waitWithTimeout(
      startPromise,
      60_000,
      "L’encoder non è partito entro 60 secondi.",
      signal
    );

    const totalFrames = proSubtitleFrameCount(settings.durationSeconds, settings.fps);
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      throwIfAborted(signal);
      const timing = proSubtitleFrameTiming(
        frameIndex,
        settings.durationSeconds,
        settings.fps
      );
      const sampleTime = Math.min(
        settings.durationSeconds - Number.EPSILON,
        timing.timestampSeconds + timing.durationSeconds / 2
      );

      context.clearRect(0, 0, settings.width, settings.height);
      if (settings.backgroundMode === "solid") {
        context.fillStyle = settings.backgroundColor;
        context.fillRect(0, 0, settings.width, settings.height);
      }
      // ProSubtitles is a 2D RGBA composition. Rendering it directly into the
      // encoder canvas avoids the fragile canvas -> WebGL texture -> readback
      // round trip that could yield a valid video containing no text.
      renderProSubtitleCompositionFrame(
        context,
        settings.subtitleCues,
        settings.subtitleSettings,
        {
          // Sampling at the centre of the encoded frame prevents a short cue
          // between two frame boundaries from disappearing completely.
          timeSeconds: sampleTime,
          width: settings.width,
          height: settings.height,
          clear: false
        }
      );
      const addPromise = trackOperation(
        source.add(timing.timestampSeconds, timing.durationSeconds)
      );
      await waitWithTimeout(
        addPromise,
        120_000,
        `L’encoder è rimasto bloccato sul frame ${frameIndex + 1}. L’export è stato interrotto senza produrre una coda nera.`,
        signal
      );

      const currentFrame = frameIndex + 1;
      const elapsedMs = performance.now() - startedAt;
      onProgress({
        currentFrame,
        totalFrames,
        progress: currentFrame / totalFrames,
        elapsedMs,
        estimatedRemainingMs: currentFrame === totalFrames
          ? 0
          : elapsedMs / currentFrame * (totalFrames - currentFrame)
      });
    }

    throwIfAborted(signal);
    exportTarget.prepareCommit();
    const finalizePromise = trackOperation(output.finalize());
    await waitWithTimeout(
      finalizePromise,
      120_000,
      "L’encoder non ha finalizzato il video entro 120 secondi.",
      signal
    );
    finalized = true;

    let artifactBlob: Blob | null = null;
    if (settings.suppressDownload) {
      await exportTarget.finish();
      artifactBlob = await exportTarget.getFinalBlob();
      if (!artifactBlob) throw new Error("Pro Subtitles non ha prodotto l’artifact layer.");
    } else if (exportTarget.bufferTarget) {
      if (!exportTarget.bufferTarget.buffer) {
        throw new Error("L’encoder non ha prodotto alcun file video.");
      }
      downloadBuffer(
        exportTarget.bufferTarget.buffer,
        fileName,
        plan.descriptor.mimeType
      );
    } else await exportTarget.finish();

    return {
      format: plan.descriptor,
      fileName,
      usedOpaqueWebmFallback: plan.usedOpaqueWebmFallback,
      ...(artifactBlob ? { blob: artifactBlob } : {})
    };
  } catch (error) {
    if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.message.toLowerCase().includes("storage quota"))) {
      throw new Error("Spazio temporaneo del browser insufficiente. Usa Chrome/Edge per il salvataggio progressivo diretto oppure riduci risoluzione, frame rate o durata.");
    }
    throw error;
  } finally {
    renderer.restorePreviewSize();
    setRenderTime(null);

    if (finalized) {
      await exportTarget?.cleanup();
    } else {
      const abortPartial = exportTarget?.abortPartial() ?? Promise.resolve();
      const cancel = output && output.state !== "canceled" && output.state !== "finalized"
        ? output.cancel().catch(() => undefined)
        : Promise.resolve();
      const lifecycle = Promise.allSettled([
        ...pendingOperations,
        abortPartial,
        cancel
      ]).then(() => exportTarget?.cleanup());

      // WebCodecs has no portable hard-abort for an encoder already inside
      // finalize(). Keep the UI responsive after a bounded best-effort cancel,
      // but defer OPFS deletion until that live operation has actually settled.
      if (!await settlesWithin(lifecycle, 3_000)) {
        void lifecycle.catch(() => undefined);
      }
    }
  }
}

/**
 * Adapter for Video Editor jobs. It intentionally reuses the complete-video
 * compositor (including original audio and frame audit) while returning the
 * final Blob instead of opening a download dialog.
 */
export async function processProSubtitleVideo(
  settings: ProSubtitleExportSettings,
  renderer: SharedViewportRenderer,
  signal: AbortSignal,
  onProgress: (progress: ExportProgress) => void
): Promise<ProSubtitleExportResult & { blob: Blob }> {
  const result = await exportProSubtitleVideo(
    {
      ...settings,
      outputMode: "completeVideo",
      suppressDownload: true
    },
    renderer,
    () => undefined,
    signal,
    onProgress
  );
  if (!result.blob) throw new Error("Pro Subtitles non ha prodotto un artifact video.");
  return result as ProSubtitleExportResult & { blob: Blob };
}
