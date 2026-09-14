import { describe, expect, it } from "vitest";
import { aggregateWidget, filterRows, formatReportNumber } from "./aggregation";
import { createWidget, type ReportDataset, type ReportFilter, type ReportWidget } from "./types";

const dataset: ReportDataset = {
  id: "sales", name: "Vendite", sourceName: "sales.csv",
  fields: [{ id: "region", name: "Regione", type: "text" }, { id: "sales", name: "Ricavi", type: "number" }, { id: "cost", name: "Costi", type: "number" }, { id: "date", name: "Data", type: "date" }],
  rows: [
    { region: "Nord", sales: 20, cost: 7, date: "2026-03-01" },
    { region: "Nord", sales: null, cost: 5, date: "2026-02-01" },
    { region: "Sud", sales: 0, cost: 3, date: "2026-01-01" },
    { region: "Nord", sales: 40, cost: null, date: "2026-01-01" },
    { region: "Sud", sales: -10, cost: 6, date: "2026-02-01" },
  ],
};
const widget = (overrides: Partial<ReportWidget> = {}): ReportWidget => ({ ...createWidget("bar", dataset), dimension: "region", measure: "sales", ...overrides });
const filter = (value: string | null, overrides: Partial<ReportFilter> = {}): ReportFilter => ({ id: "filter", datasetId: "sales", fieldId: "region", value, defaultValue: value, includeAll: true, targetMode: "all", widgetIds: [], ...overrides });

