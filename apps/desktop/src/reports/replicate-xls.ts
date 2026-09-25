import type { CSSProperties } from "react";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { WorkBook, WorkSheet, CellObject, BookType } from "xlsx";
import type { CellValue, ReportDataset, ReplicateXlsConfig, ReplicateXlsRegion } from "./types";
import { prepareReplicateRegion } from "./replicate-query";

export const REPLICATE_XLS_MAX_TEMPLATE_BYTES = 15 * 1024 * 1024;
export const REPLICATE_XLS_FORMATS = ["xlsx", "xls", "xlsm", "xlsb", "ods"] as const;

export interface ReplicateXlsCellPreview {
  address: string;
  row: number;
  column: number;
  display: string;
  formula: string;
  style: CSSProperties;
}

export interface ReplicateXlsGridPreview {
  sheetName: string;
  startRow: number;
  startColumn: number;
  rowCount: number;
  columnCount: number;
  cells: ReplicateXlsCellPreview[][];
  columnWidths: number[];
  rowHeights: number[];
  truncated: boolean;
}

export interface ReplicateXlsTemplateSummary {
  fileName: string;
  format: ReplicateXlsConfig["templateFormat"];
  sheets: Array<{
    name: string;
    range: string;
    merges: string[];
    populatedCells: number;
    sampleCells: Array<{ address: string; value: string; formula?: string; numberFormat?: string }>;
  }>;
}

export interface ReplicateXlsInspection {
  workbook: WorkBook;
  summary: ReplicateXlsTemplateSummary;
  base64: string;
}

interface Coordinate { row: number; column: number }
interface CellStyleShape {
  font?: { bold?: boolean; italic?: boolean; name?: string; sz?: number; color?: { rgb?: string } };
  fill?: { fgColor?: { rgb?: string } };
  alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean };
}
type StyledCell = CellObject & { s?: CellStyleShape };

