import { reduceDatasetMeasure } from "./aggregation";
import { bucketTimeValue } from "./time-buckets";
import type { CellValue, ReportDataset, ReplicateXlsQuery, ReplicateXlsRegion } from "./types";

export function validateReplicateQuery(value: unknown, dataset: ReportDataset): ReplicateXlsQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid report aggregation / Aggregazione report non valida");
  const q = value as Record<string, unknown>;
  const exists = (id: unknown): id is string => typeof id === "string" && dataset.fields.some(f => f.id === id);
  if (!Array.isArray(q.groupBy) || q.groupBy.length > 10 || !q.groupBy.every(exists) || !exists(q.measure)) throw new Error("Unknown aggregation field / Campo aggregazione inesistente");
  if (!["sum", "avg", "count", "distinct", "median", "min", "max", "range", "variance", "stddev"].includes(String(q.aggregation))) throw new Error("Invalid aggregation");
  if (q.pivotField !== undefined && !exists(q.pivotField)) throw new Error("Unknown pivot field");
  if (q.timeGrain !== undefined && !["exact", "day", "week", "month", "quarter", "year"].includes(String(q.timeGrain))) throw new Error("Invalid time grouping");
  if (q.pivotValues !== undefined && (!Array.isArray(q.pivotValues) || q.pivotValues.length > 500 || !q.pivotValues.every(v => v === null || ["string", "number", "boolean"].includes(typeof v)))) throw new Error("Invalid pivot values");
  if (q.blankColumns !== undefined && (!Array.isArray(q.blankColumns) || !q.blankColumns.every(v => Number.isInteger(v) && Number(v) >= 0 && Number(v) < 500))) throw new Error("Invalid spacer columns");
  return { groupBy: q.groupBy, measure: q.measure, aggregation: q.aggregation as ReplicateXlsQuery["aggregation"], ...(q.pivotField ? { pivotField: String(q.pivotField) } : {}), ...(q.pivotValues ? { pivotValues: q.pivotValues as CellValue[] } : {}), ...(q.timeGrain ? { timeGrain: q.timeGrain as ReplicateXlsQuery["timeGrain"] & string } : {}), total: q.total === true, ...(q.blankColumns ? { blankColumns: q.blankColumns as number[] } : {}) };
}

export function prepareReplicateRegion(dataset: ReportDataset, region: ReplicateXlsRegion): { dataset: ReportDataset; region: ReplicateXlsRegion } {
  if (!region.query) return { dataset, region };
  const query = validateReplicateQuery(region.query, dataset);
  const groups = new Map<string, { keys: CellValue[]; rows: ReportDataset["rows"] }>();
  for (const row of dataset.rows) {
    const keys = query.groupBy.map(id => query.timeGrain && query.timeGrain !== "exact" ? bucketTimeValue(row[id], query.timeGrain)?.key ?? row[id] ?? null : row[id] ?? null);
    const key = JSON.stringify(keys);
    if (!groups.has(key)) groups.set(key, { keys, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  if (!query.groupBy.length && !groups.size) groups.set("[]", { keys: [], rows: [] });
  const observed = query.pivotField ? [...new Set(dataset.rows.map(row => row[query.pivotField!] ?? null))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })) : [];
  // Keep template columns in place, then extend for newly arrived categories.
  const pivots = [...(query.pivotValues ?? []), ...observed.filter(v => !(query.pivotValues ?? []).includes(v))];
  const fields: ReportDataset["fields"] = query.groupBy.map(id => ({ ...dataset.fields.find(f => f.id === id)! }));
  if (query.pivotField) pivots.forEach((v, index) => fields.push({ id: `metric_${index}`, name: String(v ?? ""), type: "number" }));
  else fields.push({ id: "metric", name: dataset.fields.find(f => f.id === query.measure)!.name, type: "number" });
  if (query.pivotField && query.total) fields.push({ id: "total", name: "Total", type: "number" });
  const rows = [...groups.values()].sort((a, b) => {
    for (let i = 0; i < a.keys.length; i++) { const diff = String(a.keys[i]).localeCompare(String(b.keys[i]), undefined, { numeric: true }); if (diff) return diff; }
    return 0;
  }).map(group => {
    const row: Record<string, CellValue> = Object.fromEntries(query.groupBy.map((id, index) => [id, group.keys[index] ?? null]));
    if (query.pivotField) pivots.forEach((v, index) => { const selected = group.rows.filter(r => (r[query.pivotField!] ?? null) === v); row[`metric_${index}`] = reduceDatasetMeasure(dataset, query.measure, selected, query.aggregation); });
    else row.metric = reduceDatasetMeasure(dataset, query.measure, group.rows, query.aggregation);
    if (query.pivotField && query.total) row.total = reduceDatasetMeasure(dataset, query.measure, group.rows, query.aggregation);
    return row;
  });
  for (const offset of [...new Set(query.blankColumns ?? [])].sort((a, b) => a - b)) fields.splice(offset, 0, { id: `blank_${offset}`, name: "", type: "text" });
  return { dataset: { ...dataset, fields, rows }, region: { ...region, fieldIds: fields.map(f => f.id) } };
}
