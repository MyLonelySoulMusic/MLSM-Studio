export type UpscalerMediaKind = "image" | "video";

export interface SupportedUpscalerMediaFile {
  supported: true;
  kind: UpscalerMediaKind;
  extension: string;
  mimeType: string;
}

export interface UnsupportedUpscalerMediaFile {
  supported: false;
  reason: "unsupported-extension" | "unsupported-mime" | "mime-extension-mismatch";
  message: string;
}

export type UpscalerMediaFileClassification = SupportedUpscalerMediaFile | UnsupportedUpscalerMediaFile;

export interface UpscalerMediaMetadata {
  kind: UpscalerMediaKind;
  width: number;
  height: number;
  duration: number;
}

interface MediaExtensionPolicy {
  kind: UpscalerMediaKind;
  mimeTypes: readonly string[];
}

const MEDIA_BY_EXTENSION: Readonly<Record<string, MediaExtensionPolicy>> = {
  png: { kind: "image", mimeTypes: ["image/png"] },
  jpg: { kind: "image", mimeTypes: ["image/jpeg", "image/jpg"] },
  jpeg: { kind: "image", mimeTypes: ["image/jpeg", "image/jpg"] },
  webp: { kind: "image", mimeTypes: ["image/webp"] },
  avif: { kind: "image", mimeTypes: ["image/avif"] },
  mp4: { kind: "video", mimeTypes: ["video/mp4"] },
  webm: { kind: "video", mimeTypes: ["video/webm"] },
  mov: { kind: "video", mimeTypes: ["video/quicktime"] },
  m4v: { kind: "video", mimeTypes: ["video/x-m4v", "video/mp4"] }
};

const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream", "application/x-octet-stream", "binary/octet-stream"]);

function normalizedMimeType(file: Pick<File, "type">): string {
  return file.type.split(";", 1)[0]!.trim().toLowerCase();
}

function normalizedExtension(file: Pick<File, "name">): string {
  const lastDot = file.name.lastIndexOf(".");
  return lastDot >= 0 && lastDot < file.name.length - 1 ? file.name.slice(lastDot + 1).trim().toLowerCase() : "";
}

/**
 * Classifies Upscaler inputs with one fail-closed policy:
 * - only the extensions in MEDIA_BY_EXTENSION are accepted;
 * - an empty or generic binary MIME is inferred from a supported extension;
 * - a specific MIME must match that extension exactly;
 * - unknown extensions and MIME/extension disagreement are rejected.
 */
export function classifyUpscalerMediaFile(file: Pick<File, "name" | "type">): UpscalerMediaFileClassification {
  const extension = normalizedExtension(file);
  const policy = MEDIA_BY_EXTENSION[extension];
  if (!policy) {
    return { supported: false, reason: "unsupported-extension", message: extension ? `Estensione .${extension} non supportata.` : "Estensione file mancante o non supportata." };
  }

  const mimeType = normalizedMimeType(file);
  if (GENERIC_MIME_TYPES.has(mimeType)) return { supported: true, kind: policy.kind, extension, mimeType };
  if (policy.mimeTypes.includes(mimeType)) return { supported: true, kind: policy.kind, extension, mimeType };

  const knownMime = Object.values(MEDIA_BY_EXTENSION).some((candidate) => candidate.mimeTypes.includes(mimeType));
  return {
    supported: false,
    reason: knownMime ? "mime-extension-mismatch" : "unsupported-mime",
    message: knownMime ? `MIME ${mimeType} non coerente con .${extension}.` : `MIME ${mimeType} non supportato per .${extension}.`
  };
}

function abortError(): DOMException {
  return new DOMException("Operazione annullata.", "AbortError");
}

export function readUpscalerMediaMetadata(file: File, url: string, classification: UpscalerMediaFileClassification = classifyUpscalerMediaFile(file), signal?: AbortSignal): Promise<UpscalerMediaMetadata> {
  if (!classification.supported) return Promise.reject(new Error(classification.message));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    let settled = false;
    const settle = (cleanup: () => void, callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      cleanup();
      callback();
    };
    let abortCleanup: () => void = () => undefined;
    const onAbort = () => settle(abortCleanup, () => reject(abortError()));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (classification.kind === "video") {
      const video = document.createElement("video");
      const cleanup = () => { video.onloadedmetadata = null; video.onerror = null; video.src = ""; };
      abortCleanup = cleanup;
      video.preload = "metadata";
      video.onloadedmetadata = () => { const metadata = { kind: "video" as const, width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : 0 }; settle(cleanup, () => resolve(metadata)); };
      video.onerror = () => settle(cleanup, () => reject(new Error("Video non leggibile.")));
      video.src = url;
      return;
    }
    const image = new Image();
    const cleanup = () => { image.onload = null; image.onerror = null; image.src = ""; };
    abortCleanup = cleanup;
    image.onload = () => { const metadata = { kind: "image" as const, width: image.naturalWidth, height: image.naturalHeight, duration: 0 }; settle(cleanup, () => resolve(metadata)); };
    image.onerror = () => settle(cleanup, () => reject(new Error("Immagine non leggibile.")));
    image.src = url;
  });
}
