import { describe, expect, it } from "vitest";
import { bucketTimeValue, TIME_GRAIN_LABELS, TIME_GRAIN_LABELS_BY_LANGUAGE, type TimeGrain } from "./time-buckets";

describe("report time buckets", () => {
  it("exposes Italian labels for every supported grain", () => {
    const grains: TimeGrain[] = ["exact", "day", "week", "month", "quarter", "year"];
    expect(grains.map(grain => TIME_GRAIN_LABELS[grain])).toEqual(["Data esatta", "Giorno", "Settimana", "Mese", "Trimestre", "Anno"]);
  });

  it("keeps exact ISO values while sorting by their UTC timestamp", () => {
    const value = "2026-09-11T23:30:45.125-02:00";
    expect(bucketTimeValue(value, "exact")).toEqual({ key: value, label: value, sortKey: Date.parse(value) });
    expect(bucketTimeValue("2026-09-11", "exact")).toEqual({ key: "2026-09-11", label: "2026-09-11", sortKey: Date.parse("2026-09-11T00:00:00Z") });
  });

  it("buckets dates by UTC day and treats timezone-less datetimes as UTC", () => {
    expect(bucketTimeValue("2026-09-11T23:30:00-02:00", "day")).toEqual({ key: "2026-09-12", label: "12/09/2026", sortKey: Date.parse("2026-09-12T00:00:00Z") });
    expect(bucketTimeValue("2026-09-11T23:30", "day")).toEqual({ key: "2026-09-11", label: "11/09/2026", sortKey: Date.parse("2026-09-11T00:00:00Z") });
  });

  it("uses ISO Monday-to-Sunday weeks, including year boundaries", () => {
    expect(bucketTimeValue("2020-12-31", "week")).toEqual({ key: "2020-W53", label: "Settimana 53 · 2020", sortKey: Date.parse("2020-12-28T00:00:00Z") });
    expect(bucketTimeValue("2021-01-01", "week")).toEqual({ key: "2020-W53", label: "Settimana 53 · 2020", sortKey: Date.parse("2020-12-28T00:00:00Z") });
    expect(bucketTimeValue("2021-01-04", "week")).toEqual({ key: "2021-W01", label: "Settimana 1 · 2021", sortKey: Date.parse("2021-01-04T00:00:00Z") });
    expect(bucketTimeValue("2026-09-13T00:30:00+02:00", "week")).toEqual({ key: "2026-W37", label: "Settimana 37 · 2026", sortKey: Date.parse("2026-09-07T00:00:00Z") });
  });

  it("creates deterministic month, quarter and year buckets", () => {
    expect(bucketTimeValue("2026-01-31", "month")).toEqual({ key: "2026-01", label: "gen 2026", sortKey: Date.parse("2026-01-01T00:00:00Z") });
    expect(bucketTimeValue("2026-09-30T23:59:59Z", "month")).toEqual({ key: "2026-09", label: "set 2026", sortKey: Date.parse("2026-09-01T00:00:00Z") });
    expect(bucketTimeValue("2026-03-31", "quarter")).toEqual({ key: "2026-Q1", label: "T1 2026", sortKey: Date.parse("2026-01-01T00:00:00Z") });
    expect(bucketTimeValue("2026-04-01", "quarter")).toEqual({ key: "2026-Q2", label: "T2 2026", sortKey: Date.parse("2026-04-01T00:00:00Z") });
    expect(bucketTimeValue("2026-12-31", "quarter")).toEqual({ key: "2026-Q4", label: "T4 2026", sortKey: Date.parse("2026-10-01T00:00:00Z") });
    expect(bucketTimeValue("2026-12-31", "year")).toEqual({ key: "2026", label: "2026", sortKey: Date.parse("2026-01-01T00:00:00Z") });
  });

  it("creates English labels for controls and grouped chart axes", () => {
    expect(TIME_GRAIN_LABELS_BY_LANGUAGE.en).toEqual({ exact: "Exact date", day: "Day", week: "Week", month: "Month", quarter: "Quarter", year: "Year" });
    expect(bucketTimeValue("2026-09-30", "week", "en")?.label).toBe("Week 40 · 2026");
    expect(bucketTimeValue("2026-09-30", "month", "en")?.label).toBe("Sep 2026");
    expect(bucketTimeValue("2026-09-30", "quarter", "en")?.label).toBe("Q3 2026");
  });

  it("returns null for empty, non-text and invalid ISO values", () => {
    expect(bucketTimeValue(undefined, "day")).toBeNull();
    expect(bucketTimeValue(null, "day")).toBeNull();
    expect(bucketTimeValue(2026, "day")).toBeNull();
    expect(bucketTimeValue(true, "day")).toBeNull();
    expect(bucketTimeValue("", "day")).toBeNull();
    expect(bucketTimeValue("2026-02-29", "day")).toBeNull();
    expect(bucketTimeValue("2026-13-01", "month")).toBeNull();
    expect(bucketTimeValue("2026-01-01T24:00:00Z", "day")).toBeNull();
    expect(bucketTimeValue("2026-01-01T12:60:00Z", "day")).toBeNull();
    expect(bucketTimeValue("2026-01-01T12:00:00+25:00", "day")).toBeNull();
  });
});
