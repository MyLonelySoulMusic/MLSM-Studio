import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { ReplicateXlsModal } from "./ReplicateXlsModal";
import { createWidget, type ReportDataset, type ReplicateXlsConfig } from "./types";
const mocks = vi.hoisted(() => ({ suggest: vi.fn(), inspect: vi.fn(), build: vi.fn() }));
vi.mock("./reports-ai", async () => ({ ...await vi.importActual<typeof import("./reports-ai")>("./reports-ai"), suggestReplicateXlsModel: mocks.suggest }));
vi.mock("../services/studio-settings", () => ({ providerLabels: { openai: "OpenAI" }, getLlmSettings: vi.fn().mockResolvedValue({ activeProvider: "local", providers: {} }), requestRemoteAnswer: vi.fn() }));
vi.mock("./replicate-xls", async () => ({ ...await vi.importActual<typeof import("./replicate-xls")>("./replicate-xls"), inspectStoredReplicateXlsTemplate: mocks.inspect, buildReplicatedWorkbook: mocks.build }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("Replicate XLS automatic analysis", () => {
  it("analyzes an unfinished template immediately and tests the returned model", async () => {
    const dataset: ReportDataset = { id: "d", name: "results", sourceName: "results.csv", sources: [], fields: [{ id: "value", name: "Quantity", type: "number" }], rows: [{ value: 123 }] };
    const config: ReplicateXlsConfig = { templateName: "test_report.xlsx", templateFormat: "xlsx", templateBase64: "eA==", sheetName: "Report", selectedRange: "A1:A1", regions: [], aiSummary: "", aiProvider: "", aiModel: "", correctionNotes: "", lastTestedAt: null };
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Quantity"], [123]]), "Report");
    mocks.inspect.mockResolvedValue({ workbook, summary: { fileName: config.templateName, sheets: [] } });
    mocks.suggest.mockResolvedValue({ summary: "Quantity by date", regions: [{ id: "r", sheetName: "Report", range: "A2:A2", fieldIds: ["value"], includeHeaders: false, mode: "tableRows", label: "Data", description: "Rows" }], provider: "nvidia", model: "test" });
    mocks.build.mockResolvedValue(workbook);
    const widget = { ...createWidget("replicateXls", dataset), replicateXls: config };
    render(<ReplicateXlsModal widget={widget} dataset={dataset} language="en" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(mocks.suggest).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.build).toHaveBeenCalledOnce());
    expect(await screen.findByText("Quantity by date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save model" })).toBeEnabled();
    expect(screen.getByText("test_report.xlsx")).toBeInTheDocument();
  });
});
