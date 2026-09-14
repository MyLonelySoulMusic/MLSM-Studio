import { displayCell, filterRows, reduceDatasetMeasure } from "./aggregation";
import { bucketTimeValue } from "./time-buckets";
import type { BarRaceAnimation, CellValue, ReportDataset, ReportFilter } from "./types";
import type { UiLanguage } from "../services/ui-preferences";

export interface BarRacePoint {
  id: string;
  label: string;
  value: number;
  rank: number;
}

export interface BarRaceFrame {
  key: string;
  label: string;
  sortKey: number;
  points: BarRacePoint[];
}

interface ValueGroup {
  label: string;
  rows: ReportDataset["rows"];
}

interface PeriodGroup {
  key: string;
  label: string;
  sortKey: number;
  groups: Map<string, ValueGroup>;
}

function categoryKey(value: CellValue | undefined): string {
  return value === null || value === undefined || value === "" ? "empty:" : `${typeof value}:${String(value)}`;
}

function ranked(points: Omit<BarRacePoint, "rank">[], sort: BarRaceAnimation["sort"], language: UiLanguage): BarRacePoint[] {
  return [...points]
    .sort((left, right) => {
      const byValue = sort === "asc" ? left.value - right.value : right.value - left.value;
      return byValue || left.label.localeCompare(right.label, language, { numeric: true, sensitivity: "base" });
    })
    .map((point, rank) => ({ ...point, rank }));
}

export function buildBarRaceFrames(
  animation: BarRaceAnimation,
  dataset: ReportDataset,
  filters: ReportFilter[] = [],
  language: UiLanguage = "it",
): BarRaceFrame[] {
  const rows = filterRows(dataset, filters);
  const periods = new Map<string, PeriodGroup>();
  const categories = new Map<string, string>();

  for (const row of rows) {
    const bucket = bucketTimeValue(row[animation.dateDimension], animation.timeGrain, language);
    if (!bucket) continue;
    const rawCategory = row[animation.groupDimension];
    const id = categoryKey(rawCategory);
    const label = displayCell(rawCategory);
    categories.set(id, label);
    let period = periods.get(bucket.key);
    if (!period) {
      period = { key: bucket.key, label: bucket.label, sortKey: bucket.sortKey, groups: new Map() };
      periods.set(bucket.key, period);
    }
    let group = period.groups.get(id);
    if (!group) {
      group = { label, rows: [] };
      period.groups.set(id, group);
    }
    group.rows.push(row);
  }

  const orderedPeriods = [...periods.values()].sort((left, right) => left.sortKey - right.sortKey);
  const running = new Map<string, ValueGroup>();
  return orderedPeriods.map(period => {
    if (animation.valueMode === "cumulative") {
      for (const [id, group] of period.groups) {
        const current = running.get(id) ?? { label: group.label, rows: [] };
        current.rows.push(...group.rows);
        running.set(id, current);
      }
    }
    const source = animation.valueMode === "cumulative" ? running : period.groups;
    const points = [...categories].map(([id, label]) => {
      const group = source.get(id);
      const value = group ? reduceDatasetMeasure(dataset, animation.measure, group.rows, animation.aggregation) : 0;
      return { id, label, value: value ?? 0 };
    });
    return { key: period.key, label: period.label, sortKey: period.sortKey, points: ranked(points, animation.sort, language) };
  });
}

export function interpolateBarRaceFrames(from: BarRaceFrame, to: BarRaceFrame, progress: number): BarRacePoint[] {
  const amount = Math.max(0, Math.min(1, progress));
  const previous = new Map(from.points.map(point => [point.id, point]));
  return to.points.map(point => {
    const start = previous.get(point.id) ?? { ...point, value: 0, rank: from.points.length };
    return {
      ...point,
      value: start.value + ((point.value - start.value) * amount),
      rank: start.rank + ((point.rank - start.rank) * amount),
    };
  });
}

export function barRaceValueDecimals(frames: BarRaceFrame[], configuredDecimals: number): number {
  const values = frames.flatMap(frame => frame.points.map(point => point.value));
  return values.length > 0 && values.every(Number.isInteger) ? 0 : configuredDecimals;
}

export function barRaceStepDuration(value: number): number {
  return Math.max(200, Math.min(20_000, Math.round(value)));
}
