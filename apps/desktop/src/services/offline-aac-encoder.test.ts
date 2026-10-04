import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ canEncodeAudio: vi.fn(), registerAacEncoder: vi.fn() }));
vi.mock("mediabunny", () => ({ canEncodeAudio: mocks.canEncodeAudio }));
vi.mock("@mediabunny/aac-encoder", () => ({ registerAacEncoder: mocks.registerAacEncoder }));

const config = { numberOfChannels: 2, sampleRate: 44_100, bitrate: 320_000 };
const track = (codec = "aac", firstTimestamp = 0) => ({
  getCodec: vi.fn().mockResolvedValue(codec), getFirstTimestamp: vi.fn().mockResolvedValue(firstTimestamp),
  getNumberOfChannels: vi.fn().mockResolvedValue(2), getSampleRate: vi.fn().mockResolvedValue(44_100)
});

beforeEach(() => { vi.resetModules(); mocks.canEncodeAudio.mockReset(); mocks.registerAacEncoder.mockReset(); });

describe("offline AAC compatibility", () => {
  it("copies existing AAC without checking the unavailable Windows encoder", async () => {
    const { prepareOfflineAacAudio } = await import("./offline-aac-encoder");
    expect(await prepareOfflineAacAudio(track())).toEqual({ mode: "copy", options: { codec: "aac" } });
    expect(mocks.canEncodeAudio).not.toHaveBeenCalled();
    expect(mocks.registerAacEncoder).not.toHaveBeenCalled();
  });

  it("keeps the native encoder on supported devices, retaining stereo and sample rate", async () => {
    mocks.canEncodeAudio.mockResolvedValue(true);
    const { prepareOfflineAacAudio } = await import("./offline-aac-encoder");
    expect(await prepareOfflineAacAudio(track("opus"))).toEqual({ mode: "native", options: { codec: "aac", ...config, forceTranscode: true } });
    expect(mocks.canEncodeAudio).toHaveBeenCalledWith("aac", config);
    expect(mocks.registerAacEncoder).not.toHaveBeenCalled();
  });

  it("loads the bundled encoder when AAC is absent and rechecks support", async () => {
    mocks.canEncodeAudio.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { prepareOfflineAacAudio } = await import("./offline-aac-encoder");
    expect(await prepareOfflineAacAudio(track("mp3"))).toEqual({ mode: "software", options: { codec: "aac", ...config, forceTranscode: true } });
    expect(mocks.registerAacEncoder).toHaveBeenCalledTimes(1);
  });

  it("does not copy negative AAC preroll: trim sample-accurately via software", async () => {
    mocks.canEncodeAudio.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { prepareOfflineAacAudio } = await import("./offline-aac-encoder");
    expect((await prepareOfflineAacAudio(track("aac", -.021))).options.forceTranscode).toBe(true);
    expect(mocks.registerAacEncoder).toHaveBeenCalledTimes(1);
  });

  it("also handles WebViews that throw while probing native support", async () => {
    mocks.canEncodeAudio.mockRejectedValueOnce(new Error("Unsupported codec")).mockResolvedValue(true);
    const { ensureOfflineAacEncoder } = await import("./offline-aac-encoder");
    expect(await ensureOfflineAacEncoder(config)).toBe("software");
  });

  it("registers only once across simultaneous and subsequent exports", async () => {
    mocks.canEncodeAudio.mockImplementation(async () => mocks.registerAacEncoder.mock.calls.length > 0);
    const { ensureOfflineAacEncoder } = await import("./offline-aac-encoder");
    expect(await Promise.all([ensureOfflineAacEncoder(config), ensureOfflineAacEncoder(config)])).toEqual(["software", "software"]);
    expect(await ensureOfflineAacEncoder(config)).toBe("software");
    expect(mocks.registerAacEncoder).toHaveBeenCalledTimes(1);
  });

  it("reports failed setup and allows retry without a stale rejected promise", async () => {
    mocks.canEncodeAudio.mockResolvedValue(false);
    mocks.registerAacEncoder.mockImplementationOnce(() => { throw new Error("worker failed"); });
    const { ensureOfflineAacEncoder } = await import("./offline-aac-encoder");
    await expect(ensureOfflineAacEncoder(config)).rejects.toThrow(/AAC software.*worker failed/);
    mocks.canEncodeAudio.mockResolvedValue(true);
    expect(await ensureOfflineAacEncoder(config)).toBe("native");
  });

  it("reports unsupported audio instead of silently delivering a muted export", async () => {
    mocks.canEncodeAudio.mockResolvedValue(false);
    const { ensureOfflineAacEncoder } = await import("./offline-aac-encoder");
    await expect(ensureOfflineAacEncoder(config)).rejects.toThrow(/2 canali, 44100 Hz/);
  });
});
