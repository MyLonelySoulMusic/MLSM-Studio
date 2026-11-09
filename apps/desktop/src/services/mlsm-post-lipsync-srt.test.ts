import { describe, expect, it } from "vitest";
import { createMlsmSrtAnalysis } from "./mlsm-post-lipsync-srt";
import { applyMlsmWhisperWordCorrection } from "./mlsm-post-lipsync-transcript-editor";

const master = "1\n00:00:31,000 --> 00:00:33,000\nHello world\n\n2\n00:00:35,000 --> 00:00:37,000\nSing with me";
const base = { targetSubtitles: master, sourceDurationSeconds: 8, targetMasterDurationSeconds: 120, targetRange: { startSeconds: 30, endSeconds: 40 }, targetTimeBase: "master" as const };

describe("SRT diretto lipsync", () => {
  it("uses absolute master cues, preserves the selected window and exposes estimated video timings", () => {
    const result = createMlsmSrtAnalysis(base);
    expect(result.timingMode).toBe("srt-direct");
    expect(result.targetAudioStartSeconds).toBe(30);
    expect(result.targetAudioEndSeconds).toBe(40);
    expect(result.targetDurationSeconds).toBe(10);
    expect(result.targetTranscript.words[0]?.start).toBe(1);
    expect(result.sourceTranscript.engine).toBe("Manual");
    expect(result.targetTranscript.engine).toBe("Subtitles");
    expect(result.anchors).toHaveLength(5);
    expect(result.anchors.every(anchor => anchor.origin === "manual" && anchor.confidenceBand === "low")).toBe(true);
    expect(result.report.monotonic).toBe(true);
  });
  it("accepts explicit original video timings instead of proportional estimates", () => {
    const sourceSubtitles = "1\n00:00:00,500 --> 00:00:02,500\nHello world\n\n2\n00:00:04,000 --> 00:00:06,000\nSing with me";
    const result = createMlsmSrtAnalysis({ ...base, sourceSubtitles });
    expect(result.sourceTranscript.engine).toBe("Subtitles");
    expect(result.anchors[0]?.sourceStart).toBe(.5);
    expect(result.anchors[0]?.targetStart).toBe(1);
  });
  it("keeps local SRT timings relative to the selected excerpt", () => {
    const result = createMlsmSrtAnalysis({ ...base, targetTimeBase: "selection", targetSubtitles: "1\n00:00:01,000 --> 00:00:03,000\nHello world" });
    expect(result.targetAudioStartSeconds).toBe(30);
    expect(result.targetTranscript.words[0]?.start).toBe(1);
  });
  it("preserves the full master window after word edits, including trailing silence", () => {
    const result = createMlsmSrtAnalysis(base);
    const corrected = applyMlsmWhisperWordCorrection({ analysis: result, sourceWords: result.sourceTranscript.words, targetWords: result.targetTranscript.words });
    expect(corrected.timingMode).toBe("srt-direct");
    expect(corrected.targetAudioStartSeconds).toBe(30);
    expect(corrected.targetAudioEndSeconds).toBe(40);
    expect(corrected.alignmentSource).toBe("subtitles");
  });
  it("rejects overlaps, empty files and times outside the selected reference", () => {
    expect(() => createMlsmSrtAnalysis({ ...base, targetSubtitles: "" })).toThrow(/SRT/);
    expect(() => createMlsmSrtAnalysis({ ...base, targetTimeBase: "selection" })).toThrow(/durata/);
    expect(() => createMlsmSrtAnalysis({ ...base, targetSubtitles: "1\n00:00:01,000 --> 00:00:03,000\nHello" })).toThrow(/Nessuna riga/);
    expect(() => createMlsmSrtAnalysis({ ...base, sourceSubtitles: "1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:02,000 --> 00:00:04,000\nWorld" })).toThrow(/sovrappongono/);
  });
});
