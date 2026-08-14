import type { VideoEditorAsset } from "./video-editor";

const videoPattern = /\.(?:mp4|webm|mov|m4v|mkv|avi)$/i;
const imagePattern = /\.(?:png|jpe?g|webp|avif|gif|bmp)$/i;
const audioPattern = /\.(?:mp3|wav|m4a|aac|flac|ogg|opus)$/i;

/** Estensioni e MIME accettati dal pool media, pronti per l’attributo `accept`. */
export const videoEditorAcceptedFiles = "video/*,image/*,audio/*,.mp4,.webm,.mov,.m4v,.mkv,.avi,.png,.jpg,.jpeg,.webp,.avif,.gif,.bmp,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus";
export const videoEditorAssetDragType = "application/x-mlsm-video-editor-asset";
/** Tipo secondario del drag: consente alla timeline di rifiutare subito un
 * media sulla corsia sbagliata senza affidarsi a fallback impliciti. */
export const videoEditorAssetKindDragType = "application/x-mlsm-video-editor-asset-kind";

export function videoEditorAssetKind(file: File): VideoEditorAsset["kind"] | null {
  if (file.type.startsWith("video/") || videoPattern.test(file.name)) return "video";
  if (file.type.startsWith("image/") || imagePattern.test(file.name)) return "image";
  if (file.type.startsWith("audio/") || audioPattern.test(file.name)) return "audio";
  return null;
}

function probeVideo(url: string): Promise<{ durationSeconds: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    let settled = false;
    const cleanup = () => { video.onloadedmetadata = null; video.onerror = null; window.clearTimeout(timeout); video.removeAttribute("src"); video.load(); };
    const finish = (value?: { durationSeconds: number; width: number; height: number }, error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error || !value || !Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0) reject(error ?? new Error("Durata video non valida."));
      else resolve(value);
    };
    const timeout = window.setTimeout(() => finish(undefined, new Error("Timeout durante la lettura del video.")), 15_000);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => finish({ durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => finish(undefined, new Error("Il browser non riesce a leggere i metadati del video."));
    video.src = url;
    video.load();
  });
}

function probeImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Il browser non riesce a leggere l’immagine."));
    image.src = url;
  });
}

function captureVideoThumbnail(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      video.onloadedmetadata = null; video.onseeked = null; video.onerror = null;
      video.removeAttribute("src"); video.load(); resolve(value);
    };
    const draw = () => {
      if (!video.videoWidth || !video.videoHeight) { finish(null); return; }
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 480 / video.videoWidth);
      canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) { finish(null); return; }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => finish(blob ? URL.createObjectURL(blob) : null), "image/jpeg", .82);
    };
    const timeout = window.setTimeout(() => finish(null), 12_000);
    video.preload = "auto"; video.muted = true; video.playsInline = true;
    video.onloadedmetadata = () => {
      const sample = Math.min(Math.max(0, video.duration - .02), Math.min(.15, video.duration * .05));
      if (sample <= .001) draw(); else video.currentTime = sample;
    };
    video.onseeked = draw;
    video.onerror = () => finish(null);
    video.src = url; video.load();
  });
}

interface DecodedAudio { durationSeconds: number; channels: number; waveform: number[] }

/**
 * Decodifica l’audio in un profilo min/max a 2048 punti: la stessa forma d’onda
 * usata dal resto dello studio, così la timeline mostra il suono senza ricalcoli.
 */
async function decodeAudio(bytes: ArrayBuffer): Promise<DecodedAudio> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0));
    const channel = decoded.getChannelData(0);
    const points = 1024;
    const bucketSize = Math.max(1, Math.ceil(channel.length / points));
    const waveform: number[] = [];
    for (let offset = 0; offset < channel.length; offset += bucketSize) {
      let minimum = 1;
      let maximum = -1;
      for (let index = offset; index < Math.min(offset + bucketSize, channel.length); index += 1) {
        const sample = channel[index] ?? 0;
        minimum = Math.min(minimum, sample);
        maximum = Math.max(maximum, sample);
      }
      waveform.push(minimum, maximum);
    }
    return { durationSeconds: decoded.duration, channels: decoded.numberOfChannels, waveform };
  } finally { await context.close(); }
}

export interface VideoEditorImportedAsset { asset: VideoEditorAsset; file: File }

/**
 * Porta un file nel pool media leggendone le proprietà reali. Un video privo di
 * traccia audio decodificabile resta perfettamente valido: entra come sorgente
 * solo visiva anziché essere rifiutato.
 */
export async function importVideoEditorAsset(file: File): Promise<VideoEditorImportedAsset> {
  const kind = videoEditorAssetKind(file);
  if (!kind) throw new Error(`${file.name}: formato non riconosciuto. Usa video, immagini o audio.`);
  const url = URL.createObjectURL(file);
  const id = `video-editor-asset-${crypto.randomUUID()}`;
  const base = { id, name: file.name, kind, url, thumbnailUrl: null as string | null, bpm: null, beats: [] as number[], downbeats: [] as number[] };
  try {
    if (kind === "image") {
      const size = await probeImage(url);
      return { asset: { ...base, thumbnailUrl: url, durationSeconds: 0, width: size.width, height: size.height, hasAudio: false, waveform: [] }, file };
    }
    if (kind === "audio") {
      const decoded = await decodeAudio(await file.arrayBuffer());
      return { asset: { ...base, durationSeconds: decoded.durationSeconds, width: 0, height: 0, hasAudio: true, waveform: decoded.waveform }, file };
    }
    const probe = await probeVideo(url);
    let waveform: number[] = [];
    let hasAudio = false;
    try {
      const decoded = await decodeAudio(await file.arrayBuffer());
      waveform = decoded.waveform;
      hasAudio = decoded.channels > 0;
    } catch { /* Video senza audio utilizzabile: resta una sorgente visiva valida. */ }
    const thumbnailUrl = await captureVideoThumbnail(url);
    return { asset: { ...base, thumbnailUrl, durationSeconds: probe.durationSeconds, width: probe.width, height: probe.height, hasAudio, waveform }, file };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export interface VideoEditorImportReport { assets: VideoEditorAsset[]; files: Map<string, File>; errors: string[] }

/** Importa più file in parallelo riportando i singoli fallimenti senza fermare gli altri. */
export async function importVideoEditorAssets(files: readonly File[]): Promise<VideoEditorImportReport> {
  const results = await Promise.allSettled(files.map((file) => importVideoEditorAsset(file)));
  const assets: VideoEditorAsset[] = [];
  const fileMap = new Map<string, File>();
  const errors: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") { assets.push(result.value.asset); fileMap.set(result.value.asset.id, result.value.file); }
    else errors.push(`${files[index]?.name ?? "File"}: ${result.reason instanceof Error ? result.reason.message : "importazione non riuscita"}`);
  });
  return { assets, files: fileMap, errors };
}

/**
 * I `File` non entrano nel progetto salvato (contiene solo i metadati), ma l’export
 * offline deve poter rileggere i byte originali: questo registro tiene il legame
 * fra id del media e file scelto dall’utente per la durata della sessione.
 */
const sessionFiles = new Map<string, File>();

export function registerVideoEditorFiles(files: Map<string, File>): void {
  for (const [assetId, file] of files) sessionFiles.set(assetId, file);
}

export function videoEditorSessionFile(assetId: string): File | null {
  return sessionFiles.get(assetId) ?? null;
}

export function forgetVideoEditorFile(assetId: string): void {
  sessionFiles.delete(assetId);
}
