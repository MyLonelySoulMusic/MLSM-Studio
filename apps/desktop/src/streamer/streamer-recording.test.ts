import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadRecording, floatWavHeader, listRecordings, recordingBitrate, recordingCodec, RecordingWriter, stereoBuffer, StreamerRecording, type RecordingInfo, type SavedRecording } from "./streamer-recording";

class Directory {
  files = new Map<string, Uint8Array>(); children = new Map<string, Directory>();
  async getDirectoryHandle(name: string, options?: { create: boolean }) {
    if (!this.children.has(name)) { if (!options?.create) throw new Error("Not found"); this.children.set(name, new Directory()); }
    return this.children.get(name)!;
  }
  async *keys() { yield* this.children.keys(); }
  async getFileHandle(name: string) {
    const files = this.files;
    return {
      createWritable: async () => {
        let offset = 0, content = new Uint8Array(0);
        return {
          seek: async (position: number) => { offset = position; },
          write: async (data: string | ArrayBuffer | Blob) => {
            const part = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(data.size) : new Uint8Array(data);
            const next = new Uint8Array(Math.max(content.length, offset + part.length)); next.set(content); next.set(part, offset); content = next; offset += part.length;
          },
          close: async () => { files.set(name, content); }, abort: async () => undefined,
        };
      },
      getFile: async () => ({ size: files.get(name)?.length ?? 0, text: async () => new TextDecoder().decode(files.get(name)) }),
    };
  }
}
class Track {
  stop = vi.fn(); listeners = new Map<string, () => void>();
  getSettings() { return { width: 2560, height: 1440, frameRate: 60 }; }
  addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
  removeEventListener(name: string) { this.listeners.delete(name); }
}
class Stream {
  constructor(readonly tracks: Track[]) {}
  getVideoTracks() { return this.tracks.filter(track => track === video); }
  getAudioTracks() { return this.tracks.filter(track => track !== video); }
  getTracks() { return this.tracks; }
}
class Recorder {
  static isTypeSupported(mime: string) { return mime.includes("vp9"); }
  static last: Recorder;
  state = "inactive"; mimeType: string; videoBitsPerSecond: number; audioBitsPerSecond: number;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(readonly stream: Stream, options: MediaRecorderOptions) { Recorder.last = this; this.mimeType = options.mimeType!; this.videoBitsPerSecond = options.videoBitsPerSecond!; this.audioBitsPerSecond = options.audioBitsPerSecond!; }
  start() { this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(103)]) }); this.onstop?.(); }
}
class Context {
  static last: Context;
  currentTime = 0; sampleRate = 48000; close = vi.fn(async () => undefined); resume = vi.fn(async () => undefined);
  nodes: { buffer: AudioBuffer | null; stop: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> }[] = [];
  constructor() { Context.last = this; }
  createMediaStreamDestination() { return { stream: new Stream([audio]), channelCount: 2, channelCountMode: "explicit" }; }
  createBuffer(channels: number, frames: number, sampleRate: number) {
    const pcm = Array.from({ length: channels }, () => new Float32Array(frames));
    return { duration: frames / sampleRate, getChannelData: (channel: number) => pcm[channel] } as AudioBuffer;
  }
  createBufferSource() {
    const node = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), stop: vi.fn(), start: vi.fn(), onended: null };
    this.nodes.push(node); return node;
  }
}
let root: Directory, video: Track, audio: Track, listener: ((pcm: Float32Array, rate: number) => void) | undefined;
const off = vi.fn(), update = vi.fn<(info: RecordingInfo) => void>(), completed = vi.fn<(item: SavedRecording | null, error?: unknown) => void>();
const source = { subscribePcm: (fn: typeof listener) => { listener = fn; return off; } };
beforeEach(() => {
  vi.useFakeTimers(); root = new Directory(); video = new Track(); audio = new Track(); listener = undefined; off.mockReset(); update.mockReset(); completed.mockReset();
  vi.stubGlobal("AudioContext", Context); vi.stubGlobal("MediaRecorder", Recorder); vi.stubGlobal("MediaStream", Stream);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getDisplayMedia: vi.fn(async () => new Stream([video])) } });
  Object.defineProperty(navigator, "storage", { configurable: true, value: { getDirectory: async () => root } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete window.showSaveFilePicker; });