function extensionOf(name: string): ReplicateXlsConfig["templateFormat"] {
  const extension = name.split(".").pop()?.toLowerCase();
  if (!REPLICATE_XLS_FORMATS.includes(extension as ReplicateXlsConfig["templateFormat"])) throw new Error("Formato template non supportato. Usa XLSX, XLS, XLSM, XLSB oppure ODS.");
  return extension as ReplicateXlsConfig["templateFormat"];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function columnLetters(column: number): string {
  let current = column + 1;
  let result = "";
  while (current > 0) { const remainder = (current - 1) % 26; result = String.fromCharCode(65 + remainder) + result; current = Math.floor((current - 1) / 26); }
  return result;
}

export function cellAddress(row: number, column: number): string { return `${columnLetters(column)}${row + 1}`; }

export function parseCellAddress(value: string): Coordinate {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(value.trim());
  if (!match) throw new Error(`Riferimento cella non valido: ${value}.`);
  let column = 0;
  for (const character of match[1]!.toUpperCase()) column = column * 26 + character.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

export function normalizeCellRange(value: string): string {
  const parts = value.trim().toUpperCase().split(":");
  if (parts.length > 2 || !parts[0]) throw new Error("Intervallo di celle non valido.");
  const first = parseCellAddress(parts[0]);
  const second = parseCellAddress(parts[1] ?? parts[0]);
  const start = { row: Math.min(first.row, second.row), column: Math.min(first.column, second.column) };
  const end = { row: Math.max(first.row, second.row), column: Math.max(first.column, second.column) };
  return `${cellAddress(start.row, start.column)}:${cellAddress(end.row, end.column)}`;
}

export function rangeCoordinates(value: string): { start: Coordinate; end: Coordinate } {
  const normalized = normalizeCellRange(value);
  const [first, second] = normalized.split(":");
  return { start: parseCellAddress(first!), end: parseCellAddress(second!) };
}

export function selectionRange(start: Coordinate, end: Coordinate): string {
  return normalizeCellRange(`${cellAddress(start.row, start.column)}:${cellAddress(end.row, end.column)}`);
}

function color(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^FF(?=[0-9A-F]{6}$)/i, "");
  return /^[0-9A-F]{6}$/i.test(normalized) ? `#${normalized}` : undefined;
}

function previewStyle(cell: StyledCell | undefined): CSSProperties {
  const style = cell?.s;
  return {
    ...(color(style?.fill?.fgColor?.rgb) ? { backgroundColor: color(style?.fill?.fgColor?.rgb) } : {}),
    ...(color(style?.font?.color?.rgb) ? { color: color(style?.font?.color?.rgb) } : {}),
    ...(style?.font?.bold ? { fontWeight: 700 } : {}),
    ...(style?.font?.italic ? { fontStyle: "italic" } : {}),
    ...(style?.font?.name ? { fontFamily: style.font.name } : {}),
    ...(style?.font?.sz ? { fontSize: `${Math.max(8, Math.min(24, style.font.sz))}px` } : {}),
    ...(style?.alignment?.horizontal ? { textAlign: style.alignment.horizontal as CSSProperties["textAlign"] } : {}),
    ...(style?.alignment?.vertical ? { verticalAlign: style.alignment.vertical as CSSProperties["verticalAlign"] } : {}),
    ...(style?.alignment?.wrapText ? { whiteSpace: "normal" } : {}),
  };
}

function workbookSummary(XLSX: typeof import("xlsx"), workbook: WorkBook, fileName: string, format: ReplicateXlsConfig["templateFormat"]): ReplicateXlsTemplateSummary {
  return {
    fileName, format,
    sheets: workbook.SheetNames.map(name => {
      const sheet = workbook.Sheets[name];
      const range = sheet?.["!ref"] ?? "A1:A1";
      const sampleCells: ReplicateXlsTemplateSummary["sheets"][number]["sampleCells"] = [];
      let populatedCells = 0;
      if (sheet) {
        for (const address of Object.keys(sheet)) {
          if (address.startsWith("!")) continue;
          const cell = sheet[address] as CellObject;
          if ((cell.v === undefined || cell.v === null || cell.v === "") && !cell.f) continue;
          populatedCells += 1;
          if (sampleCells.length < 240) {
            sampleCells.push({ address, value: XLSX.utils.format_cell(cell), ...(cell.f ? { formula: cell.f } : {}), ...(cell.z ? { numberFormat: String(cell.z) } : {}) });
          }
        }
      }
      return { name, range, merges: (sheet?.["!merges"] ?? []).map(merge => XLSX.utils.encode_range(merge)), populatedCells, sampleCells };
    }),
  };
}

async function readWorkbook(bytes: Uint8Array): Promise<WorkBook> {
  const XLSX = await import("xlsx");
  try {
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true, cellStyles: true, cellFormula: true, cellHTML: false, bookVBA: true, sheetStubs: true });
    if (bytes[0] === 80 && bytes[1] === 75) {
      const files = unzipSync(bytes);
      if (files["xl/styles.xml"]) applyOriginalStyles(workbook, files);
    }
    return workbook;
  }
  catch { throw new Error("Impossibile leggere il template. Verifica che il file non sia protetto da password o danneggiato."); }
}

