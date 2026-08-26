import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";

const mediabunnyMock = vi.hoisted(() => ({
  canEncodeVideo: vi.fn<
    (codec: string, options?: Record<string, unknown>) => Promise<boolean>
  >(),
  sourceAdd: vi.fn<(timestamp: number, duration?: number) => Promise<void>>(),
  outputStart: vi.fn<() => Promise<void>>(),
  outputFinalize: vi.fn<() => Promise<void>>(),
  outputCancel: vi.fn<() => Promise<void>>(),
  conversionCancel: vi.fn<() => Promise<void>>(),
  conversionOptions: null as Record<string, unknown> | null,
  sampleDraw: vi.fn(),
  audioSourceAdd: vi.fn<(packet: unknown, metadata: unknown) => Promise<void>>(),
  audioSourceClose: vi.fn(),
  primaryAudioTrack: null as Record<string, unknown> | null,
  sourceDuration: .1,
  videoTimings: [[0, .04], [.04, .04], [.08, .02]] as Array<[number, number]>,
  forceLastProcessedDurationZero: false,
  processedDurations: [] as number[],
  videoTrack: {
    canDecode: vi.fn(async () => true),
    getDisplayWidth: vi.fn(async () => 640),
    getDisplayHeight: vi.fn(async () => 360),
    getAverageBitrate: vi.fn(async () => 2_000_000),
    getBitrate: vi.fn(async () => 2_500_000),
    computePacketStats: vi.fn(async () => ({
      packetCount: 3,
      averagePacketRate: 30,
      averageBitrate: 2_000_000
    }))
  },
  sources: [] as Array<{
    canvas: HTMLCanvasElement;
    config: Record<string, unknown>;
  }>,
  outputs: [] as Array<{
    options: { format: { kind: string }; target: unknown };
    videoTracks: Array<{ source: unknown; metadata: unknown }>;
    audioTracks: Array<{ source: unknown; metadata: unknown }>;
    state: string;
  }>,
  streamTargets: [] as Array<{ writable: unknown; options: unknown }>,
  qualityHigh: { kind: "quality-high" },
  qualityVeryHigh: { kind: "quality-very-high" }
}));

