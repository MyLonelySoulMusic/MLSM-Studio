import type { TimeGrain } from "./time-buckets";
import type { UiLanguage } from "../services/ui-preferences";

export type CellValue = string | number | boolean | null;
export type FieldType = "text" | "number" | "date" | "boolean";
export interface CalculatedFieldDefinition { formula: string; description: string }
export interface ReportField { id: string; name: string; type: FieldType; calculated?: CalculatedFieldDefinition }
export interface ReportDatasetSource { id: string; fileName: string; sheetName: string; importedAt: string; rowCount: number }
export interface ReportDataset { id: string; name: string; sourceName: string; fields: ReportField[]; rows: Record<string, CellValue>[]; sources: ReportDatasetSource[] }
export type WidgetType = "kpi" | "bar" | "column" | "line" | "area" | "doughnut" | "scatter" | "map" | "table" | "pivot" | "replicateXls" | "text";
export type Aggregation = "sum" | "avg" | "count" | "distinct" | "median" | "min" | "max" | "range" | "variance" | "stddev";
export type CurrencyCode = "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD";
export type WidgetAnimationType = "timeSeries" | "barRace";
export type TimeSeriesChartType = "line" | "area" | "bar";
export type TimeSeriesValueMode = "period" | "cumulative";
export interface TimeSeriesAnimation {
  type: "timeSeries";
  chartType: TimeSeriesChartType;
  dimension: string;
  timeGrain: TimeGrain;
  valueMode: TimeSeriesValueMode;
  showTrendLine: boolean;
  highlightMaximum: boolean;
}
export type BarRaceOrientation = "horizontal" | "vertical";
export type BarRaceSort = "asc" | "desc";
export interface BarRaceAnimation {
  type: "barRace";
  dateDimension: string;
  groupDimension: string;
  measure: string;
  aggregation: Aggregation;
  timeGrain: TimeGrain;
  valueMode: TimeSeriesValueMode;
  orientation: BarRaceOrientation;
  sort: BarRaceSort;
  stepDurationMs: number;
}
export type ReportWidgetAnimation = TimeSeriesAnimation | BarRaceAnimation;
export type ReplicateXlsRegionMode = "static" | "singleCell" | "tableRows" | "tableColumns";
export interface ReplicateXlsRegion {
  id: string;
  sheetName: string;
  range: string;
  label: string;
  description: string;
  mode: ReplicateXlsRegionMode;
  fieldIds: string[];
  includeHeaders: boolean;
}
export interface ReplicateXlsConfig {
  templateName: string;
  templateFormat: "xlsx" | "xls" | "xlsm" | "xlsb" | "ods";
  templateBase64: string;
  sheetName: string;
  selectedRange: string;
  regions: ReplicateXlsRegion[];
  aiSummary: string;
  aiProvider: string;
  aiModel: string;
  correctionNotes: string;
  lastTestedAt: string | null;
}
export interface ReportTab { id: string; name: string }
export interface ReportLayoutRow { id: string; tabId: string; columns: number | null }
export interface ReportWidget {
  id: string; type: WidgetType; title: string; datasetId: string;
  dimension: string; secondaryDimension: string; measure: string; aggregation: Aggregation; timeGrain: TimeGrain;
  rowId: string; width: number; height: 240 | 320 | 420;
  color: string; mapBackground: string; text: string; format: "number" | "currency" | "percent"; currency: CurrencyCode; decimals: number;
  sort: "source" | "asc" | "desc"; xSort: "source" | "asc" | "desc"; limit: number | null; categoryLimitMode: "first" | "last";
  showKpiLabel: boolean; showKpiMeta: boolean;
  showXTicks: boolean; showYTicks: boolean; xTickCount: number | null; yTickCount: number | null;
  xAxisMin: number | null; xAxisMax: number | null; yAxisMin: number | null; yAxisMax: number | null;
  xAxisLabel: string; yAxisLabel: string;
  animation: ReportWidgetAnimation | null;
  replicateXls: ReplicateXlsConfig | null;
}
export interface ReportFilter { id: string; datasetId: string; fieldId: string; value: string | null; defaultValue: string | null; includeAll: boolean; targetMode: "all" | "selected"; widgetIds: string[] }
export interface ReportTheme { accent: string; ink: string; paper: string }
export interface ReportDashboard {
  schemaVersion: 16; id: string; name: string; description: string;
  createdAt: string; updatedAt: string;
  theme: ReportTheme; datasets: ReportDataset[]; tabs: ReportTab[]; layoutRows: ReportLayoutRow[]; widgets: ReportWidget[]; filters: ReportFilter[];
}
export const DEFAULT_REPORT_THEME: ReportTheme = { accent: "#FF4F9A", ink: "#211B1F", paper: "#FFFFFF" };
export const DEFAULT_MAP_BACKGROUND = "#F2F0F1";
export const WIDGET_LABELS_BY_LANGUAGE: Record<UiLanguage, Record<WidgetType, string>> = {
  it: { kpi: "Indicatore KPI", bar: "Barre orizzontali", column: "Barre verticali", line: "Linee", area: "Area", doughnut: "Ciambella", scatter: "Dispersione", map: "Mappa geografica", table: "Tabella", pivot: "Tabella pivot", replicateXls: "Replica Excel", text: "Testo e note" },
  en: { kpi: "KPI indicator", bar: "Horizontal bars", column: "Vertical bars", line: "Lines", area: "Area", doughnut: "Doughnut", scatter: "Scatter", map: "Geographic map", table: "Table", pivot: "Pivot table", replicateXls: "Replicate XLS", text: "Text and notes" },
};
export const WIDGET_LABELS = WIDGET_LABELS_BY_LANGUAGE.it;
export const AGGREGATION_LABELS_BY_LANGUAGE: Record<UiLanguage, Record<Aggregation, string>> = {
  it: { sum: "Somma", avg: "Media", count: "Conteggio righe", distinct: "Conteggio distinti", median: "Mediana", min: "Minimo", max: "Massimo", range: "Intervallo (max − min)", variance: "Varianza", stddev: "Deviazione standard" },
  en: { sum: "Sum", avg: "Average", count: "Row count", distinct: "Distinct count", median: "Median", min: "Minimum", max: "Maximum", range: "Range (max − min)", variance: "Variance", stddev: "Standard deviation" },
};
export const AGGREGATION_LABELS = AGGREGATION_LABELS_BY_LANGUAGE.it;
export const CURRENCY_LABELS_BY_LANGUAGE: Record<UiLanguage, Record<CurrencyCode, string>> = {
  it: { EUR: "Euro (€)", USD: "Dollaro USA ($)", GBP: "Sterlina britannica (£)", CHF: "Franco svizzero (CHF)", JPY: "Yen giapponese (¥)", CAD: "Dollaro canadese (CA$)", AUD: "Dollaro australiano (A$)" },
  en: { EUR: "Euro (€)", USD: "US dollar ($)", GBP: "British pound (£)", CHF: "Swiss franc (CHF)", JPY: "Japanese yen (¥)", CAD: "Canadian dollar (CA$)", AUD: "Australian dollar (A$)" },
};
export const CURRENCY_LABELS = CURRENCY_LABELS_BY_LANGUAGE.it;
export function reportId(): string { return crypto.randomUUID(); }
export function defaultDashboardName(language: UiLanguage = "it"): string { return language === "en" ? "Untitled dashboard" : "Dashboard senza titolo"; }
export function createDashboard(name?: string, language: UiLanguage = "it"): ReportDashboard {
  const now = new Date().toISOString();
  const tabId = reportId();
  return { schemaVersion: 16, id: reportId(), name: name ?? defaultDashboardName(language), description: "", createdAt: now, updatedAt: now,
    theme: { ...DEFAULT_REPORT_THEME }, datasets: [], tabs: [{ id: tabId, name: language === "en" ? "Page 1" : "Pagina 1" }], layoutRows: [{ id: reportId(), tabId, columns: null }], widgets: [], filters: [] };
}
export function createWidget(type: WidgetType, dataset?: ReportDataset, rowId = "", language: UiLanguage = "it"): ReportWidget {
  return { id: reportId(), type, title: WIDGET_LABELS_BY_LANGUAGE[language][type], datasetId: dataset?.id ?? "",
    dimension: dataset?.fields.find(field => field.type !== "number")?.id ?? dataset?.fields[0]?.id ?? "",
    secondaryDimension: dataset?.fields.filter(field => field.type !== "number")[1]?.id ?? dataset?.fields.find(field => field.type !== "number")?.id ?? "",
    measure: dataset?.fields.find(field => field.type === "number")?.id ?? "",
    aggregation: dataset?.fields.some(field => field.type === "number") ? "sum" : "count", timeGrain: "exact", rowId,
    width: type === "kpi" ? 4 : type === "table" || type === "pivot" || type === "replicateXls" ? 12 : 6, height: type === "kpi" ? 240 : type === "pivot" || type === "replicateXls" ? 420 : 320,
    color: "", mapBackground: DEFAULT_MAP_BACKGROUND, text: language === "en" ? "Add context, conclusions and next steps to your report." : "Aggiungi contesto, conclusioni e prossimi passi al tuo report.", format: "number", currency: "EUR", decimals: 2, sort: "source", xSort: "asc", limit: null, categoryLimitMode: "first",
    showKpiLabel: false, showKpiMeta: false, showXTicks: true, showYTicks: true, xTickCount: null, yTickCount: null,
    xAxisMin: null, xAxisMax: null, yAxisMin: null, yAxisMax: null, xAxisLabel: "", yAxisLabel: "", animation: null, replicateXls: null };
}