describe("report aggregation", () => {
  it("sums groups and excludes absent numbers without turning them into zero", () => {
    const report = aggregateWidget(widget(), dataset);
    expect(report.points).toEqual([{ label: "Nord", value: 60 }, { label: "Sud", value: -10 }]);
    expect(report.excludedRows).toBe(1);
    const missing: ReportDataset = { ...dataset, rows: [{ region: "Nord", sales: null }] };
    expect(aggregateWidget(widget({ type: "kpi" }), missing)).toMatchObject({ value: null, message: expect.stringContaining("Nessun valore numerico") });
    expect(aggregateWidget(widget(), missing).points).toEqual([]);
  });

  it("averages only numeric values and includes actual zero", () => {
    expect(aggregateWidget(widget({ aggregation: "avg" }), dataset).points).toEqual([{ label: "Nord", value: 30 }, { label: "Sud", value: -5 }]);
    expect(aggregateWidget(widget({ aggregation: "min", type: "kpi" }), dataset).value).toBe(-10);
    expect(aggregateWidget(widget({ aggregation: "max", type: "kpi" }), dataset).value).toBe(40);
  });

  it("supports distinct count, median, range, variance and standard deviation", () => {
    expect(aggregateWidget(widget({ type: "kpi", aggregation: "distinct", measure: "region" }), dataset).value).toBe(2);
    expect(aggregateWidget(widget({ type: "kpi", aggregation: "median" }), dataset).value).toBe(10);
    expect(aggregateWidget(widget({ type: "kpi", aggregation: "range" }), dataset).value).toBe(50);
    expect(aggregateWidget(widget({ type: "kpi", aggregation: "variance" }), dataset).value).toBe(368.75);
    expect(aggregateWidget(widget({ type: "kpi", aggregation: "stddev" }), dataset).value).toBeCloseTo(19.2029, 4);
  });

  it("formats currencies independently from the generic number format", () => {
    expect(formatReportNumber(1234.5, "currency", "USD", 2)).toContain("$");
    expect(formatReportNumber(1234.5, "currency", "EUR", 2)).toContain("€");
    expect(formatReportNumber(0.256, "percent", "EUR", 1)).toContain("25,6");
    expect(formatReportNumber(1234.5, "number", "EUR", 2, "en")).toBe("1,234.5");
  });

  it("counts rows including empty measurements and does not require a numeric measure", () => {
    expect(aggregateWidget(widget({ aggregation: "count", measure: "" }), dataset).points).toEqual([{ label: "Nord", value: 3 }, { label: "Sud", value: 2 }]);
    expect(aggregateWidget(widget({ aggregation: "count", measure: "", type: "kpi", dimension: "" }), dataset).value).toBe(5);
  });

  it("applies exact filters to their own data source and combines them", () => {
    expect(filterRows(dataset, [filter(null)])).toHaveLength(5);
    expect(filterRows(dataset, [filter("Nord")])).toHaveLength(3);
    expect(filterRows(dataset, [filter("nord")])).toEqual([]);
    expect(filterRows(dataset, [filter("Sud", { datasetId: "another" })])).toHaveLength(5);
    expect(filterRows(dataset, [filter("Nord"), filter("20", { id: "second", fieldId: "sales" })])).toEqual([dataset.rows[0]]);
    expect(aggregateWidget(widget({ type: "kpi" }), dataset, [filter("Nord")]).value).toBe(60);
    expect(aggregateWidget(widget(), dataset, [filter("Centro")])).toMatchObject({ value: null, points: [], message: expect.stringContaining("Nessun dato") });
  });

  it("reports missing fields instead of showing results with a stale filter or measurement", () => {
    expect(aggregateWidget(widget(), dataset, [filter("x", { fieldId: "removed" })]).message).toContain("Un filtro usa un campo non disponibile");
    expect(aggregateWidget(widget({ measure: "removed" }), dataset).message).toContain("campo numerico");
    expect(aggregateWidget(widget({ dimension: "removed" }), dataset).message).toContain("dimensione");
  });

  it("sorts values before limiting groups and keeps chronological source order for dates", () => {
    expect(aggregateWidget(widget({ sort: "asc", limit: 1 }), dataset).points).toEqual([{ label: "Sud", value: -10 }]);
    expect(aggregateWidget(widget({ sort: "desc", limit: 1 }), dataset).points).toEqual([{ label: "Nord", value: 60 }]);
    expect(aggregateWidget(widget({ type: "line", dimension: "date" }), dataset).points.map(point => point.label)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("includes every category by default and limits only when explicitly configured", () => {
    const manyCategories: ReportDataset = {
      id: "many", name: "Categorie", sourceName: "categorie.csv",
      fields: [{ id: "category", name: "Categoria", type: "text" }, { id: "value", name: "Valore", type: "number" }],
      rows: Array.from({ length: 18 }, (_, index) => ({ category: `Categoria ${index + 1}`, value: index + 1 })),
    };
    const all = { ...createWidget("bar", manyCategories), dimension: "category", measure: "value" };

    expect(all.limit).toBeNull();
    expect(aggregateWidget(all, manyCategories).points).toHaveLength(18);
    expect(aggregateWidget({ ...all, limit: 3, categoryLimitMode: "first" }, manyCategories).points.map(point => point.label)).toEqual(["Categoria 1", "Categoria 2", "Categoria 3"]);
    expect(aggregateWidget({ ...all, limit: 3, categoryLimitMode: "last" }, manyCategories).points.map(point => point.label)).toEqual(["Categoria 16", "Categoria 17", "Categoria 18"]);
  });

  it("orders an X axis chronologically or numerically without changing value sorting", () => {
    expect(aggregateWidget(widget({ type: "line", dimension: "date", xSort: "asc" }), dataset).points.map(point => point.label)).toEqual([
      "2026-01-01", "2026-02-01", "2026-03-01",
    ]);
    expect(aggregateWidget(widget({ type: "line", dimension: "date", xSort: "desc" }), dataset).points.map(point => point.label)).toEqual([
      "2026-03-01", "2026-02-01", "2026-01-01",
    ]);

    const numericDataset: ReportDataset = {
      id: "numeric-axis", name: "Numeri", sourceName: "numeric.csv",
      fields: [{ id: "bucket", name: "Fascia", type: "number" }, { id: "amount", name: "Importo", type: "number" }],
      rows: [{ bucket: 10, amount: 1 }, { bucket: 2, amount: 1 }, { bucket: 1, amount: 1 }, { bucket: 20, amount: 1 }],
    };
    const numericWidget = (overrides: Partial<ReportWidget> = {}): ReportWidget => ({
      ...createWidget("line", numericDataset), dimension: "bucket", measure: "amount", ...overrides,
    });
    expect(aggregateWidget(numericWidget({ xSort: "asc" }), numericDataset).points.map(point => point.label)).toEqual(["1", "2", "10", "20"]);

    expect(aggregateWidget(widget({ sort: "desc" }), dataset).points.map(point => point.label)).toEqual(["Nord", "Sud"]);
  });

  it("keeps date axes chronological for line and area charts despite legacy value sorting", () => {
    const chronological = ["2026-01-01", "2026-02-01", "2026-03-01"];
    const reverseChronological = [...chronological].reverse();

    for (const type of ["line", "area"] as const) {
      for (const sort of ["asc", "desc"] as const) {
        expect(aggregateWidget(widget({ type, dimension: "date", xSort: "asc", sort }), dataset).points.map(point => point.label)).toEqual(chronological);
        expect(aggregateWidget(widget({ type, dimension: "date", xSort: "desc", sort }), dataset).points.map(point => point.label)).toEqual(reverseChronological);
      }
    }
  });

  it("recognizes YYYY-MM text periods and orders them chronologically despite legacy value sorting", () => {
    const monthly: ReportDataset = {
      id: "monthly", name: "Mensile", sourceName: "monthly.csv",
      fields: [{ id: "month", name: "Sale Month", type: "text" }, { id: "revenue", name: "Revenue", type: "number" }],
      rows: [
        { month: "2026-04", revenue: 1 },
        { month: "2025-10", revenue: 2 },
        { month: "2026-02", revenue: 3 },
        { month: "2025-12", revenue: 4 },
        { month: "2026-01", revenue: 5 },
        { month: "2025-11", revenue: 6 },
      ],
    };
    const monthlyWidget = (xSort: "asc" | "desc"): ReportWidget => ({
      ...createWidget("line", monthly), dimension: "month", measure: "revenue", sort: "asc", xSort,
    });
    expect(aggregateWidget(monthlyWidget("asc"), monthly).points.map(point => point.label)).toEqual([
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-04",
    ]);
    expect(aggregateWidget(monthlyWidget("desc"), monthly).points.map(point => point.label)).toEqual([
      "2026-04", "2026-02", "2026-01", "2025-12", "2025-11", "2025-10",
    ]);
  });

  it("groups dates by week, month, quarter and year also for bar charts", () => {
    const dated: ReportDataset = {
      ...dataset,
      rows: [
        { region: "Nord", sales: 10, cost: 1, date: "2026-01-03" },
        { region: "Nord", sales: 20, cost: 1, date: "2026-01-20" },
        { region: "Nord", sales: 30, cost: 1, date: "2026-04-04" },
      ],
    };
    expect(aggregateWidget(widget({ dimension: "date", timeGrain: "month" }), dated).points).toEqual([
      { label: "gen 2026", value: 30 },
      { label: "apr 2026", value: 30 },
    ]);
    expect(aggregateWidget(widget({ dimension: "date", timeGrain: "quarter" }), dated).points).toEqual([
      { label: "T1 2026", value: 30 },
      { label: "T2 2026", value: 30 },
    ]);
    expect(aggregateWidget(widget({ dimension: "date", timeGrain: "year" }), dated).points).toEqual([{ label: "2026", value: 60 }]);
    expect(aggregateWidget(widget({ type: "line", dimension: "date", timeGrain: "week" }), dated).points).toHaveLength(3);
  });

  it("rejects negative or entirely zero doughnut data", () => {
    expect(aggregateWidget(widget({ type: "doughnut" }), dataset).message).toContain("valori negativi");
    expect(aggregateWidget(widget({ type: "doughnut" }), { ...dataset, rows: [{ region: "Sud", sales: 0 }] }).message).toContain("Tutti i valori sono zero");
  });

  it("uses numeric pairs for scatter and excludes rows with missing coordinates", () => {
    expect(aggregateWidget(widget({ type: "scatter", dimension: "cost" }), dataset)).toMatchObject({ scatter: [{ x: 7, y: 20 }, { x: 3, y: 0 }, { x: 6, y: -10 }], excludedRows: 2, message: "" });
    expect(aggregateWidget(widget({ type: "scatter" }), dataset).message).toContain("due campi numerici");
  });
});
