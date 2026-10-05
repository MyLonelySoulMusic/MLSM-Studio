import { aggregationNeedsMeasure, aggregationNeedsNumericMeasure, displayCell, filterRows, reduceDatasetMeasure } from "./aggregation";
import { bucketTimeValue, type TimeGrain } from "./time-buckets";
import type { Aggregation, CellValue, ReportDataset, ReportFilter } from "./types";
import type { UiLanguage } from "../services/ui-preferences";

export interface BuildPivotTableArgs {
  dataset: ReportDataset;
  filters: ReportFilter[];
  rowFieldId?: string;
  columnFieldId?: string;
  rowFieldIds?: string[];
  columnFieldIds?: string[];
  measureFieldId: string;
  aggregation: Aggregation;
  timeGrain?: TimeGrain;
  timeAxis?: "row" | "column" | "none";
  language?: UiLanguage;
  rowOffset?: number;
  rowLimit?: number;
  columnOffset?: number;
  columnLimit?: number;
}

export interface PivotResult {
  rowLabels: string[];
  columnLabels: string[];
  rowHeaders: string[][];
  columnHeaders: string[][];
  cells: (number | null)[][];
  rowTotals: (number | null)[];
  columnTotals: (number | null)[];
  grandTotal: number | null;
  totalRowCount: number;
  totalColumnCount: number;
  rowOffset: number;
  columnOffset: number;
  message: string;
}

interface Accumulator {
  rows: ReportDataset["rows"];
}

interface DimensionValue {
  key: string;
  label: string;
  sourceIndex: number;
  timeOrder: number | null;
}

interface Group {
  key: string;
  values: DimensionValue[];
  labels: string[];
  sourceIndex: number;
  accumulator: Accumulator;
}

interface NormalizedBucket {
  key: string;
  label: string;
  sortKey: number | null;
}

const EMPTY_RESULT = (message = ""): PivotResult => ({
  rowLabels: [],
  columnLabels: [],
  rowHeaders: [],
  columnHeaders: [],
  cells: [],
  rowTotals: [],
  columnTotals: [],
  grandTotal: null,
  totalRowCount: 0,
  totalColumnCount: 0,
  rowOffset: 0,
  columnOffset: 0,
  message,
});

function normalizedPageLimit(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.max(1, Math.floor(value));
}

function normalizedPageOffset(value: number | undefined, total: number, limit: number | null): number {
  if (total === 0) return 0;
  const requested = Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
  if (limit === null) return Math.min(requested, total - 1);
  const lastPageOffset = Math.floor((total - 1) / limit) * limit;
  return Math.min(requested, lastPageOffset);
}

function createAccumulator(): Accumulator {
  return { rows: [] };
}

function addValue(accumulator: Accumulator, row: ReportDataset["rows"][number]): void {
  accumulator.rows.push(row);
}

function reduceAccumulator(dataset: ReportDataset, measureFieldId: string, accumulator: Accumulator, aggregation: Aggregation): number | null {
  return reduceDatasetMeasure(dataset, measureFieldId, accumulator.rows, aggregation);
}

function valueKey(value: CellValue | undefined): string {
  if (value === null || value === undefined || value === "") return "empty:";
  return `${typeof value}:${String(value)}`;
}