export async function inspectReplicateXlsTemplate(file: File): Promise<ReplicateXlsInspection> {
  if (file.size > REPLICATE_XLS_MAX_TEMPLATE_BYTES) throw new Error("Il template supera il limite di 15 MB.");
  const format = extensionOf(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const workbook = await readWorkbook(bytes);
  if (!workbook.SheetNames.length) throw new Error("Il template non contiene fogli utilizzabili.");
  const XLSX = await import("xlsx");
  return { workbook, summary: workbookSummary(XLSX, workbook, file.name, format), base64: bytesToBase64(bytes) };
}

export async function inspectStoredReplicateXlsTemplate(config: ReplicateXlsConfig): Promise<ReplicateXlsInspection> {
  const bytes = base64ToBytes(config.templateBase64);
  const workbook = await readWorkbook(bytes);
  const XLSX = await import("xlsx");
  return { workbook, summary: workbookSummary(XLSX, workbook, config.templateName, config.templateFormat), base64: config.templateBase64 };
}

export async function createReplicateXlsGrid(workbook: WorkBook, sheetName: string, rowLimit = 80, columnLimit = 40): Promise<ReplicateXlsGridPreview> {
  const XLSX = await import("xlsx");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Il foglio “${sheetName}” non è disponibile.`);
  const decoded = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const rowCount = Math.min(rowLimit, decoded.e.r - decoded.s.r + 1);
  const columnCount = Math.min(columnLimit, decoded.e.c - decoded.s.c + 1);
  const cells = Array.from({ length: rowCount }, (_, rowOffset) => Array.from({ length: columnCount }, (_, columnOffset) => {
    const row = decoded.s.r + rowOffset; const column = decoded.s.c + columnOffset; const address = XLSX.utils.encode_cell({ r: row, c: column });
    const cell = sheet[address] as StyledCell | undefined;
    return { address, row, column, display: cell ? XLSX.utils.format_cell(cell) : "", formula: cell?.f ?? "", style: originalStyles.get(workbook)?.get(`${sheetName}!${address}`) ?? previewStyle(cell) };
  }));
  const columns = sheet["!cols"] ?? [];
  const rows = sheet["!rows"] ?? [];
  return {
    sheetName, startRow: decoded.s.r, startColumn: decoded.s.c, rowCount, columnCount, cells,
    columnWidths: Array.from({ length: columnCount }, (_, index) => Math.max(54, Math.min(260, Number(columns[decoded.s.c + index]?.wpx ?? (columns[decoded.s.c + index]?.wch ?? 11) * 7)))),
    rowHeights: Array.from({ length: rowCount }, (_, index) => Math.max(24, Math.min(90, Number(rows[decoded.s.r + index]?.hpx ?? rows[decoded.s.r + index]?.hpt ?? 24)))),
    truncated: rowCount < decoded.e.r - decoded.s.r + 1 || columnCount < decoded.e.c - decoded.s.c + 1,
  };
}

function valueCell(value: CellValue, template: StyledCell | undefined): StyledCell {
  const next = template ? structuredClone(template) : { t: "s", v: "" } as StyledCell;
  delete next.f;
  next.v = value ?? "";
  next.t = typeof value === "number" ? "n" : typeof value === "boolean" ? "b" : "s";
  return next;
}

function templateCellFor(sheet: WorkSheet, start: Coordinate, end: Coordinate, rowOffset: number, columnOffset: number): StyledCell | undefined {
  const row = Math.min(end.row, start.row + rowOffset);
  const column = Math.min(end.column, start.column + columnOffset);
  return sheet[cellAddress(row, column)] as StyledCell | undefined;
}

function extendSheetReference(XLSX: typeof import("xlsx"), sheet: WorkSheet, row: number, column: number): void {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  range.s.r = Math.min(range.s.r, row); range.s.c = Math.min(range.s.c, column);
  range.e.r = Math.max(range.e.r, row); range.e.c = Math.max(range.e.c, column);
  sheet["!ref"] = XLSX.utils.encode_range(range);
}

function applyRegion(XLSX: typeof import("xlsx"), workbook: WorkBook, dataset: ReportDataset, region: ReplicateXlsRegion): void {
  if (region.mode === "static") return;
  ({ dataset, region } = prepareReplicateRegion(dataset, region));
  const sheet = workbook.Sheets[region.sheetName];
  if (!sheet) return;
  const { start, end } = rangeCoordinates(region.range);
  const fields = region.fieldIds.map(fieldId => dataset.fields.find(field => field.id === fieldId)).filter((field): field is ReportDataset["fields"][number] => Boolean(field));
  if (!fields.length) return;
  const write = (row: number, column: number, value: CellValue, styleRow: number, styleColumn: number) => {
    sheet[cellAddress(row, column)] = valueCell(value, templateCellFor(sheet, start, end, styleRow, styleColumn));
    extendSheetReference(XLSX, sheet, row, column);
  };
  if (region.mode === "singleCell") {
    if (region.query && region.includeHeaders) { fields.forEach((field, offset) => write(start.row, start.column + offset, field.name, 0, offset)); return; }
    write(start.row, start.column, dataset.rows[0]?.[fields[0]!.id] ?? null, 0, 0);
    return;
  }
  if (region.mode === "tableRows") {
    let rowOffset = 0;
    if (region.includeHeaders) { fields.forEach((field, columnOffset) => write(start.row, start.column + columnOffset, field.name, 0, columnOffset)); rowOffset = 1; }
    dataset.rows.forEach((row, index) => fields.forEach((field, columnOffset) => write(start.row + rowOffset + index, start.column + columnOffset, row[field.id] ?? null, rowOffset + index, columnOffset)));
    return;
  }
  let columnOffset = 0;
  if (region.includeHeaders) { fields.forEach((field, rowOffset) => write(start.row + rowOffset, start.column, field.name, rowOffset, 0)); columnOffset = 1; }
  dataset.rows.forEach((row, index) => fields.forEach((field, rowOffset) => write(start.row + rowOffset, start.column + columnOffset + index, row[field.id] ?? null, rowOffset, columnOffset + index)));
}

async function buildReplicatedWorkbookWithSheetJs(config: ReplicateXlsConfig, dataset: ReportDataset): Promise<WorkBook> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(base64ToBytes(config.templateBase64), { type: "array", cellDates: true, cellStyles: true, cellFormula: true, cellHTML: false, bookVBA: true });
  config.regions.forEach(region => applyRegion(XLSX, workbook, dataset, region));
  return workbook;
}

const OOXML_MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const OOXML_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const originalStyles = new WeakMap<WorkBook, Map<string, CSSProperties>>();

// SheetJS CE does not expose the complete font/fill/border records. Read the
// original OOXML styles for preview, while export retains the original ZIP parts.
function applyOriginalStyles(workbook: WorkBook, files: Record<string, Uint8Array>): void {
  const styles = parseXml(strFromU8(files["xl/styles.xml"]!), "styles.xml");
  const theme = files["xl/theme/theme1.xml"] ? parseXml(strFromU8(files["xl/theme/theme1.xml"]!), "theme") : null;
  const scheme = theme && firstXmlElement(theme, "clrScheme");
  const themeNames = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  const indexed = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF"];
  const cssColor = (element: Element | null): string | undefined => {
    if (!element) return undefined;
    let rgb = element.getAttribute("rgb");
    if (!rgb && element.hasAttribute("theme") && scheme) {
      const entry = firstXmlElement(scheme, themeNames[Number(element.getAttribute("theme"))] ?? "dk1")?.firstElementChild;
      rgb = entry?.getAttribute("lastClr") ?? entry?.getAttribute("val") ?? null;
    }
    if (!rgb && element.hasAttribute("indexed")) rgb = indexed[Number(element.getAttribute("indexed")) % 8] ?? null;
    if (!rgb && element.getAttribute("auto") === "1") rgb = "000000";
    const hex = color(rgb?.slice(-6));
    if (!hex) return undefined;
    const tint = Number(element.getAttribute("tint") ?? 0);
    if (!tint) return hex;
    return `#${[1, 3, 5].map(offset => { const n = parseInt(hex.slice(offset, offset + 2), 16); return Math.round(tint < 0 ? n * (1 + tint) : n + (255 - n) * tint).toString(16).padStart(2, "0"); }).join("")}`;
  };
  const records = (name: string, child: string) => { const element = firstXmlElement(styles, name); return element ? directChildren(element, child) : []; };
  const fonts = records("fonts", "font"), fills = records("fills", "fill"), borders = records("borders", "border");
  const formats = records("cellXfs", "xf").map(xf => {
    const result: CSSProperties = { color: "#000000", backgroundColor: "#FFFFFF" };
    const font = fonts[Number(xf.getAttribute("fontId") ?? 0)];
    if (font) {
      result.color = cssColor(firstXmlElement(font, "color")) ?? "#000000";
      result.fontFamily = firstXmlElement(font, "name")?.getAttribute("val") ?? "Arial";
      result.fontSize = `${Number(firstXmlElement(font, "sz")?.getAttribute("val") ?? 10) * 4 / 3}px`;
      if (firstXmlElement(font, "b") && firstXmlElement(font, "b")?.getAttribute("val") !== "0") result.fontWeight = 700;
      if (firstXmlElement(font, "i") && firstXmlElement(font, "i")?.getAttribute("val") !== "0") result.fontStyle = "italic";
      if (firstXmlElement(font, "u")) result.textDecoration = "underline";
    }
    const fill = fills[Number(xf.getAttribute("fillId") ?? 0)];
    if (fill) result.backgroundColor = cssColor(firstXmlElement(fill, "fgColor")) ?? "#FFFFFF";
    const alignment = firstXmlElement(xf, "alignment");
    const horizontal = alignment?.getAttribute("horizontal");
    if (horizontal && ["left", "right", "center", "justify"].includes(horizontal)) result.textAlign = horizontal as CSSProperties["textAlign"];
    const vertical = alignment?.getAttribute("vertical");
    if (vertical) result.verticalAlign = vertical === "center" ? "middle" : vertical as CSSProperties["verticalAlign"];
    if (alignment?.getAttribute("wrapText") === "1") result.whiteSpace = "normal";
    const border = borders[Number(xf.getAttribute("borderId") ?? 0)];
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      const edge = border && firstXmlElement(border, side.toLowerCase());
      const kind = edge?.getAttribute("style");
      if (kind) result[`border${side}`] = `${kind === "thick" ? 3 : kind === "medium" ? 2 : 1}px ${kind === "double" ? "double" : kind.includes("dash") ? "dashed" : kind === "dotted" ? "dotted" : "solid"} ${cssColor(firstXmlElement(edge!, "color")) ?? "#000000"}`;
    }
    return result;
  });
  const map = new Map<string, CSSProperties>();
  for (const [name, path] of worksheetPaths(files)) {
    if (!files[path]) continue;
    const doc = parseXml(strFromU8(files[path]!), path);
    for (const cell of xmlElements(doc, "c")) {
      map.set(`${name}!${cell.getAttribute("r")}`, formats[Number(cell.getAttribute("s") ?? 0)] ?? {});
    }
  }
  originalStyles.set(workbook, map);
}

