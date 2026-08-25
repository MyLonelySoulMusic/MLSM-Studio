import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { useUpscalerBatchStore } from "../store/upscaler-batch-store";

const clearRemoteUpscalerVideoCache = vi.hoisted(() => vi.fn().mockResolvedValue({ removedJobs: 0, removedBytes: 0 }));
vi.mock("../services/upscaler-python-client", () => ({
  clearRemoteUpscalerVideoCache,
  UPSCALER_REMOTE_CACHE_CLEARED_EVENT: "upscaler:remote-cache-cleared"
}));

import { RemoteUpscalerPanel } from "./RemoteUpscalerPanel";

type Settings = ReturnType<typeof createProject>["animation"]["upscaler"];

function Harness() {
  const [settings, setSettings] = useState<Settings>(() => createProject().animation.upscaler);
  return <RemoteUpscalerPanel settings={settings} update={(patch) => setSettings((current) => ({ ...current, ...patch }))} />;
}

describe("RemoteUpscalerPanel", () => {
  beforeEach(() => { useUpscalerBatchStore.getState().resetForProjectReplacement(); clearRemoteUpscalerVideoCache.mockResolvedValue({ removedJobs: 0, removedBytes: 0 }); });
  afterEach(() => { cleanup(); useUpscalerBatchStore.getState().resetForProjectReplacement(); clearRemoteUpscalerVideoCache.mockClear(); vi.restoreAllMocks(); });

  it("aggiunge più endpoint e permette di attivarli in modo indipendente", () => {
    render(<Harness />);
    const input = screen.getByLabelText("URL endpoint Upscaler remoto");
    fireEvent.change(input, { target: { value: "https://one.gradio.live" } }); fireEvent.click(screen.getByText("Aggiungi endpoint"));
    fireEvent.change(input, { target: { value: "https://two.gradio.live" } }); fireEvent.click(screen.getByText("Aggiungi endpoint"));
    expect(screen.getByDisplayValue("https://one.gradio.live")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://two.gradio.live")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Attiva Colab 2"));
    expect(screen.getByLabelText("Attiva Colab 2")).not.toBeChecked();
  });

  it("interroga automaticamente il catalogo quando si abilita il remoto", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ok: true, endpoints: [{ url: "https://one.gradio.live", ok: true, models: [{ name: "x4", scale: 4, description: "photo", default: true }] }],
      models: [{ name: "x4", scale: 4, description: "photo", default: true }], defaultModel: "x4"
    }), { status: 200 }));
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("URL endpoint Upscaler remoto"), { target: { value: "https://one.gradio.live" } }); fireEvent.click(screen.getByText("Aggiungi endpoint"));
    fireEvent.click(screen.getByLabelText("Abilita Upscaler remoto"));
    await waitFor(() => expect(screen.getByLabelText("Modello Upscaler remoto")).toHaveValue("x4"), { timeout: 2_000 });
    expect(screen.getByText(/Online · 1 modelli/)).toBeInTheDocument();
  });

  it("richiede conferma e svuota tutta la cache locale una sola volta", async () => {
    clearRemoteUpscalerVideoCache.mockResolvedValueOnce({ removedJobs: 3, removedBytes: 2 * 1024 * 1024 });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Svuota tutta la cache video" }));
    expect(clearRemoteUpscalerVideoCache).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Conferma pulizia cache video" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Conferma eliminazione" }));
    await waitFor(() => expect(clearRemoteUpscalerVideoCache).toHaveBeenCalledOnce());
    expect(await screen.findByText("Cache svuotata: 3 job rimossi · 2.0 MB.")).toBeInTheDocument();
  });

  it("blocca la pulizia mentre un export singolo è attivo", () => {
    const owner = useUpscalerBatchStore.getState().beginSingleOperation();
    expect(owner).not.toBeNull();
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Svuota tutta la cache video" })).toBeDisabled();
    expect(screen.getByText(/quando import ed elaborazioni sono terminati/i)).toBeInTheDocument();
  });
});
