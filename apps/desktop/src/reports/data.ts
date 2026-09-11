import Papa from "papaparse";
import { createDashboard, createWidget, reportId, type CellValue, type FieldType, type ReportDashboard, type ReportDataset } from "./types";

export const REPORT_LIMITS = {
  fileBytes: 20 * 1024 * 1024,
  jsonBytes: 50 * 1024 * 1024,
  rows: 50_000,
  fields: 100,
  cells: 1_000_000,
  cellLength: 100_000,
  datasets: 20,
  widgets: 100,
  filters: 100,
} as const;

function fail(message: string): never { throw new Error(message); }

function isEmpty(value: unknown): boolean { return value == null || (typeof value === "string" && value.trim() === ""); }

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/[\u00a0\u202f]/g, " ");
  // Codes such as 00123 must not turn into quantities.
  if (/^[+-]?0\d/.test(text)) return null;
  let normalized = text;
  if (/^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(text)) normalized = text.replaceAll(".", "").replace(",", ".");
  else if (/^[+-]?\d{1,3}(?:,\d{3})+\.\d+$/.test(text)) normalized = text.replaceAll(",", "");
  else if (/^[+-]?\d{1,3}(?: \d{3})+(?:[.,]\d+)?$/.test(text)) normalized = text.replaceAll(" ", "").replace(",", ".");
  else if (/^[+-]?\d+,\d+$/.test(text)) normalized = text.replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  const result = Number(normalized);
  // Large integer identifiers cannot be represented without losing digits.
  if (!Number.isFinite(result) || (Number.isInteger(result) && !Number.isSafeInteger(result))) return null;
  return result;
}

export function isReportDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return false;
  const datePart = value.slice(0, 10);
  const date = new Date(`${datePart}T00:00:00Z`);
  return Number.isFinite(Date.parse(value)) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === datePart;
}

function inferType(values: unknown[]): FieldType {
  const nonempty = values.filter(value => !isEmpty(value));
  if (!nonempty.length) return "text";
  if (nonempty.every(value => asNumber(value) !== null)) return "number";
  if (nonempty.every(value => typeof value === "boolean" || (typeof value === "string" && /^(true|false)$/i.test(value.trim())))) return "boolean";
  if (nonempty.every(value => value instanceof Date ? Number.isFinite(value.getTime()) : isReportDate(typeof value === "string" ? value.trim() : value))) return "date";
  return "text";
}

function convertCell(value: unknown, type: FieldType): CellValue {
  if (isEmpty(value)) return null;
  if (type === "number") return asNumber(value);
  if (type === "boolean") return typeof value === "boolean" ? value : String(value).trim().toLowerCase() === "true";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : fail("Il file contiene una data non valida.");
  const text = String(value);
  if (text.length > REPORT_LIMITS.cellLength) fail("Una cella supera il limite di 100.000 caratteri.");
  return type === "date" ? text.trim() : text;
}

function tableDataset(table: unknown[][], sourceName: string, name = sourceName.replace(/\.[^.]+$/, ""), forceText = false): ReportDataset {
  const lines = table.filter(row => row.some(value => !isEmpty(value)));
  if (lines.length < 2) fail("Il file deve contenere un’intestazione e almeno una riga di dati.");
  const headers = lines[0]!;
  const values = lines.slice(1);
  if (headers.length > REPORT_LIMITS.fields) fail("Il file supera il limite di 100 campi.");
  if (values.length > REPORT_LIMITS.rows) fail("Il file supera il limite di 50.000 righe. Dividilo in file più piccoli.");
  if (values.length * headers.length > REPORT_LIMITS.cells) fail("Il file supera il limite di 1.000.000 di celle. Riduci righe o colonne.");
  if (values.some(row => row.length > headers.length)) fail("Alcune righe contengono più colonne dell’intestazione. Controlla il separatore e le virgolette.");
  const usedNames = new Set<string>();
  const fields = headers.map((header, index) => {
    const base = String(header ?? "").trim() || `Campo ${index + 1}`;
    if (base.length > 300) fail("Il nome di un campo supera il limite di 300 caratteri.");
    let name = base;
    let suffix = 2;
    while (usedNames.has(name)) name = `${base.slice(0, 290)} (${suffix++})`;
    usedNames.add(name);
    return { id: `field-${index + 1}`, name, type: forceText ? "text" as const : inferType(values.map(row => row[index])) };
  });
  const rows = values.map(row => Object.fromEntries(fields.map((field, index) => [field.id, convertCell(row[index], field.type)])));
  return { id: reportId(), name: name || "Dati importati", sourceName, fields, rows };
}

export function parseTextDataset(text: string, sourceName: string): ReportDataset {
  if (new TextEncoder().encode(text).byteLength > REPORT_LIMITS.fileBytes) fail("Il file supera il limite di 20 MB.");
  const source = text.replace(/^\uFEFF/, "");
  if (!source.trim()) fail("Il file è vuoto.");
  const result = Papa.parse<string[]>(source, {
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t", "|"],
    ...(sourceName.toLowerCase().endsWith(".tsv") ? { delimiter: "\t" } : {}),
  });
  if (sourceName.toLowerCase().endsWith(".txt") && (result.data.every(row => row.length === 1) || result.errors.some(error => error.code === "UndetectableDelimiter"))) {
    const lines = source.split(/\r\n|\n|\r/).filter(line => line.trim());
    return tableDataset([["Testo"], ...lines.map(line => [line])], sourceName, undefined, true);
  }
  const errors = result.errors.filter(error => error.code !== "UndetectableDelimiter");
  if (errors.length) fail(`Impossibile leggere il file: virgolette o struttura non valide${typeof errors[0]!.row === "number" ? ` alla riga ${errors[0]!.row! + 1}` : ""}.`);
  return tableDataset(result.data, sourceName);
}

