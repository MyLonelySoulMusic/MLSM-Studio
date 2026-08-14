import type { VideoEditorSettings } from "./video-editor";

export type VideoEditorAutomationCurve = "hold" | "linear" | "exponential" | "logarithmic" | "custom" | "easeIn" | "easeOut" | "easeInOut" | "bezier";
export type VideoEditorAutomationTarget = VideoEditorSettings["automationLanes"][number]["target"];
export type VideoEditorAutomationLane = VideoEditorSettings["automationLanes"][number];
export type VideoEditorKeyframe = VideoEditorAutomationLane["keyframes"][number];

export interface VideoEditorAutomationProperty {
  minimum: number;
  maximum: number;
  defaultValue: number;
}

const propertyRanges: Record<string, VideoEditorAutomationProperty> = {
  "transform.x": { minimum: -2, maximum: 2, defaultValue: 0 },
  "transform.y": { minimum: -2, maximum: 2, defaultValue: 0 },
  "transform.scale": { minimum: .05, maximum: 6, defaultValue: 1 },
  "transform.rotation": { minimum: -360, maximum: 360, defaultValue: 0 },
  "adjustments.opacity": { minimum: 0, maximum: 1, defaultValue: 1 },
  "adjustments.exposure": { minimum: -2, maximum: 2, defaultValue: 0 },
  "adjustments.contrast": { minimum: -100, maximum: 100, defaultValue: 0 },
  "adjustments.highlights": { minimum: -100, maximum: 100, defaultValue: 0 },
  "adjustments.shadows": { minimum: -100, maximum: 100, defaultValue: 0 },
  "adjustments.whites": { minimum: -100, maximum: 100, defaultValue: 0 },
  "adjustments.blacks": { minimum: -100, maximum: 100, defaultValue: 0 },
  "adjustments.saturation": { minimum: -100, maximum: 100, defaultValue: 0 },
  "adjustments.vibrance": { minimum: -100, maximum: 100, defaultValue: 0 },
  "adjustments.temperature": { minimum: -100, maximum: 100, defaultValue: 0 },
  "adjustments.tint": { minimum: -100, maximum: 100, defaultValue: 0 },
  "adjustments.hue": { minimum: -180, maximum: 180, defaultValue: 0 },
  "adjustments.sharpness": { minimum: 0, maximum: 100, defaultValue: 0 },
  "adjustments.denoise": { minimum: 0, maximum: 100, defaultValue: 0 },
  volume: { minimum: 0, maximum: 2, defaultValue: 1 },
  blendIntensity: { minimum: 0, maximum: 1, defaultValue: 1 },
  mix: { minimum: 0, maximum: 1, defaultValue: 1 }
};

export function videoEditorAutomationProperty(property: string): VideoEditorAutomationProperty {
  return propertyRanges[property] ?? { minimum: -Infinity, maximum: Infinity, defaultValue: 0 };
}

function targetKey(target: VideoEditorAutomationTarget): string {
  return target.kind === "clip" ? `clip:${target.clipId}:${target.property}` : `effect:${target.effectId}:${target.property}`;
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const inverse = 1 - t;
  return inverse ** 3 * a + 3 * inverse ** 2 * t * b + 3 * inverse * t ** 2 * c + t ** 3 * d;
}

function customCurveValue(progress: number, left: VideoEditorKeyframe, right: VideoEditorKeyframe): number {
  if (right.bezier) {
    return solveCubicBezier(progress, right.bezier.x1, right.bezier.y1, right.bezier.x2, right.bezier.y2);
  }
  // Compatibility for projects written before segment-normalized handles were
  // persisted. New edits never manufacture absolute tangent coordinates.
  const frameSpan = Math.max(1, right.frame - left.frame);
  const valueSpan = right.value - left.value;
  const normalizeX = (value: number | undefined, fallback: number) => value === undefined ? fallback : Math.max(0, Math.min(1, (value - left.frame) / frameSpan));
  const normalizeY = (value: number | undefined, fallback: number) => value === undefined || Math.abs(valueSpan) < 1e-9 ? fallback : (value - left.value) / valueSpan;
  const x1 = normalizeX(left.outTangent?.x, 1 / 3);
  const x2 = normalizeX(right.inTangent?.x, 2 / 3);
  const y1 = normalizeY(left.outTangent?.y, 1 / 3);
  const y2 = normalizeY(right.inTangent?.y, 2 / 3);
  return solveCubicBezier(progress, x1, y1, x2, y2);
}

