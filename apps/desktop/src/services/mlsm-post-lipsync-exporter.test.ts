import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MlsmPostLipsyncAnalysis } from "./mlsm-post-lipsync-types";

const runtime = vi.hoisted(() => {
  const videoTrack = { getDisplayWidth: vi.fn(async () => 1080), getDisplayHeight: vi.fn(async () => 1920), canDecode: vi.fn(async () => true) };
  const audioTrack = {};
  const sourceInput = { canRead: vi.fn(async () => true), getPrimaryVideoTrack: vi.fn(async () => videoTrack), getPrimaryAudioTrack: vi.fn(async () => null), getFirstTimestamp: vi.fn(async () => 0), computeDuration: vi.fn(async () => 2), dispose: vi.fn() };
  const targetInput = { canRead: vi.fn(async () => true), getPrimaryVideoTrack: vi.fn(async () => null), getPrimaryAudioTrack: vi.fn(async () => audioTrack), getFirstTimestamp: vi.fn(async () => 0), computeDuration: vi.fn(async () => 10), dispose: vi.fn() };
  return {
    videoTrack, audioTrack, sourceInput, targetInput, inputIndex: 0, sinkTimes: [] as number[][],
    videoAdd: vi.fn(async () => undefined), videoClose: vi.fn(), outputStart: vi.fn(async () => undefined), outputFinalize: vi.fn(async () => undefined), outputCancel: vi.fn(async () => undefined),
    conversionExecute: vi.fn(async () => undefined), conversionCancel: vi.fn(async () => undefined), conversionInit: vi.fn(), downloadBuffer: vi.fn(), createTarget: vi.fn(), audit: vi.fn(), frameCount: vi.fn(async () => 48)
  };
});

vi.mock("mediabunny", () => ({
  ALL_FORMATS: [], BlobSource: function BlobSource() { return {}; },
  Input: function Input() { return runtime.inputIndex++ === 0 ? runtime.sourceInput : runtime.targetInput; },
  CanvasSink: function CanvasSink() { return { canvasesAtTimestamps: async function* (timestamps: number[]) { runtime.sinkTimes.push(timestamps); for (let index = 0; index < timestamps.length; index += 1) yield { canvas: { index } }; } }; },
  CanvasSource: function CanvasSource() { return { add: runtime.videoAdd, close: runtime.videoClose }; },
  Conversion: { init: runtime.conversionInit }, Mp4OutputFormat: function Mp4OutputFormat() { return {}; },
  Output: function Output() { return { addVideoTrack: vi.fn(), start: runtime.outputStart, finalize: runtime.outputFinalize, cancel: runtime.outputCancel }; },
  canEncodeAudio: vi.fn(async () => true), canEncodeVideo: vi.fn(async () => true)
}));

vi.mock("./static-watermark-exporter", () => ({
  audit: runtime.audit, beginDirectSave: vi.fn(() => null), createTarget: runtime.createTarget, downloadBuffer: runtime.downloadBuffer,
  fetchVideo: vi.fn(async () => new Blob(["video"])), frameCount: runtime.frameCount, safeName: (value: string) => value,
  staticWatermarkEncodingError: (reason: unknown) => reason instanceof Error ? reason : new Error(String(reason)),
  throwIfAborted: (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("annullato", "AbortError"); }, waitWithTimeout: <T>(promise: Promise<T>) => promise
}));

import { exportMlsmPostLipsyncVideo, lipsyncExportFps } from "./mlsm-post-lipsync-exporter";

