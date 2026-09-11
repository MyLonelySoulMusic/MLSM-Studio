import { aggregationNeedsMeasure, aggregationNeedsNumericMeasure, displayCell, filterRows, reduceReportValues } from "./aggregation";
import { bucketTimeValue, type TimeGrain } from "./time-buckets";
import type { Aggregation, CellValue, ReportDataset, ReportFilter } from "./types";

export const PIVOT_MAX_ROWS = 100;
export const PIVOT_MAX_COLUMNS = 50;

export interface BuildPivotTableArgs {
  dataset: ReportDataset;
  filters: ReportFilter[];
  rowFieldId: string;
  columnFieldId: string;
  measureFieldId: string;
  aggregation: Aggregation;
  timeGrain?: TimeGrain;
  timeAxis?: "row" | "column" | "none";
}

export interface PivotResult {
  rowLabels: string[];
  columnLabels: string[];
  cells: (number | null)[][];
  rowTotals: (number | null)[];
  columnTotals: (number | null)[];
  grandTotal: number | null;
  message: string;
}

interface Accumulator {
  count: number;
  values: (CellValue | undefined)[];
}

interface DimensionValue {
  key: string;
  label: string;
  sourceIndex: number;
  timeOrder: number | null;
}

interface Group extends DimensionValue {
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
  cells: [],
  rowTotals: [],
  columnTotals: [],
  grandTotal: null,
  message,
});

function createAccumulator(): Accumulator {
  return { count: 0, values: [] };
}

function addValue(accumulator: Accumulator, value: CellValue | undefined): void {
  accumulator.count += 1;
  accumulator.values.push(value);
}