function parseXml(xml: string, label: string): XMLDocument {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error(`Il template contiene XML non valido (${label}).`);
  return document;
}

function firstXmlElement(parent: Document | Element, localName: string): Element | null {
  return parent.getElementsByTagNameNS("*", localName)[0] ?? null;
}

function xmlElements(parent: Document | Element, name: string): Element[] {
  const document = parent.nodeType === 9 ? parent as Document : parent.ownerDocument!;
  const walker = document.createTreeWalker(parent, 1);
  const result: Element[] = [];
  let next: Node | null;
  while ((next = walker.nextNode())) if ((next as Element).localName === name) result.push(next as Element);
  return result;
}

function directChildren(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter(child => child.localName === localName);
}

function normalizeZipPath(base: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `${base}/${target}`).split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function worksheetPaths(files: Record<string, Uint8Array>): Map<string, string> {
  const workbookEntry = files["xl/workbook.xml"];
  const relationshipsEntry = files["xl/_rels/workbook.xml.rels"];
  if (!workbookEntry || !relationshipsEntry) throw new Error("Il template XLSX non contiene la struttura workbook richiesta.");
  const workbook = parseXml(strFromU8(workbookEntry), "workbook.xml");
  const relationships = parseXml(strFromU8(relationshipsEntry), "workbook.xml.rels");
  const targets = new Map(Array.from(relationships.getElementsByTagNameNS("*", "Relationship")).map(relationship => [relationship.getAttribute("Id") ?? "", relationship.getAttribute("Target") ?? ""]));
  const result = new Map<string, string>();
  for (const sheet of Array.from(workbook.getElementsByTagNameNS("*", "sheet"))) {
    const name = sheet.getAttribute("name") ?? "";
    const relationId = sheet.getAttributeNS(OOXML_REL_NS, "id") ?? sheet.getAttribute("r:id") ?? "";
    const target = targets.get(relationId);
    if (name && target) result.set(name, normalizeZipPath("xl", target));
  }
  return result;
}

