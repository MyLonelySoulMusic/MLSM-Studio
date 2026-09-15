import { describe, expect, it } from "vitest";
import { barRaceValueDecimals, buildBarRaceFrames, interpolateBarRaceFrames } from "./bar-race-playback";
import type { BarRaceAnimation, ReportDataset } from "./types";

const dataset: ReportDataset = {
  id: "sales", name: "Vendite", sourceName: "sales.csv",
  sources: [{ id: "source-sales", fileName: "sales.csv", sheetName: "Vendite", importedAt: "2026-01-01T00:00:00.000Z", rowCount: 5 }],
  fields: [
    { id: "date", name: "Data", type: "date" },
    { id: "group", name: "Gruppo", type: "text" },
    { id: "value", name: "Valore", type: "number" },
  ],
  rows: [
    { date: "2026-01-03", group: "A", value: 10 },
    { date: "2026-01-20", group: "A", value: 30 },
    { date: "2026-01-08", group: "B", value: 25 },
    { date: "2026-02-02", group: "A", value: 100 },
    { date: "2026-02-04", group: "B", value: 5 },
  ],
};

const animation: BarRaceAnimation = {
  type: "barRace", dateDimension: "date", groupDimension: "group", measure: "value",
  aggregation: "sum", timeGrain: "month", valueMode: "period", orientation: "horizontal", sort: "desc", stepDurationMs: 1600,
};

describe("Reports Bar Chart Race playback", () => {
  it("builds chronological period frames and recomputes the ranking", () => {
    const frames = buildBarRaceFrames(animation, dataset);

    expect(frames.map(frame => frame.label)).toEqual(["gen 2026", "feb 2026"]);
    expect(frames[0]!.points.map(point => [point.label, point.value, point.rank])).toEqual([
      ["A", 40, 0], ["B", 25, 1],
    ]);
    expect(frames[1]!.points.map(point => [point.label, point.value, point.rank])).toEqual([
      ["A", 100, 0], ["B", 5, 1],
    ]);
  });

  it("uses the selected aggregation over all rows to date in cumulative mode", () => {
    const frames = buildBarRaceFrames({ ...animation, aggregation: "avg", valueMode: "cumulative", sort: "asc" }, dataset);

    expect(frames[0]!.points.find(point => point.label === "A")?.value).toBe(20);
    expect(frames[1]!.points.find(point => point.label === "A")?.value).toBeCloseTo(140 / 3);
    expect(frames[1]!.points.find(point => point.label === "B")?.value).toBe(15);
    expect(frames[1]!.points.map(point => point.label)).toEqual(["B", "A"]);
  });

  it("interpolates values and rank positions without jumps", () => {
    const frames = buildBarRaceFrames(animation, {
      ...dataset,
      rows: [
        { date: "2026-01-01", group: "A", value: 10 },
        { date: "2026-01-01", group: "B", value: 80 },
        { date: "2026-02-01", group: "A", value: 100 },
        { date: "2026-02-01", group: "B", value: 20 },
      ],
    });
    const halfway = interpolateBarRaceFrames(frames[0]!, frames[1]!, 0.5);

    expect(halfway.find(point => point.label === "A")).toMatchObject({ value: 55, rank: 0.5 });
    expect(halfway.find(point => point.label === "B")).toMatchObject({ value: 50, rank: 0.5 });
  });

  it("keeps animated labels integer only when every real frame value is integer", () => {
    const integerFrames = buildBarRaceFrames(animation, dataset);
    const decimalFrames = buildBarRaceFrames({ ...animation, aggregation: "avg", valueMode: "cumulative" }, dataset);

    expect(barRaceValueDecimals(integerFrames, 3)).toBe(0);
    expect(barRaceValueDecimals(decimalFrames, 3)).toBe(3);
  });
});
