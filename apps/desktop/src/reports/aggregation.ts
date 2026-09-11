import type { Aggregation, CellValue, ReportDataset, ReportField, ReportFilter, ReportWidget } from "./types";
import { bucketTimeValue } from "./time-buckets";

export interface AggregatePoint { label: string; value: number }
export interface ScatterPoint { x: number; y: number }
export interface WidgetData {
  points: AggregatePoint[];
  scatter: ScatterPoint[];
  value: number | null;
  rowCount: number;
  excludedRows: number;
  message: string;
}

export function displayCell(value: CellValue | undefined): string {
  return value === null || value === undefined || value === "" ? "(vuoto)" : String(value);
}

/** An empty filter value means the empty cell; filters from other sources never apply. */
export function filterRows(dataset: ReportDataset, filters: ReportFilter[]): ReportDataset["rows"] {
  const active = filters.filter(filter => filter.datasetId === dataset.id && filter.value !== null);
  if (!active.length) return dataset.rows;
  return dataset.rows.filter(row => active.every(filter => {
    if (!dataset.fields.some(field => field.id === filter.fieldId)) return false;
    const value = row[filter.fieldId];
    return String(value ?? "") === filter.value;
  }));
}

function isNumber(value: CellValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

interface AggregateGroup {
  label: string;
  raw: CellValue | undefined;
  values: (CellValue | undefined)[];
  count: number;
  date: number;
  sourceIndex: number;
}

function utcDateKey(year: number, month = 1, day = 1): number | null {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() : null;
}

/** Recognizes the compact period labels commonly exported by reporting tools. */
export function temporalDimensionKey(value: CellValue | undefined): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const exact = bucketTimeValue(normalized, "exact");
  if (exact) return exact.sortKey;

  let match = /^(\d{4})-(\d{1,2})$/.exec(normalized);
  if (match) return utcDateKey(Number(match[1]), Number(match[2]));
  match = /^(\d{4})$/.exec(normalized);
  if (match) return utcDateKey(Number(match[1]));
  match = /^(\d{4})[- /]?[QT]([1-4])$/i.exec(normalized);
  if (match) return utcDateKey(Number(match[1]), ((Number(match[2]) - 1) * 3) + 1);
  match = /^[QT]([1-4])[- /]?(\d{4})$/i.exec(normalized);
  if (match) return utcDateKey(Number(match[2]), ((Number(match[1]) - 1) * 3) + 1);
  match = /^(\d{1,2})\/(\d{4})$/.exec(normalized);
  if (match) return utcDateKey(Number(match[2]), Number(match[1]));
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(normalized);
  if (match) return utcDateKey(Number(match[3]), Number(match[2]), Number(match[1]));
  return null;
}

export function isTemporalDimension(field: ReportField | undefined, rows: ReportDataset["rows"]): boolean {
  if (!field) return false;
  if (field.type === "date") return true;
  if (field.type !== "text") return false;
  const values = rows.map(row => row[field.id]).filter(value => value !== null && value !== undefined && value !== "");
  return values.length > 0 && values.every(value => temporalDimensionKey(value) !== null);
}

function compareDimensionGroups(left: AggregateGroup, right: AggregateGroup, type: ReportDataset["fields"][number]["type"], direction: "asc" | "desc"): number {
  let comparison = 0;
  if (type === "date") {
    const leftValid = Number.isFinite(left.date);
    const rightValid = Number.isFinite(right.date);
    if (leftValid !== rightValid) return leftValid ? -1 : 1;
    if (leftValid && rightValid) comparison = left.date - right.date;
  } else if (type === "number") {
    const leftNumber = isNumber(left.raw) ? left.raw : null;
    const rightNumber = isNumber(right.raw) ? right.raw : null;
    const leftValid = leftNumber !== null;
    const rightValid = rightNumber !== null;
    if (leftValid !== rightValid) return leftValid ? -1 : 1;
    if (leftNumber !== null && rightNumber !== null) comparison = leftNumber - rightNumber;
  } else {
    const leftEmpty = left.raw === null || left.raw === undefined || left.raw === "";
    const rightEmpty = right.raw === null || right.raw === undefined || right.raw === "";
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
    comparison = left.label.localeCompare(right.label, "it", { numeric: true, sensitivity: "base" });
  }
  return (direction === "desc" ? -comparison : comparison) || left.sourceIndex - right.sourceIndex;
}

export function aggregationNeedsMeasure(aggregation: Aggregation): boolean { return aggregation !== "count"; }
export function aggregationNeedsNumericMeasure(aggregation: Aggregation): boolean { return !["count", "distinct"].includes(aggregation); }

export function reduceReportValues(sourceValues: (CellValue | undefined)[], count: number, aggregation: Aggregation): number | null {
  if (aggregation === "count") return count;
  if (aggregation === "distinct") {
    const values = sourceValues.filter(value => value !== null && value !== undefined && value !== "");
    return new Set(values.map(value => `${typeof value}:${String(value)}`)).size;
  }
  const values = sourceValues.filter(isNumber).sort((left, right) => left - right);
  if (!values.length) return null;
  if (aggregation === "min") return values[0]!;
  if (aggregation === "max") return values.at(-1)!;
  if (aggregation === "range") return values.at(-1)! - values[0]!;
  if (aggregation === "median") {
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
  }
  const sum = values.reduce((total, value) => total + value, 0);
  const average = sum / values.length;
  const variance = values.reduce((total, value) => total + ((value - average) ** 2), 0) / values.length;
  const result = aggregation === "avg" ? average : aggregation === "variance" ? variance : aggregation === "stddev" ? Math.sqrt(variance) : sum;
  return Number.isFinite(result) ? result : null;
}

