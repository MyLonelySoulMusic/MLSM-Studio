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
  const [settings, setSettings] = useState<Settings>(() => {
    const defaults = createProject().animation.upscaler;
    return { ...defaults, sourceWidth: 641, sourceHeight: 359, finalWidth: 641, finalHeight: 359, scale: 1, remote: { ...defaults.remote, enabled: true } };
  });
  return <><RemoteUpscalerPanel settings={settings} update={(patch) => setSettings((current) => ({ ...current, ...patch }))} /><output data-testid="remote-target">{settings.finalWidth} × {settings.finalHeight} · {settings.scale}×</output></>;
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

  it("separa e deduplica automaticamente un blocco di URL incollati", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("URL endpoint Upscaler remoto"), { target: { value: [
      "https://one.gradio.live/",
      "https://two.gradio.live; https://one.gradio.live",
      "testo https://three.gradio.live/gradio_api/api/upscale_models"
    ].join("\n") } });
    fireEvent.click(screen.getByText("Aggiungi endpoint"));
    expect(screen.getByDisplayValue("https://one.gradio.live")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://two.gradio.live")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://three.gradio.live")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^URL Colab /)).toHaveLength(3);
  });

  it("interroga automaticamente il catalogo quando viene aggiunto un endpoint nella modalità remota", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ok: true, endpoints: [{ url: "https://one.gradio.live", ok: true, models: [{ name: "x4", scale: 4, description: "photo", default: true }] }],
      models: [{ name: "x4", scale: 4, description: "photo", default: true }], defaultModel: "x4"
    }), { status: 200 }));
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("URL endpoint Upscaler remoto"), { target: { value: "https://one.gradio.live" } }); fireEvent.click(screen.getByText("Aggiungi endpoint"));
    await waitFor(() => expect(screen.getByLabelText("Modello Upscaler remoto")).toHaveValue("x4"), { timeout: 2_000 });
    expect(screen.getByText(/Online · 1 modelli/)).toBeInTheDocument();
    expect(screen.getByTestId("remote-target")).toHaveTextContent("2564 × 1436 · 4×");
  });

  it("ricalcola il target encoder-safe quando l'utente cambia modello remoto", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ok: true, endpoints: [{ url: "https://one.gradio.live", ok: true, models: [
        { name: "x2", scale: 2, description: "fast", default: true },
        { name: "x4", scale: 4, description: "quality", default: false }
      ] }],
      models: [
        { name: "x2", scale: 2, description: "fast", default: true },
        { name: "x4", scale: 4, description: "quality", default: false }
      ], defaultModel: "x2"
    }), { status: 200 }));
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("URL endpoint Upscaler remoto"), { target: { value: "https://one.gradio.live" } });
    fireEvent.click(screen.getByText("Aggiungi endpoint"));
    await waitFor(() => expect(screen.getByLabelText("Modello Upscaler remoto")).toHaveValue("x2"), { timeout: 2_000 });
    expect(screen.getByTestId("remote-target")).toHaveTextContent("1282 × 718 · 2×");

    fireEvent.change(screen.getByLabelText("Modello Upscaler remoto"), { target: { value: "x4" } });
    expect(screen.getByLabelText("Modello Upscaler remoto")).toHaveValue("x4");
    expect(screen.getByTestId("remote-target")).toHaveTextContent("2564 × 1436 · 4×");
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

  it("configura segmenti e FPS lasciando la sorgente invariata per default", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Fotogrammi per segmento remoto")).toHaveValue(100);
    expect(screen.getByLabelText("Modifica frame rate remoto")).not.toBeChecked();
    expect(screen.queryByLabelText("FPS uscita Upscaler remoto")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Fotogrammi per segmento remoto"), { target: { value: "300" } });
    fireEvent.click(screen.getByLabelText("Modifica frame rate remoto"));
    expect(screen.getByLabelText("Fotogrammi per segmento remoto")).toHaveValue(300);
    expect(screen.getByLabelText("FPS uscita Upscaler remoto")).toHaveValue(60);
    fireEvent.change(screen.getByLabelText("FPS uscita Upscaler remoto"), { target: { value: "59.94" } });
    expect(screen.getByLabelText("FPS uscita Upscaler remoto")).toHaveValue(59.94);
    expect(screen.getByText(/alcun limite automatico a 25 FPS/i)).toBeInTheDocument();
  });
});
