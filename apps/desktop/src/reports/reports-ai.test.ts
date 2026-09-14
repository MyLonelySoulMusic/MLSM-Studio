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

import { saveReportsAiSettings, suggestCalculatedField } from "./reports-ai";

const dataset: ReportDataset = {
  id: "sales", name: "Sales", sourceName: "sales.csv",
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
});
