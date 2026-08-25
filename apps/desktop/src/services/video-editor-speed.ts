import type { VideoEditorClip, VideoEditorTimebase } from "./video-editor";
import { videoEditorFrameRate, videoEditorFrameToSeconds } from "./video-editor";

export type VideoEditorSpeedCurve = "hold" | "linear" | "exponential" | "logarithmic" | "custom" | "easeIn" | "easeOut" | "easeInOut" | "bezier";
type VideoEditorAnalyticCurve = Exclude<VideoEditorSpeedCurve, "custom" | "bezier">;
interface VideoEditorBezier { x1: number; y1: number; x2: number; y2: number }
interface VideoEditorSpeedSegment { curve: VideoEditorAnalyticCurve; fromProgress: number; toProgress: number }
export interface VideoEditorSpeedPoint { id: string; frame: number; speed: number; curve: VideoEditorSpeedCurve; bezier?: VideoEditorBezier | undefined; segment?: VideoEditorSpeedSegment | undefined; inTangent?: { x: number; y: number } | undefined; outTangent?: { x: number; y: number } | undefined }
export type VideoEditorSpeed = VideoEditorClip["speed"];

/** An explicit curve selection starts a new authored segment. Derived split
 * domains, normalized handles from an old curve and legacy absolute tangents
 * must not survive and silently override that selection. Clip-level sampling
 * phase stays on VideoEditorSpeed because it describes the trimmed clip, not
 * the authored shape of this individual segment. */
export function videoEditorSpeedPointWithCurve(point: VideoEditorSpeedPoint, curve: VideoEditorSpeedCurve, customBezier: VideoEditorBezier = { x1: .33, y1: .33, x2: .67, y2: .67 }): VideoEditorSpeedPoint {
  return {
    id: point.id,
    frame: point.frame,
    speed: point.speed,
    curve,
    ...((curve === "custom" || curve === "bezier") ? { bezier: customBezier } : {})
  };
}

/** Editing normalized handles also promotes them to the sole curve payload. */
export function videoEditorSpeedPointWithBezier(point: VideoEditorSpeedPoint, bezier: VideoEditorBezier): VideoEditorSpeedPoint {
  return { id: point.id, frame: point.frame, speed: point.speed, curve: point.curve, bezier };
}

function speedWithAuthoredPoint(
  speed: NonNullable<VideoEditorSpeed>,
  pointId: string,
  author: (point: VideoEditorSpeedPoint) => VideoEditorSpeedPoint
): NonNullable<VideoEditorSpeed> {
  const ordered = [...speed.points].sort((left, right) => left.frame - right.frame);
  const authoredIndex = ordered.findIndex((point) => point.id === pointId);
  const points = speed.points.map((point) => point.id === pointId ? author(point) : point);
  // The held rate immediately before/after a fractional cut belongs to the old
  // derived segment. Reset it only when the user edits the adjacent first/last
  // segment; unrelated endpoint phase metadata must remain intact.
  const resetLeadingRate = authoredIndex === 1;
  const resetTrailingRate = authoredIndex === ordered.length - 1;
  return {
    mode: speed.mode,
    constant: speed.constant,
    points,
    preservePitch: speed.preservePitch,
    ...(speed.sampleOriginFrame !== undefined ? { sampleOriginFrame: speed.sampleOriginFrame } : {}),
    ...(!resetLeadingRate && speed.leadingRate !== undefined ? { leadingRate: speed.leadingRate } : {}),
    ...(!resetTrailingRate && speed.trailingRate !== undefined ? { trailingRate: speed.trailingRate } : {})
  };
}

export function videoEditorSpeedWithPointCurve(speed: NonNullable<VideoEditorSpeed>, pointId: string, curve: VideoEditorSpeedCurve, customBezier?: VideoEditorBezier): NonNullable<VideoEditorSpeed> {
  return speedWithAuthoredPoint(speed, pointId, (point) => videoEditorSpeedPointWithCurve(point, curve, customBezier));
}

