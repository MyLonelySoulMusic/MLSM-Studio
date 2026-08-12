import { extractPaletteFromImage } from "./image-palette";
import { getLocalObjectDetector, localModelErrorMessage, type LocalObjectDetector } from "./local-model-runtime";

export interface BackgroundAutoBoundingBox { x: number; y: number; width: number; height: number }
export interface BackgroundAutoDetection { id: string; label: string; alias: string; score: number; bbox: BackgroundAutoBoundingBox; isPerson: boolean; paletteMode?: "auto" | "manual"; palette?: [string, string, string] | null }
export interface BackgroundAutoDetectionResult { detections: BackgroundAutoDetection[]; palette: [string, string, string]; personCount: number; sourceWidth: number; sourceHeight: number }
export interface BackgroundAutoDetectionOptions { threshold?: number; signal?: AbortSignal; onProgress?: (message: string) => void; detector?: LocalObjectDetector }
export const DEFAULT_BACKGROUND_AUTO_DETECTION_THRESHOLD = .15;
const MAX_BACKGROUND_AUTO_DETECTIONS = 256;

/**
 * Person Animation used to infer a global filter from the detector output.
 * Detection is now always user-driven, so this legacy validation helper is
 * intentionally a no-op. It remains exported for old callers and projects.
 */
export function backgroundAutoPersonDetectionError(detections: readonly BackgroundAutoDetection[], personAnimationEnabled: boolean): string | null { void detections; void personAnimationEnabled; return null; }

/** DETR labels vary slightly between model revisions and translated models. */
export function isBackgroundAutoPersonLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return new Set(["person", "people", "human", "man", "woman", "men", "women"]).has(normalized);
}

function clamp(value: number, minimum = 0, maximum = 1): number { return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum)); }
function stableId(label: string, box: BackgroundAutoBoundingBox, index: number): string {
  const source = `${label}:${box.x.toFixed(5)}:${box.y.toFixed(5)}:${box.width.toFixed(5)}:${box.height.toFixed(5)}:${index}`;
  let hash = 2166136261;
  for (const character of source) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `det-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeBox(raw: unknown, width: number, height: number): BackgroundAutoBoundingBox | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const read = (key: string) => typeof value[key] === "number" ? Number(value[key]) : NaN;
  const xmin = read("xmin"); const ymin = read("ymin"); const xmax = read("xmax"); const ymax = read("ymax");
  if (![xmin, ymin, xmax, ymax].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const x = clamp(xmin / width); const y = clamp(ymin / height); const right = clamp(xmax / width); const bottom = clamp(ymax / height);
  return { x, y, width: clamp(right - x), height: clamp(bottom - y) };
}

function intersectionOverUnion(left: BackgroundAutoBoundingBox, right: BackgroundAutoBoundingBox): number {
  const x1 = Math.max(left.x, right.x); const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width); const y2 = Math.min(left.y + left.height, right.y + right.height);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = left.width * left.height + right.width * right.height - overlap;
  return union > 0 ? overlap / union : 0;
}

/**
 * Normalize DETR's closed-vocabulary output without silently throwing away
 * supported classes. A small class-aware NMS pass only removes duplicate
 * boxes from model revisions that emit the same class more than once.
 */
export function normalizeBackgroundAutoDetections(raw: unknown, width: number, height: number, threshold = DEFAULT_BACKGROUND_AUTO_DETECTION_THRESHOLD): BackgroundAutoDetection[] {
  if (!Array.isArray(raw)) return [];
  const normalized = raw.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const value = candidate as Record<string, unknown>;
    const score = clamp(typeof value.score === "number" ? value.score : 0);
    const label = typeof value.label === "string" && value.label.trim() ? value.label.trim() : "Object";
    const bbox = normalizeBox(value.box ?? value.bbox, width, height);
    if (!bbox || score < threshold || bbox.width <= .002 || bbox.height <= .002) return [];
    const isPerson = isBackgroundAutoPersonLabel(label);
    return [{ id: stableId(label, bbox, index), label, alias: label, score: Number(score.toFixed(4)), bbox, isPerson }];
  });
  const byConfidence = [...normalized].sort((left, right) => right.score - left.score || left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  const kept: BackgroundAutoDetection[] = [];
  for (const candidate of byConfidence) {
    const duplicate = kept.some((other) => other.label.toLowerCase() === candidate.label.toLowerCase() && intersectionOverUnion(other.bbox, candidate.bbox) > .82);
    if (!duplicate) kept.push(candidate);
    if (kept.length >= MAX_BACKGROUND_AUTO_DETECTIONS) break;
  }
  return kept.sort((left, right) => left.bbox.y - right.bbox.y || left.bbox.x - right.bbox.x || left.label.localeCompare(right.label) || right.score - left.score);
}

function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Detection cancelled", "AbortError")); return; }
    const image = new Image();
    const abort = () => { image.src = ""; reject(new DOMException("Detection cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    image.onload = () => { signal?.removeEventListener("abort", abort); resolve(image); };
    image.onerror = () => { signal?.removeEventListener("abort", abort); reject(new Error("Unable to read the image for detection.")); };
    image.src = url;
  });
}

export async function detectBackgroundObjects(imageUrl: string, options: BackgroundAutoDetectionOptions = {}): Promise<BackgroundAutoDetectionResult> {
  if (!imageUrl) throw new Error("Upload an image before detection.");
  if (options.signal?.aborted) throw new DOMException("Detection cancelled", "AbortError");
  options.onProgress?.("Loading image…");
  const image = await loadImage(imageUrl, options.signal);
  options.onProgress?.("Preparing DETR model…");
  const detector = options.detector ?? await getLocalObjectDetector("detr-resnet-50", options.onProgress);
  options.onProgress?.("Detecting objects…");
  let output: unknown;
  try {
    const threshold = options.threshold ?? DEFAULT_BACKGROUND_AUTO_DETECTION_THRESHOLD;
    output = await detector(imageUrl, { threshold });
  } catch (error) {
    throw new Error(localModelErrorMessage(error), { cause: error });
  }
  if (options.signal?.aborted) throw new DOMException("Detection cancelled", "AbortError");
  const threshold = options.threshold ?? DEFAULT_BACKGROUND_AUTO_DETECTION_THRESHOLD;
  const normalizedDetections = normalizeBackgroundAutoDetections(output, image.naturalWidth, image.naturalHeight, threshold);
  const extracted = await extractPaletteFromImage(imageUrl, 3).catch(() => ["#63f0d1", "#7657ff", "#ff4f9a"]);
  const palette = [extracted[0] ?? "#63f0d1", extracted[1] ?? extracted[0] ?? "#7657ff", extracted[2] ?? extracted[1] ?? "#ff4f9a"] as [string, string, string];
  const detections = normalizedDetections.map((detection) => ({ ...detection, paletteMode: "auto" as const, palette }));
  options.onProgress?.(`${detections.length} object${detections.length === 1 ? "" : "s"} detected · palette ready`);
  return { detections, palette, personCount: detections.filter((item) => item.isPerson).length, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight };
}
