import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../store/project-store";
import { useUpscalerBatchStore } from "../store/upscaler-batch-store";

const createItems = vi.hoisted(() => vi.fn());
const detectHardware = vi.hoisted(() => vi.fn());
vi.mock("../services/upscaler-batch", async () => {
  const actual = await vi.importActual<typeof import("../services/upscaler-batch")>("../services/upscaler-batch");
  return { ...actual, createUpscalerBatchItems: createItems };
});
vi.mock("../services/upscaler-runtime", async () => {
  const actual = await vi.importActual<typeof import("../services/upscaler-runtime")>("../services/upscaler-runtime");
  return { ...actual, detectUpscalerHardware: detectHardware };
});

import { UpscalerPanel } from "./UpscalerPanel";

function mockVideoMetadata(options: { autoLoad?: boolean; width?: number; height?: number; duration?: number } = {}) {
  const createElement = document.createElement.bind(document);
  let video: HTMLVideoElement | null = null;
  vi.spyOn(document, "createElement").mockImplementation((tagName, elementOptions) => {
    const element = createElement(tagName, elementOptions);
    if (tagName === "video") {
      video = element as HTMLVideoElement;
      Object.defineProperty(element, "videoWidth", { configurable: true, value: options.width ?? 1280 });
      Object.defineProperty(element, "videoHeight", { configurable: true, value: options.height ?? 720 });
      Object.defineProperty(element, "duration", { configurable: true, value: options.duration ?? 12 });
      if (options.autoLoad !== false) window.setTimeout(() => element.onloadedmetadata?.(new Event("loadedmetadata")), 0);
    }
    return element;
  });
  return { get video() { return video; } };
}

function mockDeferredImages() {
  const images: Array<{ naturalWidth: number; naturalHeight: number; onload: (() => void) | null; onerror: (() => void) | null; src: string }> = [];
  vi.stubGlobal("Image", class {
    naturalWidth = 640; naturalHeight = 360; onload: (() => void) | null = null; onerror: (() => void) | null = null; private value = "";
    constructor() { images.push(this); }
    set src(value: string) { this.value = value; }
    get src() { return this.value; }
  });
  return images;
}