function rowNumber(row: Element): number { return Math.max(1, Number(row.getAttribute("r") ?? "1")); }

function cellCoordinate(reference: string): Coordinate | null {
  try { return parseCellAddress(reference.replace(/\$/g, "")); }
  catch { return null; }
}

function findRow(sheetData: Element, row: number): Element | undefined {
  return directChildren(sheetData, "row").find(candidate => rowNumber(candidate) === row + 1);
}

function findCell(sheetData: Element, row: number, column: number): Element | undefined {
  const rowElement = findRow(sheetData, row);
  const address = cellAddress(row, column);
  return rowElement ? directChildren(rowElement, "c").find(candidate => candidate.getAttribute("r")?.replace(/\$/g, "") === address) : undefined;
}

function copyRowFormat(source: Element | undefined, target: Element): void {
  if (!source) return;
  for (const attribute of Array.from(source.attributes)) {
    if (attribute.name !== "r" && attribute.name !== "spans") target.setAttribute(attribute.name, attribute.value);
  }
}

function ensureRow(document: XMLDocument, sheetData: Element, row: number, templateRow: Element | undefined): Element {
  const existing = findRow(sheetData, row);
  if (existing) return existing;
  const created = document.createElementNS(OOXML_MAIN_NS, "row");
  created.setAttribute("r", String(row + 1));
  copyRowFormat(templateRow, created);
  const next = directChildren(sheetData, "row").find(candidate => rowNumber(candidate) > row + 1);
  sheetData.insertBefore(created, next ?? null);
  return created;
}

