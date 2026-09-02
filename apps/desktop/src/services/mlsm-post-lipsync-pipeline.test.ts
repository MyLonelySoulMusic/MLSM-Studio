import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportedAudio } from "./audio-import";

const mocks = vi.hoisted(() => {
  let cached: unknown = null;
  return {
    reset: () => { cached = null; },
    separate: vi.fn(),
    transcribe: vi.fn(),
    createAnalysis: vi.fn(),
    refine: vi.fn(),
    cacheKey: vi.fn(async (input: unknown) => JSON.stringify(input)),
    cache: {
      get: vi.fn(async () => cached),
      set: vi.fn(async (_key: string, value: unknown) => { cached = value; })
    }
  };
});

vi.mock("./audio-import", () => ({ loadAudioFromPath: vi.fn(), releaseImportedAudio: vi.fn() }));
vi.mock("./cassette-desk-vocals", () => ({ separateCassetteDeskVocals: mocks.separate }));
vi.mock("./cassette-desk-vocals-browser", () => ({ releaseBrowserVocalStem: vi.fn() }));
vi.mock("./mlsm-post-lipsync-whisper", () => ({ transcribeMlsmWhisperWords: mocks.transcribe }));
vi.mock("./mlsm-post-lipsync-analysis", () => ({ createMlsmPostLipsyncAnalysis: mocks.createAnalysis }));
vi.mock("./mlsm-post-lipsync-exact-transcript", () => ({ constrainMlsmPostLipsyncTranscriptToExactLyrics: vi.fn((value) => value) }));
vi.mock("./mlsm-post-lipsync-llm", () => ({ repairMlsmPostLipsyncTranscriptWithLocalLlm: vi.fn() }));
vi.mock("./mlsm-post-lipsync-cache", () => ({ mlsmPostLipsyncCache: mocks.cache, mlsmPostLipsyncCacheKey: mocks.cacheKey }));
vi.mock("./mlsm-post-lipsync-refinement", () => ({ refineMlsmPostLipsyncAlignment: mocks.refine }));
vi.mock("./mlsm-post-lipsync-waveform", () => ({
  measureMlsmPostLipsyncWaveformAlignment: vi.fn(),
  unmeasuredMlsmWaveformAlignment: vi.fn((status: string, detail: string | null = null) => ({ status, detail, trusted: false }))
}));
vi.mock("./mlsm-post-lipsync-visual", () => ({ markMlsmVisualSpeechUnavailable: vi.fn(), refineMlsmPostLipsyncWithVisualSpeech: vi.fn() }));
vi.mock("./song-player-native", () => ({ ensureSongPlayerRuntime: vi.fn(), getSongPlayerCapabilities: vi.fn(), isSongPlayerJobTerminal: vi.fn(), startSongPlayerJob: vi.fn(), waitForSongPlayerJob: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => false) }));

import { analyzeMlsmPostLipsync } from "./mlsm-post-lipsync-pipeline";

const audio = (name: string, hash: string, durationSeconds: number): ImportedAudio => ({
  metadata: { path: `/${name}`, fileName: name, hash, durationSeconds, sampleRate: 48_000, channels: 2, codec: "wav", fileSize: 10 },
  waveform: [],
  url: `blob:${name}`
});

const transcript = (durationSeconds: number, text: string) => ({
  schemaVersion: 1 as const,
  engine: "Whisper" as const,
  model: "whisper-medium_timestamped",
  durationSeconds,
  transcript: text,
  words: [{ text, start: .2, end: .8, confidence: .9 }],
  phrases: [{ text, start: .2, end: .8, confidence: .9 }]
});

describe("analyzeMlsmPostLipsync deterministico", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.reset();
    mocks.transcribe.mockResolvedValueOnce(transcript(2, "source")).mockResolvedValueOnce(transcript(1, "target"));
    mocks.createAnalysis.mockImplementation((input) => ({ ...input, anchors: [], visualSpeech: { enabled: false } }));
  });

  it("usa audio originale e Whisper Medium senza invocare Demucs o MFCC", async () => {
    const source = audio("clip.wav", "a".repeat(64), 2);
    const target = audio("master.wav", "b".repeat(64), 10);
    await analyzeMlsmPostLipsync({
      sourceVideoPath: "/clip.mp4",
      sourceVideoHash: "video-content-hash",
      sourceAudio: source,
      targetMaster: target,
      targetMasterRange: { startSeconds: 4, endSeconds: 5 },
      language: "en",
      whisperModel: "whisper-medium_timestamped",
      localLlmCorrection: false,
      reuseCachedAnalysis: true
    });

    expect(mocks.separate).not.toHaveBeenCalled();
    expect(mocks.transcribe).toHaveBeenNthCalledWith(1, expect.objectContaining({ media: expect.objectContaining({ path: "/clip.wav" }), range: { startSeconds: 0, endSeconds: 2 }, model: "whisper-medium_timestamped", role: "source" }));
    expect(mocks.transcribe).toHaveBeenNthCalledWith(2, expect.objectContaining({ media: expect.objectContaining({ path: "/master.wav" }), range: { startSeconds: 4, endSeconds: 5 }, model: "whisper-medium_timestamped", role: "target" }));
    expect(mocks.refine).not.toHaveBeenCalled();
    expect(mocks.cacheKey).toHaveBeenCalledWith(expect.objectContaining({ sourceVideoHash: "video-content-hash", alignmentParameters: expect.objectContaining({ vocalSeparation: "disabled", microAlignment: "disabled" }) }));
  });

  it("alla seconda richiesta identica restituisce esattamente il baseline in cache senza rianalizzare", async () => {
    const input = {
      sourceVideoPath: "/clip.mp4",
      sourceVideoHash: "same-video",
      sourceAudio: audio("clip.wav", "a".repeat(64), 2),
      targetMaster: audio("master.wav", "b".repeat(64), 10),
      targetMasterRange: { startSeconds: 4, endSeconds: 5 },
      language: "en",
      whisperModel: "whisper-medium_timestamped" as const,
      localLlmCorrection: false,
      reuseCachedAnalysis: true
    };
    const first = await analyzeMlsmPostLipsync(input);
    const second = await analyzeMlsmPostLipsync(input);

    expect(second).toBe(first);
    expect(mocks.transcribe).toHaveBeenCalledTimes(2);
    expect(mocks.createAnalysis).toHaveBeenCalledOnce();
    expect(mocks.cache.get).toHaveBeenCalledTimes(2);
  });
});
