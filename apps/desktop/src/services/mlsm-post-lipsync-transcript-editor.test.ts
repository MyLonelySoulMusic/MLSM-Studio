import { describe, expect, it } from "vitest";
import { createMlsmPostLipsyncAnalysis } from "./mlsm-post-lipsync-analysis";
import { applyMlsmWhisperWordCorrection, rebuildWhisperTranscript } from "./mlsm-post-lipsync-transcript-editor";
import type { TimestampedWord, WhisperTranscriptDocument } from "./subtitle-generation";

function transcript(words: TimestampedWord[], durationSeconds = 8): WhisperTranscriptDocument {
  return {
    schemaVersion: 1,
    engine: "Whisper",
    model: "whisper-base_timestamped",
    durationSeconds,
    transcript: words.map((word) => word.text).join(" "),
    words,
    phrases: [{ start: words[0]?.start ?? 0, end: words.at(-1)?.end ?? durationSeconds, text: words.map((word) => word.text).join(" "), confidence: .9 }]
  };
}

const modelWord = (text: string, start: number, end: number): TimestampedWord => ({ text, start, end, confidence: .94, confidenceSource: "model" });

function analysis() {
  return createMlsmPostLipsyncAnalysis({
    sourceTranscript: transcript([modelWord("The", .2, .55), modelWord("wrong", .6, 1.15), modelWord("loves", 1.5, 1.95), modelWord("me", 2, 2.4)]),
    targetTranscript: transcript([modelWord("The", .35, .7), modelWord("Fallen", .74, 1.35), modelWord("still", 1.6, 1.95), modelWord("loves", 2, 2.4), modelWord("me", 2.45, 2.9)]),
    sourceDurationSeconds: 8,
    targetDurationSeconds: 8,
    targetMasterDurationSeconds: 40,
    targetAnalysisStartSeconds: 12
  });
}

describe("MLSM Whisper word correction", () => {
  it("rebuilds the real canonical sequence, anchors and time-map from inserted, deleted and renamed words", () => {
    const current = analysis();
    const sourceWords = [
      modelWord("The", .45, .72),
      modelWord("Fallen", .75, 1.35),
      modelWord("still", 1.62, 1.98),
      modelWord("loves", 2.02, 2.42),
      modelWord("me", 2.46, 2.92)
    ];
    const targetWords = [
      modelWord("The", .35, .7),
      modelWord("Fallen", .74, 1.35),
      modelWord("still", 1.6, 1.95),
      modelWord("loves", 2, 2.4),
      modelWord("me", 2.45, 2.9)
    ];
    const corrected = applyMlsmWhisperWordCorrection({ analysis: current, sourceWords, targetWords });
    expect(corrected.sourceTranscript.words.map((word) => word.text)).toEqual(["The", "Fallen", "still", "loves", "me"]);
    expect(corrected.targetTranscript.words.map((word) => word.text)).toEqual(["The", "Fallen", "still", "loves", "me"]);
    expect(corrected.canonicalLyrics.map((word) => word.text)).toEqual(["The", "Fallen", "still", "loves", "me"]);
    expect(corrected.anchors).toHaveLength(5);
    expect(corrected.anchors.every((anchor) => anchor.manuallyEdited && anchor.origin === "manual")).toBe(true);
    expect(corrected.anchors.find((anchor) => anchor.text === "Fallen")?.sourceStart).toBeCloseTo(.75, 3);
    expect(corrected.timeMap.points.find((point) => point.canonicalIndex === 1)?.sourceTime).toBeCloseTo(.75, 2);
    expect(corrected.targetAudioStartSeconds).toBeCloseTo(current.targetAnalysisStartSeconds, 3);
    expect(corrected.whisperTranscripts.target.words).toHaveLength(5);
    expect(corrected.alignmentSource).toBe("whisper");
  });

  it("rebuilds transcript text and phrases from the edited words property", () => {
    const base = transcript([modelWord("God", 0, .3), modelWord("asked", .35, .7), modelWord("me", 1.6, 1.9)], 2);
    const rebuilt = rebuildWhisperTranscript(base, [modelWord("The", .1, .4), modelWord("Fallen", .5, 1)], "source");
    expect(rebuilt.transcript).toBe("The Fallen");
    expect(rebuilt.words).toHaveLength(2);
    expect(rebuilt.phrases).toEqual([{ start: .1, end: 1, text: "The Fallen", confidence: .94 }]);
  });

  it("rejects empty, invalid and non-monotonic edits before touching the time-map", () => {
    const base = transcript([modelWord("The", .2, .5)], 2);
    expect(() => rebuildWhisperTranscript(base, [], "source")).toThrow(/non può essere vuota/u);
    expect(() => rebuildWhisperTranscript(base, [modelWord("", .2, .5)], "source")).toThrow(/è vuota/u);
    expect(() => rebuildWhisperTranscript(base, [modelWord("late", 1, 1.4), modelWord("early", .2, .5)], "source")).toThrow(/ordine crescente/u);
    expect(() => rebuildWhisperTranscript(base, [modelWord("outside", 1.8, 2.4)], "source")).toThrow(/Timestamp non valido/u);
  });
});