describe("UpscalerPanel source picker", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useUpscalerBatchStore.getState().clear();
    detectHardware.mockResolvedValue({ platform: "test", architecture: "test", appleSilicon: false, cuda: false, webgpu: false, gpuName: null, recommendedBackend: "cpu" });
    createItems.mockImplementation(async (files: readonly File[]) => ({
      items: files.map((file, index) => ({
        id: `${file.name}-${index}`, file, url: `blob:${file.name}`, name: file.name,
        sourceWidth: 100 + index, sourceHeight: 50 + index, target: { width: 400 + index, height: 200 + index },
        outputName: `${file.name}-upscaled.png`, selected: true, status: "queued", progress: 0, error: null
      })),
      failures: []
    }));
  });

  afterEach(() => {
    cleanup();
    useUpscalerBatchStore.getState().resetForProjectReplacement();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("espone multiple e inserisce tutte le immagini selezionate nel pool batch", async () => {
    render(<UpscalerPanel />);
    const input = screen.getByLabelText("Carica sorgente Upscaler");
    expect(input).toHaveAttribute("multiple");

    fireEvent.change(input, { target: { files: [
      new File(["one"], "one.jpg", { type: "image/jpeg" }),
      new File(["two"], "two.png", { type: "image/png" })
    ] } });

    await waitFor(() => expect(useUpscalerBatchStore.getState().items).toHaveLength(2));
    expect(useUpscalerBatchStore.getState().items.map((item) => item.name)).toEqual(["one.jpg", "two.png"]);
    expect(screen.getByText("one.jpg")).toBeInTheDocument();
    expect(screen.getByText("two.png")).toBeInTheDocument();
  });

  it("disabilita il picker principale durante l'elaborazione batch", () => {
    const controller = new AbortController();
    useUpscalerBatchStore.setState({ running: true, controller });
    render(<UpscalerPanel />);
    expect(screen.getByLabelText("Carica sorgente Upscaler")).toBeDisabled();
    useUpscalerBatchStore.getState().resetForProjectReplacement();
  });

  it("inserisce nel pool immagini con MIME corretto, vuoto e generico", async () => {
    render(<UpscalerPanel />);
    const files = [
      new File(["one"], "one.jpg", { type: "image/jpeg" }),
      new File(["two"], "two.png", { type: "" }),
      new File(["three"], "three.webp", { type: "application/octet-stream" })
    ];
    fireEvent.change(screen.getByLabelText("Carica sorgente Upscaler"), { target: { files } });
    await waitFor(() => expect(useUpscalerBatchStore.getState().items.map((item) => item.name)).toEqual(["one.jpg", "two.png", "three.webp"]));
    expect(createItems).toHaveBeenCalledWith(files, expect.any(Object), expect.objectContaining({ signal: expect.any(AbortSignal), isGenerationCurrent: expect.any(Function) }));
  });

  it("conserva tutte le immagini valide di una selezione multipla e segnala gli sconosciuti", async () => {
    render(<UpscalerPanel />);
    const first = new File(["one"], "one.jpg", { type: "application/octet-stream" });
    const unknown = new File(["unknown"], "unknown.bin", { type: "application/octet-stream" });
    const second = new File(["two"], "two.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Carica sorgente Upscaler"), { target: { files: [first, unknown, second] } });
    await waitFor(() => expect(useUpscalerBatchStore.getState().items.map((item) => item.name)).toEqual(["one.jpg", "two.png"]));
    expect(createItems).toHaveBeenCalledWith([first, second], expect.any(Object), expect.objectContaining({ signal: expect.any(AbortSignal), isGenerationCurrent: expect.any(Function) }));
    expect(screen.getByText(/unknown\.bin: Estensione \.bin non supportata\./)).toBeInTheDocument();
  });

  it("mantiene una singola immagine generica nel flusso singolo", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:single-image") });
    vi.stubGlobal("Image", class { naturalWidth = 640; naturalHeight = 360; onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
    render(<UpscalerPanel />);
    fireEvent.change(screen.getByLabelText("Carica sorgente Upscaler"), { target: { files: [new File(["one"], "one.jpg", { type: "application/octet-stream" })] } });
    await waitFor(() => expect(useProjectStore.getState().project.animation.upscaler).toMatchObject({ sourceName: "one.jpg", sourceKind: "image", sourceWidth: 640, sourceHeight: 360 }));
    expect(createItems).not.toHaveBeenCalled();
  });

  it("fa vincere deterministicamente la selezione più recente quando i metadata terminano fuori ordine", async () => {
    const images = mockDeferredImages(); const revoke = vi.fn();
    const createUrl = vi.fn().mockReturnValueOnce("blob:first-pending").mockReturnValueOnce("blob:second-pending");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    render(<UpscalerPanel />);
    const input = screen.getByLabelText("Carica sorgente Upscaler");
    fireEvent.change(input, { target: { files: [new File(["one"], "first.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(useUpscalerBatchStore.getState().importing).toBe(true));
    expect(input).toBeEnabled();
    expect(screen.getByLabelText("Modello Upscaler")).toBeDisabled();
    fireEvent.change(input, { target: { files: [new File(["two"], "second.png", { type: "image/png" })] } });
    expect(images).toHaveLength(2);
    images[1]!.naturalWidth = 900; images[1]!.naturalHeight = 600;
    act(() => images[1]!.onload?.());
    await waitFor(() => expect(useProjectStore.getState().project.animation.upscaler).toMatchObject({ sourceUrl: "blob:second-pending", sourceName: "second.png", sourceWidth: 900, sourceHeight: 600 }));
    images[0]!.naturalWidth = 320; images[0]!.naturalHeight = 200;
    act(() => images[0]!.onload?.());
    await waitFor(() => expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:first-pending"]));
    expect(useProjectStore.getState().project.animation.upscaler).toMatchObject({ sourceUrl: "blob:second-pending", sourceName: "second.png", sourceWidth: 900, sourceHeight: 600 });
  });

  it("applica la stessa generazione a video e immagini singole in competizione", async () => {
    const metadata = mockVideoMetadata({ autoLoad: false }); const images = mockDeferredImages(); const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn().mockReturnValueOnce("blob:stale-video").mockReturnValueOnce("blob:latest-image") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    render(<UpscalerPanel />);
    const input = screen.getByLabelText("Carica sorgente Upscaler");
    fireEvent.change(input, { target: { files: [new File(["video"], "stale.mp4", { type: "video/mp4" })] } });
    fireEvent.change(input, { target: { files: [new File(["image"], "latest.jpg", { type: "image/jpeg" })] } });
    act(() => images[0]!.onload?.());
    await waitFor(() => expect(useProjectStore.getState().project.animation.upscaler).toMatchObject({ sourceUrl: "blob:latest-image", sourceName: "latest.jpg", sourceKind: "image" }));
    act(() => metadata.video?.onloadedmetadata?.(new Event("loadedmetadata")));
    await waitFor(() => expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:stale-video"]));
    expect(useProjectStore.getState().project.animation.upscaler).toMatchObject({ sourceUrl: "blob:latest-image", sourceName: "latest.jpg", sourceKind: "image" });
  });

  it("scarta e pulisce un batch multiplo quando una selezione singola più recente lo supersede", async () => {
    const images = mockDeferredImages(); const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:latest-single") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    let resolveBatch!: (value: Awaited<ReturnType<typeof createItems>>) => void;
    createItems.mockImplementationOnce(() => new Promise((resolve) => { resolveBatch = resolve; }));
    const staleFile = new File(["stale"], "stale.jpg", { type: "image/jpeg" });
    render(<UpscalerPanel />);
    const input = screen.getByLabelText("Carica sorgente Upscaler");
    fireEvent.change(input, { target: { files: [staleFile, new File(["also-stale"], "also-stale.png", { type: "image/png" })] } });
    fireEvent.change(input, { target: { files: [new File(["latest"], "latest.jpg", { type: "image/jpeg" })] } });
    act(() => images[0]!.onload?.());
    await waitFor(() => expect(useProjectStore.getState().project.animation.upscaler.sourceName).toBe("latest.jpg"));
    resolveBatch({ items: [{ id: "stale-batch", file: staleFile, url: "blob:stale-batch", name: staleFile.name, sourceWidth: 100, sourceHeight: 50, target: { width: 400, height: 200 }, outputName: "stale.png", selected: true, status: "queued", progress: 0, error: null }], failures: [] });
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:stale-batch"));
    expect(revoke).not.toHaveBeenCalledWith("blob:latest-single");
    expect(useUpscalerBatchStore.getState().items).toEqual([]);
    expect(useProjectStore.getState().project.animation.upscaler).toMatchObject({ sourceUrl: "blob:latest-single", sourceName: "latest.jpg" });
  });

  it("aborts a deferred batch import immediately at project replacement and cleans a late result", async () => {
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    let importSignal!: AbortSignal;
    let resolveBatch!: (value: Awaited<ReturnType<typeof createItems>>) => void;
    createItems.mockImplementationOnce((_files, _settings, options: { signal: AbortSignal }) => {
      importSignal = options.signal;
      return new Promise((resolve) => { resolveBatch = resolve; });
    });
    const staleFile = new File(["stale"], "stale.jpg", { type: "image/jpeg" });
    render(<UpscalerPanel />);
    fireEvent.change(screen.getByLabelText("Carica sorgente Upscaler"), { target: { files: [staleFile, new File(["other"], "other.png", { type: "image/png" })] } });
    await waitFor(() => expect(useUpscalerBatchStore.getState().importing).toBe(true));

    useUpscalerBatchStore.getState().resetForProjectReplacement();
    expect(importSignal.aborted).toBe(true);
    expect(useUpscalerBatchStore.getState().importing).toBe(false);
    resolveBatch({ items: [{ id: "stale", file: staleFile, url: "blob:stale", thumbnailUrl: "blob:stale-thumb", name: staleFile.name, sourceWidth: 100, sourceHeight: 50, target: { width: 400, height: 200 }, outputName: "stale.png", selected: true, status: "queued", progress: 0, error: null }], failures: [] });

    await waitFor(() => expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:stale", "blob:stale-thumb"]));
    expect(useUpscalerBatchStore.getState().items).toEqual([]);
  });

  it("ignora l'errore di un decoder stale dopo il successo della selezione più recente", async () => {
    const images = mockDeferredImages(); const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn().mockReturnValueOnce("blob:stale-error").mockReturnValueOnce("blob:latest-success") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    render(<UpscalerPanel />);
    const input = screen.getByLabelText("Carica sorgente Upscaler");
    fireEvent.change(input, { target: { files: [new File(["one"], "stale.jpg", { type: "image/jpeg" })] } });
    fireEvent.change(input, { target: { files: [new File(["two"], "latest.jpg", { type: "image/jpeg" })] } });
    act(() => images[1]!.onload?.());
    await waitFor(() => expect(useProjectStore.getState().project.animation.upscaler.sourceName).toBe("latest.jpg"));
    act(() => images[0]!.onerror?.());
    await waitFor(() => expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:stale-error"]));
    expect(screen.queryByText("Immagine non leggibile.")).not.toBeInTheDocument();
    expect(useProjectStore.getState().project.animation.upscaler.sourceName).toBe("latest.jpg");
  });

  it("mantiene la sorgente esistente quando l'ultima selezione fallisce e pulisce solo gli URL pending", async () => {
    useProjectStore.getState().updateUpscaler({ sourceUrl: "blob:existing", sourceName: "existing.jpg", sourceKind: "image", sourceWidth: 100, sourceHeight: 50 });
    const images = mockDeferredImages(); const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn().mockReturnValueOnce("blob:older-pending").mockReturnValueOnce("blob:latest-failure") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    render(<UpscalerPanel />);
    const input = screen.getByLabelText("Carica sorgente Upscaler");
    fireEvent.change(input, { target: { files: [new File(["one"], "older.jpg", { type: "image/jpeg" })] } });
    fireEvent.change(input, { target: { files: [new File(["two"], "broken.jpg", { type: "image/jpeg" })] } });
    act(() => images[1]!.onerror?.());
    expect(await screen.findByText("Immagine non leggibile.")).toBeInTheDocument();
    act(() => images[0]!.onload?.());
    await waitFor(() => expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual(["blob:latest-failure", "blob:older-pending"].sort()));
    expect(revoke).not.toHaveBeenCalledWith("blob:existing");
    expect(useProjectStore.getState().project.animation.upscaler).toMatchObject({ sourceUrl: "blob:existing", sourceName: "existing.jpg" });
  });

  it.each([
    ["unknown.bin", "application/octet-stream", "Estensione .bin non supportata."],
    ["fake.jpg", "video/mp4", "MIME video/mp4 non coerente con .jpg."]
  ])("rifiuta %s con feedback senza tentare il decoder immagine", async (name, type, feedback) => {
    const createUrl = vi.fn(); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
    const imageConstructor = vi.fn(); vi.stubGlobal("Image", imageConstructor);
    render(<UpscalerPanel />);
    fireEvent.change(screen.getByLabelText("Carica sorgente Upscaler"), { target: { files: [new File(["x"], name, { type })] } });
    expect(await screen.findByText(new RegExp(feedback.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
    expect(createUrl).not.toHaveBeenCalled();
    expect(imageConstructor).not.toHaveBeenCalled();
  });

  it("mantiene il video nel flusso singolo senza inserirlo nel pool", async () => {
    mockVideoMetadata();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:video") });

    render(<UpscalerPanel />);
    fireEvent.change(screen.getByLabelText("Carica sorgente Upscaler"), { target: { files: [new File(["video"], "clip.MOV", { type: "" })] } });

    await waitFor(() => expect(useProjectStore.getState().project.animation.upscaler).toMatchObject({ sourceName: "clip.MOV", sourceKind: "video", sourceWidth: 1280, sourceHeight: 720 }));
    expect(useUpscalerBatchStore.getState().items).toHaveLength(0);
    expect(createItems).not.toHaveBeenCalled();
  });

  it("instrada anche una sola foto al batch quando la selezione contiene un video", async () => {
    mockVideoMetadata();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:mixed-video") });
    const image = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
    const video = new File(["video"], "clip.mp4", { type: "video/mp4" });

    render(<UpscalerPanel />);
    fireEvent.change(screen.getByLabelText("Carica sorgente Upscaler"), { target: { files: [image, video] } });

    await waitFor(() => expect(useUpscalerBatchStore.getState().items.map((item) => item.name)).toEqual(["photo.jpg"]));
    expect(createItems).toHaveBeenCalledWith([image], expect.objectContaining({ model: expect.any(String) }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(useProjectStore.getState().project.animation.upscaler).toMatchObject({ sourceName: "clip.mp4", sourceKind: "video" });
  });

  it("blocca start e clear per tutto l'import misto senza perdere immagini o URL", async () => {
    const metadata = mockVideoMetadata({ autoLoad: false });
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:pending-video") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const existing = { id: "existing", file: new File(["old"], "old.jpg"), url: "blob:old", name: "old.jpg", sourceWidth: 10, sourceHeight: 10, target: { width: 40, height: 40 }, outputName: "old.png", selected: true, status: "queued" as const, progress: 0, error: null };
    useUpscalerBatchStore.setState({ items: [existing] });
    let resolveBatch!: (value: Awaited<ReturnType<typeof createItems>>) => void;
    createItems.mockImplementationOnce(() => new Promise((resolve) => { resolveBatch = resolve; }));
    const image = new File(["photo"], "new.jpg", { type: "image/jpeg" });
    const video = new File(["video"], "new.webm", { type: "video/webm" });

    render(<UpscalerPanel />);
    fireEvent.change(screen.getByLabelText("Carica sorgente Upscaler"), { target: { files: [video, image] } });
    expect(useUpscalerBatchStore.getState().importing).toBe(true);
    expect(useUpscalerBatchStore.getState().startBatch({} as never)).toBeNull();
    useUpscalerBatchStore.getState().clear();
    expect(useUpscalerBatchStore.getState().items.map((item) => item.name)).toEqual(["old.jpg"]);
    expect(revoke).not.toHaveBeenCalled();

    metadata.video?.onloadedmetadata?.(new Event("loadedmetadata"));
    await waitFor(() => expect(createItems).toHaveBeenCalledWith([image], expect.any(Object), expect.objectContaining({ signal: expect.any(AbortSignal) })));
    useUpscalerBatchStore.getState().clear();
    expect(useUpscalerBatchStore.getState().items.map((item) => item.name)).toEqual(["old.jpg"]);
    resolveBatch({ items: [{ ...existing, id: "new", file: image, url: "blob:new", name: "new.jpg", outputName: "new.png" }], failures: [] });

    await waitFor(() => expect(useUpscalerBatchStore.getState().importing).toBe(false));
    expect(useUpscalerBatchStore.getState().items.map((item) => item.name)).toEqual(["old.jpg", "new.jpg"]);
    useUpscalerBatchStore.getState().clear();
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:old", "blob:new"]);
    expect(revoke).not.toHaveBeenCalledWith("blob:pending-video");
  });

  it("con più video usa deterministicamente il primo e conserva le foto", async () => {
    mockVideoMetadata();
    const createUrl = vi.fn()
      .mockReturnValueOnce("blob:first-video");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
    const first = new File(["one"], "first.mp4", { type: "video/mp4" });
    const photo = new File(["photo"], "photo.png", { type: "image/png" });
    const second = new File(["two"], "second.mov", { type: "video/quicktime" });

    render(<UpscalerPanel />);
    fireEvent.change(screen.getByLabelText("Carica sorgente Upscaler"), { target: { files: [first, photo, second] } });

    await waitFor(() => expect(useUpscalerBatchStore.getState().items).toHaveLength(1));
    expect(useProjectStore.getState().project.animation.upscaler.sourceName).toBe("first.mp4");
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  it("conserva le immagini valide e pulisce l'URL se il video misto fallisce", async () => {
    const metadata = mockVideoMetadata({ autoLoad: false });
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:broken-video") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const image = new File(["photo"], "kept.jpg", { type: "image/jpeg" });
    const video = new File(["video"], "broken.m4v", { type: "" });

    render(<UpscalerPanel />);
    fireEvent.change(screen.getByLabelText("Carica sorgente Upscaler"), { target: { files: [video, image] } });
    metadata.video?.onerror?.(new Event("error"));

    await waitFor(() => expect(useUpscalerBatchStore.getState().items.map((item) => item.name)).toEqual(["kept.jpg"]));
    expect(await screen.findByText("Video non leggibile.")).toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith("blob:broken-video");
  });
});
