import { invoke, isTauri } from "@tauri-apps/api/core";
import { isReportDate, REPORT_LIMITS } from "./data";
import { DEFAULT_MAP_BACKGROUND, reportId, type CellValue, type ReportDashboard, type ReportDataset, type ReportField, type ReportFilter, type ReportLayoutRow, type ReportTab, type ReportWidget } from "./types";

const DATABASE_NAME = "mlsm-studio-reports";
const STORE_NAME = "dashboards";
type JsonObject = Record<string, unknown>;

function invalid(message: string): never { throw new Error(`Dashboard non valida: ${message}`); }

function object(value: unknown, keys: readonly string[], label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} deve essere un oggetto.`);
  const record = value as JsonObject;
  if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(record, key))) invalid(`la struttura di ${label} non corrisponde al formato Reports supportato.`);
  return record;
}

function string(value: unknown, label: string, maximum = 300, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())) invalid(`${label} non è un testo valido (massimo ${maximum} caratteri).`);
  return value;
}

function nullableString(value: unknown, label: string, maximum = 300): string | null {
  return value === null ? null : string(value, label, maximum, true);
}

function id(value: unknown, label: string, allowEmpty = false): string {
  if (allowEmpty && value === "") return "";
  const result = string(value, label, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) invalid(`${label} contiene caratteri non validi.`);
  return result;
}

function color(value: unknown, label: string, allowEmpty = false): string {
  if (allowEmpty && value === "") return "";
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value)) invalid(`${label} deve essere un colore esadecimale, per esempio #FF4F9A.`);
  return value;
}

function choice<T extends string | number>(value: unknown, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) invalid(`${label} non è supportato.`);
  return value as T;
}

function array(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid(`${label} deve essere una lista con al massimo ${maximum} elementi.`);
  return value;
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) invalid(`${label} contiene identificativi duplicati.`);
}

function date(value: unknown, label: string): string {
  if (!isReportDate(value) || !value.includes("T")) invalid(`${label} deve essere una data ISO valida.`);
  return value;
}

function dataset(value: unknown): ReportDataset {
  const data = object(value, ["id", "name", "sourceName", "fields", "rows"], "dataset");
  const fields: ReportField[] = array(data.fields, REPORT_LIMITS.fields, "campi").map(value => {
    const field = object(value, ["id", "name", "type"], "campo");
    return { id: id(field.id, "ID campo"), name: string(field.name, "nome campo"), type: choice(field.type, ["text", "number", "date", "boolean"] as const, "tipo campo") };
  });
  if (!fields.length) invalid("un dataset deve avere almeno un campo.");
  unique(fields.map(field => field.id), "campi");
  const sourceRows = array(data.rows, REPORT_LIMITS.rows, "righe");
  if (sourceRows.length * fields.length > REPORT_LIMITS.cells) invalid("un dataset supera il limite di 1.000.000 di celle.");
  const fieldIds = fields.map(field => field.id);
  const rows = sourceRows.map((value, index) => {
    const source = object(value, fieldIds, `riga ${index + 1}`);
    return Object.fromEntries(fields.map(field => {
      const cell = source[field.id];
      if (cell === null) return [field.id, null];
      if (typeof cell === "number") {
        if (!Number.isFinite(cell) || field.type !== "number") invalid(`valore numerico non valido nel campo “${field.name}”, riga ${index + 1}.`);
      } else if (typeof cell === "boolean") {
        if (field.type !== "boolean") invalid(`valore booleano non coerente nel campo “${field.name}”.`);
      } else if (typeof cell === "string") {
        if (cell.length > REPORT_LIMITS.cellLength || !["text", "date"].includes(field.type) || (field.type === "date" && !isReportDate(cell))) invalid(`valore non valido nel campo “${field.name}”, riga ${index + 1}.`);
      } else invalid(`le celle devono contenere solo testo, numeri finiti, booleani o null (riga ${index + 1}).`);
      return [field.id, cell as CellValue];
    }));
  });
  return { id: id(data.id, "ID dataset"), name: string(data.name, "nome dataset"), sourceName: string(data.sourceName, "nome del file", 500), fields, rows };
}

