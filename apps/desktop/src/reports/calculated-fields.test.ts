import { describe, expect, it } from "vitest";
import { aggregateWidget, reduceDatasetMeasure } from "./aggregation";
import { analyzeCalculatedFormula, createCalculatedField, evaluateCalculatedFormula } from "./calculated-fields";
import { createWidget, type ReportDataset } from "./types";

const dataset: ReportDataset = {
  id: "sales", name: "Sales", sourceName: "sales.csv",
  fields: [
    { id: "region", name: "Region", type: "text" },
    { id: "revenue", name: "Revenue", type: "number" },
    { id: "units", name: "Units", type: "number" },
    { id: "customer", name: "Customer ID", type: "text" },
  ],
  rows: [
    { region: "North", revenue: 100, units: 10, customer: "A" },
    { region: "North", revenue: 300, units: 10, customer: "A" },
    { region: "South", revenue: 200, units: 40, customer: "B" },
  ],
};

describe("MLSM Formula calculated fields", () => {
  it("materializes row formulas for the data preview", () => {
    const result = createCalculatedField(dataset, { id: "price", name: "Unit price", formula: "[Revenue] / [Units]" });
    expect(result.rows.map(row => row.price)).toEqual([10, 30, 5]);
    expect(result.fields.at(-1)).toMatchObject({ id: "price", type: "number", calculated: { formula: "[Revenue] / [Units]" } });
  });

  it("evaluates aggregate ratios on each chart group, not as a sum of row ratios", () => {
    const result = createCalculatedField(dataset, { id: "price", name: "Weighted price", formula: "SUM([Revenue]) / SUM([Units])" });
    const widget = { ...createWidget("bar", result, "row"), dimension: "region", measure: "price", aggregation: "sum" as const };
    expect(aggregateWidget(widget, result).points).toEqual([{ label: "North", value: 20 }, { label: "South", value: 5 }]);
    expect(reduceDatasetMeasure(result, "price", result.rows, "sum")).toBe(10);
  });

  it("uses current-row semantics for aggregate formulas in preview", () => {
    expect(evaluateCalculatedFormula("SUM([Revenue]) / SUM([Units])", dataset, [dataset.rows[0]!], dataset.rows[0]!, true)).toBe(10);
  });

  it("supports conditional sums, distinct counts and median", () => {
    expect(evaluateCalculatedFormula("SUM(IF([Region] = 'North', [Revenue], 0))", dataset, dataset.rows, null)).toBe(400);
    expect(evaluateCalculatedFormula("COUNTD([Customer ID])", dataset, dataset.rows, null)).toBe(2);
    expect(evaluateCalculatedFormula("MEDIAN([Revenue])", dataset, dataset.rows, null)).toBe(200);
  });

  it("rejects unknown fields and mixed aggregate/bare-field semantics", () => {
    expect(() => analyzeCalculatedFormula("SUM([Revenue]) / [Units]", dataset)).toThrow(/ogni campo/);
    expect(() => analyzeCalculatedFormula("SUM([Missing])", dataset)).toThrow(/non esiste/);
  });
});