vi.mock("mediabunny", () => {
  class BlobSource {
    constructor(
      public blob: Blob,
      public options?: Record<string, unknown>
    ) {}
  }

  class BufferTarget {
    buffer: ArrayBuffer | null = null;

    _write(): void {
      // The production exporter wraps Mediabunny's runtime writer with a cap.
    }
  }

  class StreamTarget {
    private writer: WritableStreamDefaultWriter<unknown> | null = null;

    constructor(
      public writable: unknown,
      public options?: unknown
    ) {
      mediabunnyMock.streamTargets.push({ writable, options });
    }

    start(): void {
      this.writer = (this.writable as WritableStream<unknown>).getWriter();
    }

    async finalize(): Promise<void> {
      await this.writer?.close();
    }

    async cancel(): Promise<void> {
      await this.writer?.close();
    }
  }

  class CanvasSource {
    constructor(
      public canvas: HTMLCanvasElement,
      public config: Record<string, unknown>
    ) {
      mediabunnyMock.sources.push({ canvas, config });
    }

    add(timestamp: number, duration?: number): Promise<void> {
      return mediabunnyMock.sourceAdd(timestamp, duration);
    }
  }

  class WebMOutputFormat {
    readonly kind = "webm";
  }

  class Mp4OutputFormat {
    readonly kind = "mp4";
  }

  class Output {
    state = "pending";
    readonly videoTracks: Array<{ source: unknown; metadata: unknown }> = [];
    readonly audioTracks: Array<{ source: unknown; metadata: unknown }> = [];

    constructor(
      readonly options: { format: { kind: string }; target: BufferTarget | StreamTarget }
    ) {
      mediabunnyMock.outputs.push(this);
    }

    addVideoTrack(source: unknown, metadata: unknown): void {
      this.videoTracks.push({ source, metadata });
    }

    addAudioTrack(source: unknown, metadata: unknown): void {
      this.audioTracks.push({ source, metadata });
    }

    async start(): Promise<void> {
      this.state = "started";
      if (this.options.target instanceof StreamTarget) this.options.target.start();
      await mediabunnyMock.outputStart();
    }

    async finalize(): Promise<void> {
      this.state = "finalizing";
      await mediabunnyMock.outputFinalize();
      if (this.options.target instanceof StreamTarget) {
        await this.options.target.finalize();
      }
      if (this.options.target instanceof BufferTarget) {
        this.options.target.buffer = new ArrayBuffer(16);
      }
      this.state = "finalized";
    }

    async cancel(): Promise<void> {
      if (this.state === "finalizing" || this.state === "finalized") return;
      this.state = "canceled";
      await mediabunnyMock.outputCancel();
      if (this.options.target instanceof StreamTarget) {
        await this.options.target.cancel();
      }
    }
  }

  class Input {
    disposed = false;

    constructor(public options: Record<string, unknown>) {}

    async canRead(): Promise<boolean> {
      return true;
    }

    async getPrimaryVideoTrack(): Promise<typeof mediabunnyMock.videoTrack> {
      return mediabunnyMock.videoTrack;
    }

    async getPrimaryAudioTrack(): Promise<null> {
      return mediabunnyMock.primaryAudioTrack as null;
    }

    async getFirstTimestamp(): Promise<number> {
      return 0;
    }

    async computeDuration(): Promise<number> {
      return mediabunnyMock.sourceDuration;
    }

    dispose(): void {
      this.disposed = true;
    }
  }

  class EncodedPacketSink {
    constructor(public track: unknown) {}

    async *packets(): AsyncGenerator<Record<string, number>> {
      if (this.track === mediabunnyMock.primaryAudioTrack) {
        for (const [timestamp, duration, byteLength] of [[0, .05, 11], [.05, .05, 13]] as Array<[number, number, number]>) {
          yield {
            timestamp,
            duration,
            byteLength,
            clone: () => ({ timestamp, duration, byteLength })
          } as unknown as Record<string, number>;
        }
        return;
      }
      for (const [timestamp, duration] of mediabunnyMock.videoTimings) {
        yield { timestamp, duration };
      }
    }
  }

  class EncodedAudioPacketSource {
    constructor(public codec: string) {}

    add(packet: unknown, metadata: unknown): Promise<void> {
      return mediabunnyMock.audioSourceAdd(packet, metadata);
    }

    close(): void {
      mediabunnyMock.audioSourceClose();
    }
  }

  class Conversion {
    state = "idle";
    isValid = true;
    utilizedTracks = [mediabunnyMock.videoTrack];

    static async init(options: Record<string, unknown>): Promise<Conversion> {
      mediabunnyMock.conversionOptions = options;
      return new Conversion(options);
    }

    constructor(private options: Record<string, unknown>) {}

    async execute(): Promise<void> {
      this.state = "executing";
      const video = this.options.video as {
        frameRate?: number;
        process: (sample: {
          timestamp: number;
          duration: number;
          setDuration: (duration: number) => void;
          draw: (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => void;
        }) => unknown;
      };
      const timings: Array<[number, number]> = video.frameRate
        ? Array.from(
          {
            length: Math.max(1, Math.floor(
              mediabunnyMock.sourceDuration * video.frameRate
              + Math.max(1, mediabunnyMock.sourceDuration * video.frameRate) * Number.EPSILON * 16
            ))
          },
          (_, index) => [
            index / video.frameRate!,
            Math.min(1 / video.frameRate!, mediabunnyMock.sourceDuration - index / video.frameRate!)
          ]
        )
        : mediabunnyMock.videoTimings;
      for (const [index, [timestamp, duration]] of timings.entries()) {
        const sample = {
          timestamp,
          duration: mediabunnyMock.forceLastProcessedDurationZero && index === timings.length - 1 ? 0 : duration,
          setDuration(value: number) { this.duration = value; },
          draw: (...args: [CanvasRenderingContext2D, number, number, number, number]) => mediabunnyMock.sampleDraw(...args)
        };
        await video.process(sample);
        mediabunnyMock.processedDurations.push(sample.duration);
      }
      this.state = "done";
    }

    async cancel(): Promise<void> {
      this.state = "canceled";
      await mediabunnyMock.conversionCancel();
    }
  }

  return {
    ALL_FORMATS: [],
    BlobSource,
    BufferTarget,
    CanvasSource,
    Conversion,
    EncodedAudioPacketSource,
    EncodedPacketSink,
    Input,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH: mediabunnyMock.qualityHigh,
    QUALITY_VERY_HIGH: mediabunnyMock.qualityVeryHigh,
    StreamTarget,
    WebMOutputFormat,
    canEncodeVideo: mediabunnyMock.canEncodeVideo
  };
});

import type { SharedViewportRenderer } from "./offline-video-exporter";
import {
  PRO_SUBTITLE_FORMAT_DESCRIPTORS,
  PRO_SUBTITLE_BUFFER_LIMIT_BYTES,
  assertCompleteVideoFrameIntegrity,
  buildCompleteProSubtitleFileName,
  buildProSubtitleFileName,
  createProSubtitleExportCapabilities,
  estimateProSubtitleBufferBytes,
  exportProSubtitleVideo,
  rebaseProSubtitleCues,
  probeProSubtitleExportCapabilities,
  proSubtitleFrameCount,
  proSubtitleNormalizedFrameCount,
  proSubtitleFrameTiming,
  resolveProSubtitleSourceFrameDuration,
  resolveProSubtitleExportPlan,
  type ProSubtitleExportSettings
} from "./pro-subtitle-exporter";

describe("Video Editor ProSubs range helpers", () => {
  it("rebases and clips cues to the selected source fragment", () => {
    const rebased = rebaseProSubtitleCues([
      { id: "a", startSeconds: 3, endSeconds: 5, text: "prima", confidence: 1, verified: true, manual: true },
      { id: "b", startSeconds: 5.5, endSeconds: 8, text: "seconda", confidence: 1, verified: true, manual: true }
    ], 4, 3);
    expect(rebased).toEqual([
      { id: "a", startSeconds: 0, endSeconds: 1, text: "prima", confidence: 1, verified: true, manual: true },
      { id: "b", startSeconds: 1.5, endSeconds: 3, text: "seconda", confidence: 1, verified: true, manual: true }
    ]);
  });
});

function baseSettings(
  overrides: Partial<ProSubtitleExportSettings> = {}
): ProSubtitleExportSettings {
  const project = createProject();
  return {
    width: 1080,
    height: 1920,
    fps: 20,
    durationSeconds: .09,
    projectName: "My Project",
    quality: "maximum",
    backgroundMode: "transparent",
    backgroundColor: "#102030",
    subtitleCues: [{
      id: "export-visible",
      startSeconds: 0,
      endSeconds: .09,
      text: "TESTO VISIBILE",
      confidence: 1,
      verified: true,
      manual: true
    }],
    subtitleSettings: {
      ...project.animation.proSubtitles,
      autoVaryAnimations: false,
      defaultAnimation: "maskReveal"
    },
    ...overrides
  };
}

function createWritableMock(): FileSystemWritableFileStream {
  return {
    write: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined)
  } as unknown as FileSystemWritableFileStream;
}