export function aggregateWidget(widget: ReportWidget, dataset: ReportDataset | undefined, filters: ReportFilter[] = []): WidgetData {
  const result: WidgetData = { points: [], scatter: [], value: null, rowCount: 0, excludedRows: 0, message: "" };
  if (widget.type === "text") return result;
  if (!dataset) return { ...result, message: "Collega una fonte dati per iniziare." };
  const missingFilter = filters.find(filter => filter.datasetId === dataset.id && !dataset.fields.some(field => field.id === filter.fieldId));
  if (missingFilter) return { ...result, message: "Un filtro usa un campo non disponibile. Rimuovilo o scegli un altro campo." };
  const rows = filterRows(dataset, filters);
  result.rowCount = rows.length;
  if (!rows.length) return { ...result, message: "Nessun dato disponibile con i filtri attuali." };
  if (widget.type === "table") return result;

  const dimension = dataset.fields.find(field => field.id === widget.dimension);
  const measure = dataset.fields.find(field => field.id === widget.measure);
  if (widget.type !== "kpi" && !dimension) return { ...result, message: "Scegli un campo per la dimensione." };
  if ((widget.type === "scatter" || aggregationNeedsNumericMeasure(widget.aggregation)) && (!measure || measure.type !== "number")) {
    return { ...result, message: "Scegli un campo numerico per la misura." };
  }
  if (aggregationNeedsMeasure(widget.aggregation) && !measure) {
    return { ...result, message: "Scegli un campo per la misura." };
  }

  const temporalAxis = isTemporalDimension(dimension, rows);

  if (widget.type === "scatter") {
    if (dimension?.type !== "number") return { ...result, message: "La dispersione richiede due campi numerici: asse X e asse Y." };
    for (const row of rows) {
      const x = row[widget.dimension];
      const y = row[widget.measure];
      if (isNumber(x) && isNumber(y)) result.scatter.push({ x, y });
      else result.excludedRows += 1;
    }
    if (!result.scatter.length) result.message = "Nessuna coppia di valori numerici disponibile.";
    return result;
  }

  const sourceValues = rows.map(row => row[widget.measure]);
  const usableValues = widget.aggregation === "distinct" ? sourceValues.filter(value => value !== null && value !== undefined && value !== "") : sourceValues.filter(isNumber);
  result.excludedRows = widget.aggregation === "count" ? 0 : rows.length - usableValues.length;
  result.value = reduceReportValues(sourceValues, rows.length, widget.aggregation);
  if (widget.type === "kpi") {
    if (result.value === null) result.message = "Nessun valore numerico disponibile per questa misura.";
    return result;
  }

  const groups = new Map<string, AggregateGroup>();
  for (const [sourceIndex, row] of rows.entries()) {
    const cell = row[widget.dimension];
    const timeBucket = dimension?.type === "date" && widget.timeGrain !== "exact" ? bucketTimeValue(cell, widget.timeGrain) : null;
    if (dimension?.type === "date" && widget.timeGrain !== "exact" && !timeBucket) { result.excludedRows += 1; continue; }
    const key = timeBucket?.key ?? (cell === null || cell === undefined || cell === "" ? "empty:" : `${typeof cell}:${String(cell)}`);
    let group = groups.get(key);
    if (!group) {
      group = { label: timeBucket?.label ?? displayCell(cell), raw: cell, values: [], count: 0, date: timeBucket?.sortKey ?? temporalDimensionKey(cell) ?? Number.NaN, sourceIndex };
      groups.set(key, group);
    }
    group.count += 1;
    group.values.push(row[widget.measure]);
  }
  let entries = [...groups.values()];
  const xSort = widget.xSort;
  // A line has semantic meaning only when its temporal sequence is preserved.
  // Older dashboards can contain both xSort and value sort: for line/area dates,
  // the explicit X-axis order wins so points are never connected by magnitude.
  const lockTemporalSequence = temporalAxis && (widget.type === "line" || widget.type === "area");
  const valueSort = lockTemporalSequence ? "source" : widget.sort;
  if (dimension && valueSort === "source" && xSort !== "source") {
    entries = entries.sort((left, right) => compareDimensionGroups(left, right, temporalAxis ? "date" : dimension.type, xSort));
  }
  result.points = entries.flatMap(group => {
    const value = reduceReportValues(group.values, group.count, widget.aggregation);
    return value === null ? [] : [{ label: group.label, value }];
  });
  if (valueSort !== "source") {
    result.points.sort((a, b) => valueSort === "asc" ? a.value - b.value : b.value - a.value);
  }
  result.points = result.points.slice(0, Math.max(1, Math.floor(widget.limit)));
  if (!result.points.length) result.message = "Nessun valore numerico disponibile per questa misura.";
  if (widget.type === "doughnut" && result.points.some(point => point.value < 0)) {
    result.message = "La ciambella non supporta valori negativi. Usa un grafico a barre o modifica la misura.";
  } else if (widget.type === "doughnut" && result.points.length > 0 && result.points.every(point => point.value === 0)) {
    result.message = "Tutti i valori sono zero: non ci sono proporzioni da rappresentare.";
  }
  return result;
}

export function formatReportNumber(value: number, format: ReportWidget["format"], currency: ReportWidget["currency"] = "EUR", decimals = 2): string {
  return new Intl.NumberFormat("it-IT", {
    maximumFractionDigits: Math.max(0, Math.min(6, decimals)),
    ...(format === "currency" ? { style: "currency", currency, currencyDisplay: "narrowSymbol" as const } : {}),
    ...(format === "percent" ? { style: "percent" } : {}),
  }).format(value);
}