function numericDateValue(value: CellValue | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBucket(value: unknown): NormalizedBucket | null {
  if (typeof value === "string") {
    const label = value.trim();
    return label ? { key: label, label, sortKey: null } : null;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    const label = value.toISOString();
    return { key: label, label, sortKey: value.getTime() };
  }
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const rawKey = candidate.key ?? candidate.value ?? candidate.id ?? candidate.label;
  const rawLabel = candidate.label ?? candidate.name ?? rawKey;
  if (typeof rawKey !== "string" && typeof rawKey !== "number") return null;
  if (typeof rawLabel !== "string" && typeof rawLabel !== "number") return null;
  const key = String(rawKey).trim();
  const label = String(rawLabel);
  const rawSortKey = candidate.sortKey ?? candidate.timestamp ?? candidate.start;
  const sortKey = typeof rawSortKey === "number" && Number.isFinite(rawSortKey) ? rawSortKey : null;
  return key ? { key, label, sortKey } : null;
}

function timeBucket(value: CellValue | undefined, grain: TimeGrain, language: UiLanguage): NormalizedBucket | null {
  // The time-bucket helper is intentionally normalized here so the pivot remains
  // compatible with both string buckets and richer { key, label } buckets.
  try {
    const bucket = bucketTimeValue(value, grain, language);
    return normalizeBucket(bucket);
  } catch {
    return null;
  }
}

function dimensionValue(
  value: CellValue | undefined,
  fieldType: ReportDataset["fields"][number]["type"],
  sourceIndex: number,
  shouldBucket: boolean,
  grain: TimeGrain | undefined,
  language: UiLanguage,
): { value: DimensionValue | null; invalidDate: boolean } {
  if (shouldBucket && grain && fieldType === "date") {
    const bucket = timeBucket(value, grain, language);
    if (!bucket) return { value: null, invalidDate: true };
    return {
      value: {
        key: `bucket:${bucket.key}`,
        label: bucket.label,
        sourceIndex,
        timeOrder: bucket.sortKey ?? numericDateValue(value),
      },
      invalidDate: false,
    };
  }
  return {
    value: {
      key: valueKey(value),
      label: displayCell(value),
      sourceIndex,
      timeOrder: null,
    },
    invalidDate: false,
  };
}

function compareGroups(left: Group, right: Group): number {
  for (let index = 0; index < Math.max(left.values.length, right.values.length); index += 1) {
    const leftValue = left.values[index];
    const rightValue = right.values[index];
    if (!leftValue || !rightValue) break;
    if (leftValue.timeOrder !== null || rightValue.timeOrder !== null) {
      if (leftValue.timeOrder === null) return 1;
      if (rightValue.timeOrder === null) return -1;
      if (leftValue.timeOrder !== rightValue.timeOrder) return leftValue.timeOrder - rightValue.timeOrder;
    }
    const labelOrder = leftValue.label.localeCompare(rightValue.label, undefined, { numeric: true, sensitivity: "base" });
    if (labelOrder !== 0) return labelOrder;
  }
  return left.sourceIndex - right.sourceIndex;
}

function compositeKey(values: DimensionValue[]): string {
  return JSON.stringify(values.map(value => value.key));
}

function resolveFieldIds(multiple: string[] | undefined, single: string | undefined): string[] {
  const values = multiple?.length ? multiple : single ? [single] : [];
  return [...new Set(values.filter(Boolean))];
}

function invalidDateMessage(invalidDateRows: number): string {
  return `Nessun dato utile: ${invalidDateRows.toLocaleString("it-IT")} date non valide sono state escluse dal raggruppamento.`;
}

/**
 * Builds a pageable cross-tab from filtered raw rows. Each accumulator retains
 * raw numeric values, so row/column/grand averages are weighted correctly.
 */
export function buildPivotTable({
  dataset,
  filters,
  rowFieldId,
  columnFieldId,
  rowFieldIds,
  columnFieldIds,
  measureFieldId,
  aggregation,
  timeGrain,
  timeAxis = "none",
  language = "it",
  rowOffset,
  rowLimit,
  columnOffset,
  columnLimit,
}: BuildPivotTableArgs): PivotResult {
  const resolvedRowFieldIds = resolveFieldIds(rowFieldIds, rowFieldId);
  const resolvedColumnFieldIds = resolveFieldIds(columnFieldIds, columnFieldId);
  const rowFields = resolvedRowFieldIds.map(fieldId => dataset.fields.find(field => field.id === fieldId)).filter((field): field is ReportDataset["fields"][number] => Boolean(field));
  const columnFields = resolvedColumnFieldIds.map(fieldId => dataset.fields.find(field => field.id === fieldId)).filter((field): field is ReportDataset["fields"][number] => Boolean(field));
  const measureField = dataset.fields.find(field => field.id === measureFieldId);
  if (!rowFields.length || !columnFields.length || rowFields.length !== resolvedRowFieldIds.length || columnFields.length !== resolvedColumnFieldIds.length) {
    return EMPTY_RESULT("Scegli almeno una dimensione valida per le righe e una per le colonne della tabella pivot.");
  }
  if (aggregationNeedsMeasure(aggregation) && !measureField) {
    return EMPTY_RESULT("Scegli un campo per la misura della tabella pivot.");
  }
  if (aggregationNeedsNumericMeasure(aggregation) && measureField?.type !== "number") {
    return EMPTY_RESULT("Scegli un campo numerico per la misura della tabella pivot.");
  }

  const rows = filterRows(dataset, filters);
  if (!rows.length) return EMPTY_RESULT("Nessun dato disponibile con i filtri attuali.");

  const rowGroups = new Map<string, Group>();
  const columnGroups = new Map<string, Group>();
  const cells = new Map<string, Map<string, Accumulator>>();
  const grandAccumulator = createAccumulator();
  let invalidDateRows = 0;

  for (const [sourceIndex, row] of rows.entries()) {
    const rowDimensions = rowFields.map(field => dimensionValue(row[field.id], field.type, sourceIndex, timeAxis === "row", timeGrain, language));
    const columnDimensions = columnFields.map(field => dimensionValue(row[field.id], field.type, sourceIndex, timeAxis === "column", timeGrain, language));
    if ([...rowDimensions, ...columnDimensions].some(dimension => dimension.invalidDate || !dimension.value)) {
      if ([...rowDimensions, ...columnDimensions].some(dimension => dimension.invalidDate)) invalidDateRows += 1;
      continue;
    }

    const rowValues = rowDimensions.map(dimension => dimension.value!);
    const columnValues = columnDimensions.map(dimension => dimension.value!);
    const rowKey = compositeKey(rowValues);
    const columnKey = compositeKey(columnValues);
    let rowGroup = rowGroups.get(rowKey);
    if (!rowGroup) {
      rowGroup = { key: rowKey, values: rowValues, labels: rowValues.map(value => value.label), sourceIndex, accumulator: createAccumulator() };
      rowGroups.set(rowKey, rowGroup);
    }

    let columnGroup = columnGroups.get(columnKey);
    if (!columnGroup) {
      columnGroup = { key: columnKey, values: columnValues, labels: columnValues.map(value => value.label), sourceIndex, accumulator: createAccumulator() };
      columnGroups.set(columnKey, columnGroup);
    }

    const cellByColumn = cells.get(rowKey) ?? new Map<string, Accumulator>();
    const cell = cellByColumn.get(columnKey) ?? createAccumulator();
    addValue(cell, row);
    cellByColumn.set(columnKey, cell);
    cells.set(rowKey, cellByColumn);
    addValue(rowGroup.accumulator, row);
    addValue(columnGroup.accumulator, row);
    addValue(grandAccumulator, row);
  }

  if (!rowGroups.size || !columnGroups.size) {
    return EMPTY_RESULT(invalidDateRows > 0 ? invalidDateMessage(invalidDateRows) : "Nessun dato disponibile con i filtri attuali.");
  }

  const orderedRows = [...rowGroups.values()];
  const orderedColumns = [...columnGroups.values()];
  if (timeAxis === "row" && timeGrain && rowFields.some(field => field.type === "date")) orderedRows.sort(compareGroups);
  if (timeAxis === "column" && timeGrain && columnFields.some(field => field.type === "date")) orderedColumns.sort(compareGroups);

  const totalRowCount = orderedRows.length;
  const totalColumnCount = orderedColumns.length;
  const effectiveRowLimit = normalizedPageLimit(rowLimit);
  const effectiveColumnLimit = normalizedPageLimit(columnLimit);
  const effectiveRowOffset = normalizedPageOffset(rowOffset, totalRowCount, effectiveRowLimit);
  const effectiveColumnOffset = normalizedPageOffset(columnOffset, totalColumnCount, effectiveColumnLimit);
  const visibleRows = effectiveRowLimit === null
    ? orderedRows.slice(effectiveRowOffset)
    : orderedRows.slice(effectiveRowOffset, effectiveRowOffset + effectiveRowLimit);
  const visibleColumns = effectiveColumnLimit === null
    ? orderedColumns.slice(effectiveColumnOffset)
    : orderedColumns.slice(effectiveColumnOffset, effectiveColumnOffset + effectiveColumnLimit);

  const outputCells = visibleRows.map(rowGroup => visibleColumns.map(columnGroup => {
    const accumulator = cells.get(rowGroup.key)?.get(columnGroup.key);
    return accumulator ? reduceAccumulator(dataset, measureFieldId, accumulator, aggregation) : null;
  }));
  const rowTotals = visibleRows.map(group => reduceAccumulator(dataset, measureFieldId, group.accumulator, aggregation));
  const columnTotals = visibleColumns.map(group => reduceAccumulator(dataset, measureFieldId, group.accumulator, aggregation));
  const grandTotal = reduceAccumulator(dataset, measureFieldId, grandAccumulator, aggregation);
  const hasValue = grandTotal !== null || outputCells.some(row => row.some(value => value !== null));
  return {
    rowLabels: visibleRows.map(group => group.labels.join(" › ")),
    columnLabels: visibleColumns.map(group => group.labels.join(" › ")),
    rowHeaders: visibleRows.map(group => group.labels),
    columnHeaders: visibleColumns.map(group => group.labels),
    cells: outputCells,
    rowTotals,
    columnTotals,
    grandTotal,
    totalRowCount,
    totalColumnCount,
    rowOffset: effectiveRowOffset,
    columnOffset: effectiveColumnOffset,
    message: hasValue ? "" : "Nessun valore numerico disponibile per la misura selezionata.",
  };
}