export function validateDashboard(value: unknown): ReportDashboard {
  let candidate = value;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 1) {
    const legacy = candidate as JsonObject;
    candidate = {
      ...legacy,
      schemaVersion: 2,
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets.map(widget => widget && typeof widget === "object" && !Array.isArray(widget) ? { ...widget, secondaryDimension: "", timeGrain: "exact" } : widget) : legacy.widgets,
      filters: Array.isArray(legacy.filters) ? legacy.filters.map(filter => filter && typeof filter === "object" && !Array.isArray(filter) ? { ...filter, targetMode: "all", widgetIds: [] } : filter) : legacy.filters,
    };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 2) {
    const legacy = candidate as JsonObject;
    const rowId = "row-main";
    candidate = {
      ...legacy,
      schemaVersion: 3,
      layoutRows: [{ id: rowId, columns: null }],
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets.map(widget => widget && typeof widget === "object" && !Array.isArray(widget) ? { ...widget, rowId, currency: "EUR", decimals: 2 } : widget) : legacy.widgets,
    };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 3) {
    const legacy = candidate as JsonObject;
    candidate = {
      ...legacy,
      schemaVersion: 4,
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets.map(widget => widget && typeof widget === "object" && !Array.isArray(widget) ? { ...widget, xSort: "asc" } : widget) : legacy.widgets,
    };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 4) {
    const legacy = candidate as JsonObject;
    candidate = {
      ...legacy,
      schemaVersion: 5,
      filters: Array.isArray(legacy.filters) ? legacy.filters.map(filter => filter && typeof filter === "object" && !Array.isArray(filter) ? { ...filter, defaultValue: (filter as JsonObject).value ?? null, includeAll: true } : filter) : legacy.filters,
    };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 5) {
    const legacy = candidate as JsonObject;
    const tabId = "tab-main";
    candidate = {
      ...legacy,
      schemaVersion: 6,
      tabs: [{ id: tabId, name: "Pagina 1" }],
      layoutRows: Array.isArray(legacy.layoutRows) ? legacy.layoutRows.map(row => row && typeof row === "object" && !Array.isArray(row) ? { ...row, tabId } : row) : legacy.layoutRows,
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets.map(widget => widget && typeof widget === "object" && !Array.isArray(widget) ? { ...widget, limit: (widget as JsonObject).limit === 12 ? null : (widget as JsonObject).limit } : widget) : legacy.widgets,
    };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 6) {
    const legacy = candidate as JsonObject;
    candidate = {
      ...legacy,
      schemaVersion: 7,
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets.map(widget => widget && typeof widget === "object" && !Array.isArray(widget) ? { ...widget, mapBackground: DEFAULT_MAP_BACKGROUND } : widget) : legacy.widgets,
    };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 7) {
    const legacy = candidate as JsonObject;
    candidate = {
      ...legacy,
      schemaVersion: 8,
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets.map(widget => widget && typeof widget === "object" && !Array.isArray(widget) ? { ...widget, animation: null } : widget) : legacy.widgets,
    };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 8) {
    const legacy = candidate as JsonObject;
    candidate = {
      ...legacy,
      schemaVersion: 9,
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets.map(widget => {
        if (!widget || typeof widget !== "object" || Array.isArray(widget)) return widget;
        const animation = (widget as JsonObject).animation;
        return animation && typeof animation === "object" && !Array.isArray(animation)
          ? { ...widget, animation: { ...animation, valueMode: "period" } }
          : widget;
      }) : legacy.widgets,
    };
  }
  const data = object(candidate, ["schemaVersion", "id", "name", "description", "createdAt", "updatedAt", "theme", "datasets", "tabs", "layoutRows", "widgets", "filters"], "dashboard");
  if (data.schemaVersion !== 9) invalid("versione non supportata. Questo programma legge i formati Reports dalla v1 alla v9.");
  const theme = object(data.theme, ["accent", "ink", "paper"], "tema");
  const datasets = array(data.datasets, REPORT_LIMITS.datasets, "dataset").map(dataset);
  unique(datasets.map(item => item.id), "dataset");
  const datasetsById = new Map(datasets.map(item => [item.id, item]));
  const tabs: ReportTab[] = array(data.tabs, REPORT_LIMITS.tabs, "tab").map(value => {
    const tab = object(value, ["id", "name"], "tab dashboard");
    return { id: id(tab.id, "ID tab"), name: string(tab.name, "nome tab", 120) };
  });
  if (!tabs.length) invalid("la dashboard deve contenere almeno un tab.");
  unique(tabs.map(tab => tab.id), "tab");
  const tabIds = new Set(tabs.map(tab => tab.id));
  const layoutRows: ReportLayoutRow[] = array(data.layoutRows, 100, "righe layout").map(value => {
    const row = object(value, ["id", "tabId", "columns"], "riga layout");
    if (row.columns !== null && (typeof row.columns !== "number" || !Number.isInteger(row.columns) || row.columns < 1 || row.columns > 12)) invalid("gli elementi per riga devono essere un intero tra 1 e 12 oppure automatici.");
    const tabId = id(row.tabId, "tab della riga");
    if (!tabIds.has(tabId)) invalid("una riga layout fa riferimento a un tab inesistente.");
    return { id: id(row.id, "ID riga layout"), tabId, columns: row.columns as number | null };
  });
  if (!layoutRows.length) invalid("la dashboard deve contenere almeno una riga layout.");
  unique(layoutRows.map(row => row.id), "righe layout");
  if (tabs.some(tab => !layoutRows.some(row => row.tabId === tab.id))) invalid("ogni tab deve contenere almeno una riga layout.");
  const layoutRowIds = new Set(layoutRows.map(row => row.id));
  const widgets: ReportWidget[] = array(data.widgets, REPORT_LIMITS.widgets, "widget").map(value => {
    const widget = object(value, ["id", "type", "title", "datasetId", "dimension", "secondaryDimension", "measure", "aggregation", "timeGrain", "rowId", "width", "height", "color", "mapBackground", "text", "format", "currency", "decimals", "sort", "xSort", "limit", "animation"], "widget");
    const datasetId = id(widget.datasetId, "dataset del widget", true);
    const source = datasetId ? datasetsById.get(datasetId) : undefined;
    if (datasetId && !source) invalid("un widget fa riferimento a un dataset inesistente.");
    const dimension = id(widget.dimension, "dimensione del widget", true);
    const secondaryDimension = id(widget.secondaryDimension, "dimensione colonne del widget", true);
    const measure = id(widget.measure, "misura del widget", true);
    if ([dimension, secondaryDimension, measure].some(fieldId => fieldId && !source?.fields.some(field => field.id === fieldId))) invalid("un widget fa riferimento a un campo inesistente.");
    const rowId = id(widget.rowId, "riga del widget");
    if (!layoutRowIds.has(rowId)) invalid("un widget fa riferimento a una riga layout inesistente.");
    if (typeof widget.width !== "number" || !Number.isInteger(widget.width) || widget.width < 1 || widget.width > 12) invalid("la larghezza del widget deve essere un intero tra 1 e 12.");
    if (typeof widget.decimals !== "number" || !Number.isInteger(widget.decimals) || widget.decimals < 0 || widget.decimals > 6) invalid("i decimali del widget devono essere un intero tra 0 e 6.");
    if (widget.limit !== null && (typeof widget.limit !== "number" || !Number.isInteger(widget.limit) || widget.limit < 1 || widget.limit > 1000)) invalid("il limite del widget deve essere un intero tra 1 e 1000 oppure tutte le categorie.");
    let animation: ReportWidget["animation"] = null;
    if (widget.animation !== null) {
      const value = object(widget.animation, ["type", "chartType", "dimension", "timeGrain", "valueMode", "showTrendLine", "highlightMaximum"], "animazione widget");
      const animationDimension = id(value.dimension, "asse X dell’animazione");
      const animationField = source?.fields.find(field => field.id === animationDimension);
      if (!animationField || animationField.type !== "date") invalid("l’animazione Time Series richiede un campo data valido per l’asse X.");
      if (typeof value.showTrendLine !== "boolean" || typeof value.highlightMaximum !== "boolean") invalid("le opzioni dell’animazione devono essere booleane.");
      animation = {
        type: choice(value.type, ["timeSeries"] as const, "tipo animazione"),
        chartType: choice(value.chartType, ["line", "area", "bar"] as const, "grafico animazione"),
        dimension: animationDimension,
        timeGrain: choice(value.timeGrain, ["exact", "day", "week", "month", "quarter", "year"] as const, "raggruppamento animazione"),
        valueMode: choice(value.valueMode, ["period", "cumulative"] as const, "modalità valori animazione"),
        showTrendLine: value.showTrendLine,
        highlightMaximum: value.highlightMaximum,
      };
    }
    return {
      id: id(widget.id, "ID widget"), type: choice(widget.type, ["kpi", "bar", "line", "area", "doughnut", "scatter", "map", "table", "pivot", "text"] as const, "tipo widget"),
      title: string(widget.title, "titolo widget", 300, true), datasetId, dimension, secondaryDimension, measure, rowId,
      aggregation: choice(widget.aggregation, ["sum", "avg", "count", "distinct", "median", "min", "max", "range", "variance", "stddev"] as const, "aggregazione"),
      timeGrain: choice(widget.timeGrain, ["exact", "day", "week", "month", "quarter", "year"] as const, "raggruppamento temporale"),
      width: widget.width, height: choice(widget.height, [240, 320, 420] as const, "altezza widget"),
      color: color(widget.color, "colore widget", true), mapBackground: color(widget.mapBackground, "colore sfondo mappa"), text: string(widget.text, "testo widget", 20_000, true),
      format: choice(widget.format, ["number", "currency", "percent"] as const, "formato numero"),
      currency: choice(widget.currency, ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD"] as const, "valuta"), decimals: widget.decimals,
      sort: choice(widget.sort, ["source", "asc", "desc"] as const, "ordinamento valori"), xSort: choice(widget.xSort, ["source", "asc", "desc"] as const, "ordinamento asse X"), limit: widget.limit as number | null, animation,
    };
  });
  unique(widgets.map(item => item.id), "widget");
  const widgetsById = new Map(widgets.map(item => [item.id, item]));
  const filters: ReportFilter[] = array(data.filters, REPORT_LIMITS.filters, "filtri").map(value => {
    const filter = object(value, ["id", "datasetId", "fieldId", "value", "defaultValue", "includeAll", "targetMode", "widgetIds"], "filtro");
    const datasetId = id(filter.datasetId, "dataset del filtro");
    const fieldId = id(filter.fieldId, "campo del filtro");
    if (!datasetsById.get(datasetId)?.fields.some(field => field.id === fieldId)) invalid("un filtro fa riferimento a un dataset o campo inesistente.");
    const targetMode = choice(filter.targetMode, ["all", "selected"] as const, "destinazione filtro");
    if (typeof filter.includeAll !== "boolean") invalid("l’opzione (Tutti) del filtro deve essere booleana.");
    const includeAll = filter.includeAll;
    const defaultValue = nullableString(filter.defaultValue, "valore iniziale filtro", REPORT_LIMITS.cellLength);
    const currentValue = nullableString(filter.value, "valore filtro", REPORT_LIMITS.cellLength);
    if (!includeAll && (defaultValue === null || currentValue === null)) invalid("un filtro senza (Tutti) deve avere un valore iniziale specifico.");
    const availableValues = new Set(datasetsById.get(datasetId)!.rows.map(row => String(row[fieldId] ?? "")));
    if (defaultValue !== null && !availableValues.has(defaultValue)) invalid("il valore iniziale del filtro non è presente nei dati.");
    if (currentValue !== null && !availableValues.has(currentValue)) invalid("il valore del filtro non è presente nei dati.");
    const widgetIds = array(filter.widgetIds, REPORT_LIMITS.widgets, "widget del filtro").map(value => id(value, "ID widget del filtro"));
    unique(widgetIds, "widget del filtro");
    if (widgetIds.some(widgetId => widgetsById.get(widgetId)?.datasetId !== datasetId)) invalid("un filtro è associato a un widget inesistente o di un’altra origine dati.");
    return { id: id(filter.id, "ID filtro"), datasetId, fieldId, value: currentValue, defaultValue, includeAll, targetMode, widgetIds };
  });
  unique(filters.map(item => item.id), "filtri");
  return {
    schemaVersion: 9, id: id(data.id, "ID dashboard"), name: string(data.name, "nome dashboard"), description: string(data.description, "descrizione", 5000, true),
    createdAt: date(data.createdAt, "data di creazione"), updatedAt: date(data.updatedAt, "data di modifica"),
    theme: { accent: color(theme.accent, "colore principale"), ink: color(theme.ink, "colore testo"), paper: color(theme.paper, "colore sfondo") },
    datasets, tabs, layoutRows, widgets, filters,
  };
}

