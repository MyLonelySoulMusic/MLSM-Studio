import { createProject } from "@rbs/project-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exporterMock = vi.hoisted(() => ({
  behavior: "error" as "error" | "abort" | "success",
  controller: null as AbortController | null,
  audioSettled: false,
  rejectAudio: null as (() => void) | null,
  canvasDimensions: null as { width: number; height: number } | null,
  canEncodeVideo: vi.fn(async () => true),
  conversionCancel: vi.fn(async () => undefined),
  outputCancel: vi.fn(async () => undefined),
  inputDispose: vi.fn(),
  sourceClose: vi.fn()
}));

vi.mock("mediabunny", () => {
  class BlobSource {}
  class BufferTarget { buffer: ArrayBuffer | null = null; }
  class CanvasSource {
    constructor(canvas: HTMLCanvasElement) { exporterMock.canvasDimensions = { width: canvas.width, height: canvas.height }; }
    async add(): Promise<void> {
      if (exporterMock.behavior === "success") return;
      if (exporterMock.behavior === "abort") exporterMock.controller?.abort();
      throw exporterMock.behavior === "abort" ? new DOMException("Esportazione annullata", "AbortError") : new Error("frame encoder failure");
    }
    close(): void { exporterMock.sourceClose(); }
  }
  class Input {
    async getPrimaryAudioTrack() { return { computeDuration: async () => .1, computePacketStats: async () => ({ packetCount: 3 }) }; }
    dispose(): void { exporterMock.inputDispose(); }
  }
  class Output {
    private readonly target: BufferTarget;
    constructor(options: { target: BufferTarget }) { this.target = options.target; }
    addVideoTrack(): void {}
    async start(): Promise<void> {}
    async finalize(): Promise<void> { this.target.buffer = new ArrayBuffer(8); }
    async cancel(): Promise<void> { await exporterMock.outputCancel(); }
  }
  class Conversion {
    isValid = true;
    static async init(): Promise<Conversion> { return new Conversion(); }
    execute(): Promise<void> {
      if (exporterMock.behavior === "success") return Promise.resolve();
      const promise = new Promise<void>((_resolve, reject) => {
        exporterMock.rejectAudio = () => window.setTimeout(() => { exporterMock.audioSettled = true; reject(new Error("audio conversion canceled")); }, 5);
      });
      // Il mock osserva lo stato senza rendere fragile Vitest; l'exporter deve
      // comunque attendere questa stessa promise prima di rigettare.
      void promise.catch(() => undefined);
      return promise;
    }
    async cancel(): Promise<void> { exporterMock.rejectAudio?.(); await exporterMock.conversionCancel(); }
  }
  return {
    ALL_FORMATS: [], BlobSource, BufferTarget, CanvasSource, Conversion, Input,
    Mp4OutputFormat: class {}, Output, QUALITY_HIGH: 1, QUALITY_VERY_HIGH: 2,
    canEncodeAudio: async () => true, canEncodeVideo: exporterMock.canEncodeVideo
  };
});

vi.mock("./background-auto-renderer", async () => {
  const actual = await vi.importActual<typeof import("./background-auto-renderer")>("./background-auto-renderer");
  return { ...actual, renderBackgroundAutoFrame: vi.fn() };
});

import { backgroundAutoOfflineFrameCount, backgroundAutoOfflineFrameTiming, estimateBackgroundAutoBufferBytes, exportBackgroundAutoOfflineVideo } from "./background-auto-offline-exporter";