function ensureCell(document: XMLDocument, rowElement: Element, row: number, column: number, templateCell: Element | undefined): Element {
  const address = cellAddress(row, column);
  const existing = directChildren(rowElement, "c").find(candidate => candidate.getAttribute("r")?.replace(/\$/g, "") === address);
  if (existing) return existing;
  const created = templateCell ? templateCell.cloneNode(false) as Element : document.createElementNS(OOXML_MAIN_NS, "c");
  created.setAttribute("r", address);
  created.removeAttribute("t");
  const next = directChildren(rowElement, "c").find(candidate => {
    const coordinate = cellCoordinate(candidate.getAttribute("r") ?? "");
    return coordinate ? coordinate.column > column : false;
  });
  rowElement.insertBefore(created, next ?? null);
  return created;
}

function writeOoxmlCell(document: XMLDocument, cell: Element, value: CellValue): void {
  for (const child of Array.from(cell.children)) cell.removeChild(child);
  cell.removeAttribute("t");
  if (value === null) return;
  if (typeof value === "number" && Number.isFinite(value)) {
    cell.setAttribute("t", "n");
    const node = document.createElementNS(OOXML_MAIN_NS, "v"); node.textContent = String(value); cell.appendChild(node);
    return;
  }
  if (typeof value === "boolean") {
    cell.setAttribute("t", "b");
    const node = document.createElementNS(OOXML_MAIN_NS, "v"); node.textContent = value ? "1" : "0"; cell.appendChild(node);
    return;
  }
  cell.setAttribute("t", "inlineStr");
  const inline = document.createElementNS(OOXML_MAIN_NS, "is");
  const text = document.createElementNS(OOXML_MAIN_NS, "t");
  if (String(value).trim() !== String(value)) text.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  text.textContent = String(value); inline.appendChild(text); cell.appendChild(inline);
}

