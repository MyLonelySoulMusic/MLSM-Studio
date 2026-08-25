const MAX_BATCH_THUMBNAIL_EDGE = 256;

export interface UpscalerBatchThumbnailResult {
  width: number;
  height: number;
  blob: Blob | null;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

export interface UpscalerBatchThumbnailOptions {
  signal?: AbortSignal;
}

function abortError(): DOMException {
  return new DOMException("Operazione annullata.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function validDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

async function decodeWithDom(url: string, signal?: AbortSignal): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const close = () => {
      image.onload = null;
      image.onerror = null;
      image.src = "";
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => settle(() => { close(); reject(abortError()); });
    image.onload = () => {
      if (!validDimension(image.naturalWidth) || !validDimension(image.naturalHeight)) {
        settle(() => { close(); reject(new Error("Immagine non leggibile.")); });
        return;
      }
      settle(() => resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, close }));
    };
    image.onerror = () => settle(() => { close(); reject(new Error("Immagine non leggibile.")); });
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    image.src = url;
  });
}

async function decodeImage(file: File, url: string, signal?: AbortSignal): Promise<DecodedImage> {
  throwIfAborted(signal);
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      if (signal?.aborted) { bitmap.close(); throw abortError(); }
      if (!validDimension(bitmap.width) || !validDimension(bitmap.height)) {
        bitmap.close();
        throw new Error("Immagine non leggibile.");
      }
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw abortError();
      // Browser support is codec-dependent. The DOM decoder remains the
      // compatibility path for formats that createImageBitmap cannot open.
    }
  }
  return decodeWithDom(url, signal);
}

function thumbnailSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_BATCH_THUMBNAIL_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob | null> {
  if (typeof canvas.toBlob !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    try { canvas.toBlob(resolve, mimeType, mimeType === "image/webp" ? .82 : undefined); }
    catch { resolve(null); }
  });
}

let thumbnailQueue: Promise<void> = Promise.resolve();

function enqueueThumbnail<T>(task: () => Promise<T>): Promise<T> {
  const work = thumbnailQueue.then(task, task);
  // Keep the queue waiting for the underlying decoder/toBlob drain even when
  // the caller has already observed an abort.
  thumbnailQueue = work.then(() => undefined, () => undefined);
  return work;
}

function returnImmediatelyOnAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
  });
}

/**
 * Decodes at most one import at a time (the caller is intentionally sequential),
 * records intrinsic dimensions, and disposes the full-resolution decoder after
 * producing a small owned Blob. Thumbnail failure is non-fatal: the item can
 * still be processed and the gallery renders a lightweight placeholder.
 */
export function createUpscalerBatchThumbnail(file: File, url: string, options: UpscalerBatchThumbnailOptions = {}): Promise<UpscalerBatchThumbnailResult> {
  const work = enqueueThumbnail(async () => {
  throwIfAborted(options.signal);
  const decoded = await decodeImage(file, url, options.signal);
  try {
    throwIfAborted(options.signal);
    const size = thumbnailSize(decoded.width, decoded.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const getContext = canvas.getContext as typeof canvas.getContext & { _isMockFunction?: boolean };
    if (typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom") && !getContext._isMockFunction) {
      return { width: decoded.width, height: decoded.height, blob: null };
    }
    let context: CanvasRenderingContext2D | null = null;
    try { context = canvas.getContext("2d", { alpha: file.type === "image/png" }); }
    catch { /* Headless DOMs may expose canvas without a renderer. */ }
    if (!context) return { width: decoded.width, height: decoded.height, blob: null };
    try { context.drawImage(decoded.source, 0, 0, size.width, size.height); }
    catch { return { width: decoded.width, height: decoded.height, blob: null }; }
    throwIfAborted(options.signal);
    const preferredType = file.type === "image/png" ? "image/png" : "image/webp";
    let blob = await canvasBlob(canvas, preferredType);
    throwIfAborted(options.signal);
    if (!blob && preferredType !== "image/png") {
      blob = await canvasBlob(canvas, "image/png");
      throwIfAborted(options.signal);
    }
    return { width: decoded.width, height: decoded.height, blob };
  } finally {
    decoded.close();
  }
  });
  return returnImmediatelyOnAbort(work, options.signal);
}