export function videoEditorSpeedWithPointBezier(speed: NonNullable<VideoEditorSpeed>, pointId: string, bezier: VideoEditorBezier): NonNullable<VideoEditorSpeed> {
  return speedWithAuthoredPoint(speed, pointId, (point) => videoEditorSpeedPointWithBezier(point, bezier));
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const inverse = 1 - t;
  return inverse ** 3 * a + 3 * inverse ** 2 * t * b + 3 * inverse * t ** 2 * c + t ** 3 * d;
}

function normalizedBezier(left: VideoEditorSpeedPoint, right: VideoEditorSpeedPoint): VideoEditorBezier {
  if (right.bezier) return right.bezier;
  // Legacy absolute tangents remain readable, but normalized handles are the
  // canonical persisted representation for every new speed segment.
  const spanFrames = Math.max(1e-9, right.frame - left.frame);
  const spanSpeed = right.speed - left.speed;
  const normalizeX = (value: number | undefined, fallback: number) => value === undefined ? fallback : Math.max(0, Math.min(1, (value - left.frame) / spanFrames));
  const normalizeY = (value: number | undefined, fallback: number) => value === undefined || Math.abs(spanSpeed) < 1e-9 ? fallback : (value - left.speed) / spanSpeed;
  const x1 = normalizeX(left.outTangent?.x, 1 / 3);
  const x2 = normalizeX(right.inTangent?.x, 2 / 3);
  const y1 = normalizeY(left.outTangent?.y, 1 / 3);
  const y2 = normalizeY(right.inTangent?.y, 2 / 3);
  return { x1, y1, x2, y2 };
}

function solveCubicBezierParameter(target: number, bezier: VideoEditorBezier): number {
  let low = 0; let high = 1;
  for (let index = 0; index < 48; index += 1) {
    const candidate = (low + high) / 2;
    if (cubic(0, bezier.x1, bezier.x2, 1, candidate) < target) low = candidate; else high = candidate;
  }
  return (low + high) / 2;
}

function bezierProgress(progress: number, left: VideoEditorSpeedPoint, right: VideoEditorSpeedPoint): number {
  const bezier = normalizedBezier(left, right);
  return cubic(0, bezier.y1, bezier.y2, 1, solveCubicBezierParameter(Math.max(0, Math.min(1, progress)), bezier));
}

function analyticProgress(t: number, curve: VideoEditorAnalyticCurve): number {
  const value = Math.max(0, Math.min(1, t));
  if (curve === "hold") return 0;
  if (curve === "easeIn") return value * value;
  if (curve === "easeOut") return 1 - (1 - value) * (1 - value);
  if (curve === "easeInOut") return value * value * (3 - 2 * value);
  if (curve === "exponential") return value === 0 ? 0 : (Math.pow(2, 4 * value) - 1) / 15;
  if (curve === "logarithmic") return Math.log1p(9 * value) / Math.log(10);
  return value;
}

function shaped(t: number, curve: VideoEditorSpeedPoint["curve"], left: VideoEditorSpeedPoint, right: VideoEditorSpeedPoint): number {
  const value = Math.max(0, Math.min(1, t));
  if (curve === "custom" || curve === "bezier") return bezierProgress(value, left, right);
  if (!right.segment) return analyticProgress(value, curve);
  const from = analyticProgress(right.segment.fromProgress, right.segment.curve);
  const to = analyticProgress(right.segment.toProgress, right.segment.curve);
  if (Math.abs(to - from) <= 1e-12) return 0;
  const mapped = right.segment.fromProgress + (right.segment.toProgress - right.segment.fromProgress) * value;
  return (analyticProgress(mapped, right.segment.curve) - from) / (to - from);
}

interface BezierCoordinate { x: number; y: number }

function interpolateCoordinate(left: BezierCoordinate, right: BezierCoordinate, amount: number): BezierCoordinate {
  return { x: left.x + (right.x - left.x) * amount, y: left.y + (right.y - left.y) * amount };
}

/** Exact cubic subdivision at an x-domain progress. De Casteljau operates in
 * the parametric domain; both results are normalized back to CSS-style [0,1]
 * handles so repeated trims remain lossless and schema-compatible. */