function extendOoxmlDimension(document: XMLDocument): void {
  const worksheet = document.documentElement;
  const sheetData = firstXmlElement(document, "sheetData");
  if (!sheetData) return;
  let minRow = Number.POSITIVE_INFINITY; let minColumn = Number.POSITIVE_INFINITY; let maxRow = 0; let maxColumn = 0;
  for (const cell of xmlElements(sheetData, "c")) {
    const coordinate = cellCoordinate(cell.getAttribute("r") ?? "");
    if (!coordinate) continue;
    minRow = Math.min(minRow, coordinate.row); minColumn = Math.min(minColumn, coordinate.column);
    maxRow = Math.max(maxRow, coordinate.row); maxColumn = Math.max(maxColumn, coordinate.column);
  }
  if (!Number.isFinite(minRow) || !Number.isFinite(minColumn)) return;
  const dimension = firstXmlElement(document, "dimension") ?? document.createElementNS(OOXML_MAIN_NS, "dimension");
  const previous = dimension.getAttribute("ref");
  if (previous) {
    try {
      const old = rangeCoordinates(previous.includes(":") ? previous : `${previous}:${previous}`);
      minRow = Math.min(minRow, old.start.row); minColumn = Math.min(minColumn, old.start.column);
      maxRow = Math.max(maxRow, old.end.row); maxColumn = Math.max(maxColumn, old.end.column);
    } catch { /* Keep the cell-derived dimension when the source ref is malformed. */ }
  }
  dimension.setAttribute("ref", `${cellAddress(minRow, minColumn)}:${cellAddress(maxRow, maxColumn)}`);
  if (!dimension.parentNode) worksheet.insertBefore(dimension, worksheet.firstChild);
}

function applyOoxmlRegion(document: XMLDocument, dataset: ReportDataset, region: ReplicateXlsRegion): void {
  if (region.mode === "static") return;
  ({ dataset, region } = prepareReplicateRegion(dataset, region));
  const sheetData = firstXmlElement(document, "sheetData");
  if (!sheetData) throw new Error(`Il foglio “${region.sheetName}” non contiene dati modificabili.`);
  const { start, end } = rangeCoordinates(region.range);
  const fields = region.fieldIds.map(fieldId => dataset.fields.find(field => field.id === fieldId)).filter((field): field is ReportDataset["fields"][number] => Boolean(field));
  if (!fields.length) return;
  const sourceFormats = sheetData.cloneNode(true) as Element;
  // Remove the old data in the mapped area, including surplus template rows.
  // Keep the original styled cells for extending the new output.
  if (region.mode !== "singleCell") for (const cell of xmlElements(sheetData, "c")) {
    const coordinate = cellCoordinate(cell.getAttribute("r") ?? "");
    if (coordinate && coordinate.row >= start.row && coordinate.row <= end.row && coordinate.column >= start.column && coordinate.column <= end.column) writeOoxmlCell(document, cell, null);
  }
  const write = (row: number, column: number, value: CellValue, styleRow: number, styleColumn: number) => {
    const templateRowIndex = Math.min(end.row, start.row + styleRow);
    const templateColumnIndex = Math.min(end.column, start.column + styleColumn);
    const templateRow = findRow(sourceFormats, templateRowIndex);
    const templateCell = findCell(sourceFormats, templateRowIndex, templateColumnIndex);
    const rowElement = ensureRow(document, sheetData, row, templateRow);
    const cell = ensureCell(document, rowElement, row, column, templateCell);
    if (templateCell && !cell.hasAttribute("s") && templateCell.hasAttribute("s")) cell.setAttribute("s", templateCell.getAttribute("s")!);
    writeOoxmlCell(document, cell, value);
  };
  if (region.mode === "singleCell") {
    if (region.query && region.includeHeaders) { fields.forEach((field, offset) => write(start.row, start.column + offset, field.name, 0, offset)); return; }
    write(start.row, start.column, dataset.rows[0]?.[fields[0]!.id] ?? null, 0, 0);
    return;
  }
  if (region.mode === "tableRows") {
    let rowOffset = 0;
    if (region.includeHeaders) { fields.forEach((field, columnOffset) => write(start.row, start.column + columnOffset, field.name, 0, columnOffset)); rowOffset = 1; }
    dataset.rows.forEach((row, index) => fields.forEach((field, columnOffset) => write(start.row + rowOffset + index, start.column + columnOffset, row[field.id] ?? null, rowOffset + index, columnOffset)));
    return;
  }
  let columnOffset = 0;
  if (region.includeHeaders) { fields.forEach((field, rowOffset) => write(start.row + rowOffset, start.column, field.name, rowOffset, 0)); columnOffset = 1; }
  dataset.rows.forEach((row, index) => fields.forEach((field, rowOffset) => write(start.row + rowOffset, start.column + columnOffset + index, row[field.id] ?? null, rowOffset, columnOffset + index)));
}

