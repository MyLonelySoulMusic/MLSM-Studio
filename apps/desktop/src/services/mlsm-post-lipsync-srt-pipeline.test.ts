import { expect, it, vi } from "vitest";
import type { ImportedAudio } from "./audio-import";
const transcribe = vi.hoisted(() => vi.fn(() => { throw new Error("Whisper must not run"); }));
vi.mock("./mlsm-post-lipsync-whisper", () => ({ transcribeMlsmWhisperWords: transcribe }));
import { analyzeMlsmPostLipsync } from "./mlsm-post-lipsync-pipeline";

it("builds a usable SRT timeline without extracting audio, loading models or transcribing", async () => {
  const target = { metadata: { durationSeconds: 10 } } as ImportedAudio;
  const result = await analyzeMlsmPostLipsync({
    sourceVideoPath: "/not-needed.mp4", sourceDurationSeconds: 8, targetMaster: target,
    subtitles: "1\n00:00:01,000 --> 00:00:04,000\nHello beautiful world",
    directSrt: { targetTimeBase: "master" }, language: "en", whisperModel: "whisper-medium_timestamped",
    separateVocals: true, localLlmCorrection: true, visualSpeechAnalysis: true
  });
  expect(transcribe).not.toHaveBeenCalled();
  expect(result.anchors).toHaveLength(3);
  expect(result.targetAudioStartSeconds).toBe(0);
  expect(result.targetDurationSeconds).toBe(10);
  expect(result.report.monotonic).toBe(true);
});
