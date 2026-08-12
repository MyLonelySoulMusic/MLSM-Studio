import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { registerUpscalerSourceFile } from "../services/upscaler-source-file";
import { useProjectStore } from "../store/project-store";

const exportUpscaledVideo = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const generateAiUpscalerPreview = vi.hoisted(() => vi.fn().mockResolvedValue(document.createElement("canvas")));
vi.mock("../services/upscaler-video-exporter", () => ({ exportUpscaledVideo }));
vi.mock("../services/upscaler-ai", () => ({ generateAiUpscalerPreview }));

import { UpscalerPreview } from "./UpscalerPreview";

describe("UpscalerPreview video export", () => {
  beforeEach(() => { useProjectStore.getState().newProject(); vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
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

  it("sincronizza metadata e target proporzionale quando il video reale non è 16:9", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const settings = { ...createProject().animation.upscaler, sourceUrl: "blob:metadata-video", sourceName: "metadata.mp4", sourceKind: "video" as const, sourceWidth: 1920, sourceHeight: 1080, durationSeconds: 8, finalWidth: 3840, finalHeight: 2160, lockAspectRatio: true };
    useProjectStore.getState().updateUpscaler(settings);
    const { container, rerender } = render(<UpscalerPreview settings={settings} />);
    const item = container.querySelector("video")!;
    Object.defineProperties(item, { videoWidth: { configurable: true, value: 1440 }, videoHeight: { configurable: true, value: 1080 }, duration: { configurable: true, value: 12.5 } });
    fireEvent.loadedMetadata(item);
    await waitFor(() => expect(useProjectStore.getState().project.animation.upscaler).toMatchObject({ sourceWidth: 1440, sourceHeight: 1080, durationSeconds: 12.5, finalWidth: 3840, finalHeight: 2880 }));
    const updated = useProjectStore.getState().project.animation.upscaler;
    rerender(<UpscalerPreview settings={updated} />);
    act(() => window.dispatchEvent(new Event("upscaler:export")));
    await waitFor(() => expect(exportUpscaledVideo).toHaveBeenCalledOnce());
    expect(exportUpscaledVideo.mock.calls[0]?.[0].upscalerSettings).toMatchObject({ finalWidth: 3840, finalHeight: 2880 });
  });

  it("ignora il metadata event di una sorgente sostituita", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const first = { ...createProject().animation.upscaler, sourceUrl: "blob:first-video", sourceName: "first.mp4", sourceKind: "video" as const, sourceWidth: 1920, sourceHeight: 1080, finalWidth: 3840, finalHeight: 2160, lockAspectRatio: true };
    const second = { ...first, sourceUrl: "blob:second-video", sourceName: "second.mp4", sourceWidth: 1080, sourceHeight: 1920, finalWidth: 2160, finalHeight: 3840 };
    useProjectStore.getState().updateUpscaler(first);
    const { container, rerender } = render(<UpscalerPreview settings={first} />);
    const staleVideo = container.querySelector("video")!;
    useProjectStore.getState().updateUpscaler(second);
    rerender(<UpscalerPreview settings={second} />);
    Object.defineProperties(staleVideo, { videoWidth: { configurable: true, value: 1920 }, videoHeight: { configurable: true, value: 1080 }, duration: { configurable: true, value: 99 } });
    fireEvent.loadedMetadata(staleVideo);
    await waitFor(() => expect(useProjectStore.getState().project.animation.upscaler).toMatchObject({ sourceUrl: second.sourceUrl, sourceWidth: second.sourceWidth, sourceHeight: second.sourceHeight, durationSeconds: 0 }));
    expect(useProjectStore.getState().project.animation.upscaler.finalHeight).toBe(second.finalHeight);
  });

  it("espone badge e stile preview con dimensioni intrinseche senza stiramento", () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const settings = { ...createProject().animation.upscaler, sourceUrl: "blob:badge-video", sourceName: "badge.mp4", sourceKind: "video" as const, sourceWidth: 1440, sourceHeight: 1080, finalWidth: 1920, finalHeight: 1440 };
    const { container } = render(<UpscalerPreview settings={settings} />);
    const video = container.querySelector("video")!;
    fireEvent.loadedData(video);
    expect(screen.getByText("Originale 1440 × 1080")).toBeInTheDocument();
    expect(screen.getByText("Output 1920 × 1440")).toBeInTheDocument();
    const canvas = container.querySelector("canvas")!;
    expect(canvas.style.width).toBe("auto");
    expect(canvas.style.height).toBe("auto");
    expect(canvas.style.maxWidth).toBe("100%");
    expect(canvas.style.maxHeight).toBe("100%");
  });
});
