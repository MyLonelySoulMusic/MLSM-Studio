import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportDataset } from "./types";

const runtime = vi.hoisted(() => ({
  status: vi.fn(),
  answer: vi.fn(),
  local: vi.fn(),
  generator: vi.fn(),
}));

vi.mock("../services/local-model-runtime", () => ({
  preferredLocalAssistantModel: "qwen-test", preferredLocalAssistantLabel: "Qwen local",
  getLocalTextGenerator: runtime.generator,
  runLocalTextGeneration: runtime.local,
  localGeneratedAnswer: (output: string) => output,
}));

vi.mock("../services/studio-settings", () => ({
  providerLabels: { nvidia: "NVIDIA", openai: "OpenAI", gemini: "Google Gemini", xai: "xAI / Grok" },
  getLlmSettings: runtime.status,
  requestRemoteAnswer: runtime.answer,
}));

import { saveReportsAiSettings, suggestCalculatedField, suggestReplicateXlsModel } from "./reports-ai";

const dataset: ReportDataset = {
  id: "sales", name: "Sales", sourceName: "sales.csv",
  sources: [{ id: "source-sales", fileName: "sales.csv", sheetName: "Sales", importedAt: "2026-01-01T00:00:00.000Z", rowCount: 1 }],
  fields: [{ id: "revenue", name: "Revenue", type: "number" }, { id: "customer", name: "Customer", type: "text" }],
  rows: [{ revenue: 100, customer: "A" }],
};

describe("Reports calculated-field LLM assistant", () => {
  beforeEach(() => {
    localStorage.clear();
    runtime.status.mockReset();
    runtime.answer.mockReset();
    runtime.generator.mockReset().mockResolvedValue(() => undefined);
    runtime.local.mockReset().mockResolvedValue('{"name":"Total","formula":"SUM([Revenue])","description":"Aggregate sum."}');
    runtime.status.mockResolvedValue({
      activeProvider: "openai",
      providers: {
        openai: { provider: "openai", configured: true, enabled: true, model: "gpt-test", keySource: "settings", endpoint: "" },
        nvidia: { provider: "nvidia", configured: false, enabled: false, model: "", keySource: "none", endpoint: "" },
        gemini: { provider: "gemini", configured: false, enabled: false, model: "", keySource: "none", endpoint: "" },
        xai: { provider: "xai", configured: false, enabled: false, model: "", keySource: "none", endpoint: "" },
      },
    });
    runtime.answer.mockResolvedValue({ source: "openai", model: "gpt-test", content: '{"name":"Revenue per customer","formula":"SUM([Revenue]) / COUNTD([Customer])","description":"Aggregate ratio."}' });
  });

  it("passes the complete MLSM Formula knowledge base and validates the generated formula", async () => {
    saveReportsAiSettings({ enabled: true, provider: "openai" });
    const result = await suggestCalculatedField("Revenue for each distinct customer", dataset, "en");

    expect(result.formula).toBe("SUM([Revenue]) / COUNTD([Customer])");
    expect(runtime.answer).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "system", content: expect.stringContaining("AGGREGATE FUNCTIONS") }),
      expect.objectContaining({ role: "user", content: expect.stringContaining('"name":"Revenue"') }),
    ]), expect.objectContaining({ provider: "openai" }));
  });

  it("refuses AI generation when the Reports assistant is disabled", async () => {
    saveReportsAiSettings({ enabled: false, provider: "openai" });
    await expect(suggestCalculatedField("Total revenue", dataset, "en")).rejects.toThrow(/Enable the formula assistant/);
    expect(runtime.answer).not.toHaveBeenCalled();
  });

  it("honors Studio local selection without sending requests to an API", async () => {
    saveReportsAiSettings({ enabled: true, provider: "" });
    runtime.status.mockResolvedValue({
      activeProvider: "local",
      providers: {
        openai: { provider: "openai", configured: true, enabled: true, model: "gpt-test", keySource: "settings", endpoint: "" },
        nvidia: { provider: "nvidia", configured: false, enabled: false, model: "", keySource: "none", endpoint: "" },
        gemini: { provider: "gemini", configured: false, enabled: false, model: "", keySource: "none", endpoint: "" },
        xai: { provider: "xai", configured: false, enabled: false, model: "", keySource: "none", endpoint: "" },
      },
    });
    const result = await suggestCalculatedField("Total revenue", dataset, "en");
    expect(result.provider).toBe("local");
    expect(runtime.answer).not.toHaveBeenCalled();
    expect(runtime.local).toHaveBeenCalledOnce();
  });

  it("uses an explicit local choice without requiring API settings", async () => {
    saveReportsAiSettings({ enabled: true, provider: "", formulaProvider: "local" });
    runtime.status.mockRejectedValue(new Error("API service unavailable"));
    expect((await suggestCalculatedField("Total", dataset, "en")).provider).toBe("local");
    expect(runtime.status).not.toHaveBeenCalled();
    expect(runtime.answer).not.toHaveBeenCalled();
  });

  it("never silently replaces an unavailable explicit API provider", async () => {
    saveReportsAiSettings({ enabled: true, provider: "", formulaProvider: "nvidia" });
    await expect(suggestCalculatedField("Total", dataset, "en")).rejects.toThrow();
    expect(runtime.answer).not.toHaveBeenCalled();
    expect(runtime.local).not.toHaveBeenCalled();
  });

  it("keeps formula and replication providers independent", async () => {
    saveReportsAiSettings({ enabled: true, provider: "", formulaProvider: "openai", replicateProvider: "local" });
    expect((await suggestCalculatedField("Total", dataset, "en")).provider).toBe("openai");
    runtime.local.mockResolvedValue(JSON.stringify({ summary: "Local report", regions: [{ sheetName: "Report", range: "A2", label: "Data", description: "Rows", mode: "tableRows", fieldIds: ["revenue"], includeHeaders: false }] }));
    const result = await suggestReplicateXlsModel({ fileName: "report.xlsx", format: "xlsx", sheets: [{ name: "Report", range: "A1:A2", merges: [], populatedCells: 1, sampleCells: [] }] }, dataset, "en");
    expect(result.provider).toBe("local");
    expect(result.regions).toHaveLength(1);
    expect(runtime.answer).toHaveBeenCalledOnce();
    expect(runtime.local).toHaveBeenCalledOnce();
  });

  it("turns the workbook analysis into validated editable Replicate XLS regions", async () => {
    saveReportsAiSettings({ enabled: true, provider: "openai" });
    runtime.answer.mockResolvedValue({ source: "openai", model: "gpt-test", content: JSON.stringify({
      summary: "Rows are metrics and new records continue to the right.",
      regions: [{ sheetName: "Report", range: "B4:C8", label: "Sales", description: "Add one column for every record.", mode: "tableColumns", fieldIds: ["customer", "revenue"], includeHeaders: true }],
    }) });
    const result = await suggestReplicateXlsModel({ fileName: "report.xlsx", format: "xlsx", sheets: [{ name: "Report", range: "A1:C8", merges: [], populatedCells: 5, sampleCells: [{ address: "A1", value: "Report" }] }] }, dataset, "en");
    expect(result.summary).toContain("continue to the right");
    expect(result.regions[0]).toMatchObject({ sheetName: "Report", range: "B4:C8", mode: "tableColumns", fieldIds: ["customer", "revenue"] });
    expect(runtime.answer).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining("tableColumns") })]), expect.objectContaining({ provider: "openai" }));
  });
});
