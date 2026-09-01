import type {
  CanonicalLyricWord,
  LipsyncAnalysisDetail,
  LipsyncSpeedBand,
  LipsyncSpeedLimits,
  LipsyncTimeMap,
  LipsyncTimePoint,
  LipsyncTimeSegment,
  WordAnchor
} from "./mlsm-post-lipsync-types";

export const defaultLipsyncSpeedLimits: LipsyncSpeedLimits = {
  safeMinimum: .8,
  safeMaximum: 1.25,
  moderateMinimum: .6,
  moderateMaximum: 1.6
};

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} deve essere maggiore di zero.`);
  return value;
}

function speedBand(speed: number, limits: LipsyncSpeedLimits): LipsyncSpeedBand {
  if (speed >= limits.safeMinimum && speed <= limits.safeMaximum) return "safe";
  if (speed >= limits.moderateMinimum && speed <= limits.moderateMaximum) return "moderate";
  return "critical";
}

function validateLimits(limits: LipsyncSpeedLimits): LipsyncSpeedLimits {
  positive(limits.moderateMinimum, "Velocità moderata minima");
  positive(limits.safeMinimum, "Velocità sicura minima");
  positive(limits.safeMaximum, "Velocità sicura massima");
  positive(limits.moderateMaximum, "Velocità moderata massima");
  if (!(limits.moderateMinimum <= limits.safeMinimum && limits.safeMinimum <= limits.safeMaximum && limits.safeMaximum <= limits.moderateMaximum)) {
    throw new Error("I limiti di velocità Lipsync non sono ordinati correttamente.");
  }
  return { ...limits };
}

function anchorPoint(anchor: WordAnchor, edge: "start" | "center" | "end"): LipsyncTimePoint {
  const common = {
    canonicalIndex: anchor.canonicalIndex,
    locked: anchor.locked,
    manual: anchor.manuallyEdited || anchor.origin === "manual"
  };
  const sourceTime = edge === "start" ? anchor.sourceStart : edge === "center" ? anchor.sourceCenter : anchor.sourceEnd;
  const targetTime = edge === "start" ? anchor.targetStart : edge === "center" ? anchor.targetCenter : anchor.targetEnd;
  return { ...common, id: `${anchor.id}:${edge}`, sourceTime, targetTime };
}

/** Keep the same sparse phrase path used by the successful hard-gate render:
 * the start of every sung word plus the release of the final word. Adding all
 * three points for every word over-constrains tiny Whisper spans and creates
 * rapid speed changes that are visible as jerky motion. */
function phoneticCharacters(value: string): string[] {
  return Array.from(value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
}

function phoneticWeight(character: string): number {
  // Vowels normally hold the audible nucleus longer than consonants. These
  // weights turn Whisper word boundaries into a stable grapheme/phoneme grid;
  // the exact word onset/release still comes from measured audio timestamps.
  return /[aeiouyàáâäèéêëìíîïòóôöùúûü]/iu.test(character) ? 1.45 : .82;
}

function detailedAnchorPoints(anchor: WordAnchor): LipsyncTimePoint[] {
  const characters = phoneticCharacters(anchor.text);
  const weights = characters.map(phoneticWeight);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (characters.length < 2 || total <= 0) return [anchorPoint(anchor, "start"), anchorPoint(anchor, "end")];
  let elapsed = 0;
  const interior = characters.slice(0, -1).map((character, index) => {
    elapsed += weights[index] ?? 0;
    const progress = elapsed / total;
    return {
      id: `${anchor.id}:phoneme:${index + 1}:${character}`,
      canonicalIndex: anchor.canonicalIndex,
      sourceTime: anchor.sourceStart + (anchor.sourceEnd - anchor.sourceStart) * progress,
      targetTime: anchor.targetStart + (anchor.targetEnd - anchor.targetStart) * progress,
      locked: anchor.locked,
      manual: anchor.manuallyEdited || anchor.origin === "manual"
    } satisfies LipsyncTimePoint;
  });
  return [anchorPoint(anchor, "start"), ...interior, anchorPoint(anchor, "end")];
}

export function lipsyncPhoneticPointCount(anchors: readonly WordAnchor[]): number {
  return anchors.reduce((total, anchor) => total + detailedAnchorPoints(anchor).length, 0);
}

function anchorPoints(anchors: readonly WordAnchor[], detailMode: LipsyncAnalysisDetail): LipsyncTimePoint[] {
  if (detailMode === "phoneme") return anchors.flatMap(detailedAnchorPoints);
  const cueIndexes = [...new Set(anchors.map((anchor) => anchor.cueIndex))];
  return cueIndexes.flatMap((cueIndex) => {
    const phrase = anchors.filter((anchor) => anchor.cueIndex === cueIndex).sort((left, right) => left.canonicalIndex - right.canonicalIndex);
    return phrase.flatMap((anchor, index) => anchor.manuallyEdited || index === phrase.length - 1
      ? [anchorPoint(anchor, "start"), anchorPoint(anchor, "end")]
      : [anchorPoint(anchor, "start")]);
  });
}

function strictlyMonotonicPoints(points: readonly LipsyncTimePoint[]): LipsyncTimePoint[] {
  const result: LipsyncTimePoint[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous && (point.sourceTime <= previous.sourceTime + 1e-6 || point.targetTime <= previous.targetTime + 1e-6)) continue;
    result.push(point);
  }
  return result;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

/** Extrapolates the selected performance boundaries from the word path. This
 * automatically excludes duplicated AI phrases or static padding outside the
 * central matched performance, without asking the user to trim the source. */
export function lipsyncSourceWindow(
  anchors: readonly WordAnchor[],
  sourceDurationSeconds: number,
  targetDurationSeconds: number
): { startSeconds: number; endSeconds: number } {
  const ordered = [...anchors]
    .filter((anchor) => anchor.confidenceBand !== "unresolved")
    .sort((left, right) => left.canonicalIndex - right.canonicalIndex);
  const slopes = ordered.slice(1).flatMap((anchor, index) => {
    const previous = ordered[index]!;
    const targetDelta = anchor.targetCenter - previous.targetCenter;
    const sourceDelta = anchor.sourceCenter - previous.sourceCenter;
    return targetDelta > .04 && sourceDelta > .04 ? [sourceDelta / targetDelta] : [];
  });
  const scale = median(slopes);
  if (scale === null || !Number.isFinite(scale) || scale <= 0) return { startSeconds: 0, endSeconds: sourceDurationSeconds };
  const start = median(ordered.map((anchor) => anchor.sourceCenter - anchor.targetCenter * scale));
  const end = median(ordered.map((anchor) => anchor.sourceCenter + (targetDurationSeconds - anchor.targetCenter) * scale));
  if (start === null || end === null) return { startSeconds: 0, endSeconds: sourceDurationSeconds };
  const boundaryTolerance = Math.max(.08, targetDurationSeconds * .02);
  const openingEvidence = ordered
    .filter((anchor) => anchor.targetStart <= boundaryTolerance)
    .sort((left, right) => left.targetStart - right.targetStart)[0];
  const closingEvidence = ordered
    .filter((anchor) => targetDurationSeconds - anchor.targetEnd <= boundaryTolerance)
    .sort((left, right) => right.targetEnd - left.targetEnd)[0];
  // A phrase-edge DTW anchor is stronger evidence than a centre-based
  // extrapolation. In particular, retain the release of the final sung word:
  // replacing it with an extrapolated boundary was the reason the old path
  // could sync the beginning or the end, but not both.
  const measuredStart = openingEvidence ? openingEvidence.sourceStart : start;
  const measuredEnd = closingEvidence ? closingEvidence.sourceEnd : end;
  const startSeconds = Math.max(0, Math.min(sourceDurationSeconds - .001, measuredStart));
  const endSeconds = Math.min(sourceDurationSeconds, Math.max(startSeconds + .001, measuredEnd));
  return endSeconds - startSeconds >= .25 ? { startSeconds, endSeconds } : { startSeconds: 0, endSeconds: sourceDurationSeconds };
}

function segment(left: LipsyncTimePoint, right: LipsyncTimePoint, limits: LipsyncSpeedLimits): LipsyncTimeSegment {
  const sourceDuration = right.sourceTime - left.sourceTime;
  const targetDuration = right.targetTime - left.targetTime;
  if (sourceDuration <= 0 || targetDuration <= 0) throw new Error(`Segmento non monotono tra ${left.id} e ${right.id}.`);
  const speedRatio = sourceDuration / targetDuration;
  return {
    id: `lipsync-segment-${left.id}-${right.id}`,
    leftPointId: left.id,
    rightPointId: right.id,
    sourceStart: left.sourceTime,
    sourceEnd: right.sourceTime,
    targetStart: left.targetTime,
    targetEnd: right.targetTime,
    sourceDuration,
    targetDuration,
    speedRatio,
    speedBand: speedBand(speedRatio, limits),
    requiresInterpolation: speedRatio < 1 - 1e-6,
    locked: left.locked && right.locked,
    speedOverride: null
  };
}

export function buildLipsyncTimeMap(options: {
  anchors: readonly WordAnchor[];
  sourceDurationSeconds: number;
  targetDurationSeconds: number;
  speedLimits?: LipsyncSpeedLimits;
  detailMode?: LipsyncAnalysisDetail;
}): LipsyncTimeMap {
  const sourceDurationSeconds = positive(options.sourceDurationSeconds, "Durata source");
  const targetDurationSeconds = positive(options.targetDurationSeconds, "Durata target");
  const speedLimits = validateLimits(options.speedLimits ?? defaultLipsyncSpeedLimits);
  const candidates = anchorPoints(options.anchors
    .filter((anchor) => anchor.confidenceBand !== "unresolved")
    .sort((left, right) => left.canonicalIndex - right.canonicalIndex), options.detailMode ?? "word")
    .filter((point) => point.sourceTime >= 0 && point.sourceTime <= sourceDurationSeconds && point.targetTime >= 0 && point.targetTime <= targetDurationSeconds);
  const sourceWindow = lipsyncSourceWindow(options.anchors, sourceDurationSeconds, targetDurationSeconds);
  const points = strictlyMonotonicPoints([
    { id: "lipsync-boundary-start", canonicalIndex: null, sourceTime: sourceWindow.startSeconds, targetTime: 0, locked: true, manual: false },
    ...candidates,
    { id: "lipsync-boundary-end", canonicalIndex: null, sourceTime: sourceWindow.endSeconds, targetTime: targetDurationSeconds, locked: true, manual: false }
  ]);
  const last = points.at(-1);
  if (last?.id !== "lipsync-boundary-end") {
    // A bad automatic anchor must never silently remove the master boundary.
    while (points.length > 1 && (points.at(-1)!.sourceTime >= sourceWindow.endSeconds || points.at(-1)!.targetTime >= targetDurationSeconds)) points.pop();
    points.push({ id: "lipsync-boundary-end", canonicalIndex: null, sourceTime: sourceWindow.endSeconds, targetTime: targetDurationSeconds, locked: true, manual: false });
  }
  const segments = points.slice(1).map((right, index) => segment(points[index]!, right, speedLimits));
  return { version: 1, sourceDurationSeconds, targetDurationSeconds, points, segments, speedLimits };
}

function segmentForSource(map: LipsyncTimeMap, sourceTime: number): LipsyncTimeSegment {
  return map.segments.find((item) => sourceTime <= item.sourceEnd + 1e-9) ?? map.segments.at(-1)!;
}

function segmentForTarget(map: LipsyncTimeMap, targetTime: number): LipsyncTimeSegment {
  return map.segments.find((item) => targetTime <= item.targetEnd + 1e-9) ?? map.segments.at(-1)!;
}

export function lipsyncSourceToTarget(map: LipsyncTimeMap, sourceTime: number): number {
  const clamped = Math.min(map.points.at(-1)!.sourceTime, Math.max(map.points[0]!.sourceTime, sourceTime));
  const selected = segmentForSource(map, clamped);
  const progress = (clamped - selected.sourceStart) / selected.sourceDuration;
  return selected.targetStart + progress * selected.targetDuration;
}

/** Canonical export lookup: every output frame starts from an absolute target
 * timestamp and resolves its source timestamp through this inverse map. */
export function lipsyncTargetToSource(map: LipsyncTimeMap, targetTime: number): number {
  const clamped = Math.min(map.targetDurationSeconds, Math.max(0, targetTime));
  const selected = segmentForTarget(map, clamped);
  const progress = (clamped - selected.targetStart) / selected.targetDuration;
  return selected.sourceStart + progress * selected.sourceDuration;
}

export function lipsyncMapIsMonotonic(map: LipsyncTimeMap): boolean {
  return map.points.every((point, index) => {
    const previous = map.points[index - 1];
    return !previous || point.sourceTime > previous.sourceTime && point.targetTime > previous.targetTime;
  });
}

export function editLipsyncAnchor(
  anchors: readonly WordAnchor[],
  anchorId: string,
  patch: Partial<Pick<WordAnchor, "sourceStart" | "sourceCenter" | "sourceEnd" | "targetStart" | "targetCenter" | "targetEnd" | "locked">>
): WordAnchor[] {
  const index = anchors.findIndex((anchor) => anchor.id === anchorId);
  if (index < 0) return [...anchors];
  const current = anchors[index]!;
  const next = { ...current, ...patch, locked: false, origin: "manual" as const, manuallyEdited: true, confidenceBand: "high" as const };
  if (!(next.sourceStart <= next.sourceCenter && next.sourceCenter <= next.sourceEnd && next.targetStart <= next.targetCenter && next.targetCenter <= next.targetEnd)) {
    throw new Error("L’anchor manuale deve conservare start ≤ center ≤ end.");
  }
  const previous = anchors[index - 1];
  const following = anchors[index + 1];
  if (previous && (next.sourceCenter <= previous.sourceCenter || next.targetCenter <= previous.targetCenter)) throw new Error("L’anchor manuale supererebbe la parola precedente.");
  if (following && (next.sourceCenter >= following.sourceCenter || next.targetCenter >= following.targetCenter)) throw new Error("L’anchor manuale supererebbe la parola successiva.");
  return anchors.map((anchor, anchorIndex) => anchorIndex === index ? next : anchor);
}

/** Moves a word selection as one rigid block on the source performance. This
 * avoids the temporary neighbour collisions produced by editing selected
 * anchors one-by-one and preserves their internal timing exactly. */
export function shiftLipsyncAnchors(
  anchors: readonly WordAnchor[],
  canonicalIndexes: readonly number[],
  requestedDeltaSeconds: number,
  sourceDurationSeconds = Number.POSITIVE_INFINITY
): WordAnchor[] {
  if (!Number.isFinite(requestedDeltaSeconds)) throw new Error("Lo spostamento del gruppo non è valido.");
  const selected = new Set(canonicalIndexes);
  const moving = anchors.filter((anchor) => selected.has(anchor.canonicalIndex));
  if (!moving.length) return [...anchors];
  const minimumStart = Math.min(...moving.map((anchor) => anchor.sourceStart));
  const maximumEnd = Math.max(...moving.map((anchor) => anchor.sourceEnd));
  const maximumDelta = Number.isFinite(sourceDurationSeconds) ? sourceDurationSeconds - maximumEnd : Number.POSITIVE_INFINITY;
  const delta = Math.max(-minimumStart, Math.min(maximumDelta, requestedDeltaSeconds));
  const shifted = anchors.map((anchor) => selected.has(anchor.canonicalIndex) ? {
    ...anchor,
    sourceStart: anchor.sourceStart + delta,
    sourceCenter: anchor.sourceCenter + delta,
    sourceEnd: anchor.sourceEnd + delta,
    locked: false,
    origin: "manual" as const,
    manuallyEdited: true,
    confidenceBand: "high" as const
  } : anchor);
  const ordered = [...shifted].sort((left, right) => left.canonicalIndex - right.canonicalIndex);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!; const current = ordered[index]!;
    if (current.sourceCenter <= previous.sourceCenter || current.targetCenter <= previous.targetCenter) {
      throw new Error("Lo spostamento del gruppo supererebbe una parola adiacente.");
    }
  }
  return shifted;
}

/** Turns an unresolved lyric into an explicit user-owned anchor. The current
 * monotone map only supplies the initial source estimate; from this point on
 * every boundary is editable and no confidence gate can hide the word. */
export function createManualLipsyncAnchor(
  word: CanonicalLyricWord,
  map: LipsyncTimeMap,
  existingAnchors: readonly WordAnchor[]
): WordAnchor[] {
  if (existingAnchors.some((anchor) => anchor.canonicalIndex === word.canonicalIndex)) return [...existingAnchors];
  const targetStart = Math.max(0, Math.min(map.targetDurationSeconds, word.estimatedStartSeconds));
  const targetEnd = Math.max(targetStart + .001, Math.min(map.targetDurationSeconds, word.estimatedEndSeconds));
  const targetCenter = (targetStart + targetEnd) / 2;
  const sourceStart = lipsyncTargetToSource(map, targetStart);
  const sourceCenter = lipsyncTargetToSource(map, targetCenter);
  const sourceEnd = lipsyncTargetToSource(map, targetEnd);
  const anchor: WordAnchor = {
    id: `lipsync-word-${word.canonicalIndex}-manual`,
    text: word.text,
    canonicalIndex: word.canonicalIndex,
    cueIndex: word.cueIndex,
    sourceStart,
    sourceCenter,
    sourceEnd,
    targetStart,
    targetCenter,
    targetEnd,
    sourceConfidence: 1,
    targetConfidence: 1,
    matchConfidence: 1,
    confidenceBand: "high",
    origin: "manual",
    locked: false,
    manuallyEdited: true,
    evidence: { textSimilarity: 0, sourceConfidence: 0, targetConfidence: 0, subtitlePrior: 1, sequenceMargin: 0 },
    sourceTranscriptText: word.text,
    targetTranscriptText: word.text
  };
  return [...existingAnchors, anchor].sort((left, right) => left.canonicalIndex - right.canonicalIndex);
}