function installSavePicker(
  writable: FileSystemWritableFileStream = createWritableMock()
): {
  picker: ReturnType<typeof vi.fn>;
  writable: FileSystemWritableFileStream;
} {
  const picker = vi.fn(async () => ({
    createWritable: async () => writable,
    getFile: async () => new File(["encoded"], "render.mp4", { type: "video/mp4" })
  }));
  Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true,
    writable: true,
    value: picker
  });
  return { picker, writable };
}

function createRenderer(): SharedViewportRenderer {
  return {
    canvas: document.createElement("canvas"),
    setExportSize: vi.fn(),
    restorePreviewSize: vi.fn(),
    renderNow: vi.fn()
  };
}

describe("ProSubtitles exporter", () => {
  let context: {
    clearRect: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    setTransform: ReturnType<typeof vi.fn>;
    translate: ReturnType<typeof vi.fn>;
    rotate: ReturnType<typeof vi.fn>;
    scale: ReturnType<typeof vi.fn>;
    beginPath: ReturnType<typeof vi.fn>;
    rect: ReturnType<typeof vi.fn>;
    clip: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
    fillStyle: string;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    globalAlpha: number;
    shadowColor: string;
    shadowBlur: number;
    shadowOffsetX: number;
    shadowOffsetY: number;
    filledRectColors: string[];
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;
  };

  beforeEach(() => {
    mediabunnyMock.sources.length = 0;
    mediabunnyMock.outputs.length = 0;
    mediabunnyMock.streamTargets.length = 0;
    mediabunnyMock.canEncodeVideo.mockReset().mockResolvedValue(true);
    mediabunnyMock.sourceAdd.mockReset().mockResolvedValue(undefined);
    mediabunnyMock.outputStart.mockReset().mockResolvedValue(undefined);
    mediabunnyMock.outputFinalize.mockReset().mockResolvedValue(undefined);
    mediabunnyMock.outputCancel.mockReset().mockResolvedValue(undefined);
    mediabunnyMock.conversionCancel.mockReset().mockResolvedValue(undefined);
    mediabunnyMock.conversionOptions = null;
    mediabunnyMock.sampleDraw.mockReset();
    mediabunnyMock.audioSourceAdd.mockReset().mockResolvedValue(undefined);
    mediabunnyMock.audioSourceClose.mockReset();
    mediabunnyMock.primaryAudioTrack = null;
    mediabunnyMock.sourceDuration = .1;
    mediabunnyMock.videoTimings = [[0, .04], [.04, .04], [.08, .02]];
    mediabunnyMock.forceLastProcessedDurationZero = false;
    mediabunnyMock.processedDurations.length = 0;
    mediabunnyMock.videoTrack.computePacketStats.mockReset().mockResolvedValue({
      packetCount: 3,
      averagePacketRate: 30,
      averageBitrate: 2_000_000
    });

    context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(() => { context.filledRectColors.push(context.fillStyle); }),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 52 })),
      fillStyle: "",
      font: "",
      textAlign: "start",
      textBaseline: "alphabetic",
      globalAlpha: 1,
      shadowColor: "",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      filledRectColors: [],
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low"
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    installSavePicker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      writable: true,
      value: undefined
    });
  });

  it("descrive onestamente ProRes come capability desktop non disponibile", () => {
    const capabilities = createProSubtitleExportCapabilities({
      vp9Alpha: true,
      avcSolid: true,
      vp9Solid: true
    });

    expect(capabilities.movProRes4444).toMatchObject({
      id: "movProRes4444",
      extension: ".mov",
      alpha: true,
      desktopRequired: true,
      supported: false
    });
    expect(capabilities.movProRes4444.reason).toMatch(/FFmpeg|VideoToolbox/);
    expect(PRO_SUBTITLE_FORMAT_DESCRIPTORS.webmVp9Alpha).toMatchObject({
      mimeType: "video/webm",
      codec: "vp9",
      alpha: true
    });
  });

  it("mappa separatamente i probe VP9 alpha, AVC e VP9 opaco", async () => {
    mediabunnyMock.canEncodeVideo.mockImplementation(async (codec, options) => {
      if (codec === "avc") return false;
      return options?.alpha === "keep";
    });

    const capabilities = await probeProSubtitleExportCapabilities(1080, 1920, "high");

    expect(capabilities.webmVp9Alpha.supported).toBe(true);
    expect(capabilities.mp4H264Solid.supported).toBe(false);
    expect(capabilities.webmVp9Solid.supported).toBe(false);
    expect(mediabunnyMock.canEncodeVideo).toHaveBeenCalledWith("vp9", expect.objectContaining({
      width: 1080,
      height: 1920,
      alpha: "keep",
      latencyMode: "quality",
      bitrate: mediabunnyMock.qualityHigh
    }));
  });

  it("apre il file picker nel gesto utente prima di avviare qualsiasi probe codec", async () => {
    const order: string[] = [];
    const writable = createWritableMock();
    const picker = vi.fn(() => {
      order.push("picker");
      return Promise.resolve({
        createWritable: async () => writable,
        getFile: async () => new File([], "unused.webm")
      });
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      writable: true,
      value: picker
    });
    mediabunnyMock.canEncodeVideo.mockImplementation(async () => {
      order.push("probe");
      return true;
    });

    await exportProSubtitleVideo(
      baseSettings(),
      createRenderer(),
      vi.fn(),
      new AbortController().signal,
      vi.fn()
    );

    expect(order[0]).toBe("picker");
    expect(order.slice(1)).toEqual(["probe", "probe", "probe"]);
    expect(writable.close).toHaveBeenCalledOnce();
    expect(writable.abort).not.toHaveBeenCalled();
  });

  it("attende i font della preview prima di codificare il primo frame", async () => {
    const fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
    let resolveFonts!: () => void;
    const ready = new Promise<FontFaceSet>((resolve) => {
      resolveFonts = () => resolve({} as FontFaceSet);
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready }
    });

    try {
      const exporting = exportProSubtitleVideo(
        baseSettings(),
        createRenderer(),
        vi.fn(),
        new AbortController().signal,
        vi.fn()
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(mediabunnyMock.sourceAdd).not.toHaveBeenCalled();
      expect(mediabunnyMock.outputStart).not.toHaveBeenCalled();

      resolveFonts();
      await exporting;
      expect(mediabunnyMock.outputStart).toHaveBeenCalledOnce();
      expect(mediabunnyMock.sourceAdd).toHaveBeenCalledTimes(2);
    } finally {
      if (fontsDescriptor) Object.defineProperty(document, "fonts", fontsDescriptor);
      else Reflect.deleteProperty(document, "fonts");
    }
  });

  it("non converte mai silenziosamente un export trasparente in opaco", () => {
    const capabilities = createProSubtitleExportCapabilities({
      vp9Alpha: false,
      avcSolid: true,
      vp9Solid: true
    });

    expect(() => resolveProSubtitleExportPlan(
      baseSettings({ allowOpaqueWebmFallback: true }),
      capabilities
    )).toThrow(/alpha/i);
  });

  it("usa WebM opaco soltanto con opt-in esplicito se AVC non è disponibile", () => {
    const capabilities = createProSubtitleExportCapabilities({
      vp9Alpha: true,
      avcSolid: false,
      vp9Solid: true
    });
    const settings = baseSettings({ backgroundMode: "solid" });

    expect(() => resolveProSubtitleExportPlan(settings, capabilities))
      .toThrow(/non viene applicato automaticamente/);
    expect(resolveProSubtitleExportPlan(
      { ...settings, allowOpaqueWebmFallback: true },
      capabilities
    )).toMatchObject({
      descriptor: { id: "webmVp9Solid" },
      alpha: "discard",
      usedOpaqueWebmFallback: true
    });
  });

  it("produce timestamp deterministici e chiude esattamente alla durata richiesta", () => {
    expect(proSubtitleFrameCount(.09, 20)).toBe(2);
    expect(proSubtitleFrameCount(48.03333333333334, 30)).toBe(1441);
    expect(proSubtitleNormalizedFrameCount(48.03333333333334, 30)).toBe(1441);
    expect(proSubtitleFrameTiming(0, .09, 20)).toEqual({
      timestampSeconds: 0,
      durationSeconds: .05
    });
    expect(proSubtitleFrameTiming(1, .09, 20)).toEqual({
      timestampSeconds: .05,
      durationSeconds: .039999999999999994
    });
    expect(() => proSubtitleFrameTiming(2, .09, 20)).toThrow(/limiti/);
    expect(buildProSubtitleFileName(
      "Titolo / test",
      1080,
      1920,
      60,
      PRO_SUBTITLE_FORMAT_DESCRIPTORS.webmVp9Alpha
    )).toBe("Titolo-test-pro-subtitles-1080x1920-60fps.webm");
    expect(buildCompleteProSubtitleFileName("Titolo / test"))
      .toBe("Titolo-test-video-originale-con-sottotitoli.mp4");
    expect(() => assertCompleteVideoFrameIntegrity(120, 119))
      .toThrow(/Controllo anti-drop fallito/);
    expect(() => assertCompleteVideoFrameIntegrity(120, 120)).not.toThrow();
  });

  it("compone il video completo al frame rate scelto senza dipendere da quello sorgente", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["source-video"], { type: "video/mp4" }))
    );
    const onProgress = vi.fn();
    mediabunnyMock.videoTrack.computePacketStats.mockResolvedValue({
      packetCount: 2,
      averagePacketRate: 20,
      averageBitrate: 2_000_000
    });

    const result = await exportProSubtitleVideo(
      baseSettings({
        outputMode: "completeVideo",
        sourceVideoUrl: "blob:source-video",
        sourceVideoName: "source.mp4",
        durationSeconds: .1
      }),
      createRenderer(),
      vi.fn(),
      new AbortController().signal,
      onProgress
    );

    expect(fetchSpy).toHaveBeenCalledWith("blob:source-video", {
      signal: expect.any(AbortSignal)
    });
    expect(result).toMatchObject({
      format: { id: "mp4H264Solid" },
      sourceFrameCount: 3,
      encodedFrameCount: 2
    });
    expect(mediabunnyMock.sampleDraw).toHaveBeenCalledTimes(2);
    expect(context.fillText).toHaveBeenCalled();
    expect(mediabunnyMock.conversionOptions).toMatchObject({
      tracks: "primary",
      trim: { start: 0, end: .1 },
      audio: {},
      composable: true,
      video: {
        codec: "avc",
        forceTranscode: true,
        frameRate: 20,
        allowRotationMetadata: false,
        processedWidth: 640,
        processedHeight: 360
      }
    });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      currentFrame: 2,
      totalFrames: 2,
      progress: 1
    }));
  });

  it("recupera la durata zero dell’ultimo frame sorgente 1801 senza perderlo", async () => {
    const frameRate = 30;
    const frameCount = 1801;
    mediabunnyMock.sourceDuration = frameCount / frameRate;
    mediabunnyMock.forceLastProcessedDurationZero = true;
    mediabunnyMock.videoTimings = Array.from({ length: frameCount }, (_, index) => [
      index / frameRate,
      index === frameCount - 1 ? 0 : 1 / frameRate
    ]);
    mediabunnyMock.videoTrack.computePacketStats.mockResolvedValue({
      packetCount: frameCount,
      averagePacketRate: frameRate,
      averageBitrate: 2_000_000
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["source-video"], { type: "video/mp4" }))
    );

    expect(resolveProSubtitleSourceFrameDuration(
      1800 / frameRate,
      0,
      1 / frameRate,
      frameCount / frameRate,
      frameRate
    )).toBeCloseTo(1 / frameRate);

    const result = await exportProSubtitleVideo(
      baseSettings({
        outputMode: "completeVideo",
        sourceVideoUrl: "blob:source-video",
        fps: frameRate,
        durationSeconds: mediabunnyMock.sourceDuration
      }),
      createRenderer(),
      vi.fn(),
      new AbortController().signal,
      vi.fn()
    );

    expect(result).toMatchObject({
      sourceFrameCount: frameCount,
      encodedFrameCount: frameCount
    });
    expect(mediabunnyMock.sampleDraw).toHaveBeenCalledTimes(frameCount);
    expect(mediabunnyMock.processedDurations.at(-1)).toBeCloseTo(1 / frameRate);
  });

  it("non inventa il frame 1442 per una durata flottante di 1441 frame", async () => {
    const frameRate = 30;
    const frameCount = 1441;
    mediabunnyMock.sourceDuration = 48.03333333333334;
    mediabunnyMock.videoTimings = Array.from({ length: frameCount }, (_, index) => [
      index / frameRate,
      1 / frameRate
    ]);
    mediabunnyMock.videoTrack.computePacketStats.mockResolvedValue({
      packetCount: frameCount,
      averagePacketRate: frameRate,
      averageBitrate: 2_000_000
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["source-video"], { type: "video/mp4" }))
    );

    const result = await exportProSubtitleVideo(
      baseSettings({
        outputMode: "completeVideo",
        sourceVideoUrl: "blob:source-video",
        fps: frameRate,
        durationSeconds: mediabunnyMock.sourceDuration
      }),
      createRenderer(),
      vi.fn(),
      new AbortController().signal,
      vi.fn()
    );

    expect(result).toMatchObject({
      sourceFrameCount: frameCount,
      encodedFrameCount: frameCount
    });
    expect(mediabunnyMock.sampleDraw).toHaveBeenCalledTimes(frameCount);
  });

  it("annulla il risultato se il file finalizzato ha perso anche un solo frame", async () => {
    const { writable } = installSavePicker();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["source-video"], { type: "video/mp4" }))
    );
    mediabunnyMock.videoTrack.computePacketStats.mockResolvedValueOnce({
      packetCount: 2,
      averagePacketRate: 20,
      averageBitrate: 2_000_000
    });

    await expect(exportProSubtitleVideo(
      baseSettings({
        outputMode: "completeVideo",
        sourceVideoUrl: "blob:source-video",
        fps: 30,
        durationSeconds: .1
      }),
      createRenderer(),
      vi.fn(),
      new AbortController().signal,
      vi.fn()
    )).rejects.toThrow(/Controllo anti-drop fallito/);

    expect(writable.abort).toHaveBeenCalled();
  });

  it("copia i pacchetti audio originali senza passarli al transcoder", async () => {
    mediabunnyMock.primaryAudioTrack = {
      getCodec: vi.fn(async () => "aac"),
      getName: vi.fn(async () => "Original mix"),
      getDisposition: vi.fn(async () => ({ default: true })),
      getDecoderConfig: vi.fn(async () => ({
        codec: "mp4a.40.2",
        sampleRate: 48_000,
        numberOfChannels: 2
      }))
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["source-video"], { type: "video/mp4" }))
    );

    const result = await exportProSubtitleVideo(
      baseSettings({
        outputMode: "completeVideo",
        sourceVideoUrl: "blob:source-video",
        fps: 30,
        durationSeconds: .1
      }),
      createRenderer(),
      vi.fn(),
      new AbortController().signal,
      vi.fn()
    );

    expect(result.copiedAudioPacketCount).toBe(2);
    expect(mediabunnyMock.audioSourceAdd).toHaveBeenCalledTimes(2);
    expect(mediabunnyMock.audioSourceClose).toHaveBeenCalledOnce();
    expect(mediabunnyMock.outputs.at(-1)?.audioTracks).toHaveLength(1);
    expect(mediabunnyMock.conversionOptions).toMatchObject({
      audio: { discard: true }
    });
  });

  it("rifiuta in preflight un BufferTarget che supererebbe il limite RAM", async () => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      writable: true,
      value: undefined
    });
    const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, "storage");
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { getDirectory: vi.fn(async () => { throw new Error("OPFS unavailable"); }) }
    });
    const hugeSettings = baseSettings({
      width: 3840,
      height: 2160,
      fps: 120,
      durationSeconds: 180
    });

    try {
      expect(estimateProSubtitleBufferBytes(hugeSettings))
        .toBeGreaterThan(PRO_SUBTITLE_BUFFER_LIMIT_BYTES);
      await expect(exportProSubtitleVideo(
        hugeSettings,
        createRenderer(),
        vi.fn(),
        new AbortController().signal,
        vi.fn()
      )).rejects.toThrow(/memoria del browser|limite sicuro/i);
      expect(mediabunnyMock.outputs).toHaveLength(0);
    } finally {
      if (storageDescriptor) Object.defineProperty(navigator, "storage", storageDescriptor);
      else Reflect.deleteProperty(navigator, "storage");
    }
  });

  it("blocca un export vuoto invece di generare un video senza testo", async () => {
    await expect(exportProSubtitleVideo(
      baseSettings({ subtitleCues: [] }),
      createRenderer(),
      vi.fn(),
      new AbortController().signal,
      vi.fn()
    )).rejects.toThrow(/Nessun sottotitolo visibile/);
    expect(mediabunnyMock.outputs).toHaveLength(0);
    expect(mediabunnyMock.sourceAdd).not.toHaveBeenCalled();
  });

  it("esporta il solo canvas overlay come VP9 alpha senza riempire lo sfondo", async () => {
    const renderer = createRenderer();
    const setRenderTime = vi.fn();
    const onProgress = vi.fn();

    const result = await exportProSubtitleVideo(
      baseSettings(),
      renderer,
      setRenderTime,
      new AbortController().signal,
      onProgress
    );

    expect(result).toMatchObject({
      format: { id: "webmVp9Alpha", extension: ".webm", alpha: true },
      usedOpaqueWebmFallback: false
    });
    expect(mediabunnyMock.sources[0]?.config).toMatchObject({
      codec: "vp9",
      alpha: "keep",
      latencyMode: "quality",
      contentHint: "text",
      bitrate: mediabunnyMock.qualityVeryHigh
    });
    expect(mediabunnyMock.outputs[0]?.options.format.kind).toBe("webm");
    expect(mediabunnyMock.outputs[0]?.videoTracks).toHaveLength(1);
    expect(mediabunnyMock.outputs[0]?.videoTracks[0]?.metadata)
      .toEqual({ frameRate: 20 });
    expect(mediabunnyMock.sourceAdd.mock.calls).toEqual([
      [0, .05],
      [.05, .039999999999999994]
    ]);
    expect(context.clearRect).toHaveBeenCalledTimes(2);
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(context.fillText).toHaveBeenCalled();
    expect(setRenderTime.mock.calls).toEqual([[null]]);
    expect(renderer.setExportSize).not.toHaveBeenCalled();
    expect(renderer.renderNow).not.toHaveBeenCalled();
    expect(renderer.restorePreviewSize).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      currentFrame: 2,
      totalFrames: 2,
      progress: 1,
      estimatedRemainingMs: 0
    }));
    expect(mediabunnyMock.streamTargets).toHaveLength(1);
  });

  it("compone lo sfondo pieno e usa MP4 AVC con alpha scartato", async () => {
    const renderer = createRenderer();

    const result = await exportProSubtitleVideo(
      baseSettings({ backgroundMode: "solid", backgroundColor: "#abc123" }),
      renderer,
      vi.fn(),
      new AbortController().signal,
      vi.fn()
    );

    expect(result.format.id).toBe("mp4H264Solid");
    expect(mediabunnyMock.outputs[0]?.options.format.kind).toBe("mp4");
    expect(mediabunnyMock.sources[0]?.config).toMatchObject({
      codec: "avc",
      alpha: "discard"
    });
    expect(context.filledRectColors).toEqual(["#abc123", "#abc123"]);
    expect(context.fillRect).toHaveBeenCalledTimes(2);
  });

  it("usa BufferTarget e scarica il risultato quando il file picker non esiste", async () => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      writable: true,
      value: undefined
    });
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    const createObjectURL = vi.fn(() => "blob:pro-subtitles");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    vi.useFakeTimers();

    try {
      const result = await exportProSubtitleVideo(
        baseSettings(),
        createRenderer(),
        vi.fn(),
        new AbortController().signal,
        vi.fn()
      );
      expect(result.fileName).toBe(
        "My-Project-pro-subtitles-1080x1920-20fps.webm"
      );
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(30_000);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:pro-subtitles");
      expect(mediabunnyMock.streamTargets).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      if (createObjectUrlDescriptor) {
        Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
      } else {
        delete (URL as { createObjectURL?: unknown }).createObjectURL;
      }
      if (revokeObjectUrlDescriptor) {
        Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
      } else {
        delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
      }
    }
  });

  it("ripiega su OPFS se il file picker non può essere usato", async () => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      writable: true,
      value: vi.fn(async () => {
        throw new DOMException("User activation unavailable", "SecurityError");
      })
    });
    const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, "storage");
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    const writable = createWritableMock();
    const getFile = vi.fn(async () => new File(["encoded"], "render.part"));
    const getFileHandle = vi.fn(async () => ({ createWritable: async () => writable, getFile }));
    const removeEntry = vi.fn(async () => undefined);
    const directory = {
      async *keys() { /* nessun file orfano */ },
      getFileHandle,
      removeEntry
    };
    const getDirectoryHandle = vi.fn(async () => directory);
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { getDirectory: vi.fn(async () => ({ getDirectoryHandle })) }
    });
    const createObjectURL = vi.fn(() => "blob:opfs-pro-subtitles");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.useFakeTimers();

    try {
      await exportProSubtitleVideo(
        baseSettings(),
        createRenderer(),
        vi.fn(),
        new AbortController().signal,
        vi.fn()
      );
      expect(mediabunnyMock.streamTargets).toHaveLength(1);
      expect(mediabunnyMock.streamTargets[0]?.writable).toBeInstanceOf(WritableStream);
      expect(writable.close).toHaveBeenCalledOnce();
      expect(writable.abort).not.toHaveBeenCalled();
      expect(getFile).toHaveBeenCalledOnce();
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(File));
      expect(click).toHaveBeenCalledOnce();
      expect(removeEntry).toHaveBeenCalledWith(expect.stringMatching(/^pro-subtitles-.+\.part$/));
      vi.advanceTimersByTime(30_000);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:opfs-pro-subtitles");
    } finally {
      vi.useRealTimers();
      if (storageDescriptor) Object.defineProperty(navigator, "storage", storageDescriptor);
      else Reflect.deleteProperty(navigator, "storage");
      if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
      else delete (URL as { createObjectURL?: unknown }).createObjectURL;
      if (revokeObjectUrlDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
      else delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });

  it("annulla l’encoder e ripristina sempre viewport e tempo", async () => {
    const controller = new AbortController();
    const renderer = createRenderer();
    const setRenderTime = vi.fn();
    const { writable } = installSavePicker();
    mediabunnyMock.sourceAdd.mockImplementationOnce(async () => {
      controller.abort();
    });

    await expect(exportProSubtitleVideo(
      baseSettings({ durationSeconds: .2 }),
      renderer,
      setRenderTime,
      controller.signal,
      vi.fn()
    )).rejects.toMatchObject({ name: "AbortError" });

    expect(mediabunnyMock.outputCancel).toHaveBeenCalledOnce();
    expect(writable.abort).toHaveBeenCalledOnce();
    expect(writable.close).not.toHaveBeenCalled();
    expect(renderer.restorePreviewSize).toHaveBeenCalledOnce();
    expect(setRenderTime).toHaveBeenLastCalledWith(null);
  });

  it("sblocca l’interfaccia ma non elimina OPFS mentre WebCodecs sta ancora finalizzando", async () => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      writable: true,
      value: undefined
    });
    const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, "storage");
    const writable = createWritableMock();
    const getFileHandle = vi.fn(async () => ({
      createWritable: async () => writable,
      getFile: async () => new File(["encoded"], "render.part")
    }));
    const removeEntry = vi.fn(async () => undefined);
    const directory = { getFileHandle, removeEntry };
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        getDirectory: vi.fn(async () => ({
          getDirectoryHandle: async () => directory
        }))
      }
    });
    let releaseFinalize: (() => void) | undefined;
    let markFinalizing: (() => void) | undefined;
    const finalizing = new Promise<void>((resolve) => { markFinalizing = resolve; });
    mediabunnyMock.outputFinalize.mockImplementation(() => {
      markFinalizing?.();
      return new Promise<void>((resolve) => { releaseFinalize = resolve; });
    });
    const controller = new AbortController();
    vi.useFakeTimers();

    try {
      const exportPromise = exportProSubtitleVideo(
        baseSettings({ durationSeconds: .04 }),
        createRenderer(),
        vi.fn(),
        controller.signal,
        vi.fn()
      );
      const rejection = expect(exportPromise).rejects.toMatchObject({ name: "AbortError" });
      await finalizing;
      controller.abort();
      await vi.advanceTimersByTimeAsync(3_000);
      await rejection;

      expect(writable.abort).toHaveBeenCalledOnce();
      expect(removeEntry).not.toHaveBeenCalled();

      releaseFinalize?.();
      await vi.runAllTimersAsync();
      await Promise.resolve();
      expect(removeEntry).toHaveBeenCalledWith(expect.stringMatching(/^pro-subtitles-.+\.part$/));
    } finally {
      vi.useRealTimers();
      if (storageDescriptor) Object.defineProperty(navigator, "storage", storageDescriptor);
      else Reflect.deleteProperty(navigator, "storage");
    }
  });

  it("rifiuta MOV ProRes senza simulare un file incompatibile", async () => {
    const renderer = createRenderer();
    const setRenderTime = vi.fn();

    await expect(exportProSubtitleVideo(
      baseSettings({ format: "movProRes4444" }),
      renderer,
      setRenderTime,
      new AbortController().signal,
      vi.fn()
    )).rejects.toThrow(/FFmpeg|VideoToolbox/);

    expect(mediabunnyMock.canEncodeVideo).not.toHaveBeenCalled();
    expect(mediabunnyMock.outputs).toHaveLength(0);
    expect(renderer.restorePreviewSize).toHaveBeenCalledOnce();
    expect(setRenderTime).toHaveBeenLastCalledWith(null);
  });
});