function subdivideBezier(bezier: VideoEditorBezier, progress: number): readonly [VideoEditorBezier, VideoEditorBezier] {
  const amount = solveCubicBezierParameter(Math.max(0, Math.min(1, progress)), bezier);
  const p0 = { x: 0, y: 0 };
  const p1 = { x: bezier.x1, y: bezier.y1 };
  const p2 = { x: bezier.x2, y: bezier.y2 };
  const p3 = { x: 1, y: 1 };
  const p01 = interpolateCoordinate(p0, p1, amount);
  const p12 = interpolateCoordinate(p1, p2, amount);
  const p23 = interpolateCoordinate(p2, p3, amount);
  const p012 = interpolateCoordinate(p01, p12, amount);
  const p123 = interpolateCoordinate(p12, p23, amount);
  const boundary = interpolateCoordinate(p012, p123, amount);
  const normalizeLeft = (point: BezierCoordinate): BezierCoordinate => ({
    x: boundary.x <= 1e-12 ? 0 : point.x / boundary.x,
    y: Math.abs(boundary.y) <= 1e-12 ? 0 : point.y / boundary.y
  });
  const normalizeRight = (point: BezierCoordinate): BezierCoordinate => ({
    x: 1 - boundary.x <= 1e-12 ? 1 : (point.x - boundary.x) / (1 - boundary.x),
    y: 1 - boundary.y <= 1e-12 ? 1 : (point.y - boundary.y) / (1 - boundary.y)
  });
  const left1 = normalizeLeft(p01);
  const left2 = normalizeLeft(p012);
  const right1 = normalizeRight(p123);
  const right2 = normalizeRight(p23);
  return [
    { x1: left1.x, y1: left1.y, x2: left2.x, y2: left2.y },
    { x1: right1.x, y1: right1.y, x2: right2.x, y2: right2.y }
  ];
}

function sampleOriginFrame(speed: VideoEditorSpeed | undefined): number {
  return speed?.sampleOriginFrame ?? 0;
}

/** Rate held over the source project-frame cell containing localFrame. */
export function videoEditorSampledSpeedAtFrame(speed: VideoEditorSpeed | undefined, localFrame: number): number {
  if (!speed || speed.mode === "constant") return Math.max(.1, Math.min(8, speed?.constant ?? 1));
  const origin = sampleOriginFrame(speed);
  const rootFrame = origin + Math.max(0, localFrame);
  const rootOrdinal = Math.floor(rootFrame + 1e-9);
  const sampleFrame = rootOrdinal + .5 - origin;
  if (sampleFrame < 0 && speed.leadingRate !== undefined) return speed.leadingRate;
  const lastFrame = speed.points.reduce((maximum, point) => Math.max(maximum, point.frame), Number.NEGATIVE_INFINITY);
  if (sampleFrame > lastFrame && speed.trailingRate !== undefined) return speed.trailingRate;
  return videoEditorSpeedAtFrame(speed, Math.max(0, sampleFrame));
}

function nextSampleBoundaryFrame(speed: VideoEditorSpeed | undefined, localFrame: number): number {
  const origin = sampleOriginFrame(speed);
  const rootFrame = origin + localFrame;
  return Math.floor(rootFrame + 1e-9) + 1 - origin;
}

export function videoEditorSpeedAtFrame(speed: VideoEditorSpeed | undefined, frame: number): number {
  if (!speed || speed.mode === "constant" || !speed.points.length) return Math.max(.1, Math.min(8, speed?.constant ?? 1));
  const points = [...speed.points].sort((a, b) => a.frame - b.frame);
  if (frame <= points[0]!.frame) return points[0]!.speed;
  const last = points[points.length - 1]!;
  if (frame >= last.frame) return last.speed;
  const rightIndex = points.findIndex((point) => point.frame >= frame);
  const right = points[rightIndex]!;
  const left = points[rightIndex - 1]!;
  const amount = shaped((frame - left.frame) / Math.max(1e-9, right.frame - left.frame), right.curve, left, right);
  return left.speed + (right.speed - left.speed) * amount;
}

/**
 * Canonical clip-local source integral. Speed ramps are held for each local
 * project-frame interval and sampled at that interval's midpoint. The last
 * interval may be partial: it consumes only the timeline time that actually
 * belongs to the half-open clip interval [start, end).
 *
 * Keeping the interval origin on the clip, rather than subtracting two rounded
 * global frame ordinals, is what makes sub-frame moves phase-neutral.
 */
