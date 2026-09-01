import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ generator: vi.fn() }));

vi.mock("./local-model-runtime", () => ({
  preferredLocalAssistantModel: "qwen2.5-0.5b-instruct",
  getLocalTextGenerator: async () => runtime.generator,
  runLocalTextGeneration: (generator: (input: unknown, options: unknown) => Promise<unknown>, input: unknown, options: unknown) => generator(input, options),
  localGeneratedAnswer: (output: { generated_text?: string }[]) => output[0]?.generated_text ?? ""
}));

import { createMlsmPostLipsyncAnalysis } from "./mlsm-post-lipsync-analysis";
import { repairMlsmPostLipsyncTranscriptWithLocalLlm } from "./mlsm-post-lipsync-llm";
import type { TimestampedWord, WhisperTranscriptDocument } from "./subtitle-generation";

function transcript(words: readonly string[], times: readonly (readonly [number, number])[], durationSeconds: number): WhisperTranscriptDocument {
  const timeline: TimestampedWord[] = words.map((text, index) => ({ text, start: times[index]![0], end: times[index]![1], confidence: .95, confidenceSource: "model" }));
  return { schemaVersion: 1, engine: "Whisper", model: "whisper-base_timestamped", durationSeconds, transcript: words.join(" "), words: timeline, phrases: [] };
}

describe("MLSM POST LIPSYNC · local LLM omission repair", () => {
  beforeEach(() => runtime.generator.mockReset());

  it("recovers The Fallen before an already-correct Still loves me without moving the latter", async () => {
    runtime.generator.mockResolvedValue([{ generated_text: '{"prepend":[],"append":[],"reason":"model missed the opening"}' }]);
    const source = transcript(["Still", "loves", "me"], [[4.34, 4.9], [5.2, 6], [6.4, 7.36]], 7.5);
    const target = transcript(["The", "fallen", "Still", "loves", "me"], [[.7, 1.1], [1.4, 2.3], [4.34, 4.9], [5.2, 6], [6.4, 7.36]], 60);
    const repaired = await repairMlsmPostLipsyncTranscriptWithLocalLlm({ sourceTranscript: source, targetTranscript: target, exactSungLyrics: "The Fallen, still loves me" });
    expect(repaired).toMatchObject({ applied: true, recoveredWords: ["The", "Fallen"], model: "qwen2.5-0.5b-instruct" });
    expect(repaired.sourceTranscript.words.map((word) => word.text)).toEqual(["The", "Fallen", "Still", "loves", "me"]);
    expect(repaired.sourceTranscript.words.slice(0, 2).every((word) => word.confidenceSource === "estimated")).toBe(true);
    expect(repaired.sourceTranscript.words[2]).toEqual(source.words[0]);

    const analysis = createMlsmPostLipsyncAnalysis({
      sourceTranscript: repaired.sourceTranscript,
      targetTranscript: target,
      sourceDurationSeconds: 7.5,
      targetDurationSeconds: 60,
      localLlmCorrection: { enabled: true, applied: true, status: "applied", recoveredWords: repaired.recoveredWords, model: repaired.model, exactLyrics: "The Fallen, still loves me" }
    });
    expect(analysis.canonicalLyrics.map((word) => word.text)).toEqual(["The", "Fallen", "Still", "loves", "me"]);
    expect(analysis.anchors.map((anchor) => anchor.text)).toEqual(["The", "Fallen", "Still", "loves", "me"]);
    expect(analysis.anchors.find((anchor) => anchor.text === "Still")?.sourceStart).toBe(4.34);
    expect(analysis.localLlmCorrection.recoveredWords).toEqual(["The", "Fallen"]);
    const conversation = runtime.generator.mock.calls[0]?.[0] as { content: string }[];
    expect(conversation.some((message) => message.content.includes('"allowedPrependCandidates"'))).toBe(true);
    expect(conversation.some((message) => message.content.includes('"exactSungLyrics":"The Fallen, still loves me"'))).toBe(true);
    expect(conversation.some((message) => message.content.includes('"requiredReferencePrependIndices":[0,1]'))).toBe(true);
  });

  it("does not invent exact words that cannot be matched to the measured master", async () => {
    runtime.generator.mockResolvedValue([{ generated_text: '{"prepend":[],"append":[],"reason":"no measured reference"}' }]);
    const source = transcript(["Still", "loves", "me"], [[4.34, 4.9], [5.2, 6], [6.4, 7.36]], 7.5);
    const target = transcript(["The", "fallen", "Still", "loves", "me"], [[.7, 1.1], [1.4, 2.3], [4.34, 4.9], [5.2, 6], [6.4, 7.36]], 60);
    const repaired = await repairMlsmPostLipsyncTranscriptWithLocalLlm({ sourceTranscript: source, targetTranscript: target, exactSungLyrics: "Ghost words still loves me" });
    expect(repaired.applied).toBe(false);
    expect(repaired.sourceTranscript.words.map((word) => word.text)).toEqual(["Still", "loves", "me"]);
  });

  it("rejects indices outside the measured adjacent master words", async () => {
    runtime.generator.mockResolvedValue([{ generated_text: '{"prepend":[999],"append":[],"reason":"invented"}' }]);
    const source = transcript(["Still", "loves", "me"], [[4.34, 4.9], [5.2, 6], [6.4, 7.36]], 7.5);
    const target = transcript(["The", "fallen", "Still", "loves", "me"], [[.7, 1.1], [1.4, 2.3], [4.34, 4.9], [5.2, 6], [6.4, 7.36]], 60);
    const repaired = await repairMlsmPostLipsyncTranscriptWithLocalLlm({ sourceTranscript: source, targetTranscript: target });
    expect(repaired.applied).toBe(false);
    expect(repaired.sourceTranscript).toBe(source);
  });
});
