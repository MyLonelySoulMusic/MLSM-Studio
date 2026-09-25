import { invoke, isTauri } from "@tauri-apps/api/core";
import { isReportDate, REPORT_LIMITS } from "./data";
import { DEFAULT_MAP_BACKGROUND, reportId, type CellValue, type ReportDashboard, type ReportDataset, type ReportDatasetSource, type ReportField, type ReportFilter, type ReportLayoutRow, type ReportTab, type ReportWidget } from "./types";
import { materializeCalculatedFields } from "./calculated-fields";
import { validateReplicateQuery } from "./replicate-query";

const DATABASE_NAME = "mlsm-studio-reports";
const STORE_NAME = "dashboards";
type JsonObject = Record<string, unknown>;

function invalid(message: string): never { throw new Error(`Dashboard non valida: ${message}`); }

function object(value: unknown, keys: readonly string[], label: string, optionalKeys: readonly string[] = []): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} deve essere un oggetto.`);
  const record = value as JsonObject;
  if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !optionalKeys.includes(key) && !Object.hasOwn(record, key))) invalid(`la struttura di ${label} non corrisponde al formato Reports supportato.`);
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

function nullableFiniteNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${label} deve essere un numero finito oppure automatico.`);
  return value;
}

function nullableTickCount(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 2 || value > 50) invalid(`${label} deve essere un intero tra 2 e 50 oppure automatico.`);
  return value;
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
  const data = object(value, ["id", "name", "sourceName", "fields", "rows", "sources"], "dataset");
  const fields: ReportField[] = array(data.fields, REPORT_LIMITS.fields, "campi").map(value => {
    const field = object(value, ["id", "name", "type", "calculated"], "campo", ["calculated"]);
    const calculated = field.calculated === undefined ? undefined : object(field.calculated, ["formula", "description"], "definizione campo calcolato");
    return {
      id: id(field.id, "ID campo"), name: string(field.name, "nome campo"), type: choice(field.type, ["text", "number", "date", "boolean"] as const, "tipo campo"),
      ...(calculated ? { calculated: { formula: string(calculated.formula, "formula campo calcolato", 4000), description: string(calculated.description, "descrizione campo calcolato", 2000, true) } } : {}),
    };
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
  const sources: ReportDatasetSource[] = array(data.sources, REPORT_LIMITS.rows, "file del dataset").map(value => {
    const source = object(value, ["id", "fileName", "sheetName", "importedAt", "rowCount"], "file del dataset");
    if (typeof source.rowCount !== "number" || !Number.isInteger(source.rowCount) || source.rowCount < 0 || source.rowCount > REPORT_LIMITS.rows) invalid("il numero di righe di un file del dataset non è valido.");
    return { id: id(source.id, "ID file del dataset"), fileName: string(source.fileName, "nome file del dataset", 500), sheetName: string(source.sheetName, "foglio del dataset", 300), importedAt: date(source.importedAt, "data importazione file"), rowCount: source.rowCount };
  });
  if (!sources.length) invalid("un dataset deve contenere almeno un file sorgente.");
  unique(sources.map(source => source.id), "file del dataset");
  if (new Set(sources.map(source => source.fileName.normalize("NFKC").trim().toLocaleLowerCase())).size !== sources.length) invalid("i file di un dataset devono avere nomi univoci.");
  if (sources.reduce((sum, source) => sum + source.rowCount, 0) !== rows.length) invalid("la somma delle righe dei file non coincide con le righe del dataset.");
  try {
    return materializeCalculatedFields({ id: id(data.id, "ID dataset"), name: string(data.name, "nome dataset"), sourceName: string(data.sourceName, "nome del file", 500), fields, rows, sources });
  } catch (error) {
    invalid(error instanceof Error ? error.message : "un campo calcolato non è valido.");
  }
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
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 9) {
    const legacy = candidate as JsonObject;
    candidate = {
      ...legacy,
      schemaVersion: 10,
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets.map(widget => widget && typeof widget === "object" && !Array.isArray(widget) ? { ...widget, categoryLimitMode: "first" } : widget) : legacy.widgets,
    };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 10) {
    candidate = { ...(candidate as JsonObject), schemaVersion: 11 };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 11) {
    candidate = { ...(candidate as JsonObject), schemaVersion: 12 };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 12) {
    const legacy = candidate as JsonObject;
    candidate = {
      ...legacy,
      schemaVersion: 13,
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets.map(widget => widget && typeof widget === "object" && !Array.isArray(widget) ? {
        ...widget,
        showKpiLabel: false, showKpiMeta: false,
        showXTicks: true, showYTicks: true, xTickCount: null, yTickCount: null,
        xAxisMin: null, xAxisMax: null, yAxisMin: null, yAxisMax: null,
      } : widget) : legacy.widgets,
    };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 13) {
    const legacy = candidate as JsonObject;
    candidate = {
      ...legacy,
      schemaVersion: 14,
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets.map(widget => widget && typeof widget === "object" && !Array.isArray(widget) ? { ...widget, xAxisLabel: "", yAxisLabel: "" } : widget) : legacy.widgets,
    };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 14) {
    const legacy = candidate as JsonObject;
    candidate = {
      ...legacy,
      schemaVersion: 15,
      datasets: Array.isArray(legacy.datasets) ? legacy.datasets.map((dataset, index) => dataset && typeof dataset === "object" && !Array.isArray(dataset) ? {
        ...dataset,
        sources: [{ id: `source-${index + 1}`, fileName: String((dataset as JsonObject).sourceName ?? "file-importato"), sheetName: String((dataset as JsonObject).name ?? "Dati importati"), importedAt: legacy.createdAt, rowCount: Array.isArray((dataset as JsonObject).rows) ? ((dataset as JsonObject).rows as unknown[]).length : 0 }],
      } : dataset) : legacy.datasets,
    };
  }
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && (candidate as JsonObject).schemaVersion === 15) {
    const legacy = candidate as JsonObject;
    candidate = {
      ...legacy,
      schemaVersion: 16,
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets.map(widget => widget && typeof widget === "object" && !Array.isArray(widget) ? { ...widget, replicateXls: null } : widget) : legacy.widgets,
    };
  }
  const data = object(candidate, ["schemaVersion", "id", "name", "description", "createdAt", "updatedAt", "theme", "datasets", "tabs", "layoutRows", "widgets", "filters"], "dashboard");
  if (data.schemaVersion !== 16) invalid("versione non supportata. Questo programma legge i formati Reports dalla v1 alla v16.");
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
    const widget = object(value, ["id", "type", "title", "datasetId", "dimension", "secondaryDimension", "measure", "aggregation", "timeGrain", "rowId", "width", "height", "color", "mapBackground", "text", "format", "currency", "decimals", "sort", "xSort", "limit", "categoryLimitMode", "showKpiLabel", "showKpiMeta", "showXTicks", "showYTicks", "xTickCount", "yTickCount", "xAxisMin", "xAxisMax", "yAxisMin", "yAxisMax", "xAxisLabel", "yAxisLabel", "animation", "replicateXls"], "widget");
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
    if (typeof widget.showKpiLabel !== "boolean" || typeof widget.showKpiMeta !== "boolean" || typeof widget.showXTicks !== "boolean" || typeof widget.showYTicks !== "boolean") invalid("le opzioni di visualizzazione del widget devono essere booleane.");
    const xTickCount = nullableTickCount(widget.xTickCount, "il numero di tacche X");
    const yTickCount = nullableTickCount(widget.yTickCount, "il numero di tacche Y");
    const xAxisMin = nullableFiniteNumber(widget.xAxisMin, "il minimo dell’asse X");
    const xAxisMax = nullableFiniteNumber(widget.xAxisMax, "il massimo dell’asse X");
    const yAxisMin = nullableFiniteNumber(widget.yAxisMin, "il minimo dell’asse Y");
    const yAxisMax = nullableFiniteNumber(widget.yAxisMax, "il massimo dell’asse Y");
    if (xAxisMin !== null && xAxisMax !== null && xAxisMin >= xAxisMax) invalid("il minimo dell’asse X deve essere inferiore al massimo.");
    if (yAxisMin !== null && yAxisMax !== null && yAxisMin >= yAxisMax) invalid("il minimo dell’asse Y deve essere inferiore al massimo.");
    let animation: ReportWidget["animation"] = null;
    if (widget.animation !== null) {
      const animationCandidate = widget.animation as JsonObject;
      if (animationCandidate.type === "timeSeries") {
        const value = object(widget.animation, ["type", "chartType", "dimension", "timeGrain", "valueMode", "showTrendLine", "highlightMaximum"], "animazione Time Series");
        const animationDimension = id(value.dimension, "asse X dell’animazione");
        const animationField = source?.fields.find(field => field.id === animationDimension);
        if (!animationField || animationField.type !== "date") invalid("l’animazione Time Series richiede un campo data valido per l’asse X.");
        if (typeof value.showTrendLine !== "boolean" || typeof value.highlightMaximum !== "boolean") invalid("le opzioni dell’animazione devono essere booleane.");
        animation = {
          type: "timeSeries",
          chartType: choice(value.chartType, ["line", "area", "bar"] as const, "grafico animazione"),
          dimension: animationDimension,
          timeGrain: choice(value.timeGrain, ["exact", "day", "week", "month", "quarter", "year"] as const, "raggruppamento animazione"),
          valueMode: choice(value.valueMode, ["period", "cumulative"] as const, "modalità valori animazione"),
          showTrendLine: value.showTrendLine,
          highlightMaximum: value.highlightMaximum,
        };
      } else if (animationCandidate.type === "barRace") {
        const value = object(widget.animation, ["type", "dateDimension", "groupDimension", "measure", "aggregation", "timeGrain", "valueMode", "orientation", "sort", "stepDurationMs"], "animazione Bar Chart Race");
        const dateDimension = id(value.dateDimension, "campo data della Bar Chart Race");
        const groupDimension = id(value.groupDimension, "campo gruppo della Bar Chart Race");
        const measure = id(value.measure, "misura della Bar Chart Race", true);
        const aggregation = choice(value.aggregation, ["sum", "avg", "count", "distinct", "median", "min", "max", "range", "variance", "stddev"] as const, "aggregazione Bar Chart Race");
        if (source?.fields.find(field => field.id === dateDimension)?.type !== "date") invalid("la Bar Chart Race richiede un campo data valido.");
        if (!source?.fields.some(field => field.id === groupDimension)) invalid("la Bar Chart Race richiede un campo di raggruppamento valido.");
        const measureField = source?.fields.find(field => field.id === measure);
        if (aggregation !== "count" && !measureField) invalid("la Bar Chart Race richiede una misura valida.");
        if (!["count", "distinct"].includes(aggregation) && measureField?.type !== "number") invalid("questa aggregazione della Bar Chart Race richiede una misura numerica.");
        if (typeof value.stepDurationMs !== "number" || !Number.isInteger(value.stepDurationMs) || value.stepDurationMs < 200 || value.stepDurationMs > 20_000) invalid("la durata di ogni step della Bar Chart Race deve essere tra 200 e 20.000 millisecondi.");
        animation = {
          type: "barRace", dateDimension, groupDimension, measure, aggregation,
          timeGrain: choice(value.timeGrain, ["exact", "day", "week", "month", "quarter", "year"] as const, "raggruppamento temporale Bar Chart Race"),
          valueMode: choice(value.valueMode, ["period", "cumulative"] as const, "modalità valori Bar Chart Race"),
          orientation: choice(value.orientation, ["horizontal", "vertical"] as const, "orientamento Bar Chart Race"),
          sort: choice(value.sort, ["asc", "desc"] as const, "ordinamento Bar Chart Race"),
          stepDurationMs: value.stepDurationMs,
        };
      } else invalid("tipo animazione non supportato.");
    }
    let replicateXls: ReportWidget["replicateXls"] = null;
    if (widget.replicateXls !== null) {
      const config = object(widget.replicateXls, ["templateName", "templateFormat", "templateBase64", "sheetName", "selectedRange", "regions", "aiSummary", "aiProvider", "aiModel", "correctionNotes", "lastTestedAt"], "configurazione Replica Excel");
      if (!source) invalid("Replica Excel richiede un dataset valido.");
      const templateBase64 = string(config.templateBase64, "template Replica Excel", 21_000_000);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(templateBase64)) invalid("il template Replica Excel non è codificato correttamente.");
      const regions = array(config.regions, 100, "aree Replica Excel").map((value, index) => {
        const region = object(value, ["id", "sheetName", "range", "label", "description", "mode", "fieldIds", "includeHeaders", "query"], `area Replica Excel ${index + 1}`, ["query"]);
        const fieldIds = array(region.fieldIds, REPORT_LIMITS.fields, "campi area Replica Excel").map((value, fieldIndex) => id(value, `campo ${fieldIndex + 1} dell’area`));
        if (fieldIds.some(fieldId => !source.fields.some(field => field.id === fieldId))) invalid("un’area Replica Excel fa riferimento a un campo inesistente.");
        if (typeof region.includeHeaders !== "boolean") invalid("l’opzione intestazioni di Replica Excel deve essere booleana.");
        const range = string(region.range, "intervallo area Replica Excel", 50);
        if (!/^[A-Z]+[1-9]\d*:[A-Z]+[1-9]\d*$/i.test(range)) invalid("un intervallo Replica Excel non usa la notazione A1 valida.");
        return { id: id(region.id, "ID area Replica Excel"), sheetName: string(region.sheetName, "foglio area Replica Excel", 300), range: range.toUpperCase(), label: string(region.label, "nome area Replica Excel", 120, true), description: string(region.description, "descrizione area Replica Excel", 1200, true), mode: choice(region.mode, ["static", "singleCell", "tableRows", "tableColumns"] as const, "modalità area Replica Excel"), fieldIds, includeHeaders: region.includeHeaders, ...(region.query ? { query: validateReplicateQuery(region.query, source) } : {}) };
      });
      unique(regions.map(region => region.id), "aree Replica Excel");
      replicateXls = {
        templateName: string(config.templateName, "nome template Replica Excel", 500), templateFormat: choice(config.templateFormat, ["xlsx", "xls", "xlsm", "xlsb", "ods"] as const, "formato template Replica Excel"), templateBase64,
        sheetName: string(config.sheetName, "foglio Replica Excel", 300), selectedRange: string(config.selectedRange, "selezione Replica Excel", 50), regions,
        aiSummary: string(config.aiSummary, "analisi AI Replica Excel", 6000, true), aiProvider: string(config.aiProvider, "provider AI Replica Excel", 100, true), aiModel: string(config.aiModel, "modello AI Replica Excel", 300, true), correctionNotes: string(config.correctionNotes, "note Replica Excel", 6000, true),
        lastTestedAt: config.lastTestedAt === null ? null : date(config.lastTestedAt, "data ultimo test Replica Excel"),
      };
    }
    return {
      id: id(widget.id, "ID widget"), type: choice(widget.type, ["kpi", "bar", "column", "line", "area", "doughnut", "scatter", "map", "table", "pivot", "replicateXls", "text"] as const, "tipo widget"),
      title: string(widget.title, "titolo widget", 300, true), datasetId, dimension, secondaryDimension, measure, rowId,
      aggregation: choice(widget.aggregation, ["sum", "avg", "count", "distinct", "median", "min", "max", "range", "variance", "stddev"] as const, "aggregazione"),
      timeGrain: choice(widget.timeGrain, ["exact", "day", "week", "month", "quarter", "year"] as const, "raggruppamento temporale"),
      width: widget.width, height: choice(widget.height, [240, 320, 420] as const, "altezza widget"),
      color: color(widget.color, "colore widget", true), mapBackground: color(widget.mapBackground, "colore sfondo mappa"), text: string(widget.text, "testo widget", 20_000, true),
      format: choice(widget.format, ["number", "currency", "percent"] as const, "formato numero"),
      currency: choice(widget.currency, ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD"] as const, "valuta"), decimals: widget.decimals,
      sort: choice(widget.sort, ["source", "asc", "desc"] as const, "ordinamento valori"), xSort: choice(widget.xSort, ["source", "asc", "desc"] as const, "ordinamento asse X"), limit: widget.limit as number | null,
      categoryLimitMode: choice(widget.categoryLimitMode, ["first", "last"] as const, "selezione prime o ultime categorie"),
      showKpiLabel: widget.showKpiLabel, showKpiMeta: widget.showKpiMeta,
      showXTicks: widget.showXTicks, showYTicks: widget.showYTicks, xTickCount, yTickCount,
      xAxisMin, xAxisMax, yAxisMin, yAxisMax,
      xAxisLabel: string(widget.xAxisLabel, "etichetta asse X", 160, true), yAxisLabel: string(widget.yAxisLabel, "etichetta asse Y", 160, true), animation, replicateXls,
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
    schemaVersion: 16, id: id(data.id, "ID dashboard"), name: string(data.name, "nome dashboard"), description: string(data.description, "descrizione", 5000, true),
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
