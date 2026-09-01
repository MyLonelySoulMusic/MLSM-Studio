import { describe, expect, it } from "vitest";
import { constrainMlsmPostLipsyncTranscriptToExactLyrics } from "./mlsm-post-lipsync-exact-transcript";
import type { TimestampedWord, WhisperTranscriptDocument } from "./subtitle-generation";

function transcript(words: readonly TimestampedWord[], durationSeconds: number): WhisperTranscriptDocument {
  return {
    schemaVersion: 1,
    engine: "Whisper",
    model: "whisper-base_timestamped",
    durationSeconds,
    transcript: words.map((word) => word.text).join(" "),
    words: [...words],
    phrases: []
  };
}

function estimated(text: string, start: number, end: number): TimestampedWord {
  return { text, start, end, confidence: .62, confidenceSource: "estimated" };
}

function expectStrictTimeline(words: readonly TimestampedWord[], durationSeconds: number): void {
  words.forEach((word, index) => {
    expect(word.start).toBeGreaterThanOrEqual(0);
    expect(word.end).toBeGreaterThan(word.start);
    expect(word.end).toBeLessThanOrEqual(durationSeconds);
    if (index) expect(word.start).toBeGreaterThanOrEqual(words[index - 1]!.end);
  });
}

describe("MLSM POST LIPSYNC · exact transcript constraint", () => {
  it("removes sustained-vowel noise and splits a fused rubelo token into Rule below", () => {
    const noisy = transcript([
      estimated("God", 0, .4),
      estimated("asked", .4, 1.18),
      estimated("me,", 1.18, 1.56),
      ...Array.from({ length: 24 }, (_, index) => estimated("-o", 1.24 + index * .13, 1.31 + index * .13)),
      estimated("come", 1.997, 2.52),
      estimated("back", 2.529, 2.8),
      estimated("home", 2.8, 3.3),
      estimated("the", 3.328, 3.5),
      estimated("devil", 3.5, 3.88),
      estimated("smiled,", 3.927, 4.74),
      estimated("rubelo", 5.24, 5.92),
      ...Array.from({ length: 25 }, (_, index) => estimated("-o", 6 + index * .2, 6.07 + index * .2))
    ], 15.041667);

    const constrained = constrainMlsmPostLipsyncTranscriptToExactLyrics(noisy, "God asked me Come back home The devil smiled Rule below");
    expect(constrained.words.map((word) => word.text)).toEqual(["God", "asked", "me", "Come", "back", "home", "The", "devil", "smiled", "Rule", "below"]);
    expect(constrained.words.some((word) => word.text === "-o")).toBe(false);
    expect(constrained.words.find((word) => word.text === "God")).toMatchObject({ start: 0, end: .4 });
    expect(constrained.words.find((word) => word.text === "Rule")).toMatchObject({ start: 5.24, confidenceSource: "estimated" });
    expect(constrained.words.find((word) => word.text === "below")?.end).toBeCloseTo(5.92, 9);
    expectStrictTimeline(constrained.words, noisy.durationSeconds);
  });

  it("keeps measured target timings, discards an extra to and infers only the missing suffix", () => {
    const target = transcript([
      estimated("God", 0, 1.08), estimated("ask", 1.08, 1.72), estimated("me", 1.72, 1.92),
      estimated("to", 1.92, 2.18), estimated("come", 2.18, 2.44), estimated("back", 2.44, 2.64),
      estimated("home", 2.64, 3.56), estimated("The", 3.56, 4.28), estimated("devil", 4.28, 4.66),
      estimated("smiled", 4.66, 5.34), estimated("brooom", 5.34, 6.02), estimated("in", 6.02, 6.28),
      estimated("the", 6.28, 6.56), estimated("air", 6.56, 7)
    ], 7.005);

    const constrained = constrainMlsmPostLipsyncTranscriptToExactLyrics(target, "God asked me Come back home The devil smiled Rule below");
    expect(constrained.words.map((word) => word.text)).toEqual(["God", "asked", "me", "Come", "back", "home", "The", "devil", "smiled", "Rule", "below"]);
    expect(constrained.words.find((word) => word.text === "asked")).toMatchObject({ start: 1.08, end: 1.72 });
    expect(constrained.words.some((word) => word.text.toLocaleLowerCase() === "to")).toBe(false);
    expect(constrained.words.find((word) => word.text === "Rule")?.start).toBeCloseTo(5.34, 9);
    expect(constrained.words.find((word) => word.text === "below")?.end).toBeCloseTo(7, 9);
    expectStrictTimeline(constrained.words, target.durationSeconds);
  });

  it("does not move measured words when it must infer a missing opening", () => {
    const source = transcript([
      { text: "Still", start: 4.34, end: 4.9, confidence: .95, confidenceSource: "model" },
      { text: "loves", start: 5.2, end: 6, confidence: .95, confidenceSource: "model" },
      { text: "me", start: 6.4, end: 7.36, confidence: .95, confidenceSource: "model" }
    ], 7.5);

    const constrained = constrainMlsmPostLipsyncTranscriptToExactLyrics(source, "The Fallen Still loves me");
    expect(constrained.words.map((word) => word.text)).toEqual(["The", "Fallen", "Still", "loves", "me"]);
    expect(constrained.words[2]).toEqual(source.words[0]);
    expect(constrained.words.slice(0, 2).every((word) => word.confidenceSource === "estimated")).toBe(true);
    expectStrictTimeline(constrained.words, source.durationSeconds);
  });
});