function reduceAccumulator(accumulator: Accumulator, aggregation: Aggregation): number | null {
  return reduceReportValues(accumulator.values, accumulator.count, aggregation);
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

function timeBucket(value: CellValue | undefined, grain: TimeGrain): NormalizedBucket | null {
  // The time-bucket helper is intentionally normalized here so the pivot remains
  // compatible with both string buckets and richer { key, label } buckets.
  try {
    const bucket = (bucketTimeValue as unknown as (input: CellValue | undefined, selectedGrain: TimeGrain) => unknown)(value, grain);
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
): { value: DimensionValue | null; invalidDate: boolean } {
  if (shouldBucket && grain && fieldType === "date") {
    const bucket = timeBucket(value, grain);
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
  if (left.timeOrder !== null || right.timeOrder !== null) {
    if (left.timeOrder === null) return 1;
    if (right.timeOrder === null) return -1;
    if (left.timeOrder !== right.timeOrder) return left.timeOrder - right.timeOrder;
  }
  return left.sourceIndex - right.sourceIndex;
}

function invalidDateMessage(invalidDateRows: number): string {
  return `Nessun dato utile: ${invalidDateRows.toLocaleString("it-IT")} date non valide sono state escluse dal raggruppamento.`;
}

/**
 * Builds a bounded cross-tab from filtered raw rows. Each accumulator retains
 * raw numeric values, so row/column/grand averages are weighted correctly.
 */
export function buildPivotTable({
  dataset,
  filters,
  rowFieldId,
  columnFieldId,
  measureFieldId,
  aggregation,
  timeGrain,
  timeAxis = "none",
}: BuildPivotTableArgs): PivotResult {
  const rowField = dataset.fields.find(field => field.id === rowFieldId);
  const columnField = dataset.fields.find(field => field.id === columnFieldId);
  const measureField = dataset.fields.find(field => field.id === measureFieldId);
  if (!rowField || !columnField) return EMPTY_RESULT("Scegli due dimensioni valide per la tabella pivot.");
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
    const rowDimension = dimensionValue(row[rowField.id], rowField.type, sourceIndex, timeAxis === "row", timeGrain);
    const columnDimension = dimensionValue(row[columnField.id], columnField.type, sourceIndex, timeAxis === "column", timeGrain);
    if (rowDimension.invalidDate || columnDimension.invalidDate || !rowDimension.value || !columnDimension.value) {
      if (rowDimension.invalidDate || columnDimension.invalidDate) invalidDateRows += 1;
      continue;
    }

    const rowValue = rowDimension.value;
    const columnValue = columnDimension.value;
    let rowGroup = rowGroups.get(rowValue.key);
    if (!rowGroup) {
      rowGroup = { ...rowValue, accumulator: createAccumulator() };
      rowGroups.set(rowValue.key, rowGroup);
    } else if (rowGroup.timeOrder === null && rowValue.timeOrder !== null) {
      rowGroup.timeOrder = rowValue.timeOrder;
    } else if (rowValue.timeOrder !== null && rowGroup.timeOrder !== null) {
      rowGroup.timeOrder = Math.min(rowGroup.timeOrder, rowValue.timeOrder);
    }

    let columnGroup = columnGroups.get(columnValue.key);
    if (!columnGroup) {
      columnGroup = { ...columnValue, accumulator: createAccumulator() };
      columnGroups.set(columnValue.key, columnGroup);
    } else if (columnGroup.timeOrder === null && columnValue.timeOrder !== null) {
      columnGroup.timeOrder = columnValue.timeOrder;
    } else if (columnValue.timeOrder !== null && columnGroup.timeOrder !== null) {
      columnGroup.timeOrder = Math.min(columnGroup.timeOrder, columnValue.timeOrder);
    }

    const measureValue = row[measureFieldId];
    const cellByColumn = cells.get(rowValue.key) ?? new Map<string, Accumulator>();
    const cell = cellByColumn.get(columnValue.key) ?? createAccumulator();
    addValue(cell, measureValue);
    cellByColumn.set(columnValue.key, cell);
    cells.set(rowValue.key, cellByColumn);
    addValue(rowGroup.accumulator, measureValue);
    addValue(columnGroup.accumulator, measureValue);
    addValue(grandAccumulator, measureValue);
  }

  if (!rowGroups.size || !columnGroups.size) {
    return EMPTY_RESULT(invalidDateRows > 0 ? invalidDateMessage(invalidDateRows) : "Nessun dato disponibile con i filtri attuali.");
  }

  const orderedRows = [...rowGroups.values()];
  const orderedColumns = [...columnGroups.values()];
  if (timeAxis === "row" && timeGrain && rowField.type === "date") orderedRows.sort(compareGroups);
  if (timeAxis === "column" && timeGrain && columnField.type === "date") orderedColumns.sort(compareGroups);

  if (orderedRows.length > PIVOT_MAX_ROWS || orderedColumns.length > PIVOT_MAX_COLUMNS) {
    return EMPTY_RESULT(`La tabella pivot supera il limite massimo di ${PIVOT_MAX_ROWS} righe e ${PIVOT_MAX_COLUMNS} colonne (trovate ${orderedRows.length} righe e ${orderedColumns.length} colonne). Riduci i dati o applica filtri.`);
  }

  const outputCells = orderedRows.map(rowGroup => orderedColumns.map(columnGroup => {
    const accumulator = cells.get(rowGroup.key)?.get(columnGroup.key);
    return accumulator ? reduceAccumulator(accumulator, aggregation) : null;
  }));
  const rowTotals = orderedRows.map(group => reduceAccumulator(group.accumulator, aggregation));
  const columnTotals = orderedColumns.map(group => reduceAccumulator(group.accumulator, aggregation));
  const grandTotal = reduceAccumulator(grandAccumulator, aggregation);
  const hasValue = outputCells.some(row => row.some(value => value !== null));
  return {
    rowLabels: orderedRows.map(group => group.label),
    columnLabels: orderedColumns.map(group => group.label),
    cells: outputCells,
    rowTotals,
    columnTotals,
    grandTotal,
    message: hasValue ? "" : "Nessun valore numerico disponibile per la misura selezionata.",
  };
}
