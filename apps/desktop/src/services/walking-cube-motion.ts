export interface WalkingCubeImpact {
  timeSeconds: number;
  strength: number;
}

export interface WalkingCubePose {
  loopPhase: number;
  stepIndex: number;
  stepProgress: number;
  position: { x: number; y: number; z: number };
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  orientation: { x: number; y: number; z: number; w: number };
  split: number;
  zoom: number;
  selectedChildIndex: number;
  impactStrength: number;
}

export interface WalkingCubeMotionOptions {
  durationSeconds: number;
  bpm: number;
  impacts: readonly WalkingCubeImpact[];
  seed: number;
  intensity: number;
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function smootherstep(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}
function hash(seed: number): number { const value = Math.sin(seed * 91.173 + 14.71) * 43_758.5453; return value - Math.floor(value); }

function impactAnchors(durationSeconds: number, impacts: readonly WalkingCubeImpact[], bpm: number): { times: number[]; strengths: number[] } {
  const duration = Math.max(.001, durationSeconds);
  const events = impacts
    .filter((impact) => impact.timeSeconds > 0 && impact.timeSeconds < duration && Number.isFinite(impact.timeSeconds))
    .sort((left, right) => left.timeSeconds - right.timeSeconds)
    .filter((impact, index, source) => index === 0 || impact.timeSeconds - source[index - 1]!.timeSeconds > .025);
  const estimated = events.length || Math.max(4, Math.round(duration * Math.max(48, bpm || 90) / 60));
  // Gruppi di quattro quarti di giro garantiscono che l'ultimo orientamento
  // coincida con il primo, senza dover nascondere il raccordo del loop.
  const stepCount = Math.max(4, Math.min(256, Math.round(estimated / 4) * 4));
  const sources = [{ timeSeconds: 0, strength: 0 }, ...events, { timeSeconds: duration, strength: 0 }];
  const times = Array.from({ length: stepCount + 1 }, (_, index) => {
    if (index === 0) return 0;
    if (index === stepCount) return duration;
    const sourcePosition = index / stepCount * (sources.length - 1);
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(sources.length - 1, leftIndex + 1);
    const mix = sourcePosition - leftIndex;
    const eventTime = sources[leftIndex]!.timeSeconds + (sources[rightIndex]!.timeSeconds - sources[leftIndex]!.timeSeconds) * mix;
    return eventTime * .9 + duration * index / stepCount * .1;
  });
  const strengths = Array.from({ length: stepCount }, (_, index) => {
    const center = (times[index]! + times[index + 1]!) * .5;
    const nearest = events.reduce<WalkingCubeImpact | null>((best, event) => !best || Math.abs(event.timeSeconds - center) < Math.abs(best.timeSeconds - center) ? event : best, null);
    return clamp01(nearest?.strength ?? .62);
  });
  return { times, strengths };
}

export function createWalkingCubeMotionEvaluator(options: WalkingCubeMotionOptions): (timeSeconds: number) => WalkingCubePose {
  const duration = Math.max(.001, options.durationSeconds);
  const { times, strengths } = impactAnchors(duration, options.impacts, options.bpm);
  const stepCount = times.length - 1;
  return (requestedTime) => {
    const wrappedTime = ((requestedTime % duration) + duration) % duration;
    const loopPhase = wrappedTime / duration;
    let low = 0;
    let high = stepCount - 1;
    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (times[middle]! <= wrappedTime) low = middle;
      else high = middle - 1;
    }
    const stepIndex = Math.min(stepCount - 1, low);
    const start = times[stepIndex]!;
    const end = times[stepIndex + 1]!;
    const stepProgress = clamp01((wrappedTime - start) / Math.max(.001, end - start));
    const responseEnd = Math.max(.38, Math.min(.94, .88 / Math.max(.25, options.intensity)));
    const rotationProgress = smootherstep((stepProgress - .025) / Math.max(.1, responseEnd - .025));
    const groupIndex = Math.floor(stepIndex / 4);
    const withinGroup = stepIndex % 4;
    // Ogni asse ha sempre componenti X, Y e Z: è un vero tumble nello
    // spazio, non una sequenza di ribaltamenti piatti su una sola faccia.
    const rawAxis = {
      x: (.42 + hash(options.seed + groupIndex * 17.7) * .58) * (hash(options.seed + groupIndex * 11.2) >= .5 ? 1 : -1),
      y: (.42 + hash(options.seed + groupIndex * 23.4) * .58) * (hash(options.seed + groupIndex * 31.7) >= .5 ? 1 : -1),
      z: (.42 + hash(options.seed + groupIndex * 37.1) * .58) * (hash(options.seed + groupIndex * 43.9) >= .5 ? 1 : -1)
    };
    const axisLength = Math.hypot(rawAxis.x, rawAxis.y, rawAxis.z);
    const axis = { x: rawAxis.x / axisLength, y: rawAxis.y / axisLength, z: rawAxis.z / axisLength };
    const angle = (withinGroup + rotationProgress) * Math.PI / 2;
    const halfAngle = angle / 2;
    const sine = Math.sin(halfAngle);
    return {
      loopPhase,
      stepIndex,
      stepProgress,
      position: { x: 0, y: 0, z: 0 },
      rotationX: axis.x * angle,
      rotationY: axis.y * angle,
      rotationZ: axis.z * angle,
      orientation: { x: axis.x * sine, y: axis.y * sine, z: axis.z * sine, w: Math.cos(halfAngle) },
      split: 0,
      zoom: 0,
      selectedChildIndex: 0,
      impactStrength: strengths[stepIndex]!
    };
  };
}
