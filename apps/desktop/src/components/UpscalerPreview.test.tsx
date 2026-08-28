import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { registerUpscalerSourceFile } from "../services/upscaler-source-file";
import { useProjectStore } from "../store/project-store";
import { useUpscalerBatchStore } from "../store/upscaler-batch-store";
import { resetUpscalerRuntimeForProjectReplacement } from "../services/upscaler-batch-lifecycle";
import { UPSCALER_REMOTE_CACHE_CLEARED_EVENT } from "../services/upscaler-python-client";

const exportUpscaledVideo = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const generateAiUpscalerPreview = vi.hoisted(() => vi.fn().mockResolvedValue(document.createElement("canvas")));
const exportUpscalerImage = vi.hoisted(() => vi.fn().mockResolvedValue({ blob: new Blob(["png"]), fileName: "image.png", width: 20, height: 20, aiEnhancedSource: null }));
const chooseUpscalerVideoSaveTarget = vi.hoisted(() => vi.fn().mockResolvedValue({ kind: "download" }));
const prepareUpscalerVideoSaveTarget = vi.hoisted(() => vi.fn().mockResolvedValue({ kind: "download" }));
const saveUpscalerVideoArtifact = vi.hoisted(() => vi.fn().mockResolvedValue({ bytes: 11, destination: "remote-upscaled.mp4" }));
const hasCompatibleRemoteUpscalerCheckpoint = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("../services/upscaler-video-exporter", () => ({ exportUpscaledVideo }));
vi.mock("../services/upscaler-video-artifact", () => ({ chooseUpscalerVideoSaveTarget, prepareUpscalerVideoSaveTarget, saveUpscalerVideoArtifact }));
vi.mock("../services/upscaler-ai", () => ({ generateAiUpscalerPreview }));
vi.mock("../services/upscaler-image-exporter", () => ({ exportUpscalerImage }));
vi.mock("../services/upscaler-remote-checkpoint", () => ({ hasCompatibleRemoteUpscalerCheckpoint }));

import { UpscalerPreview } from "./UpscalerPreview";