function buildOoxmlBytes(config: ReplicateXlsConfig, dataset: ReportDataset): Uint8Array {
  const files = unzipSync(base64ToBytes(config.templateBase64));
  const paths = worksheetPaths(files);
  const documents = new Map<string, XMLDocument>();
  for (const region of config.regions) {
    const path = paths.get(region.sheetName);
    if (!path || !files[path]) throw new Error(`Il foglio “${region.sheetName}” non è disponibile nel template originale.`);
    const document = documents.get(path) ?? parseXml(strFromU8(files[path]!), path);
    applyOoxmlRegion(document, dataset, region);
    documents.set(path, document);
  }
  for (const [path, document] of documents) {
    extendOoxmlDimension(document);
    files[path] = strToU8(new XMLSerializer().serializeToString(document));
  }
  return zipSync(files, { level: 6 });
}

export async function buildReplicatedWorkbookBytes(config: ReplicateXlsConfig, dataset: ReportDataset): Promise<Uint8Array> {
  if (config.templateFormat === "xlsx" || config.templateFormat === "xlsm") return buildOoxmlBytes(config, dataset);
  const XLSX = await import("xlsx");
  const workbook = await buildReplicatedWorkbookWithSheetJs(config, dataset);
  const bookType: BookType = config.templateFormat === "xls" ? "biff8" : config.templateFormat;
  const written = XLSX.write(workbook, { type: "array", bookType, cellStyles: true });
  return written instanceof Uint8Array ? written : new Uint8Array(written as ArrayBuffer);
}

export async function buildReplicatedWorkbook(config: ReplicateXlsConfig, dataset: ReportDataset): Promise<WorkBook> {
  return readWorkbook(await buildReplicatedWorkbookBytes(config, dataset));
}

function outputExtension(config: ReplicateXlsConfig): ReplicateXlsConfig["templateFormat"] { return config.templateFormat; }

export async function downloadReplicatedWorkbook(config: ReplicateXlsConfig, dataset: ReportDataset): Promise<boolean> {
  const extension = outputExtension(config);
  const bytes = await buildReplicatedWorkbookBytes(config, dataset);
  const stem = config.templateName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-") || "report";
  const fileName = `${stem}-replicato.${extension}`;
  const { isTauri, invoke } = await import("@tauri-apps/api/core");
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: fileName, filters: [{ name: "Excel report", extensions: [extension] }] });
    if (!path) return false;
    await invoke("write_report_workbook", { path, bytes: Array.from(bytes) });
    return true;
  }
  const blobBytes = new Uint8Array(bytes.byteLength); blobBytes.set(bytes);
  const url = URL.createObjectURL(new Blob([blobBytes.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