export function videoEditorClipConsumedSourceSeconds(clip: VideoEditorClip, localSeconds: number, timebase: VideoEditorTimebase): number {
  const duration = Math.max(0, Math.min(clip.durationSeconds, Number.isFinite(localSeconds) ? localSeconds : 0));
  const constant = clip.speed?.constant ?? 1;
  if (!clip.speed || clip.speed.mode === "constant") return duration * constant;
  const frameRate = videoEditorFrameRate(timebase);
  const exactFrames = duration * frameRate;
  // Absorb only floating-point noise at exact rational frame boundaries. A real
  // partial interval (for example .01 s at 60 fps) must remain partial.
  const nearestFrame = Math.round(exactFrames);
  const normalizedFrames = Math.abs(exactFrames - nearestFrame) <= 1e-9 ? nearestFrame : exactFrames;
  let consumedSeconds = 0;
  let cursorFrame = 0;
  while (cursorFrame < normalizedFrames - 1e-12) {
    const boundaryFrame = nextSampleBoundaryFrame(clip.speed, cursorFrame);
    const spanFrames = Math.min(normalizedFrames - cursorFrame, Math.max(1e-12, boundaryFrame - cursorFrame));
    consumedSeconds += videoEditorSampledSpeedAtFrame(clip.speed, cursorFrame) * spanFrames / frameRate;
    cursorFrame += spanFrames;
  }
  return consumedSeconds;
}

export function videoEditorClipSourceTimeAtLocalSeconds(clip: VideoEditorClip, localSeconds: number, timebase: VideoEditorTimebase): number {
  const consumed = videoEditorClipConsumedSourceSeconds(clip, localSeconds, timebase);
  if (!clip.reversed) return clip.sourceInSeconds + consumed;
  const total = videoEditorClipConsumedSourceSeconds(clip, clip.durationSeconds, timebase);
  return clip.sourceInSeconds + Math.max(0, total - consumed);
}

/** Compatibility bridge for frame-index callers. The frame is converted back
 * to timeline time before entering the canonical clip-local integral. */
export function videoEditorClipSourceTimeAtFrame(clip: VideoEditorClip, timelineFrame: number, timebase: VideoEditorTimebase): number {
  return videoEditorClipSourceTimeAtLocalSeconds(
    clip,
    videoEditorFrameToSeconds(timelineFrame, timebase) - clip.startSeconds,
    timebase
  );
}

/** Held playback rate for the clip-local interval containing localSeconds. */
export function videoEditorClipPlaybackRateAtLocalSeconds(clip: VideoEditorClip, localSeconds: number, timebase: VideoEditorTimebase): number {
  const exactFrame = Math.max(0, localSeconds) * videoEditorFrameRate(timebase);
  return videoEditorSampledSpeedAtFrame(clip.speed, exactFrame);
}

export function videoEditorClipTimelineDurationForSource(sourceDurationSeconds: number, speed: VideoEditorSpeed | undefined, timebase: VideoEditorTimebase): number {
  const source = Math.max(0, sourceDurationSeconds);
  if (!speed || speed.mode === "constant") return source / Math.max(.1, speed?.constant ?? 1);
  if (source === 0) return 0;
  const frameRate = videoEditorFrameRate(timebase);
  let consumedSeconds = 0;
  let cursorFrame = 0;
  // .1 is the schema minimum playback rate, so this is a finite upper bound.
  const maximumFrames = Math.ceil(source * frameRate / .1) + 1;
  while (cursorFrame < maximumFrames) {
    const boundaryFrame = nextSampleBoundaryFrame(speed, cursorFrame);
    const spanFrames = Math.min(maximumFrames - cursorFrame, Math.max(1e-12, boundaryFrame - cursorFrame));
    const rate = videoEditorSampledSpeedAtFrame(speed, cursorFrame);
    const intervalSourceSeconds = rate * spanFrames / frameRate;
    if (consumedSeconds + intervalSourceSeconds >= source) {
      return (cursorFrame + (source - consumedSeconds) * frameRate / Math.max(.1, rate)) / frameRate;
    }
    consumedSeconds += intervalSourceSeconds;
    cursorFrame += spanFrames;
  }
  return maximumFrames / frameRate;
}