function ensureJsonSize(json: string): void {
  if (new TextEncoder().encode(json).byteLength > REPORT_LIMITS.jsonBytes) throw new Error("La dashboard supera il limite di 50 MB. Riduci i dati inclusi nel report.");
}

export function exportDashboard(dashboard: ReportDashboard): string {
  const json = JSON.stringify(validateDashboard(dashboard), null, 2);
  ensureJsonSize(json);
  return json;
}

export function importDashboard(json: string): ReportDashboard {
  ensureJsonSize(json);
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new Error("Il file non contiene JSON valido. Esporta una dashboard Reports e riprova."); }
  const dashboard = validateDashboard(value);
  const now = new Date().toISOString();
  return { ...dashboard, id: reportId(), createdAt: now, updatedAt: now };
}

function databaseError(error: DOMException | null | undefined): Error {
  if (error?.name === "QuotaExceededError") return new Error("Spazio locale esaurito. Esporta le dashboard e libera spazio prima di salvare.");
  return new Error("Impossibile accedere all’archivio Reports. Verifica che l’archiviazione locale sia disponibile e riprova.");
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(databaseError(undefined)); return; }
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DATABASE_NAME, 1); }
    catch { reject(databaseError(undefined)); return; }
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
    request.onerror = () => reject(databaseError(request.error));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("L’archivio Reports è aperto in un’altra finestra. Chiudila e riprova."));
    };
  });
}

