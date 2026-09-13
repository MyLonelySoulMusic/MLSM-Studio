import { beforeEach, describe, expect, it, vi } from "vitest";
const remoteMocks = vi.hoisted(() => ({ requestRemoteAnswer: vi.fn() }));
vi.mock("./studio-settings", () => ({
  providerLabels: { nvidia: "NVIDIA", openai: "OpenAI", gemini: "Google Gemini", xai: "xAI / Grok" },
  requestRemoteAnswer: remoteMocks.requestRemoteAnswer,
}));
import { buildAudioTranscriptReviewMessages, correctAudioTranscript, retimeReferenceWords, transcriptAsSrt, transcriptAsVtt } from "./audio-tools";
import type { WhisperTranscriptDocument } from "./subtitle-generation";

function transcript(): WhisperTranscriptDocument {
  return {
    schemaVersion: 1,
    engine: "Whisper",
    model: "whisper-medium_timestamped",
    durationSeconds: 3,
    transcript: "hello old world",
    words: [
      { text: "hello", start: .2, end: .7, confidence: .91, confidenceSource: "model" },
      { text: "old", start: .9, end: 1.2, confidence: .88, confidenceSource: "model" },
      { text: "world", start: 1.5, end: 2.4, confidence: .93, confidenceSource: "model" },
    ],
    phrases: [{ start: .2, end: 2.4, text: "hello old world", confidence: .9 }],
  };
}

describe("audio tools", () => {
  beforeEach(() => vi.clearAllMocks());
  it("cambia le parole senza alterare i timestamp Whisper quando il conteggio coincide", () => {
    const source = transcript();
    const result = retimeReferenceWords(source, ["Hello,", "new", "world!"]);
    expect(result.words.map(({ start, end }) => ({ start, end }))).toEqual(source.words.map(({ start, end }) => ({ start, end })));
    expect(result.words.map((word) => word.text)).toEqual(["Hello,", "new", "world!"]);
    expect(result.words.every((word) => word.confidenceSource === "model")).toBe(true);
  });

  it("marca come stimati soltanto i tempi ricostruiti quando cambia il numero di parole", () => {
    const result = retimeReferenceWords(transcript(), ["hello", "beautiful", "new", "world"]);
    expect(result.words).toHaveLength(4);
    expect(result.words.every((word) => word.confidenceSource === "estimated")).toBe(true);
    expect(result.words[0]!.start).toBe(.2);
    expect(result.words.at(-1)!.end).toBe(2.4);
  });

  it("esporta clock SRT e WebVTT standard", () => {
    expect(transcriptAsSrt(transcript())).toContain("00:00:00,200 --> 00:00:02,400");
    expect(transcriptAsVtt(transcript())).toContain("00:00:00.200 --> 00:00:02.400");
  });

  it("invia al revisore tutti i dati Whisper e il testo autorevole", () => {
    const messages = buildAudioTranscriptReviewMessages(transcript(), "hello new world");
    expect(messages[0]!.content).toContain('"confidenceSource":"model"');
    expect(messages[0]!.content).toContain('"phrases"');
    expect(messages[0]!.content).toContain("<reference_text>hello new world</reference_text>");
    expect(messages[0]!.content).toContain("non aggiungere o rimuovere parole");
  });

  it("usa il provider API scelto e conserva i timestamp Whisper", async () => {
    remoteMocks.requestRemoteAnswer.mockResolvedValue({ content: '{"text":"Hello, new world!"}', model: "gpt-test", source: "openai" });
    const original = transcript();
    const result = await correctAudioTranscript(original, "hello new world", vi.fn(), { reviewer: "openai" });

    expect(remoteMocks.requestRemoteAnswer).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ provider: "openai" }));
    expect(result.transcript).toBe("Hello, new world!");
    expect(result.words.map(({ start, end }) => ({ start, end }))).toEqual(original.words.map(({ start, end }) => ({ start, end })));
  });

  it("non perde la trascrizione se il revisore scelto non è raggiungibile", async () => {
    remoteMocks.requestRemoteAnswer.mockRejectedValue(new Error("provider offline"));
    const progress = vi.fn();
    const result = await correctAudioTranscript(transcript(), "hello new world", progress, { reviewer: "openai" });
    expect(result.transcript).toBe("hello new world");
    expect(result.words.map((word) => word.text)).toEqual(["hello", "new", "world"]);
    expect(progress).toHaveBeenCalledWith(expect.stringMatching(/Revisore non disponibile/));
  });
});
