import { describe, expect, it } from "vitest";
import { buildPivotTable } from "./pivot";
import type { ReportDataset } from "./types";
import { createCalculatedField } from "./calculated-fields";

const dataset: ReportDataset = {
  id: "sales",
  name: "Vendite",
  sourceName: "sales.csv",
  fields: [
    { id: "region", name: "Regione", type: "text" },
    { id: "channel", name: "Canale", type: "text" },
    { id: "date", name: "Data", type: "date" },
    { id: "sales", name: "Ricavi", type: "number" },
  ],
  rows: [
    { region: "Nord", channel: "Web", date: "2026-01-03", sales: 10 },
    { region: "Nord", channel: "Web", date: "2026-01-20", sales: 20 },
    { region: "Nord", channel: "Negozio", date: "2026-02-02", sales: 100 },
    { region: "Sud", channel: "Web", date: "2026-02-10", sales: 40 },
    { region: "Sud", channel: "Negozio", date: "2026-02-14", sales: null },
  ],
};

describe("report pivot", () => {
  it("builds numeric cells and totals while preserving source dimension order", () => {
    const result = buildPivotTable({
      dataset,
      filters: [],
      rowFieldId: "region",
      columnFieldId: "channel",
      measureFieldId: "sales",
      aggregation: "sum",
    });

    expect(result.rowLabels).toEqual(["Nord", "Sud"]);
    expect(result.columnLabels).toEqual(["Web", "Negozio"]);
    expect(result.cells).toEqual([[30, 100], [40, null]]);
    expect(result.rowTotals).toEqual([130, 40]);
    expect(result.columnTotals).toEqual([70, 100]);
    expect(result.grandTotal).toBe(170);
    expect(result.message).toBe("");
  });

  it("computes weighted averages and counts from raw rows for totals", () => {
    const average = buildPivotTable({
      dataset,
      filters: [],
      rowFieldId: "region",
      columnFieldId: "channel",
      measureFieldId: "sales",
      aggregation: "avg",
    });
    expect(average.cells).toEqual([[15, 100], [40, null]]);
    expect(average.rowTotals).toEqual([130 / 3, 40]);
    expect(average.columnTotals).toEqual([70 / 3, 100]);
    expect(average.grandTotal).toBe(170 / 4);

    const count = buildPivotTable({
      dataset,
      filters: [],
      rowFieldId: "region",
      columnFieldId: "channel",
      measureFieldId: "sales",
      aggregation: "count",
    });
    expect(count.cells).toEqual([[2, 1], [1, 1]]);
    expect(count.rowTotals).toEqual([3, 2]);
    expect(count.columnTotals).toEqual([3, 2]);
    expect(count.grandTotal).toBe(5);
  });

  it("evaluates an aggregate calculated measure independently for every pivot cell and total", () => {
    const withUnits: ReportDataset = {
      ...dataset,
      fields: [...dataset.fields, { id: "units", name: "Unità", type: "number" }],
      rows: dataset.rows.map((row, index) => ({ ...row, units: [2, 3, 10, 8, 1][index]! })),
    };
    const calculated = createCalculatedField(withUnits, { id: "rate", name: "Ricavo unitario", formula: "SUM([Ricavi]) / SUM([Unità])" });
    const result = buildPivotTable({ dataset: calculated, filters: [], rowFieldId: "region", columnFieldId: "channel", measureFieldId: "rate", aggregation: "sum" });

    expect(result.cells[0]?.[0]).toBe(6);
    expect(result.rowTotals[0]).toBeCloseTo(130 / 15);
    expect(result.grandTotal).toBeCloseTo(170 / 24);
  });

  it("applies the existing exact filters before creating cells", () => {
    const result = buildPivotTable({
      dataset,
      filters: [{ id: "filter", datasetId: "sales", fieldId: "region", value: "Nord", defaultValue: "Nord", includeAll: true, targetMode: "all", widgetIds: [] }],
      rowFieldId: "region",
      columnFieldId: "channel",
      measureFieldId: "sales",
      aggregation: "sum",
    });
    expect(result.rowLabels).toEqual(["Nord"]);
    expect(result.cells).toEqual([[30, 100]]);
    expect(result.grandTotal).toBe(130);
  });

  it("groups a date dimension by month in chronological order and ignores invalid dates when useful rows remain", () => {
    const withInvalidDate: ReportDataset = { ...dataset, rows: [...dataset.rows, { region: "Nord", channel: "Web", date: "data errata", sales: 999 }] };
    const result = buildPivotTable({
      dataset: withInvalidDate,
      filters: [],
      rowFieldId: "date",
      columnFieldId: "channel",
      measureFieldId: "sales",
      aggregation: "sum",
      timeGrain: "month",
      timeAxis: "row",
    });
    expect(result.rowLabels).toHaveLength(2);
    expect(result.cells).toEqual([[30, null], [40, 100]]);
    expect(result.message).toBe("");

    const onlyInvalid: ReportDataset = { ...dataset, rows: [{ region: "Nord", channel: "Web", date: "data errata", sales: 10 }] };
    const empty = buildPivotTable({
      dataset: onlyInvalid,
      filters: [],
      rowFieldId: "date",
      columnFieldId: "channel",
      measureFieldId: "sales",
      aggregation: "sum",
      timeGrain: "month",
      timeAxis: "row",
    });
    expect(empty.message).toMatch(/date non valide/i);
    expect(empty.cells).toEqual([]);
  });

  it("returns an explicit error instead of silently truncating oversized pivots", () => {
    const manyRows: ReportDataset = {
      ...dataset,
      rows: Array.from({ length: 101 }, (_, index) => ({ region: `R${index}`, channel: "Web", date: "2026-01-01", sales: index })),
    };
    const rowsResult = buildPivotTable({
      dataset: manyRows,
      filters: [],
      rowFieldId: "region",
      columnFieldId: "channel",
      measureFieldId: "sales",
      aggregation: "sum",
    });
    expect(rowsResult.message).toContain("100 righe");
    expect(rowsResult.cells).toEqual([]);

    const manyColumns: ReportDataset = {
      ...dataset,
      rows: Array.from({ length: 51 }, (_, index) => ({ region: "Nord", channel: `C${index}`, date: "2026-01-01", sales: index })),
    };
    const columnsResult = buildPivotTable({
      dataset: manyColumns,
      filters: [],
      rowFieldId: "region",
      columnFieldId: "channel",
      measureFieldId: "sales",
      aggregation: "sum",
    });
    expect(columnsResult.message).toContain("50 colonne");
    expect(columnsResult.cells).toEqual([]);
  });
});
