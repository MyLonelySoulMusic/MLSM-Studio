import type { RhythmBallProject } from "@rbs/project-schema";
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { normalizedWatermarkRegion, resolveReferencePlacement } from "./static-watermark-renderer";

type Settings = RhythmBallProject["animation"]["staticWatermark"];
type Fingerprint = Float32Array;

export interface TemporalAlignmentResult {
  offsetSeconds: number;
  confidence: number;
  comparedFrames: number;
  sourceFrameRate?: number;
  referenceFrameRate?: number;
  sourceDurationSeconds?: number;
  referenceDurationSeconds?: number;
}

export interface SpatialAlignmentResult {
  canvas: HTMLCanvasElement;
  offsetX: number;
  offsetY: number;
  confidence: number;
  usedFallback: boolean;
}

const abortError = () => new DOMException("Analisi allineamento annullata", "AbortError");
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export function frameRatesDiffer(sourceFrameRate: number, referenceFrameRate: number): boolean {
  if (!(sourceFrameRate > 0 && referenceFrameRate > 0)) return false;
  return Math.abs(sourceFrameRate - referenceFrameRate) > Math.max(.1, Math.min(sourceFrameRate, referenceFrameRate) * .005);
}

function throwIfAborted(signal: AbortSignal) { if (signal.aborted) throw abortError(); }

function fingerprint(source: CanvasImageSource, region: Settings["region"]): Fingerprint {
  const width = 32; const height = 18;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas di analisi non disponibile.");
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const cleanRegion = normalizedWatermarkRegion({ region });
  const left = Math.floor(cleanRegion.x * width) - 1; const top = Math.floor(cleanRegion.y * height) - 1;
  const right = Math.ceil((cleanRegion.x + cleanRegion.width) * width) + 1; const bottom = Math.ceil((cleanRegion.y + cleanRegion.height) * height) + 1;
  const gray = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = (pixels[offset] ?? 0) * .2126 + (pixels[offset + 1] ?? 0) * .7152 + (pixels[offset + 2] ?? 0) * .0722;
  }
  const values: number[] = [];
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    if (x >= left && x <= right && y >= top && y <= bottom) continue;
    const index = y * width + x;
    values.push((gray[index + 1]! - gray[index - 1]!) * .5, (gray[index + width]! - gray[index - width]!) * .5);
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  let energy = 0;
  for (const value of values) energy += (value - mean) ** 2;
  const deviation = Math.sqrt(energy / Math.max(1, values.length)) || 1;
  return Float32Array.from(values, value => (value - mean) / deviation);
}

export function fingerprintSimilarity(a: Fingerprint, b: Fingerprint): number {
  const length = Math.min(a.length, b.length);
  if (!length) return -1;
  let dot = 0; let aa = 0; let bb = 0;
  for (let index = 0; index < length; index += 1) { const av = a[index] ?? 0; const bv = b[index] ?? 0; dot += av * bv; aa += av * av; bb += bv * bv; }
  return aa > 1e-6 && bb > 1e-6 ? clamp(dot / Math.sqrt(aa * bb), -1, 1) : 0;
}