/** Source range consumed by the current timeline duration. This is the canonical
 * bridge used by speed edits, trims, splits, preview and export. */
export function videoEditorClipSourceDuration(clip: VideoEditorClip, timebase: VideoEditorTimebase): number {
  return videoEditorClipConsumedSourceSeconds(clip, clip.durationSeconds, timebase);
}

/** Inverse mapping used for beat markers and source-relative tool ranges. */
export function videoEditorClipTimelineTimeForSourceTime(clip: VideoEditorClip, sourceTimeSeconds: number, timebase: VideoEditorTimebase): number | null {
  const sourceOffset = sourceTimeSeconds - clip.sourceInSeconds;
  const sourceDuration = videoEditorClipSourceDuration(clip, timebase);
  if (sourceOffset < -1e-12 || sourceOffset > sourceDuration + 1e-12) return null;
  const target = clip.reversed ? sourceDuration - sourceOffset : sourceOffset;
  if (target === 0) return clip.startSeconds;
  const frameRate = videoEditorFrameRate(timebase);
  const exactFrames = clip.durationSeconds * frameRate;
  let consumedSeconds = 0;
  let cursorFrame = 0;
  while (cursorFrame < exactFrames - 1e-12) {
    const boundaryFrame = nextSampleBoundaryFrame(clip.speed, cursorFrame);
    const intervalFrames = Math.min(exactFrames - cursorFrame, Math.max(1e-12, boundaryFrame - cursorFrame));
    const intervalTimelineSeconds = intervalFrames / frameRate;
    const rate = videoEditorSampledSpeedAtFrame(clip.speed, cursorFrame);
    const intervalSourceSeconds = rate * intervalTimelineSeconds;
    if (consumedSeconds + intervalSourceSeconds >= target - 1e-12) {
      const withinSeconds = (target - consumedSeconds) / Math.max(.1, rate);
      const timelineSeconds = clip.startSeconds + cursorFrame / frameRate + Math.max(0, Math.min(intervalTimelineSeconds, withinSeconds));
      return Math.round(timelineSeconds * 1_000_000) / 1_000_000;
    }
    consumedSeconds += intervalSourceSeconds;
    cursorFrame += intervalFrames;
  }
  return null;
}

function segmentSubdivision(
  left: VideoEditorSpeedPoint,
  right: VideoEditorSpeedPoint,
  progress: number
): readonly [Partial<VideoEditorSpeedPoint>, Partial<VideoEditorSpeedPoint>] {
  if (right.curve === "custom" || right.curve === "bezier") {
    const [leftBezier, rightBezier] = subdivideBezier(normalizedBezier(left, right), progress);
    return [
      { curve: right.curve, bezier: leftBezier, segment: undefined, inTangent: undefined, outTangent: undefined },
      { curve: right.curve, bezier: rightBezier, segment: undefined, inTangent: undefined, outTangent: undefined }
    ];
  }
  const source = right.segment ?? { curve: right.curve, fromProgress: 0, toProgress: 1 };
  const boundary = source.fromProgress + (source.toProgress - source.fromProgress) * progress;
  return [
    { curve: right.curve, bezier: undefined, segment: { ...source, toProgress: boundary }, inTangent: undefined, outTangent: undefined },
    { curve: right.curve, bezier: undefined, segment: { ...source, fromProgress: boundary }, inTangent: undefined, outTangent: undefined }
  ];
}

