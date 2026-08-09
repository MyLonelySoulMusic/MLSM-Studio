import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { registerUpscalerSourceFile } from "../services/upscaler-source-file";

const exportUpscaledVideo = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const generateAiUpscalerPreview = vi.hoisted(() => vi.fn().mockResolvedValue(document.createElement("canvas")));
vi.mock("../services/upscaler-video-exporter", () => ({ exportUpscaledVideo }));
vi.mock("../services/upscaler-ai", () => ({ generateAiUpscalerPreview }));

import { UpscalerPreview } from "./UpscalerPreview";

describe("UpscalerPreview video export", () => {
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
  afterEach(() => { cleanup(); exportUpscaledVideo.mockClear(); generateAiUpscalerPreview.mockClear(); vi.restoreAllMocks(); });

  it("collega l'azione globale al job del video intero usando il File originale", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const file = new File([new Uint8Array([0, 1, 2, 3])], "source.mp4", { type: "video/mp4" });
    const settings = { ...createProject().animation.upscaler, sourceUrl: "blob:source-video", sourceName: file.name, sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720, durationSeconds: 12, finalWidth: 2560, finalHeight: 1440 };
    registerUpscalerSourceFile(settings.sourceUrl, file);
    render(<UpscalerPreview settings={settings} />);
    act(() => window.dispatchEvent(new Event("upscaler:export")));
    await waitFor(() => expect(exportUpscaledVideo).toHaveBeenCalledOnce());
    expect(exportUpscaledVideo.mock.calls[0]?.[0]).toMatchObject({ sourceVideoUrl: settings.sourceUrl, sourceVideoFile: file });
  });

  it("mostra nella preview centrale le azioni per video completo e prova frame", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const settings = { ...createProject().animation.upscaler, model: "RealESRNet_x4plus" as const, sourceUrl: "blob:central-video", sourceName: "central.mp4", sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720, durationSeconds: 8, finalWidth: 2560, finalHeight: 1440 };
    const { container } = render(<UpscalerPreview settings={settings} />);
    fireEvent.loadedData(container.querySelector("video")!);
    expect(screen.getByRole("group", { name: "Azioni upscaling video" })).toBeInTheDocument();
    const controls = container.querySelector(".upscaler-preview-controls-stack")!;
    expect(controls.firstElementChild).toHaveClass("upscaler-detail-controls");
    expect(controls.lastElementChild).toHaveClass("upscaler-video-transport");
    fireEvent.click(screen.getByRole("button", { name: "Prova il frame corrente" }));
    await waitFor(() => expect(generateAiUpscalerPreview).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Avvia upscaling video completo" }));
    await waitFor(() => expect(exportUpscaledVideo).toHaveBeenCalledOnce());
  });

  it("annulla il job remoto quando la pagina viene aggiornata", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    exportUpscaledVideo.mockImplementationOnce((_options, signal: AbortSignal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve({}), { once: true });
    }));
    const settings = { ...createProject().animation.upscaler, sourceUrl: "blob:refresh-video", sourceName: "refresh.mp4", sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720, durationSeconds: 8, finalWidth: 2560, finalHeight: 1440 };
    const { container } = render(<UpscalerPreview settings={settings} />);
    fireEvent.loadedData(container.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "Avvia upscaling video completo" }));
    await waitFor(() => expect(exportUpscaledVideo).toHaveBeenCalledOnce());
    const signal = exportUpscaledVideo.mock.calls[0]?.[1] as AbortSignal;
    window.dispatchEvent(new Event("pagehide"));
    expect(signal.aborted).toBe(true);
  });
});
