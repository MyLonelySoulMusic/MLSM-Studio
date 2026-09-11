import { describe, expect, it } from "vitest";
import { filtersForWidget, normalizeFilterTargets, type DashboardFilterLike } from "./filter-targets";

const filters: DashboardFilterLike[] = [
  { id: "global", datasetId: "sales", fieldId: "region", value: "Nord" },
  { id: "empty-targets", datasetId: "sales", fieldId: "channel", value: "Retail", widgetIds: [] },
  { id: "bar-only", datasetId: "sales", fieldId: "status", value: "Confermato", targetMode: "selected", widgetIds: ["bar"] },
  { id: "line-and-table", datasetId: "sales", fieldId: "owner", value: "Ada", targetMode: "selected", widgetIds: ["line", "table"] },
  { id: "other-dataset", datasetId: "costs", fieldId: "region", value: "Nord" },
];

describe("report filter targets", () => {
  it("applies global filters and filters with empty targets to every widget in their dataset", () => {
    expect(filtersForWidget(filters, "line", "sales").map((filter) => filter.id)).toEqual([
      "global",
      "empty-targets",
      "line-and-table",
    ]);
    expect(filtersForWidget(filters, "table", "sales").map((filter) => filter.id)).toEqual([
      "global",
      "empty-targets",
      "line-and-table",
    ]);
  });

  it("keeps only filters explicitly targeting the selected widget", () => {
    expect(filtersForWidget(filters, "bar", "sales").map((filter) => filter.id)).toEqual([
      "global",
      "empty-targets",
      "bar-only",
    ]);
    expect(filtersForWidget(filters, "kpi", "sales").map((filter) => filter.id)).toEqual([
      "global",
      "empty-targets",
    ]);
  });

  it("never leaks filters from another dataset", () => {
    expect(filtersForWidget(filters, "bar", "costs").map((filter) => filter.id)).toEqual(["other-dataset"]);
    expect(filtersForWidget(filters, "bar", "missing-dataset")).toEqual([]);
  });

  it("allows an explicitly selected filter to target no widget", () => {
    const disabled: DashboardFilterLike = { id: "none", datasetId: "sales", fieldId: "region", value: "Nord", targetMode: "selected", widgetIds: [] };
    expect(filtersForWidget([disabled], "bar", "sales")).toEqual([]);
  });

  it("normalizes valid targets, preserving order and removing duplicates", () => {
    const validWidgetIds = new Set(["bar", "line", "table"]);
    expect(normalizeFilterTargets(["line", "bar", "line", "table", "bar"], validWidgetIds)).toEqual([
      "line",
      "bar",
      "table",
    ]);
  });

  it("drops malformed, empty, invalid and prototype-like values", () => {
    const validWidgetIds = new Set(["bar", "line"]);
    const maliciousValues: unknown[] = [
      "line",
      "line",
      "",
      " ",
      "missing",
      "__proto__",
      "constructor",
      1,
      null,
      undefined,
      { id: "bar" },
      ["bar"],
    ];

    expect(normalizeFilterTargets(maliciousValues, validWidgetIds)).toEqual(["line"]);
    expect(normalizeFilterTargets({ widgetIds: ["bar"] }, validWidgetIds)).toEqual([]);
  });
});
