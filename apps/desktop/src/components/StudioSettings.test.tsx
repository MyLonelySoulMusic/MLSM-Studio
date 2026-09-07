import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getLlmSettings, settingsRequest, clearCacheEntry } = vi.hoisted(() => ({ getLlmSettings: vi.fn(async () => ({
  activeProvider: "nvidia" as const,
  providers: {
    nvidia: { configured: true, enabled: true, model: "moonshotai/kimi-k3", keySource: "environment" as const, endpoint: "https://integrate.api.nvidia.com/v1/chat/completions", provider: "nvidia" as const },
    openai: { configured: false, enabled: true, model: "gpt-5.6-terra", keySource: "none" as const, endpoint: "https://api.openai.com/v1/chat/completions", provider: "openai" as const },
    gemini: { configured: false, enabled: true, model: "gemini-3.8-flash", keySource: "none" as const, endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", provider: "gemini" as const },
    xai: { configured: false, enabled: true, model: "grok-4.6", keySource: "none" as const, endpoint: "https://api.x.ai/v1/chat/completions", provider: "xai" as const },
  },
})), settingsRequest: vi.fn(), clearCacheEntry: vi.fn<(entry: unknown) => Promise<void>>().mockResolvedValue(undefined) }));

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
});