describe("Background Auto offline export preflight", () => {
  it("mantiene timing contiguo e l’ultimo frame limitato alla durata", () => {
    expect(backgroundAutoOfflineFrameCount(1.01, 30)).toBe(31);
    const last = backgroundAutoOfflineFrameTiming(30, 1.01, 30);
    expect(last.timestampSeconds).toBe(1); expect(last.durationSeconds).toBeCloseTo(.01, 8); expect(last.sampleTimeSeconds).toBeLessThan(1.01);
  });

  it("stima più memoria per qualità massima e per output più lunghi", () => {
    const high = estimateBackgroundAutoBufferBytes(1920, 1080, 30, 60, "high");
    expect(estimateBackgroundAutoBufferBytes(1920, 1080, 30, 60, "maximum")).toBeGreaterThan(high);
    expect(estimateBackgroundAutoBufferBytes(1920, 1080, 30, 120, "high")).toBeGreaterThan(high);
  });

  it("rifiuta l’override globale 16:9 per una cover portrait prima dell’encoder", async () => {
    const backgroundAutoSettings = createProject().animation.backgroundAuto;
    backgroundAutoSettings.sourceWidth = 1080; backgroundAutoSettings.sourceHeight = 1920;
    await expect(exportBackgroundAutoOfflineVideo({ width: 1920, height: 1080, fps: 30, durationSeconds: .1, projectName: "test", projectSeed: 1, quality: "high", audioUrl: "blob:audio", imageUrl: "data:image/png;base64,AAAA", backgroundAutoSettings, energyFrames: [] }, new AbortController().signal, vi.fn())).rejects.toThrow(/9:16 source ratio/);
  });

  it("esporta una sorgente dispari con dimensioni encoder canoniche in canvas, nome e risultato", async () => {
    exporterMock.behavior = "success"; exporterMock.canvasDimensions = null; exporterMock.canEncodeVideo.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["audio"]) })));
    vi.stubGlobal("Image", class {
      naturalWidth = 941; naturalHeight = 1672; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:video"), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      const backgroundAutoSettings = createProject().animation.backgroundAuto;
      backgroundAutoSettings.sourceWidth = 941; backgroundAutoSettings.sourceHeight = 1672;
      const result = await exportBackgroundAutoOfflineVideo({ width: 942, height: 1672, fps: 30, durationSeconds: .1, projectName: "Odd source", projectSeed: 1, quality: "high", audioUrl: "blob:audio", imageUrl: "data:image/png;base64,AAAA", backgroundAutoSettings, energyFrames: [] }, new AbortController().signal, vi.fn());
      expect(exporterMock.canEncodeVideo).toHaveBeenCalledWith("avc", expect.objectContaining({ width: 942, height: 1672 }));
      expect(exporterMock.canvasDimensions).toEqual({ width: 942, height: 1672 });
      expect(result).toMatchObject({ width: 942, height: 1672, fileName: "Odd-source-background-auto-942x1672-30fps.mp4" });
      expect(click).toHaveBeenCalledOnce();
    } finally {
      click.mockRestore(); vi.unstubAllGlobals();
    }
  });
});

describe("Background Auto offline export cleanup", () => {
  beforeEach(() => {
    exporterMock.behavior = "error"; exporterMock.controller = null; exporterMock.audioSettled = false; exporterMock.rejectAudio = null;
    exporterMock.conversionCancel.mockClear(); exporterMock.outputCancel.mockClear(); exporterMock.inputDispose.mockClear(); exporterMock.sourceClose.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["audio"]) })));
    vi.stubGlobal("Image", class {
      naturalWidth = 100; naturalHeight = 100; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function settings() {
    const backgroundAutoSettings = createProject().animation.backgroundAuto;
    backgroundAutoSettings.sourceWidth = 100; backgroundAutoSettings.sourceHeight = 100;
    backgroundAutoSettings.detections = [{ id: "person-a", label: "person", alias: "person", score: .95, isPerson: true, bbox: { x: .1, y: .1, width: .4, height: .8 } }];
    backgroundAutoSettings.effects = [{ ...backgroundAutoSettings.effects[0]!, detectionId: "person-a" }];
    return { width: 320, height: 320, fps: 30, durationSeconds: .1, projectName: "test", projectSeed: 42, quality: "high" as const, audioUrl: "blob:audio", imageUrl: "data:image/png;base64,AAAA", backgroundAutoSettings, energyFrames: [] };
  }

  it.each(["error", "abort"] as const)("attende la conversione audio e completa il cleanup su %s del frame encoder", async (behavior) => {
    exporterMock.behavior = behavior; const controller = new AbortController(); exporterMock.controller = controller;
    await expect(exportBackgroundAutoOfflineVideo(settings(), controller.signal, vi.fn())).rejects.toMatchObject(behavior === "abort" ? { name: "AbortError" } : { message: "frame encoder failure" });
    expect(exporterMock.audioSettled).toBe(true);
    expect(exporterMock.conversionCancel).toHaveBeenCalled(); expect(exporterMock.outputCancel).toHaveBeenCalled();
    expect(exporterMock.sourceClose).toHaveBeenCalled(); expect(exporterMock.inputDispose).toHaveBeenCalledOnce();
  });
});