export function selectTemporalOffset(source: readonly { time: number; fingerprint: Fingerprint }[], reference: readonly { time: number; fingerprint: Fingerprint }[], candidates: readonly number[]): TemporalAlignmentResult {
  if (!source.length || !reference.length || !candidates.length) return { offsetSeconds: 0, confidence: 0, comparedFrames: 0 };
  const scored = candidates.map((offsetSeconds) => {
    let total = 0; let comparedFrames = 0;
    for (const sourceFrame of source) {
      const wanted = sourceFrame.time + offsetSeconds;
      let best: typeof reference[number] | undefined;
      let distance = Infinity;
      for (const candidate of reference) { const nextDistance = Math.abs(candidate.time - wanted); if (nextDistance < distance) { best = candidate; distance = nextDistance; } }
      if (!best || distance > .075) continue;
      total += fingerprintSimilarity(sourceFrame.fingerprint, best.fingerprint); comparedFrames += 1;
    }
    return { offsetSeconds, score: comparedFrames ? total / comparedFrames : -1, comparedFrames };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const independentRunnerUp = scored.find(item => Math.abs(item.offsetSeconds - best.offsetSeconds) >= .25) ?? scored[1] ?? best;
  const quality = clamp((best.score + 1) / 2, 0, 1);
  const margin = clamp(best.score - independentRunnerUp.score, 0, 1);
  return { offsetSeconds: best.offsetSeconds, confidence: clamp(quality * .86 + margin * .7, 0, 1), comparedFrames: best.comparedFrames };
}

async function decodeFingerprints(sink: CanvasSink, timestamps: readonly number[], firstTimestamp: number, region: Settings["region"], signal: AbortSignal) {
  const result: Array<{ time: number; fingerprint: Fingerprint }> = [];
  let index = 0;
  for await (const frame of sink.canvasesAtTimestamps(timestamps, { skipLiveWait: true })) {
    throwIfAborted(signal);
    const timestamp = timestamps[index++]!;
    if (frame) result.push({ time: timestamp - firstTimestamp, fingerprint: fingerprint(frame.canvas, region) });
  }
  return result;
}

async function mediaBlob(url: string, file: Blob | null | undefined, signal: AbortSignal, label: string) {
  if (file?.size) return file;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}.`);
  const blob = await response.blob();
  if (!blob.size) throw new Error(`${label}: file vuoto.`);
  return blob;
}

export async function analyzeStaticWatermarkVideoAlignment(options: {
  sourceUrl: string;
  referenceUrl: string;
  region: Settings["region"];
  searchSeconds: number;
  signal: AbortSignal;
  sourceFile?: Blob | null;
  referenceFile?: Blob | null;
  sourceStartSeconds?: number;
}): Promise<TemporalAlignmentResult> {
  const [sourceBlob, referenceBlob] = await Promise.all([
    mediaBlob(options.sourceUrl, options.sourceFile, options.signal, "Video con watermark non accessibile"),
    mediaBlob(options.referenceUrl, options.referenceFile, options.signal, "Video pulito non accessibile"),
  ]);
  const sourceInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(sourceBlob, { maxCacheSize: 16 * 1024 ** 2 }) });
  const referenceInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(referenceBlob, { maxCacheSize: 16 * 1024 ** 2 }) });
  try {
    const [sourceTrack, referenceTrack] = await Promise.all([sourceInput.getPrimaryVideoTrack(), referenceInput.getPrimaryVideoTrack()]);
    if (!sourceTrack || !referenceTrack) throw new Error("Entrambi i file devono contenere una traccia video.");
    if (!await sourceTrack.canDecode() || !await referenceTrack.canDecode()) throw new Error("Uno dei due video non è decodificabile dal browser.");
    const [[sourceFirst, sourceEnd], [referenceFirst, referenceEnd]] = await Promise.all([
      Promise.all([sourceInput.getFirstTimestamp([sourceTrack]), sourceInput.computeDuration([sourceTrack])]),
      Promise.all([referenceInput.getFirstTimestamp([referenceTrack]), referenceInput.computeDuration([referenceTrack])]),
    ]);
    const sourceStart = sourceFirst + Math.max(0, options.sourceStartSeconds ?? 0);
    const sourceDuration = Math.max(0, sourceEnd - sourceStart); const referenceDuration = Math.max(0, referenceEnd - referenceFirst);
    if (sourceDuration < .25 || referenceDuration < .25) throw new Error("I video sono troppo brevi per l’allineamento automatico.");
    const [sourceStats, referenceStats] = await Promise.all([
      sourceTrack.computePacketStats(Infinity, { skipLiveWait: true }),
      referenceTrack.computePacketStats(Infinity, { skipLiveWait: true }),
    ]);
    const timing = {
      sourceFrameRate: sourceStats.packetCount / (sourceEnd - sourceFirst),
      referenceFrameRate: referenceStats.packetCount / referenceDuration,
      sourceDurationSeconds: sourceDuration,
      referenceDurationSeconds: referenceDuration,
    };
    if (sourceDuration > referenceDuration + .05) return { offsetSeconds: 0, confidence: 0, comparedFrames: 0, ...timing };
    const search = clamp(options.searchSeconds, .5, Math.min(60, Math.max(sourceDuration, referenceDuration)));
    const windowDuration = Math.min(12, sourceDuration);
    const sourceRelativeTimes = Array.from({ length: Math.max(3, Math.floor(windowDuration * 2)) }, (_, index) => Math.min(sourceDuration - .01, .2 + index * .5)).filter(time => time >= 0);
    const referenceStep = .1;
    const referenceWindow = Math.min(referenceDuration, windowDuration + search + 1);
    const referenceRelativeTimes = Array.from({ length: Math.max(3, Math.floor(referenceWindow / referenceStep) + 1) }, (_, index) => index * referenceStep).filter(time => time < referenceDuration && time <= referenceWindow);
    const [sourceFrames, referenceFrames] = await Promise.all([
      decodeFingerprints(new CanvasSink(sourceTrack, { poolSize: 2 }), sourceRelativeTimes.map(time => sourceStart + time), sourceStart, options.region, options.signal),
      decodeFingerprints(new CanvasSink(referenceTrack, { poolSize: 2 }), referenceRelativeTimes.map(time => referenceFirst + time), referenceFirst, options.region, options.signal),
    ]);
    const coarseCandidates = Array.from({ length: Math.floor(search * 20) + 1 }, (_, index) => -search + index * .1);
    const coarse = selectTemporalOffset(sourceFrames, referenceFrames, coarseCandidates);

    const anchors = sourceFrames.filter((_, index) => index % Math.max(1, Math.floor(sourceFrames.length / 5)) === 0).slice(0, 5);
    const fineCandidates = Array.from({ length: 25 }, (_, index) => coarse.offsetSeconds - .2 + index / 60);
    const requests: Array<{ candidate: number; anchor: number; time: number }> = [];
    fineCandidates.forEach((offset, candidate) => anchors.forEach((anchor, anchorIndex) => {
      const time = anchor.time + offset;
      if (time >= 0 && time < referenceDuration) requests.push({ candidate, anchor: anchorIndex, time });
    }));
    requests.sort((a, b) => a.time - b.time);
    const grouped = new Map<number, Array<{ time: number; fingerprint: Fingerprint }>>();
    let requestIndex = 0;
    for await (const frame of new CanvasSink(referenceTrack, { poolSize: 2 }).canvasesAtTimestamps(requests.map(item => referenceFirst + item.time), { skipLiveWait: true })) {
      throwIfAborted(options.signal);
      const request = requests[requestIndex++];
      if (!frame || !request) continue;
      const list = grouped.get(request.candidate) ?? [];
      list.push({ time: request.time, fingerprint: fingerprint(frame.canvas, options.region) });
      grouped.set(request.candidate, list);
    }
    const fineResults = fineCandidates.map((offset, candidate) => selectTemporalOffset(anchors, grouped.get(candidate) ?? [], [offset]));
    const fine = fineResults.sort((a, b) => b.confidence - a.confidence)[0] ?? coarse;
    return { ...(fine.comparedFrames >= 2 ? fine : coarse), ...timing };
  } finally {
    sourceInput.dispose(); referenceInput.dispose();
  }
}

function grayEdges(data: Uint8ClampedArray, width: number, height: number) {
  const gray = new Float32Array(width * height); const edges = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) { const offset = index * 4; gray[index] = (data[offset] ?? 0) * .2126 + (data[offset + 1] ?? 0) * .7152 + (data[offset + 2] ?? 0) * .0722; }
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) { const index = y * width + x; const gx = gray[index + 1]! - gray[index - 1]!; const gy = gray[index + width]! - gray[index - width]!; edges[index] = Math.hypot(gx, gy); }
  return edges;
}

export function estimateSpatialTranslation(source: ImageData, reference: ImageData, region: Settings["region"], maxShiftX: number, maxShiftY: number) {
  const width = source.width; const height = source.height;
  const sourceEdges = grayEdges(source.data, width, height); const referenceEdges = grayEdges(reference.data, width, height);
  const cleanRegion = normalizedWatermarkRegion({ region });
  const left = Math.floor(cleanRegion.x * width) - 2; const top = Math.floor(cleanRegion.y * height) - 2;
  const right = Math.ceil((cleanRegion.x + cleanRegion.width) * width) + 2; const bottom = Math.ceil((cleanRegion.y + cleanRegion.height) * height) + 2;
  let best = { dx: 0, dy: 0, score: -1 }; let runner = -1; let texture = 0; let textureCount = 0;
  for (let y = 2; y < height - 2; y += 2) for (let x = 2; x < width - 2; x += 2) { if (x >= left && x <= right && y >= top && y <= bottom) continue; texture += sourceEdges[y * width + x] ?? 0; textureCount += 1; }
  for (let dy = -maxShiftY; dy <= maxShiftY; dy += 1) for (let dx = -maxShiftX; dx <= maxShiftX; dx += 1) {
    let dot = 0; let aa = 0; let bb = 0; let count = 0;
    for (let y = 2; y < height - 2; y += 2) for (let x = 2; x < width - 2; x += 2) {
      if (x >= left && x <= right && y >= top && y <= bottom) continue;
      const rx = x - dx; const ry = y - dy; if (rx < 1 || ry < 1 || rx >= width - 1 || ry >= height - 1) continue;
      const a = sourceEdges[y * width + x] ?? 0; const b = referenceEdges[ry * width + rx] ?? 0;
      dot += a * b; aa += a * a; bb += b * b; count += 1;
    }
    const score = count > 20 && aa > 1 && bb > 1 ? dot / Math.sqrt(aa * bb) : -1;
    if (score > best.score) { runner = best.score; best = { dx, dy, score }; } else if (score > runner) runner = score;
  }
  const textureFactor = clamp((texture / Math.max(1, textureCount)) / 12, 0, 1);
  const confidence = clamp(((best.score + 1) / 2) * .82 + Math.max(0, best.score - runner) * 1.8, 0, 1) * textureFactor;
  return { ...best, confidence };
}

export function createStaticWatermarkReferenceAligner(width: number, height: number) {
  const placed = document.createElement("canvas"); placed.width = width; placed.height = height;
  const aligned = document.createElement("canvas"); aligned.width = width; aligned.height = height;
  const sampleWidth = Math.min(128, width); const sampleHeight = Math.max(18, Math.round(height * sampleWidth / width));
  const sourceSample = document.createElement("canvas"); sourceSample.width = sampleWidth; sourceSample.height = sampleHeight;
  const referenceSample = document.createElement("canvas"); referenceSample.width = sampleWidth; referenceSample.height = sampleHeight;
  const placedContext = placed.getContext("2d", { alpha: false }); const alignedContext = aligned.getContext("2d", { alpha: false });
  const sourceContext = sourceSample.getContext("2d", { willReadFrequently: true }); const referenceContext = referenceSample.getContext("2d", { willReadFrequently: true });
  let offsetX = 0; let offsetY = 0; let lastConfidence = 0; let initialized = false;
  return {
    align(sourceFrame: CanvasImageSource, referenceFrame: CanvasImageSource, settings: Settings): SpatialAlignmentResult {
      if (!placedContext || !alignedContext || !sourceContext || !referenceContext) return { canvas: aligned, offsetX: 0, offsetY: 0, confidence: 0, usedFallback: true };
      const reference = referenceFrame as CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number };
      const referenceWidth = Math.max(1, reference.naturalWidth ?? reference.videoWidth ?? reference.width ?? width);
      const referenceHeight = Math.max(1, reference.naturalHeight ?? reference.videoHeight ?? reference.height ?? height);
      const placement = resolveReferencePlacement(referenceWidth, referenceHeight, width, height, settings);
      placedContext.clearRect(0, 0, width, height); placedContext.drawImage(referenceFrame, placement.x, placement.y, placement.width, placement.height);
      let confidence = 1; let usedFallback = false;
      if (settings.autoSpatialAlignment && settings.alignmentMaxShift > 0) {
        sourceContext.drawImage(sourceFrame, 0, 0, sampleWidth, sampleHeight); referenceContext.drawImage(placed, 0, 0, sampleWidth, sampleHeight);
        const estimate = estimateSpatialTranslation(sourceContext.getImageData(0, 0, sampleWidth, sampleHeight), referenceContext.getImageData(0, 0, sampleWidth, sampleHeight), settings.region, Math.max(1, Math.round(settings.alignmentMaxShift * sampleWidth / width)), Math.max(1, Math.round(settings.alignmentMaxShift * sampleHeight / height)));
        confidence = estimate.confidence;
        const candidateX = estimate.dx * width / sampleWidth; const candidateY = estimate.dy * height / sampleHeight;
        const jump = Math.hypot(candidateX - offsetX, candidateY - offsetY);
        const accepted = confidence >= settings.alignmentMinConfidence && (!initialized || jump <= Math.max(3, settings.alignmentMaxShift * .45) || confidence > lastConfidence + .16);
        if (accepted) {
          const smoothing = initialized ? settings.alignmentSmoothing : 0;
          offsetX = offsetX * smoothing + candidateX * (1 - smoothing); offsetY = offsetY * smoothing + candidateY * (1 - smoothing);
          initialized = true; lastConfidence = confidence;
        } else usedFallback = true;
      } else { offsetX = 0; offsetY = 0; initialized = true; }
      alignedContext.clearRect(0, 0, width, height); alignedContext.drawImage(placed, offsetX, offsetY);
      return { canvas: aligned, offsetX, offsetY, confidence, usedFallback };
    },
    reset() { offsetX = 0; offsetY = 0; lastConfidence = 0; initialized = false; }
  };
}
