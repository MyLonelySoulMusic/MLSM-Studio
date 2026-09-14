export interface TimeSeriesPlaybackTiming {
  startDelay: number;
  stepDelay: number;
  pointDuration: number;
  seriesEnd: number;
  trendStart: number;
  trendDuration: number;
  totalDuration: number;
}

export function timeSeriesPoints<T extends { value: number }>(points: readonly T[], mode: "period" | "cumulative"): T[] {
  if (mode === "period") return points.map(point => ({ ...point }));
  let total = 0;
  return points.map(point => ({ ...point, value: total += point.value }));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function timeSeriesRevealProgress(elapsed: number, start: number, duration: number): number | null {
  if (elapsed < start) return null;
  return clamp((elapsed - start) / Math.max(1, duration), 0, 1);
}

export function timeSeriesPlaybackTiming(pointCount: number, withTrend: boolean): TimeSeriesPlaybackTiming {
  const count = Math.max(1, Math.floor(pointCount));
  const startDelay = 260;
  const seriesSpan = clamp(count * 520, 2_800, 8_500);
  const stepDelay = count > 1 ? seriesSpan / (count - 1) : 0;
  const pointDuration = clamp(stepDelay * 0.72 || 520, 260, 620);
  const seriesEnd = startDelay + (stepDelay * (count - 1)) + pointDuration;
  const trendStart = seriesEnd + 380;
  const trendDuration = withTrend ? clamp(count * 90, 1_100, 2_100) : 0;
  return { startDelay, stepDelay, pointDuration, seriesEnd, trendStart, trendDuration, totalDuration: withTrend ? trendStart + trendDuration : seriesEnd };
}

export function playbackPointIndex(elapsed: number, pointCount: number, timing: TimeSeriesPlaybackTiming): number {
  if (pointCount <= 0 || elapsed < timing.startDelay) return -1;
  if (pointCount === 1) return 0;
  return Math.min(pointCount - 1, Math.floor((elapsed - timing.startDelay) / timing.stepDelay));
}
