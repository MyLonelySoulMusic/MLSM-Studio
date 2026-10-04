import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class { onmessage?: (value: unknown) => void },
  convertFileSrc: (path: string) => `asset:${path}`,
  invoke,
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./pcm-tap.worklet?worker&url", () => ({ default: "pcm-tap.js" }));

class FakeAudio {
  src = "";
  preload = "";
  paused = true;
  duration = 10;
  currentTime = 0;
  pause = vi.fn(() => { this.paused = true; });
  play = vi.fn(async () => { this.paused = false; });
  load = vi.fn();
  removeAttribute = vi.fn();
}

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

describe("StreamerAudioRuntime lifecycle", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("Worker", FakeWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does not request native or browser capture on construction", async () => {
    const { StreamerAudioRuntime } = await import("./streamer-audio");
    const runtime = new StreamerAudioRuntime();
    expect(invoke).not.toHaveBeenCalled();
    expect(runtime.frame).toBeNull();
    await runtime.dispose();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the newest local track after rapid selection", async () => {
    const { StreamerAudioRuntime } = await import("./streamer-audio");
    const runtime = new StreamerAudioRuntime();
    const first = runtime.loadLocal({ nativePath: "/music/first.wav" });
    const second = runtime.loadLocal({ nativePath: "/music/second.wav" });
    await Promise.all([first, second]);
    expect(runtime.audio.src).toBe("asset:/music/second.wav");
    expect(invoke).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("taps the untouched stereo PCM before transferring it to the analyzer", async () => {
    const { StreamerAudioRuntime } = await import("./streamer-audio");
    const runtime = new StreamerAudioRuntime();
    const internal = runtime as unknown as { push(pcm: Float32Array, rate: number): void; worker: FakeWorker };
    const pcm = new Float32Array([.1, -.3, .2, -.4]);
    const subscriber = vi.fn((audio: Float32Array, rate: number) => {
      expect(internal.worker.postMessage).not.toHaveBeenCalled();
      expect(audio).toBe(pcm); expect(rate).toBe(48000);
    });
    runtime.subscribePcm(subscriber); internal.push(pcm, 48000);
    expect(subscriber).toHaveBeenCalledOnce();
    expect(internal.worker.postMessage).toHaveBeenCalledWith({ type: "pcm", pcm, sampleRate: 48000 }, [pcm.buffer]);
    expect(Array.from(pcm)).toEqual(Array.from(new Float32Array([.1, -.3, .2, -.4])));
    await runtime.dispose(); internal.push(pcm, 48000); expect(subscriber).toHaveBeenCalledOnce();
  });

  it("does not interrupt analysis if a transcript subscriber fails", async () => {
    const { StreamerAudioRuntime } = await import("./streamer-audio");
    const runtime = new StreamerAudioRuntime();
    const internal = runtime as unknown as { push(pcm: Float32Array, rate: number): void; worker: FakeWorker };
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = vi.fn(() => { throw new Error("subscriber failed"); }); runtime.subscribePcm(broken);
    internal.push(new Float32Array(4), 48000); internal.push(new Float32Array(4), 48000);
    expect(internal.worker.postMessage).toHaveBeenCalledTimes(2); expect(broken).toHaveBeenCalledOnce();
    warning.mockRestore(); await runtime.dispose();
  });
});