describe("UpscalerPreview video export", () => {
  beforeEach(() => { useProjectStore.getState().newProject(); useUpscalerBatchStore.getState().resetForProjectReplacement(); chooseUpscalerVideoSaveTarget.mockResolvedValue({ kind: "download" }); prepareUpscalerVideoSaveTarget.mockResolvedValue({ kind: "download" }); saveUpscalerVideoArtifact.mockResolvedValue({ bytes: 11, destination: "remote-upscaled.mp4" }); hasCompatibleRemoteUpscalerCheckpoint.mockResolvedValue(true); vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
  afterEach(() => { cleanup(); useUpscalerBatchStore.getState().resetForProjectReplacement(); exportUpscaledVideo.mockClear(); generateAiUpscalerPreview.mockReset(); generateAiUpscalerPreview.mockResolvedValue(document.createElement("canvas")); exportUpscalerImage.mockClear(); chooseUpscalerVideoSaveTarget.mockClear(); prepareUpscalerVideoSaveTarget.mockClear(); saveUpscalerVideoArtifact.mockClear(); hasCompatibleRemoteUpscalerCheckpoint.mockClear(); vi.restoreAllMocks(); });

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

  it("mantiene il progresso Canvas locale separato dalla percentuale e non mostra istruzioni Gradio", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    let finish!: () => void;
    exportUpscaledVideo.mockImplementationOnce((_options, _signal, onProgress: (progress: unknown) => void) => {
      onProgress({
        phase: "upscaling", phaseLabel: "Frame 45/361 · passaggio 1/1", progress: .05,
        currentFrame: 44, totalFrames: 361, elapsedMs: 1_000, estimatedRemainingMs: 180_000,
        originalFramesDirectory: "/tmp/local/original-frames"
      });
      return new Promise<void>((resolve) => { finish = () => resolve(); });
    });
    const settings = { ...createProject().animation.upscaler, model: "canvas" as const, sourceUrl: "blob:local-canvas", sourceName: "canvas.mp4", sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720, durationSeconds: 12 };
    const { container } = render(<UpscalerPreview settings={settings} />);
    fireEvent.loadedData(container.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "Avvia upscaling video completo" }));

    expect(await screen.findByText("Frame 45/361 · passaggio 1/1")).toBeInTheDocument();
    expect(screen.getByLabelText("Avanzamento 5%")).toHaveTextContent("Avanzamento 5%");
    expect(screen.getByText("/tmp/local/original-frames")).toBeInTheDocument();
    expect(screen.queryByText(/I video vengono inviati come segmenti/i)).not.toBeInTheDocument();
    act(() => finish());
  });

  it("non ripiega sui motori locali se Gradio è selezionato senza endpoint attivi", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const defaults = createProject().animation.upscaler;
    const settings = { ...defaults, sourceUrl: "blob:remote-unconfigured", sourceName: "remote.mp4", sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720, durationSeconds: 8, remote: { ...defaults.remote, enabled: true, endpoints: [] } };
    const { container } = render(<UpscalerPreview settings={settings} />);
    fireEvent.loadedData(container.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "Avvia upscaling video completo" }));

    expect(await screen.findByText(/aggiungi e attiva almeno un endpoint/i)).toBeInTheDocument();
    expect(exportUpscaledVideo).not.toHaveBeenCalled();
  });

  it("adotta il video remoto ricostruito nella preview e permette di salvarlo senza rieseguire il job", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const blob = new Blob(["final-video"], { type: "video/mp4" });
    exportUpscaledVideo.mockResolvedValueOnce({ blob, fileName: "remote-upscaled.mp4", width: 2560, height: 1440, sourceFrameCount: 240, encodedFrameCount: 240, audioPacketCount: 128, tempDirectory: "temp", originalFramesDirectory: "originals", resultPath: "/cache/job/upscaled-video.mp4" });
    const createUrl = vi.fn(() => "blob:remote-result"); const revokeUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeUrl });
    const settings = { ...createProject().animation.upscaler, sourceUrl: "blob:source", sourceName: "source.mp4", sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720, durationSeconds: 8, finalWidth: 2560, finalHeight: 1440 };
    const { container } = render(<UpscalerPreview settings={settings} />);
    fireEvent.loadedData(container.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "Avvia upscaling video completo" }));
    await waitFor(() => expect(createUrl).toHaveBeenCalledWith(blob));
    const resultVideo = container.querySelector("video")!;
    expect(resultVideo).toHaveAttribute("src", "blob:remote-result");
    expect(await screen.findByRole("button", { name: "Esporta / salva MP4" })).toBeInTheDocument();
    fireEvent.loadedData(resultVideo);
    expect(await screen.findByText("RISULTATO UPSCALATO · PRONTO")).toBeInTheDocument();
    expect(screen.getByText(/240 frame ricomposti · audio incluso/)).toBeInTheDocument();
    let finishSave!: (receipt: { bytes: number; destination: string }) => void;
    saveUpscalerVideoArtifact.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Esporta / salva MP4" }));
    await waitFor(() => expect(saveUpscalerVideoArtifact).toHaveBeenCalledWith({ kind: "download" }, expect.objectContaining({ blob, resultPath: "/cache/job/upscaled-video.mp4" })));
    expect(useUpscalerBatchStore.getState().singleOperations).toBe(1);
    act(() => finishSave({ bytes: 11, destination: "remote-upscaled.mp4" }));
    expect(await screen.findByText(/Download avviato.*remote-upscaled\.mp4/)).toBeInTheDocument();
    await waitFor(() => expect(useUpscalerBatchStore.getState().singleOperations).toBe(0));
    expect(exportUpscaledVideo).toHaveBeenCalledOnce();
    cleanup();
    expect(revokeUrl).toHaveBeenCalledWith("blob:remote-result");
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

  it("mostra tutti gli endpoint realmente attivi invece del solo ultimo completato", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    let finish!: () => void;
    exportUpscaledVideo.mockImplementationOnce((_options, _signal, onProgress: (progress: unknown) => void) => {
      onProgress({
        phase: "upscaling", phaseLabel: "Upscaling remoto · 2/2 endpoint al lavoro", progress: .25,
        currentFrame: 200, totalFrames: 400, completedSegments: 2, totalSegments: 4, elapsedMs: 1_000, estimatedRemainingMs: 4_000,
        activeEndpoints: ["https://first.gradio.live", "https://second.gradio.live"],
        endpointActivity: [
          { url: "https://first.gradio.live", state: "busy", activeFrame: null, activeSegment: "segment-000003.mp4", completed: 1, completedSegments: 1, completedFrames: 100, failures: 0, segmentFrame: 42, segmentTotalFrames: 100, segmentProgress: .42, segmentPhase: "upscaling", secondsPerFrame: 1.75, segmentEstimatedRemainingSeconds: 101.5 },
          { url: "https://second.gradio.live", state: "busy", activeFrame: null, activeSegment: "segment-000004.mp4", completed: 1, completedSegments: 1, completedFrames: 100, failures: 1, segmentFrame: 0, segmentTotalFrames: 100, segmentProgress: 0, segmentPhase: "awaiting_progress" }
        ]
      });
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    hasCompatibleRemoteUpscalerCheckpoint.mockResolvedValueOnce(false);
    const defaults = createProject().animation.upscaler;
    const settings = { ...defaults, sourceUrl: "blob:parallel-video", sourceName: "parallel.mp4", sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720, durationSeconds: 8, remote: { ...defaults.remote, enabled: true, model: "x4", endpoints: [
      { id: "first", label: "First", url: "https://first.gradio.live", enabled: true },
      { id: "second", label: "Second", url: "https://second.gradio.live", enabled: true }
    ] } };
    const { container } = render(<UpscalerPreview settings={settings} />);
    fireEvent.loadedData(container.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "Avvia upscaling video completo" }));
    expect(await screen.findByText("2 richieste contemporaneamente in volo")).toBeInTheDocument();
    expect(screen.getByText("first.gradio.live")).toBeInTheDocument();
    expect(screen.getByText("second.gradio.live")).toBeInTheDocument();
    expect(screen.getByText("2", { selector: "b" })).toBeInTheDocument();
    expect(screen.getByText("1 segmenti · 100 frame · 1 retry")).toBeInTheDocument();
    expect(screen.getByText("Upscaling frame · segment-000003.mp4")).toBeInTheDocument();
    const firstProgress = screen.getByRole("progressbar", { name: "Progresso first.gradio.live" });
    expect(firstProgress).toHaveValue(.42);
    expect(firstProgress.closest(".upscaler-remote-worker")).toHaveTextContent("42% · frame 42/100 · 1.75 s/frame · ETA 2 min");
    expect(screen.getByRole("progressbar", { name: "Progresso second.gradio.live" })).not.toHaveAttribute("value");
    expect(screen.getByText(/Riavvia un endpoint aggiornato/)).toBeInTheDocument();
    expect(screen.getByText(/I video vengono inviati come segmenti da 100 frame/i)).toBeInTheDocument();
    act(() => finish());
  });

  it("chiede conferma e continua con i soli endpoint raggiungibili", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    hasCompatibleRemoteUpscalerCheckpoint.mockResolvedValue(false);
    let receivedDecision = "";
    exportUpscaledVideo.mockImplementationOnce(async (options, signal: AbortSignal) => {
      receivedDecision = await options.onRemoteEndpointDecision({
        ok: true,
        reachableEndpoints: ["https://online.gradio.live"],
        failures: [{ url: "https://offline.gradio.live", error: "HTTP Error 404: Not Found" }],
      }, signal);
      return {};
    });
    const defaults = createProject().animation.upscaler;
    const settings = { ...defaults, sourceUrl: "blob:remote-source", sourceName: "remote.mp4", sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720, durationSeconds: 8, remote: {
      ...defaults.remote, enabled: true, model: "x4", endpoints: [
        { id: "online", label: "Online", url: "https://online.gradio.live", enabled: true },
        { id: "offline", label: "Offline", url: "https://offline.gradio.live", enabled: true },
      ],
    } };
    const { container } = render(<UpscalerPreview settings={settings} />);
    fireEvent.loadedData(container.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "Avvia upscaling video completo" }));
    expect(await screen.findByRole("dialog", { name: "Alcuni endpoint non rispondono" })).toBeInTheDocument();
    expect(screen.getByText("offline.gradio.live")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continua con 1 endpoint" }));
    await waitFor(() => expect(receivedDecision).toBe("continue"));
    expect(screen.queryByRole("dialog", { name: "Alcuni endpoint non rispondono" })).not.toBeInTheDocument();
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

  it("clears stale canvas pixels and source errors immediately when the source changes", async () => {
    const images: Array<{ onload: (() => void) | null; onerror: (() => void) | null }> = [];
    vi.stubGlobal("Image", class { naturalWidth = 100; naturalHeight = 50; onload: (() => void) | null = null; onerror: (() => void) | null = null; src = ""; constructor() { images.push(this); } });
    const first = { ...createProject().animation.upscaler, sourceUrl: "blob:broken", sourceName: "broken.jpg", sourceKind: "image" as const, sourceWidth: 100, sourceHeight: 50, finalWidth: 200, finalHeight: 100 };
    const { container, rerender } = render(<UpscalerPreview settings={first} />);
    act(() => images[0]?.onerror?.());
    expect(await screen.findByText("Immagine non leggibile")).toBeInTheDocument();
    const canvas = container.querySelector("canvas")!; canvas.width = 200; canvas.height = 100;
    rerender(<UpscalerPreview settings={{ ...first, sourceUrl: "blob:replacement", sourceName: "replacement.jpg" }} />);
    await waitFor(() => expect(screen.queryByText("Immagine non leggibile")).not.toBeInTheDocument());
    expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  });

  it("scarta una preview AI che termina dopo il cambio delle impostazioni e non la riusa nell'export", async () => {
    const images: Array<{ onload: (() => void) | null }> = [];
    vi.stubGlobal("Image", class { naturalWidth = 100; naturalHeight = 50; onload: (() => void) | null = null; onerror: (() => void) | null = null; src = ""; constructor() { images.push(this); } });
    let resolveStalePreview!: (canvas: HTMLCanvasElement) => void;
    generateAiUpscalerPreview.mockImplementationOnce(() => new Promise((resolve) => { resolveStalePreview = resolve; }));
    const staleCanvas = document.createElement("canvas");
    const initial = { ...createProject().animation.upscaler, model: "RealESRNet_x4plus" as const, sourceUrl: "blob:photo", sourceName: "photo.jpg", sourceKind: "image" as const, sourceWidth: 100, sourceHeight: 50, finalWidth: 200, finalHeight: 100 };
    const { rerender } = render(<UpscalerPreview settings={initial} />); act(() => images[0]?.onload?.());
    fireEvent.click(await screen.findByRole("button", { name: "Genera anteprima upscaling" }));
    await waitFor(() => expect(generateAiUpscalerPreview).toHaveBeenCalledOnce());
    const changed = { ...initial, finalWidth: 300, finalHeight: 150 };
    rerender(<UpscalerPreview settings={changed} />);
    resolveStalePreview(staleCanvas);
    await waitFor(() => expect(screen.getByText("ORIGINALE · ANTEPRIMA NON GENERATA")).toBeInTheDocument());
    act(() => window.dispatchEvent(new Event("upscaler:export")));
    await waitFor(() => expect(exportUpscalerImage).toHaveBeenCalledOnce());
    expect(exportUpscalerImage.mock.calls[0]?.[0].settings).toMatchObject({ finalWidth: 300, finalHeight: 150 });
    expect(exportUpscalerImage.mock.calls[0]?.[0].aiEnhancedSource).toBeNull();
  });

  it("shares an in-flight image preview with export instead of starting a second inference", async () => {
    const images: Array<{ onload: (() => void) | null }> = [];
    vi.stubGlobal("Image", class { naturalWidth = 100; naturalHeight = 50; onload: (() => void) | null = null; onerror: (() => void) | null = null; src = ""; constructor() { images.push(this); } });
    let resolvePreview!: (canvas: HTMLCanvasElement) => void; generateAiUpscalerPreview.mockImplementationOnce(() => new Promise((resolve) => { resolvePreview = resolve; }));
    const enhanced = document.createElement("canvas"); const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:export") }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    exportUpscalerImage.mockImplementationOnce(async (options: { aiEnhancedSource?: CanvasImageSource | null }) => ({ blob: new Blob(["png"]), fileName: "photo.png", width: 200, height: 100, aiEnhancedSource: options.aiEnhancedSource ?? null }));
    const settings = { ...createProject().animation.upscaler, model: "RealESRNet_x4plus" as const, sourceUrl: "blob:photo", sourceName: "photo.jpg", sourceKind: "image" as const, sourceWidth: 100, sourceHeight: 50, finalWidth: 200, finalHeight: 100 };
    render(<UpscalerPreview settings={settings} />); act(() => images[0]?.onload?.());
    fireEvent.click(await screen.findByRole("button", { name: "Genera anteprima upscaling" }));
    await waitFor(() => expect(generateAiUpscalerPreview).toHaveBeenCalledOnce());
    act(() => window.dispatchEvent(new Event("upscaler:export")));
    expect(exportUpscalerImage).not.toHaveBeenCalled();
    resolvePreview(enhanced);
    await waitFor(() => expect(exportUpscalerImage).toHaveBeenCalledOnce());
    expect(generateAiUpscalerPreview).toHaveBeenCalledOnce(); expect(exportUpscalerImage.mock.calls[0]?.[0].aiEnhancedSource).toBe(enhanced); expect(click).toHaveBeenCalledOnce();
  });

  it("does not let an old preview finally decrement a new project's single-operation owner", async () => {
    const images: Array<{ onload: (() => void) | null }> = [];
    vi.stubGlobal("Image", class { naturalWidth = 100; naturalHeight = 50; onload: (() => void) | null = null; onerror: (() => void) | null = null; src = ""; constructor() { images.push(this); } });
    let resolveOld!: (canvas: HTMLCanvasElement) => void; let resolveNew!: (canvas: HTMLCanvasElement) => void;
    generateAiUpscalerPreview
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
    const base = { ...createProject().animation.upscaler, model: "RealESRNet_x4plus" as const, sourceKind: "image" as const, sourceWidth: 100, sourceHeight: 50, finalWidth: 200, finalHeight: 100 };
    const { rerender } = render(<UpscalerPreview settings={{ ...base, sourceUrl: "blob:old", sourceName: "old.jpg" }} />);
    act(() => images[0]?.onload?.());
    fireEvent.click(await screen.findByRole("button", { name: "Genera anteprima upscaling" }));
    await waitFor(() => expect(useUpscalerBatchStore.getState().singleOperations).toBe(1));

    act(() => resetUpscalerRuntimeForProjectReplacement());
    rerender(<UpscalerPreview settings={{ ...base, sourceUrl: "blob:new", sourceName: "new.jpg" }} />);
    act(() => images[1]?.onload?.());
    fireEvent.click(await screen.findByRole("button", { name: "Genera anteprima upscaling" }));
    await waitFor(() => expect(useUpscalerBatchStore.getState().singleOperations).toBe(1));

    act(() => resolveOld(document.createElement("canvas")));
    await Promise.resolve();
    expect(useUpscalerBatchStore.getState().singleOperations).toBe(1);
    act(() => resolveNew(document.createElement("canvas")));
    await waitFor(() => expect(useUpscalerBatchStore.getState().singleOperations).toBe(0));
  });

  it("annulla e separa l'export di A quando viene caricata ed esportata subito la sorgente B", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    let resolveA!: (value: Record<string, unknown>) => void; let resolveB!: (value: Record<string, unknown>) => void;
    let progressA!: (value: Record<string, unknown>) => void; let progressB!: (value: Record<string, unknown>) => void;
    exportUpscaledVideo
      .mockImplementationOnce((_options, _signal, onProgress) => new Promise((resolve) => { progressA = onProgress; resolveA = resolve; }))
      .mockImplementationOnce((_options, _signal, onProgress) => new Promise((resolve) => { progressB = onProgress; resolveB = resolve; }));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:result-b") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const fileA = new File(["video-a"], "a.mp4", { type: "video/mp4" }); const fileB = new File(["video-b"], "b.mp4", { type: "video/mp4" });
    const defaults = createProject().animation.upscaler;
    const base = {
      ...defaults, sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720, durationSeconds: 8, finalWidth: 2560, finalHeight: 1440,
      remote: { ...defaults.remote, enabled: true, model: "RealESRGAN_x4plus", endpoints: [{ id: "one", label: "Colab 1", url: "https://one.gradio.live", enabled: true }] }
    };
    const settingsA = { ...base, sourceUrl: "blob:source-a", sourceName: fileA.name };
    const settingsB = { ...base, sourceUrl: "blob:source-b", sourceName: fileB.name };
    registerUpscalerSourceFile(settingsA.sourceUrl, fileA);
    const { rerender } = render(<UpscalerPreview settings={settingsA} />);
    act(() => window.dispatchEvent(new Event("upscaler:export")));
    fireEvent.click(await screen.findByRole("button", { name: "Riparti da zero" }));
    await waitFor(() => expect(exportUpscaledVideo).toHaveBeenCalledTimes(1));
    const signalA = exportUpscaledVideo.mock.calls[0]?.[1] as AbortSignal;

    registerUpscalerSourceFile(settingsB.sourceUrl, fileB);
    rerender(<UpscalerPreview settings={settingsB} />);
    await waitFor(() => expect(signalA.aborted).toBe(true));
    act(() => window.dispatchEvent(new Event("upscaler:export")));
    expect(await screen.findByText(fileB.name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Riparti da zero" }));
    await waitFor(() => expect(exportUpscaledVideo).toHaveBeenCalledTimes(2));
    expect(exportUpscaledVideo.mock.calls[1]?.[0]).toMatchObject({ sourceVideoUrl: settingsB.sourceUrl, sourceVideoFile: fileB });

    act(() => progressA({ phase: "upscaling", phaseLabel: "PROGRESSO A OBSOLETO", progress: .8, currentFrame: 80, totalFrames: 100 }));
    expect(screen.queryByText("PROGRESSO A OBSOLETO")).not.toBeInTheDocument();
    act(() => progressB({ phase: "upscaling", phaseLabel: "PROGRESSO B CORRENTE", progress: .2, currentFrame: 20, totalFrames: 100 }));
    expect(await screen.findByText("PROGRESSO B CORRENTE")).toBeInTheDocument();
    act(() => resolveA({}));
    await waitFor(() => expect(screen.getByText("PROGRESSO B CORRENTE")).toBeInTheDocument());
    expect(useUpscalerBatchStore.getState().singleOperations).toBe(1);

    const blobB = new Blob(["result-b"], { type: "video/mp4" });
    act(() => resolveB({ blob: blobB, fileName: "b-upscaled.mp4", width: 2560, height: 1440, sourceFrameCount: 100, encodedFrameCount: 100, audioPacketCount: 3, tempDirectory: "b", originalFramesDirectory: "b/originals" }));
    expect(await screen.findByText("RISULTATO UPSCALATO · PRONTO")).toBeInTheDocument();
    await waitFor(() => expect(useUpscalerBatchStore.getState().singleOperations).toBe(0));
  });

  it.each([
    ["Riprendi cache compatibile", "resume"],
    ["Riparti da zero", "restart"]
  ] as const)("chiede la policy soltanto per una cache compatibile e inoltra %s", async (buttonName, expectedPolicy) => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const file = new File(["same-video"], "same-video.mp4", { type: "video/mp4" });
    const defaults = createProject().animation.upscaler;
    const settings = {
      ...defaults,
      sourceUrl: "blob:remote-source", sourceName: file.name, sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720, durationSeconds: 8,
      remote: { ...defaults.remote, enabled: true, model: "RealESRGAN_x4plus", endpoints: [{ id: "one", label: "Colab 1", url: "https://one.gradio.live", enabled: true }] }
    };
    registerUpscalerSourceFile(settings.sourceUrl, file);
    render(<UpscalerPreview settings={settings} />);

    act(() => window.dispatchEvent(new Event("upscaler:export")));
    expect(await screen.findByRole("dialog", { name: "Come vuoi gestire la cache?" })).toBeInTheDocument();
    expect(exportUpscaledVideo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    await waitFor(() => expect(exportUpscaledVideo).toHaveBeenCalledOnce());
    expect(exportUpscaledVideo.mock.calls[0]?.[0]).toMatchObject({ sourceVideoFile: file, remoteCheckpointPolicy: expectedPolicy });
  });

  it("avvia automaticamente da zero un video remoto nuovo senza mostrare la domanda cache", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    hasCompatibleRemoteUpscalerCheckpoint.mockResolvedValueOnce(false);
    const file = new File(["brand-new-video"], "brand-new.mp4", { type: "video/mp4" });
    const defaults = createProject().animation.upscaler;
    const settings = {
      ...defaults,
      sourceUrl: "blob:brand-new", sourceName: file.name, sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720, durationSeconds: 8,
      remote: { ...defaults.remote, enabled: true, model: "RealESRGAN_x4plus", endpoints: [{ id: "one", label: "Colab 1", url: "https://one.gradio.live", enabled: true }] }
    };
    registerUpscalerSourceFile(settings.sourceUrl, file);
    render(<UpscalerPreview settings={settings} />);

    act(() => window.dispatchEvent(new Event("upscaler:export")));
    await waitFor(() => expect(exportUpscaledVideo).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "Come vuoi gestire la cache?" })).not.toBeInTheDocument();
    expect(exportUpscaledVideo.mock.calls[0]?.[0]).toMatchObject({ sourceVideoFile: file, remoteCheckpointPolicy: "restart" });
  });

  it("invalida l'artifact remoto in anteprima quando la sua cache viene svuotata", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const blob = new Blob(["remote-result"], { type: "video/mp4" });
    exportUpscaledVideo.mockResolvedValueOnce({ blob, fileName: "remote.mp4", width: 2560, height: 1440, sourceFrameCount: 10, encodedFrameCount: 10, audioPacketCount: 1, tempDirectory: "cache", originalFramesDirectory: "cache/originals", resultPath: "/cache/remote/upscaled-video.mp4" });
    const revoke = vi.fn(); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:remote-artifact") }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const defaults = createProject().animation.upscaler;
    const settings = {
      ...defaults, sourceUrl: "blob:remote-original", sourceName: "remote-source.mp4", sourceKind: "video" as const, sourceWidth: 1280, sourceHeight: 720,
      remote: { ...defaults.remote, enabled: true, model: "RealESRGAN_x4plus", endpoints: [{ id: "one", label: "Colab", url: "https://one.gradio.live", enabled: true }] }
    };
    const { container } = render(<UpscalerPreview settings={settings} />);
    fireEvent.loadedData(container.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "Avvia upscaling video completo" }));
    expect(await screen.findByText("RISULTATO UPSCALATO · PRONTO")).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event(UPSCALER_REMOTE_CACHE_CLEARED_EVENT)));
    await waitFor(() => expect(screen.queryByText("RISULTATO UPSCALATO · PRONTO")).not.toBeInTheDocument());
    expect(revoke).toHaveBeenCalledWith("blob:remote-artifact");
  });
});