function solveCubicBezier(progress: number, x1: number, y1: number, x2: number, y2: number): number {
  let low = 0; let high = 1;
  for (let index = 0; index < 20; index += 1) {
    const candidate = (low + high) / 2;
    if (cubic(0, x1, x2, 1, candidate) < progress) low = candidate; else high = candidate;
  }
  return cubic(0, y1, y2, 1, (low + high) / 2);
}

function curveValue(progress: number, curve: VideoEditorAutomationCurve, left: VideoEditorKeyframe, right: VideoEditorKeyframe): number {
  const t = Math.max(0, Math.min(1, progress));
  if (curve === "hold") return 0;
  if (curve === "easeIn") return t * t;
  if (curve === "easeOut") return 1 - (1 - t) * (1 - t);
  if (curve === "easeInOut") return t * t * (3 - 2 * t);
  if (curve === "exponential") return t === 0 ? 0 : (Math.pow(2, 4 * t) - 1) / 15;
  if (curve === "logarithmic") return Math.log1p(9 * t) / Math.log(10);
  if (curve === "custom" || curve === "bezier") return customCurveValue(t, left, right);
  return t;
}

export function resolveVideoEditorAutomationValue(
  lanes: readonly VideoEditorAutomationLane[],
  target: VideoEditorAutomationTarget,
  frame: number,
  fallback: number
): number {
  const lane = lanes.find((candidate) => candidate.enabled && targetKey(candidate.target) === targetKey(target));
  if (!lane || lane.keyframes.length === 0) return fallback;
  const points = [...lane.keyframes].sort((a, b) => a.frame - b.frame);
  if (frame <= points[0]!.frame) return points[0]!.value;
  const last = points[points.length - 1]!;
  if (frame >= last.frame) return last.value;
  const rightIndex = points.findIndex((point) => point.frame >= frame);
  const right = points[rightIndex]!;
  const left = points[Math.max(0, rightIndex - 1)]!;
  if (right.frame === left.frame) return right.value;
  const shaped = curveValue((frame - left.frame) / (right.frame - left.frame), right.curve ?? "linear", left, right);
  return left.value + (right.value - left.value) * shaped;
}

export function upsertVideoEditorKeyframe(
  lanes: readonly VideoEditorAutomationLane[],
  target: VideoEditorAutomationTarget,
  keyframe: VideoEditorKeyframe
): VideoEditorAutomationLane[] {
  const key = targetKey(target);
  const existing = lanes.find((lane) => targetKey(lane.target) === key);
  if (!existing) return [...lanes, { id: `automation-${crypto.randomUUID()}`, target, enabled: true, keyframes: [keyframe] }];
  return lanes.map((lane) => lane.id !== existing.id ? lane : {
    ...lane,
    keyframes: [...lane.keyframes.filter((point) => point.frame !== keyframe.frame), keyframe].sort((a, b) => a.frame - b.frame)
  });
}

export function removeVideoEditorKeyframe(lanes: readonly VideoEditorAutomationLane[], target: VideoEditorAutomationTarget, frame: number): VideoEditorAutomationLane[] {
  const key = targetKey(target);
  return lanes.map((lane) => lane.id !== key && targetKey(lane.target) !== key ? lane : { ...lane, keyframes: lane.keyframes.filter((point) => point.frame !== frame) }).filter((lane) => lane.keyframes.length > 0);
}

export function videoEditorAutomationTargetKey(target: VideoEditorAutomationTarget): string {
  return targetKey(target);
}
