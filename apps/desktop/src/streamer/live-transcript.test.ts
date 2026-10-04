import { describe, expect, it, vi } from "vitest";
import { LiveMonoResampler, LiveTranscriptSession, trimTranscriptOverlap, type LiveWhisperTransport } from "./live-transcript";

const stereo = (seconds: number, rate = 16000) => new Float32Array(seconds * rate * 2).fill(.2);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const transport = (): LiveWhisperTransport => ({ start: vi.fn(async () => ({ id: "session", model: "medium" })), transcribe: vi.fn(async () => ({ phrases: [{ text: "Hello world", start: 0, end: 3.8 }] })), stop: vi.fn(async () => undefined) });

describe("Live Whisper stream", () => {
  it.each([44100, 48000, 96000])("resamples %i Hz stereo without mutating PCM or drifting across packets", rate => {
    const resampler = new LiveMonoResampler(); const input = stereo(1, rate); const original = input.slice(); let samples = 0;
    for (let i = 0; i < input.length; i += 4096) { const output = resampler.push(input.subarray(i, i + 4096), rate); samples += output.length; expect(output[0]).toBeCloseTo(.2); }
    expect(samples).toBeGreaterThanOrEqual(15999); expect(samples).toBeLessThanOrEqual(16001); expect(input).toEqual(original);
  });
  it("deduplicates overlap while retaining punctuation and new words", () => {
    expect(trimTranscriptOverlap("Hello, world!", "world and music")).toBe("and music");
    expect(trimTranscriptOverlap("Una bella canzone", "bella canzone oggi.")).toBe("oggi.");
    expect(trimTranscriptOverlap("Hello", "Hello")).toBe("");
  });
  it("starts only after audio and retains one loaded model across windows", async () => {
    const api = transport(); const session = new LiveTranscriptSession(vi.fn(), "auto", api);
    expect(api.start).not.toHaveBeenCalled();
    session.push(stereo(4.1), 16000); await flush();
    expect(api.start).toHaveBeenCalledOnce(); expect(session.state.phrases[0]?.text).toBe("Hello world");
    session.push(stereo(3), 16000); await flush();
    expect(api.start).toHaveBeenCalledOnce(); expect(api.transcribe).toHaveBeenCalledTimes(2);
    session.dispose(); expect(api.stop).toHaveBeenCalledWith("session");
  });
  it("retains every queued sample in order while an inference is slow", async () => {
    const api = transport(); let finish!: (value: { phrases: [] }) => void;
    vi.mocked(api.transcribe).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const session = new LiveTranscriptSession(vi.fn(), "auto", api);
    session.push(stereo(4.1), 16000); await flush();
    for (let i = 0; i < 20; i++) session.push(stereo(3), 16000);
    expect(api.transcribe).toHaveBeenCalledOnce();
    finish({ phrases: [] }); for (let i = 0; i < 4; i++) await flush();
    expect(api.transcribe).toHaveBeenCalledTimes(9);
    const sent = vi.mocked(api.transcribe).mock.calls.reduce((sum, call) => sum + call[1].length, 0);
    expect(sent).toBeGreaterThanOrEqual(64 * 16000);
    expect(sent).toBeLessThanOrEqual(64.1 * 16000);
    session.dispose();
  });
  it("updates provisional words, corrects them and then confirms them", async () => {
    const api = transport();
    vi.mocked(api.transcribe)
      .mockResolvedValueOnce({ partial: { text: "Hello wrong" }, processedUntil: 1.1 })
      .mockResolvedValueOnce({ partial: { text: "Hello world" }, processedUntil: 2.2 })
      .mockResolvedValueOnce({ phrases: [{ text: "Hello world", start: 0, end: 2 }], partial: { text: "music" }, processedUntil: 3.3 });
    const session = new LiveTranscriptSession(vi.fn(), "en", api);
    session.push(stereo(1.1), 16000); await flush(); expect(session.state.partial).toBe("Hello wrong");
    session.push(stereo(1.1), 16000); await flush(); expect(session.state.partial).toBe("Hello world"); expect(session.state.phrases).toEqual([]);
    session.push(stereo(1.1), 16000); await flush(); expect(session.state.phrases[0]?.text).toBe("Hello world"); expect(session.state.partial).toBe("music");
    session.dispose();
  });
  it("preserves repeated lyrics when their timestamps differ", async () => {
    const api = transport(); vi.mocked(api.transcribe).mockResolvedValueOnce({ phrases: [{ text: "hello hello", start: 0, end: 1 }, { text: "hello hello", start: 1, end: 2 }] });
    const session = new LiveTranscriptSession(vi.fn(), "en", api);
    session.push(stereo(2.1), 16000); await flush(); expect(session.state.phrases).toHaveLength(2); session.dispose();
  });
  it("gives the CPU backend extra initial context without delaying later updates", async () => {
    const api = transport(); vi.mocked(api.start).mockResolvedValueOnce({ id: "cpu", device: "cpu", initialSeconds: 2 });
    const session = new LiveTranscriptSession(vi.fn(), "en", api);
    session.push(stereo(1.1), 16000); await flush(); expect(api.start).toHaveBeenCalledOnce(); expect(api.transcribe).not.toHaveBeenCalled();
    session.push(stereo(1.1), 16000); await flush(); expect(api.transcribe).toHaveBeenCalledOnce();
    session.push(stereo(1.1), 16000); await flush(); expect(api.transcribe).toHaveBeenCalledTimes(2); session.dispose();
  });
  it("sends the final flag even when pause occurs during an inference", async () => {
    const api = transport(); let finish!: (value: { partial: { text: string } }) => void;
    vi.mocked(api.transcribe).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const session = new LiveTranscriptSession(vi.fn(), "en", api);
    session.push(stereo(1.1), 16000); await flush(); session.setActive(false);
    finish({ partial: { text: "last word" } }); await flush();
    expect(api.transcribe).toHaveBeenCalledTimes(2); expect(vi.mocked(api.transcribe).mock.calls[1]?.[4]).toBe(true); session.dispose();
  });
  it("flushes a short tail on pause and ignores subsequent PCM", async () => {
    const api = transport(); const session = new LiveTranscriptSession(vi.fn(), "en", api);
    session.push(stereo(2), 16000); session.setActive(false); await flush();
    expect(api.transcribe).toHaveBeenCalledOnce(); expect(session.state.phase).toBe("paused");
    session.push(stereo(5), 16000); await flush(); expect(api.transcribe).toHaveBeenCalledOnce(); session.dispose();
  });
  it("drops late results and stops a session that finishes loading after disposal", async () => {
    const api = transport(); let ready!: (value: { id: string }) => void;
    vi.mocked(api.start).mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
    const changed = vi.fn(); const session = new LiveTranscriptSession(changed, "auto", api);
    session.push(stereo(4.1), 16000); session.dispose(); changed.mockClear();
    ready({ id: "late" }); await flush();
    expect(api.stop).toHaveBeenCalledWith("late"); expect(api.transcribe).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  });
  it("reports failures without repeatedly starting the model", async () => {
    const api = transport(); vi.mocked(api.start).mockRejectedValueOnce(new Error("Missing cached model"));
    const session = new LiveTranscriptSession(vi.fn(), "auto", api);
    session.push(stereo(4.1), 16000); await flush(); session.push(stereo(4), 16000); await flush();
    expect(session.state.phase).toBe("error"); expect(session.state.detail).toBe("Missing cached model"); expect(api.start).toHaveBeenCalledOnce(); session.dispose();
  });
});
