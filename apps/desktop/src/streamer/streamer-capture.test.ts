import { afterEach, describe, expect, it, vi } from "vitest";
import { requestBrowserCapture } from "./streamer-capture";

afterEach(() => vi.unstubAllGlobals());

function fixture(settings: MediaTrackSettings, rejectConstraints = false, hasAudio = true) {
  const track = { getSettings: () => settings, applyConstraints: vi.fn(async () => { if (rejectConstraints) throw new Error("Not supported"); }), stop: vi.fn() };
  const video = { stop: vi.fn() };
  const stream = { getAudioTracks: () => hasAudio ? [track] : [], getTracks: () => hasAudio ? [track, video] : [video] };
  const getDisplayMedia = vi.fn(async () => stream), getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia, getUserMedia } });
  return { track, video, stream, getDisplayMedia, getUserMedia };
}

describe("Music capture negotiation", () => {
  it("requests stereo without voice processing and leaves a correctly negotiated track intact", async () => {
    const f = fixture({ channelCount: 2, sampleRate: 48000, echoCancellation: false });
    const result = await requestBrowserCapture({ kind: "system" });
    expect(f.getUserMedia).not.toHaveBeenCalled();
    expect(f.getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: expect.objectContaining({ channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }) });
    expect(f.track.applyConstraints).not.toHaveBeenCalled();
    expect(result.info).toMatchObject({ trackChannels: 2, receivedChannels: null, sampleRate: 48000, constraintError: null });
  });
  it("reports a mono track honestly if the browser cannot satisfy stereo constraints", async () => {
    const f = fixture({ channelCount: 1, echoCancellation: true }, true);
    const result = await requestBrowserCapture({ kind: "system" });
    expect(f.track.applyConstraints).toHaveBeenCalledWith(expect.objectContaining({ channelCount: { ideal: 2 }, echoCancellation: false }));
    expect(result.info).toMatchObject({ trackChannels: 1, receivedChannels: null, echoCancellation: true, constraintError: "Not supported" });
    expect(result.stream).toBe(f.stream);
    expect(f.track.stop).not.toHaveBeenCalled();
  });
  it("reads back the settings after correcting a mono or speech-processed track", async () => {
    const settings = { channelCount: 1, echoCancellation: true };
    const f = fixture(settings);
    f.track.applyConstraints.mockImplementation(async () => { settings.channelCount = 2; settings.echoCancellation = false; });
    const result = await requestBrowserCapture({ kind: "system" });
    expect(result.info).toMatchObject({ trackChannels: 2, echoCancellation: false, constraintError: null });
  });
  it("releases the display stream if audio sharing was not enabled", async () => {
    const f = fixture({}, false, false);
    await expect(requestBrowserCapture({ kind: "system" })).rejects.toThrow("Nessun audio condiviso");
    expect(f.video.stop).toHaveBeenCalledOnce();
  });
  it("keeps the selected physical input instead of capturing the display", async () => {
    const f = fixture({ channelCount: 1 });
    await requestBrowserCapture({ kind: "input", id: "input-1" });
    expect(f.getDisplayMedia).not.toHaveBeenCalled();
    expect(f.getUserMedia).toHaveBeenCalledWith({ video: false, audio: expect.objectContaining({ deviceId: { exact: "input-1" }, echoCancellation: false }) });
  });
});
