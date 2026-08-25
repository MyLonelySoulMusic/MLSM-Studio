import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportedAudio } from "./audio-import";

const native = vi.hoisted(() => ({
  getSongPlayerCapabilities: vi.fn(),
  ensureSongPlayerRuntime: vi.fn(),
  getSongPlayerRuntimeSetup: vi.fn(),
  startSongPlayerJob: vi.fn(),
  waitForSongPlayerJob: vi.fn(),
  isSongPlayerJobTerminal: vi.fn((status: string) => ["completed", "succeeded", "failed", "cancelled"].includes(status))
}));
const browser = vi.hoisted(() => ({ separateBrowserCassetteDeskVocals: vi.fn() }));
vi.mock("./song-player-native", () => native);
vi.mock("./cassette-desk-vocals-browser", () => browser);
import { decodeCassetteDeskVocalResult, separateCassetteDeskVocals } from "./cassette-desk-vocals";

const audio: ImportedAudio = { metadata: { path: "/music/track.wav", fileName: "track.wav", hash: "a".repeat(64), durationSeconds: 120, sampleRate: 48_000, channels: 2, codec: "wav", fileSize: 42 }, waveform: [], url: "blob:track" };
const musicalAnalysis = { bpm: 118.4, keyRoot: 9, keyMode: "major", keyConfidence: .86 } as const;

describe("Cassette Desk vocal separation", () => {
  beforeEach(() => { vi.clearAllMocks(); native.getSongPlayerCapabilities.mockResolvedValue({ desktop: true, vocalSeparation: true }); });
  afterEach(()=>vi.useRealTimers());
  it("strictly decodes only htdemucs + pYIN vocal pitch frames", () => {
    expect(decodeCassetteDeskVocalResult({ kind: "separateVocals", path: "/jobs/vocals.wav", model: "htdemucs", pitchAlgorithm: "pyin", pitch: [[.1, 60.2, .9], [1, 64, 2], ["bad", 65, .8]], musicalAnalysis })).toEqual({ model: "htdemucs", pitchAlgorithm: "pyin", stemPath: "/jobs/vocals.wav", notes: [{ timeSeconds: .1, midi: 60.2, confidence: .9 }], musicalAnalysis, musicalAnalysisError:null });
    expect(decodeCassetteDeskVocalResult({kind:"separateVocals",path:"/jobs/vocals.wav",model:"htdemucs",pitchAlgorithm:"pyin",pitch:[[.2,69,.92]]})).toMatchObject({notes:[{timeSeconds:.2,midi:69,confidence:.92}],musicalAnalysis:null});
    expect(decodeCassetteDeskVocalResult({kind:"separateVocals",path:"/jobs/vocals.wav",model:"htdemucs",pitchAlgorithm:"pyin",pitch:[[.3,71,.9]],musicalAnalysis:{bpm:-1}})).toMatchObject({notes:[{timeSeconds:.3,midi:71,confidence:.9}],musicalAnalysis:null,musicalAnalysisError:"Analisi musicale non valida."});
    expect(() => decodeCassetteDeskVocalResult({ kind: "analyze", pitch: [] })).toThrow(/non valido/);
  });
  it("starts the dedicated native separation job and returns its vocal notes", async () => {
    native.startSongPlayerJob.mockResolvedValue({ jobId: "vocal-1", status: "completed", result: { kind: "separateVocals", path: "/jobs/vocals.wav", model: "htdemucs", pitchAlgorithm: "pyin", pitch: [[.2, 62, .95]], musicalAnalysis } });
    await expect(separateCassetteDeskVocals(audio)).resolves.toMatchObject({ notes: [{ timeSeconds: .2, midi: 62, confidence: .95 }] });
    expect(native.startSongPlayerJob).toHaveBeenCalledWith({ kind: "separateVocals", inputPath: "/music/track.wav" });
    expect(native.waitForSongPlayerJob).not.toHaveBeenCalled();
  });
  it("installs the missing runtime automatically before separating vocals", async () => {
    native.getSongPlayerCapabilities.mockResolvedValueOnce({ desktop: true, vocalSeparation: false }).mockResolvedValueOnce({ desktop: true, vocalSeparation: true });
    native.ensureSongPlayerRuntime.mockResolvedValue({ status: "ready", progress: 100, message: "Runtime pronto", error: null });
    native.startSongPlayerJob.mockResolvedValue({ jobId: "vocal-auto", status: "completed", result: { kind: "separateVocals", path: "/jobs/vocals.wav", model: "htdemucs", pitchAlgorithm: "pyin", pitch: [], musicalAnalysis } });
    await expect(separateCassetteDeskVocals(audio)).resolves.toMatchObject({ notes: [] });
    expect(native.ensureSongPlayerRuntime).toHaveBeenCalledOnce();
  });
  it("polls one shared automatic installation until it becomes ready", async () => {
    vi.useFakeTimers();
    native.getSongPlayerCapabilities.mockResolvedValueOnce({ desktop: true, vocalSeparation: false }).mockResolvedValueOnce({ desktop: true, vocalSeparation: true });
    native.ensureSongPlayerRuntime.mockResolvedValue({ status: "installing", progress: 42, message: "Installazione Demucs", error: null });
    native.getSongPlayerRuntimeSetup.mockResolvedValue({ status: "ready", progress: 100, message: "Runtime pronto", error: null });
    native.startSongPlayerJob.mockResolvedValue({ jobId: "vocal-after-setup", status: "completed", result: { kind: "separateVocals", path: "/jobs/vocals.wav", model: "htdemucs", pitchAlgorithm: "pyin", pitch: [], musicalAnalysis } });
    const progress=vi.fn();const operation=separateCassetteDeskVocals(audio,undefined,progress);await vi.advanceTimersByTimeAsync(500);await expect(operation).resolves.toMatchObject({notes:[]});
    expect(native.ensureSongPlayerRuntime).toHaveBeenCalledOnce();expect(native.getSongPlayerRuntimeSetup).toHaveBeenCalledOnce();expect(progress).toHaveBeenCalledWith(expect.any(Number),expect.stringContaining("Installazione Demucs"));
  });
  it("fails closed instead of deriving notes from the full mix when automatic setup fails", async () => {
    native.getSongPlayerCapabilities.mockResolvedValue({ desktop: true, vocalSeparation: false });
    native.ensureSongPlayerRuntime.mockResolvedValue({ status: "failed", progress: 0, message: "Installazione fallita", error: "rete assente" });
    await expect(separateCassetteDeskVocals(audio)).rejects.toThrow(/rete assente/);
    expect(native.startSongPlayerJob).not.toHaveBeenCalled();
  });
  it("runs the same real Demucs pipeline through the integrated browser service", async () => {
    native.getSongPlayerCapabilities.mockResolvedValue({ desktop:false,vocalSeparation:true });
    browser.separateBrowserCassetteDeskVocals.mockResolvedValue({kind:"separateVocals",path:"browser://vocals.wav",model:"htdemucs",pitchAlgorithm:"pyin",pitch:[[.4,67,.91]],musicalAnalysis});
    await expect(separateCassetteDeskVocals({...audio,metadata:{...audio.metadata,path:""}})).resolves.toMatchObject({stemPath:"browser://vocals.wav",notes:[{timeSeconds:.4,midi:67,confidence:.91}]});
    expect(browser.separateBrowserCassetteDeskVocals).toHaveBeenCalledOnce();
    expect(native.startSongPlayerJob).not.toHaveBeenCalled();
  });
});
