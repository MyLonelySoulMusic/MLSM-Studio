import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";

const state = vi.hoisted(() => ({
  codec: "aac", hasAudio: true, audioPackets: 5, validConversion: true,
  canEncodeAudio: vi.fn(), registerAacEncoder: vi.fn(), conversionOptions: vi.fn(), cancel: vi.fn(), timings: [] as number[]
}));
vi.mock("@mediabunny/aac-encoder", () => ({ registerAacEncoder: state.registerAacEncoder }));
vi.mock("./portrait-landscape-renderer", () => ({ renderPortraitLandscapeFrame: vi.fn() }));
vi.mock("mediabunny", () => {
  const video = { computeDuration: async () => .1, computePacketStats: async () => ({ packetCount: 3 }) };
  const audio = {
    getCodec: async () => state.codec, getFirstTimestamp: async () => 0,
    getNumberOfChannels: async () => 2, getSampleRate: async () => 48_000,
    computePacketStats: async () => ({ packetCount: state.audioPackets })
  };
  class BufferTarget { buffer = new ArrayBuffer(100); }
  return {
    ALL_FORMATS: [], BlobSource: class {}, BufferTarget, StreamTarget: class {}, Mp4OutputFormat: class {},
    QUALITY_HIGH: 1, QUALITY_VERY_HIGH: 2, canEncodeVideo: async () => true, canEncodeAudio: state.canEncodeAudio,
    Input: class {
      getPrimaryVideoTrack = async () => video;
      getPrimaryAudioTrack = async () => state.hasAudio ? audio : null;
      dispose() {}
    },
    CanvasSource: class {
      add = async (timestamp: number) => { state.timings.push(timestamp); };
      close() {}
    },
    CanvasSink: class {
      async *canvasesAtTimestamps(times: number[]) { for (const time of times) yield { canvas: {}, timestamp: time }; }
    },
    Output: class {
      addVideoTrack() {}
      start = async () => undefined;
      finalize = async () => undefined;
      cancel = state.cancel;
    },
    Conversion: { init: async (options: unknown) => {
      state.conversionOptions(options);
      return { isValid: state.validConversion, utilizedTracks: state.validConversion ? [audio] : [], execute: async () => undefined, cancel: async () => undefined };
    } }
  };
});

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); state.timings.length = 0;
  state.codec = "aac"; state.hasAudio = true; state.audioPackets = 5; state.validConversion = true;
  state.cancel.mockResolvedValue(undefined);
  state.canEncodeAudio.mockImplementation(async () => state.registerAacEncoder.mock.calls.length > 0);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["source"]) }));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function run(signal = new AbortController().signal) {
  const { exportPortraitLandscapeOfflineVideo } = await import("./portrait-landscape-offline-exporter");
  const progress = vi.fn();
  const result = await exportPortraitLandscapeOfflineVideo({
    width: 640, height: 360, fps: 30, durationSeconds: .1, projectName: "AAC Windows", quality: "maximum",
    sourceVideoUrl: "blob:source", portraitLandscapeSettings: { ...createProject().animation.portraitLandscape, sideImageUrl: null, coverImageUrl: null },
    energyFrames: [], rhythmEvents: [], bpm: 120
  }, signal, progress);
  return { result, progress };
}

describe("From 9:16 to 16:9 audio export pipeline", () => {
  it("exports and verifies audio on Windows with no AAC encoder when the input is AAC", async () => {
    const { result, progress } = await run();
    expect(result.audioPacketCount).toBe(5);
    expect(result.encodedFrameCount).toBe(3);
    expect(state.conversionOptions.mock.calls[0]?.[0]).toMatchObject({ audio: { codec: "aac" }, trim: { start: 0, end: .1 } });
    expect(state.conversionOptions.mock.calls[0]?.[0].audio.forceTranscode).toBeUndefined();
    expect(state.canEncodeAudio).not.toHaveBeenCalled();
    expect(state.registerAacEncoder).not.toHaveBeenCalled();
    expect(state.timings).toEqual([0, 1 / 30, 2 / 30]);
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "rendering", indeterminate: false, currentFrame: 3 });
  });

  it("exports non-AAC inputs through the bundled software encoder instead of failing", async () => {
    state.codec = "opus";
    const { result } = await run();
    expect(result.audioPacketCount).toBeGreaterThan(0);
    expect(state.registerAacEncoder).toHaveBeenCalledOnce();
    expect(state.conversionOptions.mock.calls[0]?.[0].audio).toEqual({ codec: "aac", bitrate: 320_000, numberOfChannels: 2, sampleRate: 48_000, forceTranscode: true });
  });

  it("does not load an encoder for a silent input", async () => {
    state.hasAudio = false;
    expect((await run()).result.audioPacketCount).toBe(0);
    expect(state.conversionOptions).not.toHaveBeenCalled();
    expect(state.registerAacEncoder).not.toHaveBeenCalled();
  });

  it("still refuses to deliver a file that unexpectedly lost its audio", async () => {
    state.audioPackets = 0;
    await expect(run()).rejects.toThrow(/nessun pacchetto/);
  });

  it("cancels an invalid audio conversion instead of exporting silently", async () => {
    state.validConversion = false;
    await expect(run()).rejects.toThrow(/traccia audio/);
    expect(state.cancel).toHaveBeenCalled();
  });

  it("honors cancellation before starting an encoder", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(run(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(state.registerAacEncoder).not.toHaveBeenCalled();
  });
});
