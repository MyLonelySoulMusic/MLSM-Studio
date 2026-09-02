import { describe, expect, it } from "vitest";
import { decodeNativeWhisperTranscript } from "./mlsm-post-lipsync-whisper";

describe("Whisper Medium nativo per MLSM Post Lipsync", () => {
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
});