function analysis(): MlsmPostLipsyncAnalysis {
  const emptyTranscript = { schemaVersion: 1 as const, engine: "Whisper" as const, model: "whisper-base_timestamped" as const, durationSeconds: 2, transcript: "", words: [], phrases: [] };
  return {
    analysisVersion: "mlsm-post-lipsync-v12", detailMode: "phoneme", alignmentSource: "subtitles", localLlmCorrection: { enabled: false, applied: false, status: "disabled", recoveredWords: [], model: null, exactLyrics: null }, visualSpeech: { enabled: false, applied: false, status: "disabled", provider: null, model: null, revision: null, device: null, visualTranscript: "", faceCoverage: null, words: [], visemes: [], error: null }, sourceDurationSeconds: 2, targetMasterDurationSeconds: 10, targetAnalysisStartSeconds: 0, targetAnalysisEndSeconds: 10, targetAudioStartSeconds: 3, targetAudioEndSeconds: 5, targetDurationSeconds: 2,
    canonicalLyrics: [], whisperTranscripts: { source: emptyTranscript, target: emptyTranscript }, sourceTranscript: emptyTranscript, targetTranscript: emptyTranscript, anchors: [], unresolved: [],
    timeMap: { version: 1, sourceDurationSeconds: 2, targetDurationSeconds: 2, points: [{ id: "start", canonicalIndex: null, sourceTime: 0, targetTime: 0, locked: true, manual: false }, { id: "end", canonicalIndex: null, sourceTime: 2, targetTime: 2, locked: true, manual: false }], segments: [{ id: "segment", leftPointId: "start", rightPointId: "end", sourceStart: 0, sourceEnd: 2, targetStart: 0, targetEnd: 2, sourceDuration: 2, targetDuration: 2, speedRatio: 1, speedBand: "safe", requiresInterpolation: false, locked: true, speedOverride: null }], speedLimits: { safeMinimum: .8, safeMaximum: 1.25, moderateMinimum: .6, moderateMaximum: 1.6 } },
    report: { canonicalWords: 0, matchedWords: 0, highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unresolved: 0, averageTimingCorrectionMs: 0, maximumTimingCorrectionMs: 0, segmentsRequiringInterpolation: 0, criticalRetimeSegments: 0, monotonic: true }
  };
}

describe("MLSM POST LIPSYNC export", () => {
  beforeEach(() => {
    vi.clearAllMocks(); runtime.inputIndex = 0; runtime.sinkTimes.length = 0;
    runtime.conversionInit.mockResolvedValue({ isValid: true, utilizedTracks: [runtime.audioTrack], execute: runtime.conversionExecute, cancel: runtime.conversionCancel });
    runtime.createTarget.mockResolvedValue({ target: {}, buffer: { buffer: new ArrayBuffer(16) }, prepareCommit: vi.fn(), abortPartial: vi.fn(async () => undefined), finalBlob: vi.fn(async () => new Blob(["mp4"])), finish: vi.fn(async () => undefined), invalidateFinal: vi.fn(async () => undefined), cleanup: vi.fn(async () => undefined) });
    runtime.audit.mockResolvedValue({ videoFrames: 48, audioPackets: 96 });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true, imageSmoothingQuality: "high" } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["audio"]), { status: 200 })));
  });

  it("mantiene il frame rate medio originale senza imporre 25 o 30 FPS", () => {
    expect(lipsyncExportFps(240, 10)).toBe(24); expect(lipsyncExportFps(300, 10.01)).toBeCloseTo(29.97003, 4);
  });

  it("rifiuta una sorgente senza timeline video misurabile", () => { expect(() => lipsyncExportFps(0, 10)).toThrow(/frame rate/u); });

  it("esporta la time-map corrente, ritaglia il master e verifica ogni frame", async () => {
    const progress = vi.fn();
    const result = await exportMlsmPostLipsyncVideo({ projectName: "fallen", sourceVideoUrl: "blob:video", targetAudioUrl: "blob:audio", analysis: analysis() }, new AbortController().signal, progress);
    expect(result).toMatchObject({ fileName: "fallen-post-lipsync.mp4", width: 1080, height: 1920, fps: 24, encodedFrameCount: 48, audioPacketCount: 96 });
    expect(runtime.conversionInit).toHaveBeenCalledWith(expect.objectContaining({ trim: { start: 3, end: 5 }, video: { discard: true } }));
    expect(runtime.sinkTimes[0]).toHaveLength(48); expect(runtime.videoAdd).toHaveBeenCalledTimes(48);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ currentFrame: 48, totalFrames: 48, progress: 1 })); expect(runtime.downloadBuffer).toHaveBeenCalledOnce();
  });
});
