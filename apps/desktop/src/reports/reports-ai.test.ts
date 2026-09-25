import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportDataset } from "./types";

const runtime = vi.hoisted(() => ({
  status: vi.fn(),
  answer: vi.fn(),
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

  it("uses an available API provider when Studio is currently set to local", async () => {
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
    expect(result.provider).toBe("openai");
    expect(runtime.answer).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ provider: "openai" }));
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
