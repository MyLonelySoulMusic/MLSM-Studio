import type { TimeGrain } from "./time-buckets";

export type CellValue = string | number | boolean | null;
export type FieldType = "text" | "number" | "date" | "boolean";
export interface ReportField { id: string; name: string; type: FieldType }
export interface ReportDataset { id: string; name: string; sourceName: string; fields: ReportField[]; rows: Record<string, CellValue>[] }
export type WidgetType = "kpi" | "bar" | "line" | "area" | "doughnut" | "scatter" | "table" | "pivot" | "text";
export type Aggregation = "sum" | "avg" | "count" | "distinct" | "median" | "min" | "max" | "range" | "variance" | "stddev";
export type CurrencyCode = "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "CAD" | "AUD";
export interface ReportLayoutRow { id: string; columns: number | null }
export interface ReportWidget {
  id: string; type: WidgetType; title: string; datasetId: string;
  dimension: string; secondaryDimension: string; measure: string; aggregation: Aggregation; timeGrain: TimeGrain;
  rowId: string; width: number; height: 240 | 320 | 420;
  color: string; text: string; format: "number" | "currency" | "percent"; currency: CurrencyCode; decimals: number;
  sort: "source" | "asc" | "desc"; xSort: "source" | "asc" | "desc"; limit: number;
}
export interface ReportFilter { id: string; datasetId: string; fieldId: string; value: string | null; defaultValue: string | null; includeAll: boolean; targetMode: "all" | "selected"; widgetIds: string[] }
export interface ReportTheme { accent: string; ink: string; paper: string }
export interface ReportDashboard {
  schemaVersion: 5; id: string; name: string; description: string;
  createdAt: string; updatedAt: string;
  theme: ReportTheme; datasets: ReportDataset[]; layoutRows: ReportLayoutRow[]; widgets: ReportWidget[]; filters: ReportFilter[];
}
export const DEFAULT_REPORT_THEME: ReportTheme = { accent: "#FF4F9A", ink: "#211B1F", paper: "#FFFFFF" };
export const WIDGET_LABELS: Record<WidgetType, string> = {
  kpi: "Indicatore KPI", bar: "Barre", line: "Linee", area: "Area", doughnut: "Ciambella",
  scatter: "Dispersione", table: "Tabella", pivot: "Tabella pivot", text: "Testo e note",
};
export const AGGREGATION_LABELS: Record<Aggregation, string> = {
  sum: "Somma", avg: "Media", count: "Conteggio righe", distinct: "Conteggio distinti", median: "Mediana",
  min: "Minimo", max: "Massimo", range: "Intervallo (max − min)", variance: "Varianza", stddev: "Deviazione standard",
};
export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  EUR: "Euro (€)", USD: "Dollaro USA ($)", GBP: "Sterlina britannica (£)", CHF: "Franco svizzero (CHF)",
  JPY: "Yen giapponese (¥)", CAD: "Dollaro canadese (CA$)", AUD: "Dollaro australiano (A$)",
};
export function reportId(): string { return crypto.randomUUID(); }
export function createDashboard(name = "Dashboard senza titolo"): ReportDashboard {
  const now = new Date().toISOString();
  return { schemaVersion: 5, id: reportId(), name, description: "", createdAt: now, updatedAt: now,
    theme: { ...DEFAULT_REPORT_THEME }, datasets: [], layoutRows: [{ id: reportId(), columns: null }], widgets: [], filters: [] };
}
export function createWidget(type: WidgetType, dataset?: ReportDataset, rowId = ""): ReportWidget {
  return { id: reportId(), type, title: WIDGET_LABELS[type], datasetId: dataset?.id ?? "",
    dimension: dataset?.fields.find(field => field.type !== "number")?.id ?? dataset?.fields[0]?.id ?? "",
    secondaryDimension: dataset?.fields.filter(field => field.type !== "number")[1]?.id ?? dataset?.fields.find(field => field.type !== "number")?.id ?? "",
    measure: dataset?.fields.find(field => field.type === "number")?.id ?? "",
    aggregation: dataset?.fields.some(field => field.type === "number") ? "sum" : "count", timeGrain: "exact", rowId,
    width: type === "kpi" ? 4 : type === "table" || type === "pivot" ? 12 : 6, height: type === "kpi" ? 240 : type === "pivot" ? 420 : 320,
    color: "", text: "Aggiungi contesto, conclusioni e prossimi passi al tuo report.", format: "number", currency: "EUR", decimals: 2, sort: "source", xSort: "asc", limit: 12 };
}
