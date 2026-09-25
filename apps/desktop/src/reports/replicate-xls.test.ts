import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import * as XLSX from "xlsx";
import { buildReplicatedWorkbook, buildReplicatedWorkbookBytes, normalizeCellRange, selectionRange } from "./replicate-xls";
import type { ReportDataset, ReplicateXlsConfig } from "./types";

const dataset: ReportDataset = {
  id: "sales", name: "Sales", sourceName: "sales.csv",
  fields: [{ id: "country", name: "Country", type: "text" }, { id: "revenue", name: "Revenue", type: "number" }],
  rows: [{ country: "IT", revenue: 12 }, { country: "US", revenue: 35 }],
  sources: [{ id: "source", fileName: "sales.csv", sheetName: "Sales", importedAt: "2026-01-01T00:00:00.000Z", rowCount: 2 }],
};

function templateBase64(): string {
  const sheet = XLSX.utils.aoa_to_sheet([["Report"], [], ["Country", "Revenue"]]);
  sheet.A1!.s = { font: { bold: true, color: { rgb: "FFFF4F9A" } } };
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "Report");
  const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true }));
  let binary = ""; for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function styledTemplateBase64(): string {
  const raw = Uint8Array.from(atob(templateBase64()), character => character.charCodeAt(0));
  const files = unzipSync(raw);
  files["xl/styles.xml"] = strToU8(strFromU8(files["xl/styles.xml"]!).replace("</styleSheet>", "<!--preserve-colors-fonts-borders-FF4F9A--></styleSheet>"));
  files["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]!).replace(/(<c\s+r="[AB]3")/g, '$1 s="0"'));
  const bytes = zipSync(files);
  let binary = ""; for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function config(mode: "tableRows" | "tableColumns"): ReplicateXlsConfig {
  return { templateName: "template.xlsx", templateFormat: "xlsx", templateBase64: templateBase64(), sheetName: "Report", selectedRange: "A3:B3", aiSummary: "", aiProvider: "", aiModel: "", correctionNotes: "", lastTestedAt: null,
    regions: [{ id: "region", sheetName: "Report", range: "A3:B3", label: "Sales", description: "Populate sales", mode, fieldIds: ["country", "revenue"], includeHeaders: true }] };
}

describe("Replicate XLS", () => {
  it("normalizes cell selections in every drag direction", () => {
    expect(normalizeCellRange("D9:B2")).toBe("B2:D9");
    expect(selectionRange({ row: 4, column: 2 }, { row: 1, column: 0 })).toBe("A2:C5");
  });

  it("extends a template by rows while leaving static cells in place", async () => {
    const workbook = await buildReplicatedWorkbook(config("tableRows"), dataset);
    const sheet = workbook.Sheets.Report!;
    expect(sheet.A1?.v).toBe("Report");
    expect(sheet.A3?.v).toBe("Country"); expect(sheet.B3?.v).toBe("Revenue");
    expect(sheet.A4?.v).toBe("IT"); expect(sheet.B5?.v).toBe(35);
  });

  it("continues the report by adding one column for each new record", async () => {
    const workbook = await buildReplicatedWorkbook(config("tableColumns"), dataset);
    const sheet = workbook.Sheets.Report!;
    expect(sheet.A3?.v).toBe("Country"); expect(sheet.A4?.v).toBe("Revenue");
    expect(sheet.B3?.v).toBe("IT"); expect(sheet.B4?.v).toBe(12);
    expect(sheet.C3?.v).toBe("US"); expect(sheet.C4?.v).toBe(35);
    expect(sheet["!ref"]).toContain("C4");
  });

  it("updates XLSX cells without rebuilding or losing the original formatting package", async () => {
    const value = config("tableRows");
    value.templateBase64 = styledTemplateBase64();
    const original = unzipSync(Uint8Array.from(atob(value.templateBase64), character => character.charCodeAt(0)));
    const output = unzipSync(await buildReplicatedWorkbookBytes(value, dataset));

    expect(strFromU8(output["xl/styles.xml"]!)).toBe(strFromU8(original["xl/styles.xml"]!));
    expect(strFromU8(output["xl/styles.xml"]!)).toContain("preserve-colors-fonts-borders-FF4F9A");
    const sheet = new DOMParser().parseFromString(strFromU8(output["xl/worksheets/sheet1.xml"]!), "application/xml");
    const cells = new Map(Array.from(sheet.getElementsByTagNameNS("*", "c")).map(cell => [cell.getAttribute("r"), cell]));
    expect(cells.get("A4")?.getAttribute("s")).toBe("0");
    expect(cells.get("B5")?.getAttribute("s")).toBe("0");
  });
});