function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Impossibile leggere il file selezionato."));
    reader.onabort = () => reject(new Error("Lettura del file annullata."));
    reader.readAsArrayBuffer(file);
  });
}

export async function importReportFile(file: File): Promise<ReportDataset[]> {
  if (file.size > REPORT_LIMITS.fileBytes) fail("Il file supera il limite di 20 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["csv", "txt", "tsv", "xlsx", "xls"].includes(extension ?? "")) fail("Formato non supportato. Scegli un file CSV, TXT, TSV, XLSX o XLS.");
  const bytes = await readBytes(file);
  if (extension !== "xlsx" && extension !== "xls") {
    let text: string;
    const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
    try { text = new TextDecoder(signature[0] === 0xff && signature[1] === 0xfe ? "utf-16le" : signature[0] === 0xfe && signature[1] === 0xff ? "utf-16be" : "utf-8", { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder("windows-1252").decode(bytes); }
    return [parseTextDataset(text, file.name)];
  }
  // Excel is loaded only when needed. Formula text, HTML and macros are not loaded or executed.
  const XLSX = await import("xlsx");
  let workbook: ReturnType<typeof XLSX.read>;
  try { workbook = XLSX.read(bytes, { type: "array", cellDates: true, cellFormula: false, cellHTML: false, bookVBA: false }); }
  catch { fail("Impossibile leggere il file Excel. Verifica che sia valido e non protetto da password."); }
  const datasets: ReportDataset[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    if (range.e.r - range.s.r > REPORT_LIMITS.rows || range.e.c - range.s.c + 1 > REPORT_LIMITS.fields || (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1) > REPORT_LIMITS.cells + REPORT_LIMITS.fields) {
      fail(`Il foglio “${sheetName}” supera i limiti: 50.000 righe, 100 campi o 1.000.000 di celle.`);
    }
    const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: false, raw: true });
    if (!table.some(row => row.some(value => !isEmpty(value)))) continue;
    try { datasets.push(tableDataset(table, file.name, sheetName)); }
    catch (error) { fail(`Foglio “${sheetName}”: ${error instanceof Error ? error.message : "dati non validi."}`); }
    if (datasets.length > REPORT_LIMITS.datasets) fail("Il file supera il limite di 20 fogli non vuoti.");
  }
  if (!datasets.length) fail("Il file Excel non contiene fogli con dati.");
  return datasets;
}

export function createDemoDashboard(): ReportDashboard {
  const dashboard = createDashboard("MLSM · Audience & crescita");
  dashboard.description = "Dashboard dimostrativa · dati di esempio, pronti da esplorare e personalizzare.";
  const dataset = parseTextDataset([
    "Mese,Canale,Visualizzazioni,Interazioni,Ricavi",
    "2026-01-01,Instagram,42000,3600,1240", "2026-01-01,YouTube,31000,2100,980", "2026-01-01,TikTok,57000,4800,720",
    "2026-02-01,Instagram,49500,4200,1510", "2026-02-01,YouTube,34800,2450,1120", "2026-02-01,TikTok,63200,5100,890",
    "2026-03-01,Instagram,56800,4700,1850", "2026-03-01,YouTube,39500,3100,1420", "2026-03-01,TikTok,71500,6200,1080",
    "2026-04-01,Instagram,62400,5400,2190", "2026-04-01,YouTube,46700,3800,1740", "2026-04-01,TikTok,82300,7400,1320",
    "2026-05-01,Instagram,71800,6300,2640", "2026-05-01,YouTube,52800,4300,2090", "2026-05-01,TikTok,91400,8100,1670",
    "2026-06-01,Instagram,79600,7100,3120", "2026-06-01,YouTube,61400,5200,2480", "2026-06-01,TikTok,104200,9300,2140",
  ].join("\n"), "MLSM-demo.csv");
  dataset.name = "Performance dei canali";
  dashboard.datasets = [dataset];
  const month = dataset.fields[0]!;
  const channel = dataset.fields[1]!;
  const views = dataset.fields[2]!;
  const interactions = dataset.fields[3]!;
  const revenue = dataset.fields[4]!;
  const rowId = dashboard.layoutRows[0]!.id;
  dashboard.widgets = [
    { ...createWidget("kpi", dataset, rowId), title: "Visualizzazioni totali", measure: views.id, width: 4 },
    { ...createWidget("kpi", dataset, rowId), title: "Interazioni", measure: interactions.id, width: 4 },
    { ...createWidget("kpi", dataset, rowId), title: "Ricavi generati", measure: revenue.id, format: "currency", width: 4 },
    { ...createWidget("area", dataset, rowId), title: "Un pubblico in crescita", dimension: month.id, measure: views.id, width: 8, height: 320 },
    { ...createWidget("bar", dataset, rowId), title: "Ricavi per canale", dimension: channel.id, measure: revenue.id, format: "currency", sort: "desc", width: 4, height: 320 },
  ];
  return dashboard;
}
