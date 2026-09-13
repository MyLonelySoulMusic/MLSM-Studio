import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { createDemoDashboard, importReportFile, parseTextDataset, REPORT_LIMITS } from "./data";

describe("Reports file import", () => {
  it("reads semicolon CSV, Italian decimals, quoted multiline values, dates and codes losslessly", () => {
    const dataset = parseTextDataset('\uFEFFCodice;Ricavi;Data;Attivo;Note\r\n001;"1.234,56";2026-06-01;true;"Prima riga\nSeconda; riga"\r\n002;12,5;2026-07-01;false;"Dice ""ciao"""', "vendite.csv");
    expect(dataset.fields.map(field => field.type)).toEqual(["text", "number", "date", "boolean", "text"]);
    expect(dataset.rows).toEqual([
      { "field-1": "001", "field-2": 1234.56, "field-3": "2026-06-01", "field-4": true, "field-5": "Prima riga\nSeconda; riga" },
      { "field-1": "002", "field-2": 12.5, "field-3": "2026-07-01", "field-4": false, "field-5": 'Dice "ciao"' },
    ]);
  });

  it("assigns unique field names and preserves missing cells as null", () => {
    const dataset = parseTextDataset("Nome,,Nome,Nome (2)\nAnna,5,Rossi,Italia\nLuca,,Verdi", "anagrafica.csv");
    expect(new Set(dataset.fields.map(field => field.name)).size).toBe(4);
    expect(dataset.fields[1]!.name).toBe("Campo 2");
    expect(dataset.rows[1]).toEqual({ "field-1": "Luca", "field-2": null, "field-3": "Verdi", "field-4": null });
  });

  it("supports TSV, a one-column CSV and plain text without losing its first line", () => {
    expect(parseTextDataset("Canale\tVisite\nSocial\t125", "visite.tsv").rows[0]).toEqual({ "field-1": "Social", "field-2": 125 });
    expect(parseTextDataset("Email\nanna@example.it\nluca@example.it", "contatti.csv").rows).toHaveLength(2);
    const text = parseTextDataset('"Nota aperta\nUna seconda riga\n\n123', "note.txt");
    expect(text.fields).toEqual([{ id: "field-1", name: "Testo", type: "text" }]);
    expect(text.rows).toEqual([{ "field-1": '"Nota aperta' }, { "field-1": "Una seconda riga" }, { "field-1": "123" }]);
  });

  it("keeps mixed columns, unsafe integers and invalid dates as text", () => {
    const dataset = parseTextDataset("Valore,Identificativo,Data\n12,9007199254740993,2026-02-30\nnon disponibile,9007199254740995,2026-02-01", "dati.csv");
    expect(dataset.fields.map(field => field.type)).toEqual(["text", "text", "text"]);
    expect(dataset.rows[0]).toEqual({ "field-1": "12", "field-2": "9007199254740993", "field-3": "2026-02-30" });
  });

  it("does not execute spreadsheet-like formulas from text", () => {
    const dataset = parseTextDataset('Nota\n"=HYPERLINK(""https://example.test"",""Apri"")"', "formule.csv");
    expect(dataset.rows[0]?.["field-1"]).toBe('=HYPERLINK("https://example.test","Apri")');
  });

  it("rejects malformed input and oversized tables without silently truncating", () => {
    expect(() => parseTextDataset("   ", "vuoto.csv")).toThrow(/vuoto/);
    expect(() => parseTextDataset("A,B\n1,2,3\n4,5,6", "colonne.csv")).toThrow(/più colonne/);
    expect(() => parseTextDataset('A,B\n1,"testo non chiuso', "virgolette.csv")).toThrow(/virgolette/);
    expect(() => parseTextDataset(`A\n${"1\n".repeat(REPORT_LIMITS.rows + 1)}`, "troppo.csv")).toThrow(/50.000 righe/);
  });

  it("reads legacy text encoding and rejects unsupported extensions", async () => {
    const file = new File([new Uint8Array([0x4e, 0x6f, 0x6d, 0x65, 0x0a, 0x63, 0x61, 0x66, 0x66, 0xe8])], "nomi.csv");
    expect((await importReportFile(file))[0]!.rows[0]?.["field-1"]).toBe("caffè");
    await expect(importReportFile(new File(["dati"], "dati.pdf"))).rejects.toThrow(/Formato non supportato/);
  });

  it("imports all populated Excel sheets, native dates and cached formula results", async () => {
    const workbook = XLSX.utils.book_new();
    const sales = XLSX.utils.aoa_to_sheet([["Data", "Ricavi"], [new Date("2026-06-01T00:00:00Z"), 1250]]);
    sales.B2 = { t: "n", f: "1000+250", v: 1250 };
    XLSX.utils.book_append_sheet(workbook, sales, "Vendite");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Codice", "Canale"], ["001", "Social"]]), "Canali");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Vuoto");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const datasets = await importReportFile(new File([bytes], "report.xlsx"));
    expect(datasets.map(dataset => dataset.name)).toEqual(["Vendite", "Canali"]);
    expect(datasets[0]!.fields.map(field => field.type)).toEqual(["date", "number"]);
    expect(datasets[0]!.rows[0]).toEqual({ "field-1": "2026-06-01T00:00:00.000Z", "field-2": 1250 });
    expect(datasets[1]!.rows[0]).toEqual({ "field-1": "001", "field-2": "Social" });
  });

  it("rejects an Excel sheet with an oversized declared range", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["A"], [1]]);
    sheet["!ref"] = "A1:CV50002";
    XLSX.utils.book_append_sheet(workbook, sheet, "Troppo grande");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    await expect(importReportFile(new File([bytes], "grande.xlsx"))).rejects.toThrow(/supera i limiti/);
  });

  it("creates a ready-to-edit demo using the MLSM palette and real embedded example data", () => {
    const dashboard = createDemoDashboard();
    expect(dashboard.theme).toEqual({ accent: "#FF4F9A", ink: "#211B1F", paper: "#FFFFFF" });
    expect(dashboard.widgets).toHaveLength(5);
    expect(dashboard.datasets[0]!.rows).toHaveLength(18);
    expect(dashboard.widgets.every(widget => widget.datasetId === dashboard.datasets[0]!.id)).toBe(true);
  });

  it("creates English demo content when English is active", () => {
    const dashboard = createDemoDashboard("en");
    expect(dashboard.name).toBe("MLSM · Audience & growth");
    expect(dashboard.datasets[0]!.name).toBe("Channel performance");
    expect(dashboard.datasets[0]!.fields.map(field => field.name)).toEqual(["Month", "Channel", "Views", "Interactions", "Revenue"]);
    expect(dashboard.widgets.map(widget => widget.title)).toContain("Total views");
  });
});
