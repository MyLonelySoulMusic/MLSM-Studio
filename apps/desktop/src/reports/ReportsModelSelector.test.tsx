import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReportsModelSelector } from "./ReportsModelSelector";
import { loadReportsAiSettings, saveReportsAiSettings } from "./reports-ai";
import { MLSM_FORMULA_GUIDE, MLSM_FORMULA_GUIDE_IT } from "./calculated-fields";
vi.mock("../services/studio-settings", () => ({
  providerLabels: { openai: "OpenAI", nvidia: "NVIDIA" },
  getLlmSettings: vi.fn().mockResolvedValue({ activeProvider: "openai", providers: {
    openai: { configured: true, enabled: true, model: "model-a" },
    nvidia: { configured: true, enabled: true, model: "model-b" },
  } }), requestRemoteAnswer: vi.fn(),
}));
beforeEach(() => localStorage.clear());
afterEach(cleanup);
it("offers local and each configured API and remembers choices separately", async () => {
  render(<><ReportsModelSelector task="formula" language="en" /><ReportsModelSelector task="replicate" language="en" /></>);
  expect(await screen.findAllByRole("option", { name: "API · NVIDIA · model-b" })).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Calculated-field AI model"), { target: { value: "local" } });
  fireEvent.change(screen.getByLabelText("Report replication AI model"), { target: { value: "nvidia" } });
  expect(loadReportsAiSettings()).toMatchObject({ formulaProvider: "local", replicateProvider: "nvidia" });
});
it("migrates the existing Reports provider into both assistants", () => {
  saveReportsAiSettings({ enabled: true, provider: "openai" });
  expect(loadReportsAiSettings()).toMatchObject({ formulaProvider: "openai", replicateProvider: "openai" });
});
it("documents the language without product inspiration claims", () => {
  expect(MLSM_FORMULA_GUIDE + MLSM_FORMULA_GUIDE_IT).not.toMatch(/tableau|inspired|ispirat/i);
  expect(MLSM_FORMULA_GUIDE).toContain("SUM");
});
