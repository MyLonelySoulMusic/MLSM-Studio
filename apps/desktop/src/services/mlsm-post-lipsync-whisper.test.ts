import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  capabilities: vi.fn(), ensureRuntime: vi.fn(), runtimeSetup: vi.fn(), startJob: vi.fn(), waitJob: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./cassette-desk-vocals-browser", () => ({ fetchBrowserVocalService: vi.fn() }));
vi.mock("./song-player-native", () => ({
  getSongPlayerCapabilities: nativeMocks.capabilities,
  ensureSongPlayerRuntime: nativeMocks.ensureRuntime,
  getSongPlayerRuntimeSetup: nativeMocks.runtimeSetup,
  startSongPlayerJob: nativeMocks.startJob,
  waitForSongPlayerJob: nativeMocks.waitJob,
  isSongPlayerJobTerminal: (status: string) => ["completed", "succeeded", "failed", "cancelled"].includes(status),
}));
import { decodeNativeWhisperTranscript, transcribeMlsmWhisperWords } from "./mlsm-post-lipsync-whisper";

describe("Whisper Medium nativo per MLSM Post Lipsync", () => {
  beforeEach(() => vi.clearAllMocks());
  it("preserva i timestamp misurati parola per parola senza distribuirli sulla durata", () => {
    const document = decodeNativeWhisperTranscript({
      transcript: "I'm scared to be alone",
      words: [
        { text: "I'm", start: .02, end: .56, confidence: .86 },
        { text: "scared", start: .56, end: .9, confidence: .99 },
        { text: "to", start: .9, end: 1.28, confidence: .93 },
        { text: "be", start: 1.28, end: 1.68, confidence: 1 },
        { text: "alone", start: 1.68, end: 2.58, confidence: 1 }
      ],
      phrases: [{ text: "I'm scared to be alone", start: .02, end: 2.58, confidence: .94 }]
    }, "whisper-medium_timestamped", 15);

    expect(document.words.map((word) => [word.text, word.start, word.end])).toEqual([
      ["I'm", .02, .56], ["scared", .56, .9], ["to", .9, 1.28], ["be", 1.28, 1.68], ["alone", 1.68, 2.58]
    ]);
    expect(document.engine).toBe("Whisper");
  });

  it("rifiuta timeline sovrapposte o prive di confini reali", () => {
    expect(() => decodeNativeWhisperTranscript({ words: [
      { text: "one", start: 0, end: 1, confidence: .9 },
      { text: "two", start: .5, end: 1.5, confidence: .9 }
    ] }, "whisper-medium_timestamped", 2)).toThrow(/timeline/);
    expect(() => decodeNativeWhisperTranscript({ transcript: "recognized only" }, "whisper-medium_timestamped", 2)).toThrow(/timeline/);
  });

  it("continua a trascrivere quando fallisce solo la verifica globale di moduli estranei", async () => {
    nativeMocks.capabilities.mockResolvedValueOnce({ wordTranscription: false }).mockResolvedValueOnce({ wordTranscription: true });
    nativeMocks.ensureRuntime.mockResolvedValue({ status: "failed", progress: 0, message: "Demucs non pronto", error: "pYIN non pronto" });
    nativeMocks.startJob.mockResolvedValue({
      jobId: "whisper-1", status: "completed", result: {
        transcript: "ciao mondo", words: [{ text: "ciao", start: 0, end: .7, confidence: .9 }, { text: "mondo", start: .8, end: 1.5, confidence: .9 }],
        phrases: [{ text: "ciao mondo", start: 0, end: 1.5, confidence: .9 }],
      },
    });

    const result = await transcribeMlsmWhisperWords({
      media: { path: "/tmp/voice.wav", url: "blob:voice", fileName: "voice.wav", durationSeconds: 2 },
      range: { startSeconds: 0, endSeconds: 2 }, language: "it", model: "whisper-base_timestamped", role: "source", onProgress: vi.fn(),
    });

    expect(result.transcript).toBe("ciao mondo");
    expect(nativeMocks.startJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "transcribeWords", model: "whisper-base_timestamped" }));
  });
});