export function videoEditorSplitSpeed(speed: VideoEditorSpeed | undefined, localFrame: number): readonly [VideoEditorSpeed | undefined, VideoEditorSpeed | undefined] {
  if (!speed || speed.mode === "constant") return [speed, speed];
  const frame = Math.max(0, localFrame);
  const points = [...speed.points].sort((left, right) => left.frame - right.frame);
  const exactIndex = points.findIndex((point) => Math.abs(point.frame - frame) <= 1e-9);
  const rebase = (point: VideoEditorSpeedPoint): VideoEditorSpeedPoint => ({
    ...point,
    frame: point.frame - frame,
    ...(point.inTangent ? { inTangent: { ...point.inTangent, x: point.inTangent.x - frame } } : {}),
    ...(point.outTangent ? { outTangent: { ...point.outTangent, x: point.outTangent.x - frame } } : {})
  });
  if (exactIndex >= 0) {
    const exact = points[exactIndex]!;
    const leftPoints = points.slice(0, exactIndex + 1);
    const rightPoints = [rebase(exact), ...points.slice(exactIndex + 1).map(rebase)];
    const splitSampleRate = videoEditorSampledSpeedAtFrame(speed, frame);
    return [
      { ...speed, trailingRate: splitSampleRate, points: leftPoints },
      { ...speed, sampleOriginFrame: sampleOriginFrame(speed) + frame, leadingRate: splitSampleRate, points: rightPoints }
    ];
  }
  const boundarySpeed = videoEditorSpeedAtFrame(speed, frame);
  const rightIndex = points.findIndex((point) => point.frame > frame);
  const leftIndex = rightIndex < 0 ? points.length - 1 : rightIndex - 1;
  let leftPatch: Partial<VideoEditorSpeedPoint> = { curve: "linear" };
  let rightPatch: Partial<VideoEditorSpeedPoint> = {};
  if (leftIndex >= 0 && rightIndex >= 0) {
    const segmentLeft = points[leftIndex]!;
    const segmentRight = points[rightIndex]!;
    const progress = (frame - segmentLeft.frame) / Math.max(1e-12, segmentRight.frame - segmentLeft.frame);
    [leftPatch, rightPatch] = segmentSubdivision(segmentLeft, segmentRight, progress);
  }
  const leftBoundary: VideoEditorSpeedPoint = { id: `speed-boundary-${frame}`, frame, speed: boundarySpeed, curve: "linear", ...leftPatch };
  const rightBoundary: VideoEditorSpeedPoint = { id: `speed-boundary-${frame}`, frame: 0, speed: boundarySpeed, curve: "linear" };
  const before = rightIndex < 0 ? points : points.slice(0, rightIndex);
  const after = rightIndex < 0 ? [] : points.slice(rightIndex).map(rebase);
  if (after[0]) after[0] = { ...after[0], ...rightPatch };
  const leftPoints = [...before, leftBoundary];
  const rightPoints = [rightBoundary, ...after];
  const splitSampleRate = videoEditorSampledSpeedAtFrame(speed, frame);
  return [
    { ...speed, trailingRate: splitSampleRate, points: leftPoints },
    { ...speed, sampleOriginFrame: sampleOriginFrame(speed) + frame, leadingRate: splitSampleRate, points: rightPoints }
  ];
}

/** Re-bases a speed curve after a trim and slices it at the new end. Positive
 * startFrame removes material from the head; a negative value extends the head
 * with the original boundary speed. The returned curve always uses clip-local
 * frame coordinates, so preview and export integrate the same mapping. */
export function videoEditorTrimSpeed(speed: VideoEditorSpeed | undefined, startFrame: number, durationFrames: number): VideoEditorSpeed | undefined {
  if (!speed || speed.mode === "constant") return speed;
  const start = startFrame;
  let rebased: VideoEditorSpeed;
  if (start >= 0) {
    rebased = videoEditorSplitSpeed(speed, start)[1] ?? speed;
  } else {
    const shift = -start;
    const shiftPoint = (point: VideoEditorSpeedPoint): VideoEditorSpeedPoint => ({
      ...point,
      frame: point.frame + shift,
      ...(point.inTangent ? { inTangent: { ...point.inTangent, x: point.inTangent.x + shift } } : {}),
      ...(point.outTangent ? { outTangent: { ...point.outTangent, x: point.outTangent.x + shift } } : {})
    });
    rebased = {
      ...speed,
      sampleOriginFrame: sampleOriginFrame(speed) + start,
      leadingRate: videoEditorSampledSpeedAtFrame(speed, 0),
      points: [
        { id: `speed-extension-${shift}`, frame: 0, speed: videoEditorSpeedAtFrame(speed, 0), curve: "hold" },
        ...speed.points.map(shiftPoint)
      ]
    };
  }
  const end = Math.max(1e-9, durationFrames);
  return videoEditorSplitSpeed(rebased, end)[0] ?? rebased;
}