async function finish(session: StreamerRecording) { const result = session.finish(); await vi.runAllTimersAsync(); return result; }

describe("recording quality and stereo", () => {
  it("prefers VP9/Opus, handles MP4 fallback and never pretends to have a codec", () => {
    expect(recordingCodec(mime => mime.includes("opus"))).toContain("vp9");
    expect(recordingCodec(mime => mime === "video/mp4")).toBe("video/mp4");
    expect(recordingCodec(() => false)).toBeUndefined();
    expect(recordingBitrate(3840, 2160, 60)).toBeGreaterThan(90_000_000);
    expect(recordingBitrate(1920, 1080, 30)).toBe(24_000_000);
  });
  it("produces a stereo IEEE float WAV with the original source rate", () => {
    const header = new DataView(floatWavHeader(44100, 800));
    expect(header.getUint16(20, true)).toBe(3); expect(header.getUint16(22, true)).toBe(2);
    expect(header.getUint32(24, true)).toBe(44100); expect(header.getUint16(34, true)).toBe(32);
    expect(header.getUint32(44, true)).toBe(100); expect(header.getUint32(52, true)).toBe(800);
    expect(() => floatWavHeader(48000, 0xffffffff)).toThrow(); expect(() => floatWavHeader(0, 8)).toThrow();
  });
  it("never averages L/R or invents a right channel for hard-panned stereo", () => {
    const pcm = new Float32Array([.4, 0, -.8, 0]);
    const buffer = stereoBuffer(new Context() as unknown as AudioContext, pcm, 44100);
    expect(buffer.getChannelData(0)).toEqual(new Float32Array([.4, -.8]));
    expect(buffer.getChannelData(1)).toEqual(new Float32Array(2)); expect(pcm).toEqual(new Float32Array([.4, 0, -.8, 0]));
  });
});
describe("recording lifecycle", () => {
  it("asks for video only, arms without recording, starts on Play and saves the final encoder chunk plus original stereo WAV", async () => {
    const session = await StreamerRecording.arm(update, completed);
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false, selfBrowserSurface: "include" }));
    expect(Recorder.last.state).toBe("inactive"); expect(update.mock.lastCall?.[0].phase).toBe("armed");
    await session.start(source); expect(Recorder.last.state).toBe("recording");
    const pcm = new Float32Array([.4, -.4, .2, 0]); listener!(pcm, 44100);
    const item = (await finish(session))!;
    expect(item.complete).toBe(true); expect(item.sampleRate).toBe(44100); expect(item.width).toBe(2560); expect(item.videoBytes).toBe(103); expect(item.audioBytes).toBe(72);
    const files = root.children.get("mlsm-streamer-recordings-v1")!.children.get(item.id)!.files;
    const wav = new DataView(files.get("audio.wav")!.buffer);
    expect(wav.getFloat32(56, true)).toBeCloseTo(.4); expect(wav.getFloat32(60, true)).toBeCloseTo(-.4); expect(wav.getFloat32(68, true)).toBe(0);
    expect(wav.getUint32(52, true)).toBe(16); expect(off).toHaveBeenCalledOnce();
    expect(video.stop).toHaveBeenCalledOnce(); expect(audio.stop).toHaveBeenCalledOnce(); expect(Context.last.close).toHaveBeenCalledOnce();
    expect(await listRecordings()).toEqual([item]);
  });
  it("pauses both video and audio, ignores PCM during pause, resumes without creating a second take", async () => {
    const session = await StreamerRecording.arm(update, completed); await session.start(source);
    listener!(new Float32Array([1, -1]), 48000); session.pause();
    expect(Recorder.last.state).toBe("paused"); listener!(new Float32Array([8, 8]), 48000);
    await session.start(source); listener!(new Float32Array([.5, -.5]), 48000);
    expect((await finish(session))!.audioBytes).toBe(72);
  });
  it("finishes when sharing is stopped, without stopping any analysis source", async () => {
    const session = await StreamerRecording.arm(update, completed); await session.start(source); listener!(new Float32Array([1, -1]), 48000);
    video.listeners.get("ended")!(); await vi.runAllTimersAsync(); const item = await session.finish();
    expect(item?.complete).toBe(true); expect(off).toHaveBeenCalledOnce(); expect(completed).toHaveBeenCalledOnce();
  });
  it("makes Stop idempotent and does not label a silent missing-source take as successful", async () => {
    const session = await StreamerRecording.arm(update, completed); await session.start(source);
    const once = session.finish(), twice = session.finish(); expect(once).toBe(twice);
    await vi.runAllTimersAsync(); expect((await once)?.complete).toBe(false); expect(completed).toHaveBeenCalledOnce();
    expect(String(completed.mock.lastCall?.[1])).toContain("No source audio");
  });
  it("cancels an armed session and closes only recording-owned tracks, with no empty download", async () => {
    const session = await StreamerRecording.arm(update, completed);
    expect(await finish(session)).toBeNull(); expect(await listRecordings()).toEqual([]);
    expect(video.stop).toHaveBeenCalledOnce(); expect(completed).toHaveBeenCalledWith(null, undefined);
  });
  it("stops on a missing audio source and reports the actual cause", async () => {
    const session = await StreamerRecording.arm(update, completed); await session.start(source);
    await vi.advanceTimersByTimeAsync(7300); await session.finish();
    expect(String(completed.mock.lastCall?.[1])).toContain("No audio received"); expect(off).toHaveBeenCalledOnce();
  });
  it("cleans up the display surface if browser storage is missing", async () => {
    Object.defineProperty(navigator, "storage", { configurable: true, value: {} });
    await expect(StreamerRecording.arm(update, completed)).rejects.toThrow("storage");
    expect(video.stop).toHaveBeenCalled();
  });
  it("reports unsupported runtimes, instead of silently recording a microphone", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
    await expect(StreamerRecording.arm(update, completed)).rejects.toThrow("Chrome or Edge");
  });
  it("preserves the previous completed take when a new take fails", async () => {
    const first = await StreamerRecording.arm(update, completed); await first.start(source); listener!(new Float32Array([1, -1]), 48000); const item = await finish(first);
    video = new Track(); const second = await StreamerRecording.arm(update, completed); await second.start(source);
    listener!(new Float32Array([1, -1]), 48000); listener!(new Float32Array([1, -1]), 44100); await finish(second);
    expect(await listRecordings()).toContainEqual(item); expect(String(completed.mock.lastCall?.[1])).toContain("sample rate changed");
  });
  it("opens the save picker in the click before awaiting storage access", async () => {
    const session = await StreamerRecording.arm(update, completed); await session.start(source); listener!(new Float32Array([1, -1]), 48000); const item = (await finish(session))!;
    const write = vi.fn(async () => undefined), close = vi.fn(async () => undefined);
    window.showSaveFilePicker = vi.fn(async () => ({ createWritable: async () => ({ write, close }) } as unknown as FileSystemFileHandle));
    const saved = downloadRecording(item, "video"); expect(window.showSaveFilePicker).toHaveBeenCalledOnce(); await saved;
    expect(write).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(await listRecordings()).toHaveLength(1);
  });
});
describe("bounded disk writes", () => {
  it("serializes chunks and waits for the last write before closing", async () => {
    const order: number[] = [], failed = vi.fn();
    const writer = new RecordingWriter({ write: async (part: ArrayBuffer) => { order.push(new Uint8Array(part)[0]!); }, close: async () => { order.push(9); } } as unknown as FileSystemWritableFileStream, failed);
    writer.append(new Uint8Array([1]).buffer); writer.append(new Uint8Array([2]).buffer); await writer.close();
    expect(order).toEqual([1, 2, 9]); expect(writer.bytes).toBe(2); expect(failed).not.toHaveBeenCalled();
  });
  it("reports disk failure without an unhandled rejected promise", async () => {
    const failed = vi.fn(), close = vi.fn(async () => undefined);
    const writer = new RecordingWriter({ write: async () => { throw new Error("Disk full"); }, close } as unknown as FileSystemWritableFileStream, failed);
    writer.append(new ArrayBuffer(8)); await expect(writer.close()).rejects.toThrow("Disk full"); expect(failed).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
  it("rejects excessive queued data instead of exhausting memory", async () => {
    const failed = vi.fn(); const writer = new RecordingWriter({ close: async () => undefined } as FileSystemWritableFileStream, failed);
    writer.append(new ArrayBuffer(33 * 1024 * 1024)); await expect(writer.close()).rejects.toThrow("cannot keep up"); expect(failed).toHaveBeenCalledOnce();
  });
});
