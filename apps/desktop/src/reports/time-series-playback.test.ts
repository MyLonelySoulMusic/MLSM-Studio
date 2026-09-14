import { describe, expect, it } from "vitest";
import { playbackPointIndex, timeSeriesPlaybackTiming, timeSeriesPoints, timeSeriesRevealProgress } from "./time-series-playback";

describe("Reports Time Series playback", () => {
  it("keeps period values or turns them into a chronological running total", () => {
    const points = [{ label: "Gen", value: 10 }, { label: "Feb", value: -3 }, { label: "Mar", value: 8 }];
    expect(timeSeriesPoints(points, "period")).toEqual(points);
    expect(timeSeriesPoints(points, "cumulative")).toEqual([
      { label: "Gen", value: 10 },
      { label: "Feb", value: 7 },
      { label: "Mar", value: 15 },
    ]);
    expect(points[1]!.value).toBe(-3);
  });

  it("reveals every point in chronological sequence and delays the trend", () => {
    const timing = timeSeriesPlaybackTiming(6, true);
    expect(playbackPointIndex(timing.startDelay - 1, 6, timing)).toBe(-1);
    expect(playbackPointIndex(timing.startDelay, 6, timing)).toBe(0);
    expect(playbackPointIndex(timing.startDelay + timing.stepDelay * 3, 6, timing)).toBe(3);
    expect(playbackPointIndex(timing.seriesEnd, 6, timing)).toBe(5);
    expect(timing.trendStart).toBeGreaterThan(timing.seriesEnd);
    expect(timing.totalDuration).toBeGreaterThan(timing.trendStart);
    expect(playbackPointIndex(timing.trendStart, 6, timing)).toBe(5);
    expect(playbackPointIndex((timing.trendStart + timing.totalDuration) / 2, 6, timing)).toBe(5);
    expect(playbackPointIndex(timing.totalDuration, 6, timing)).toBe(5);
  });

  it("keeps long series fluid without turning into an excessively long playback", () => {
    const timing = timeSeriesPlaybackTiming(500, false);
    expect(timing.seriesEnd).toBeLessThan(10_000);
    expect(playbackPointIndex(timing.totalDuration, 500, timing)).toBe(499);
  });

  it("draws no part of the trend line before its dedicated phase", () => {
    const timing = timeSeriesPlaybackTiming(8, true);
    expect(timeSeriesRevealProgress(timing.trendStart - 1, timing.trendStart, timing.trendDuration)).toBeNull();
    expect(timeSeriesRevealProgress(timing.trendStart, timing.trendStart, timing.trendDuration)).toBe(0);
    expect(timeSeriesRevealProgress(timing.totalDuration, timing.trendStart, timing.trendDuration)).toBe(1);
  });
});
