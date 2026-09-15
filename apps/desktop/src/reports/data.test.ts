import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { appendDatasetSource, createDemoDashboard, importReportFile, parseTextDataset, reconcileReplacementDataset, removeDatasetSource, replaceDatasetSource, REPORT_LIMITS, selectReplacementDataset } from "./data";
import { createCalculatedField } from "./calculated-fields";

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

  it("replaces a dataset while preserving linked field IDs across reordered or missing columns", () => {
    const previous = parseTextDataset("Canale,Data,Ricavi,Interazioni\nSocial,2026-01-01,10,3", "precedente.csv");
    const incoming = parseTextDataset("Ricavi,Canale,Regione\n25,Social,Europa", "aggiornato.csv");

    const result = reconcileReplacementDataset(previous, incoming, ["field-1", "field-2", "field-3"]);

    expect(result).toMatchObject({ matchedFields: 2, addedFields: 1, preservedMissingFields: 1 });
    expect(result.dataset.id).toBe(previous.id);
    expect(result.dataset.sourceName).toBe("aggiornato.csv");
    expect(result.dataset.fields).toEqual([
      { id: "field-3", name: "Ricavi", type: "number" },
      { id: "field-1", name: "Canale", type: "text" },
      { id: "field-5", name: "Regione", type: "text" },
      { id: "field-2", name: "Data", type: "date" },
    ]);
    expect(result.dataset.rows[0]).toEqual({ "field-3": 25, "field-1": "Social", "field-5": "Europa", "field-2": null });
  });

  it("keeps and recalculates calculated fields when their source file is replaced", () => {
    const physical = parseTextDataset("Revenue,Units\n100,10", "old.csv");
    const previous = createCalculatedField(physical, { id: "unit-price", name: "Unit price", formula: "[Revenue] / [Units]" });
    const incoming = parseTextDataset("Units,Revenue\n20,500", "new.csv");
    const result = reconcileReplacementDataset(previous, incoming, previous.fields.map(field => field.id));

    expect(result.dataset.fields.at(-1)).toMatchObject({ id: "unit-price", calculated: { formula: "[Revenue] / [Units]" } });
    expect(result.dataset.rows[0]?.["unit-price"]).toBe(25);
  });

  it("appends files with the same columns while preserving stable field IDs and source order", () => {
    const previous = parseTextDataset("Date,Region,Revenue\n2026-01-01,EU,10", "january.csv");
    const incoming = parseTextDataset("Revenue,Region,Date\n20,US,2026-02-01\n30,EU,2026-02-02", "february.csv");

    const result = appendDatasetSource(previous, incoming);

    expect(result.dataset.id).toBe(previous.id);
    expect(result.dataset.fields).toEqual(previous.fields);
    expect(result.dataset.sources.map(source => [source.fileName, source.rowCount])).toEqual([
      ["january.csv", 1], ["february.csv", 2],
    ]);
    expect(result.dataset.rows).toEqual([
      { "field-1": "2026-01-01", "field-2": "EU", "field-3": 10 },
      { "field-1": "2026-02-01", "field-2": "US", "field-3": 20 },
      { "field-1": "2026-02-02", "field-2": "EU", "field-3": 30 },
    ]);
  });

  it("rejects duplicate filenames and files whose physical columns do not match", () => {
    const previous = parseTextDataset("Date,Region,Revenue\n2026-01-01,EU,10", "sales.csv");
    const duplicate = parseTextDataset("Date,Region,Revenue\n2026-02-01,US,20", " SALES.CSV ");
    const incompatible = parseTextDataset("Date,Region,Units\n2026-02-01,US,2", "units.csv");

    expect(() => appendDatasetSource(previous, duplicate)).toThrow(/già presente/);
    expect(() => appendDatasetSource(previous, incompatible)).toThrow(/stesse colonne.*mancanti: Revenue.*in più: Units/);
  });

  it("replaces and removes a single file without touching rows from the other files", () => {
    const january = parseTextDataset("Date,Region,Revenue\n2026-01-01,EU,10", "january.csv");
    const february = parseTextDataset("Date,Region,Revenue\n2026-02-01,US,20\n2026-02-02,EU,30", "february.csv");
    const combined = appendDatasetSource(january, february).dataset;
    const februarySourceId = combined.sources[1]!.id;
    const replacement = parseTextDataset("Region,Revenue,Date\nAPAC,40,2026-03-01", "march.csv");

    const replaced = replaceDatasetSource(combined, februarySourceId, replacement).dataset;
    expect(replaced.sources.map(source => [source.id, source.fileName, source.rowCount])).toEqual([
      [combined.sources[0]!.id, "january.csv", 1], [februarySourceId, "march.csv", 1],
    ]);
    expect(replaced.rows).toEqual([
      { "field-1": "2026-01-01", "field-2": "EU", "field-3": 10 },
      { "field-1": "2026-03-01", "field-2": "APAC", "field-3": 40 },
    ]);

    const removed = removeDatasetSource(replaced, replaced.sources[0]!.id);
    expect(removed.sources.map(source => source.fileName)).toEqual(["march.csv"]);
    expect(removed.rows).toEqual([{ "field-1": "2026-03-01", "field-2": "APAC", "field-3": 40 }]);
    expect(() => removeDatasetSource(removed, removed.sources[0]!.id)).toThrow(/ultimo file/);
  });

  it("recalculates row and aggregate calculated fields after source mutations", () => {
    const base = parseTextDataset("Revenue,Units\n100,10", "base.csv");
    const withRowFormula = createCalculatedField(base, { id: "unit-price", name: "Unit price", formula: "[Revenue] / [Units]" });
    const incoming = parseTextDataset("Units,Revenue\n20,500", "more.csv");

    const appended = appendDatasetSource(withRowFormula, incoming).dataset;
    expect(appended.rows.map(row => row["unit-price"])).toEqual([10, 25]);

    const replacement = parseTextDataset("Revenue,Units\n900,30", "replacement.csv");
    const replaced = replaceDatasetSource(appended, appended.sources[1]!.id, replacement).dataset;
    expect(replaced.rows.map(row => row["unit-price"])).toEqual([10, 30]);
  });

  it("selects the matching Excel sheet when a file contains multiple datasets", () => {
    const previous = parseTextDataset("Canale,Ricavi\nSocial,10", "precedente.csv");
    previous.name = "Vendite";
    const other = { ...parseTextDataset("Nome\nAnna", "report.xlsx"), name: "Contatti" };
    const matching = { ...parseTextDataset("Canale,Ricavi\nSocial,20", "report.xlsx"), name: "vendite" };

    expect(selectReplacementDataset(previous, [other, matching])).toBe(matching);
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