async function transaction<T>(mode: IDBTransactionMode, execute: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let result: T;
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, mode);
      const request = execute(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => { result = request.result; };
    } catch {
      database.close();
      reject(databaseError(undefined));
      return;
    }
    transaction.oncomplete = () => { database.close(); resolve(result); };
    transaction.onerror = () => { database.close(); reject(databaseError(transaction.error)); };
    transaction.onabort = () => { database.close(); reject(databaseError(transaction.error)); };
  });
}

type ReportsRequest = { action: "list" } | { action: "save"; dashboard: ReportDashboard } | { action: "delete"; dashboardId: string };

async function reportsRequest<T = void>(request: ReportsRequest): Promise<T> {
  if (isTauri()) return invoke<T>("reports_storage", { request });
  let response: Response;
  try {
    response = await fetch("/__mlsm/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new Error("L’archivio locale condiviso di Reports non è disponibile. Avvia MLSM Studio per salvare le dashboard.");
  }
  const payload = await response.json().catch(() => null) as { result?: T; error?: string } | null;
  if (!response.ok || !payload || payload.error || !("result" in payload)) {
    throw new Error(payload?.error ?? "Impossibile accedere all’archivio locale condiviso di Reports.");
  }
  return payload.result as T;
}

/** Move dashboards created by the old per-browser IndexedDB store into the shared local archive once. */
async function migrateBrowserDashboards(shared: ReportDashboard[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  let legacy: unknown[];
  try { legacy = await transaction("readonly", store => store.getAll()); }
  catch { return; }
  const existing = new Map(shared.map((dashboard, index) => [dashboard.id, { dashboard, index }]));
  for (const value of legacy) {
    let dashboard: ReportDashboard;
    try { dashboard = validateDashboard(value); }
    catch (error) { throw new Error(`Una dashboard del precedente archivio browser non può essere migrata ed è stata conservata. ${error instanceof Error ? error.message : ""}`); }
    const stored = existing.get(dashboard.id);
    if (!stored || dashboard.updatedAt > stored.dashboard.updatedAt) {
      await reportsRequest({ action: "save", dashboard });
      if (stored) shared[stored.index] = dashboard;
      else { shared.push(dashboard); existing.set(dashboard.id, { dashboard, index: shared.length - 1 }); }
    }
    await transaction("readwrite", store => store.delete(dashboard.id));
  }
}

export async function listDashboards(): Promise<ReportDashboard[]> {
  const values = await reportsRequest<unknown[]>({ action: "list" });
  if (!Array.isArray(values)) throw new Error("L’archivio locale condiviso di Reports ha restituito dati non validi.");
  const dashboards = values.map(value => {
    try { return validateDashboard(value); }
    catch (error) { throw new Error(`Una dashboard salvata non può essere letta. I dati originali sono conservati nell’archivio. ${error instanceof Error ? error.message : ""}`); }
  });
  await migrateBrowserDashboards(dashboards);
  return dashboards.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveDashboard(dashboard: ReportDashboard): Promise<void> {
  const valid = validateDashboard(dashboard);
  ensureJsonSize(JSON.stringify(valid));
  await reportsRequest({ action: "save", dashboard: valid });
}

export async function deleteDashboard(dashboardId: string): Promise<void> {
  id(dashboardId, "ID dashboard");
  await reportsRequest({ action: "delete", dashboardId });
}
