import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getLlmSettings, settingsRequest, clearCacheEntry, scanInstallation, readAllServiceStatuses, testServiceCycle } = vi.hoisted(() => ({ getLlmSettings: vi.fn(async () => ({
  activeProvider: "nvidia" as const,
  providers: {
    nvidia: { configured: true, enabled: true, model: "moonshotai/kimi-k3", keySource: "environment" as const, endpoint: "https://integrate.api.nvidia.com/v1/chat/completions", provider: "nvidia" as const },
    openai: { configured: false, enabled: true, model: "gpt-5.6-terra", keySource: "none" as const, endpoint: "https://api.openai.com/v1/chat/completions", provider: "openai" as const },
    gemini: { configured: false, enabled: true, model: "gemini-3.8-flash", keySource: "none" as const, endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", provider: "gemini" as const },
    xai: { configured: false, enabled: true, model: "grok-4.6", keySource: "none" as const, endpoint: "https://api.x.ai/v1/chat/completions", provider: "xai" as const },
  },
})), settingsRequest: vi.fn(), clearCacheEntry: vi.fn<(entry: unknown) => Promise<void>>().mockResolvedValue(undefined),
  scanInstallation: vi.fn(async () => ({ ok: false, platform: "darwin", arch: "arm64", checks: { node: { ok: true, detail: "v22.12.0" }, python311: { ok: false, detail: "Python 3.11 non disponibile" } } })),
  readAllServiceStatuses: vi.fn(async () => [
    { id: "upscaler", running: false, compatible: false, detail: "Endpoint arrestato" },
    { id: "quantizer", running: true, compatible: true, detail: "Motore audio interno pronto" },
    { id: "autopost", running: true, compatible: true, detail: "Endpoint pronto" },
  ]),
  testServiceCycle: vi.fn(async () => []),
}));

vi.mock("../services/ui-preferences", () => ({ useUiPreferences: () => ({ language: "it" }) }));
vi.mock("../services/task-history", () => ({
  TASK_HISTORY_EVENT: "mlsm:test-history",
  clearTaskHistory: vi.fn(),
  hasActiveTasks: vi.fn(() => false),
  readTaskHistory: vi.fn(() => []),
}));
vi.mock("../services/cache-inventory", () => ({
  clearCacheEntry,
  listBrowserCaches: vi.fn(async () => []),
  listDiskCaches: vi.fn(async () => [{ id: "upscaler-local", label: "Upscaler / Frame Booster temporary video", location: "/temp/upscaler", bytes: 12, kind: "disk" }]),
}));
vi.mock("../services/studio-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/studio-settings")>();
  return { ...actual, getLlmSettings, saveLlmSettings: vi.fn(), settingsRequest };
});
vi.mock("../services/system-restore", () => ({
  scanInstallation,
  readAllServiceStatuses,
  readRepairJob: vi.fn(),
  restartStudio: vi.fn(),
  setAllServicesRunning: vi.fn(async () => []),
  setServiceRunning: vi.fn(),
  startRepair: vi.fn(),
  testServiceCycle,
}));

import { StudioSettings } from "./StudioSettings";

function openSettings() {
  render(<StudioSettings />);
  fireEvent(window, new Event("mlsm:open-settings"));
}

describe("StudioSettings", () => {
  afterEach(() => {
    cleanup();
    clearCacheEntry.mockClear();
    settingsRequest.mockReset();
    scanInstallation.mockClear();
    readAllServiceStatuses.mockClear();
    testServiceCycle.mockClear();
  });

  it("mostra esito, modello, latenza ed errore del test di connessione", async () => {
    settingsRequest.mockResolvedValueOnce({ ok: true, model: "nvidia/nemotron-3-super-120b-a12b" });
    openSettings();
    await screen.findByRole("dialog", { name: "Impostazioni" });
    fireEvent.change(screen.getByRole("combobox", { name: "Modello LLM" }), { target: { value: "nvidia/nemotron-3-super-120b-a12b" } });
    fireEvent.click(screen.getByRole("button", { name: "Verifica connessione" }));
    expect(await screen.findByText(/Connessione OK · risposta in \d+ ms/)).toBeInTheDocument();
    expect(screen.getByText("NVIDIA · nvidia/nemotron-3-super-120b-a12b")).toBeInTheDocument();
    expect(settingsRequest).toHaveBeenCalledWith(expect.objectContaining({ action: "test", provider: "nvidia", model: "nvidia/nemotron-3-super-120b-a12b" }));

    settingsRequest.mockRejectedValueOnce(new Error("nvidia HTTP 401"));
    fireEvent.click(screen.getByRole("button", { name: "Verifica connessione" }));
    expect(await screen.findByText(/Connessione fallita · nvidia HTTP 401 · \d+ ms/)).toBeInTheDocument();
  });

  it("separa Lonely Bot dalle API future e usa cataloghi LLM selezionabili", async () => {
    openSettings();
    expect(await screen.findByRole("dialog", { name: "Impostazioni" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "LLM · Lonely Bot" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "API · altre funzioni" })).toBeInTheDocument();
    expect(screen.getByText("Nessuna integrazione aggiuntiva disponibile al momento.")).toBeInTheDocument();

    const model = screen.getByRole("combobox", { name: "Modello LLM" });
    expect(model).toHaveValue("moonshotai/kimi-k3");
    expect(screen.getByRole("option", { name: /Nemotron 3.5 Lightning/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Llama 3.3/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /OpenAI/ }));
    expect(model).toHaveValue("gpt-5.6-terra");
    expect(screen.getByRole("option", { name: /GPT-6 Astra/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Modello LLM" })).not.toBeInTheDocument();
  });

  it("conferma e inoltra la pulizia della cache Upscaler", async () => {
    openSettings();
    await screen.findByRole("dialog", { name: "Impostazioni" });
    fireEvent.click(screen.getByRole("button", { name: /Spazio e cache/ }));
    expect(await screen.findByText("Upscaler / Frame Booster temporary video")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ripulisci" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma pulizia" }));
    await waitFor(() => expect(clearCacheEntry).toHaveBeenCalledWith(expect.objectContaining({ id: "upscaler-local", kind: "disk" })));
    expect(await screen.findByText("Pulizia completata")).toBeInTheDocument();
  });

  it("diagnostica installazione e prova il ciclo degli endpoint da Restore", async () => {
    openSettings();
    await screen.findByRole("dialog", { name: "Impostazioni" });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByRole("heading", { name: "Diagnostica e ripristina MLSM Studio" })).toBeInTheDocument();
    expect(await screen.findByText("1 controlli da correggere")).toBeInTheDocument();
    expect(screen.getByText("Python 3.11 non disponibile")).toBeInTheDocument();
    expect(screen.getByText("Upscaler · Frame Booster")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test ciclo completo" }));
    await waitFor(() => expect(testServiceCycle).toHaveBeenCalledTimes(1));
    expect(readAllServiceStatuses).toHaveBeenCalled();
  });
});
