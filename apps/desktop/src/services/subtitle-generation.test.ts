import { describe, expect, it, vi } from "vitest";
import { alignLyricsToCues, cleanReferenceLyrics, hasMeasuredWhisperWordTimeline, phraseCues, reconcileWithLyrics, subtitleCueIssues, subtitleSrt, subtitleTranscriptJson, timestampedWords } from "./subtitle-generation";

describe("subtitle generation", () => {
  it("mantiene i timestamp Whisper ma corregge le parole con il testo ufficiale", () => {
    const aligned = reconcileWithLyrics([
      { text: "helo", start: 0, end: .3, confidence: .7 },
      { text: "world", start: .35, end: .8, confidence: .9 }
    ], "Hello world");
    expect(aligned.map((word) => word.text)).toEqual(["Hello", "world"]);
    expect(aligned[0]?.start).toBe(0);
    expect(aligned[1]?.end).toBe(.8);
  });

  it("ripulisce tag Suno e sezioni strumentali senza cancellare i versi", () => {
    expect(cleanReferenceLyrics("[Verse 1: Singer]\nHello tonight\n[Instrumental]\n\n[Chorus]\nStay with me")).toBe("Hello tonight\nStay with me");
  });

  it("non spalma sull'audio intere strofe che Whisper non ha pronunciato", () => {
    const aligned = reconcileWithLyrics([
      { text: "hello", start: 2, end: 2.3, confidence: .8 },
      { text: "tonite", start: 2.35, end: 2.7, confidence: .7 }
    ], "Intro mai pronunciata hello tonight coda mai pronunciata");
    expect(aligned).toHaveLength(2);
    expect(aligned.map((word) => word.text)).toEqual(["hello", "tonight"]);
    expect(aligned.map((word) => [word.start, word.end])).toEqual([[2, 2.3], [2.35, 2.7]]);
  });

  it("scompone correttamente un chunk Whisper contenente più parole", () => {
    const result = timestampedWords({ chunks: [{ text: "short muchlonger", timestamp: [1, 2] }] }, 3);
    expect(result.map((word) => word.text)).toEqual(["short", "muchlonger"]);
    expect(result[0]?.start).toBe(1);
    expect(result[1]?.end).toBe(2);
    expect((result[1]?.end ?? 0) - (result[1]?.start ?? 0)).toBeGreaterThan((result[0]?.end ?? 0) - (result[0]?.start ?? 0));
  });

  it("riconosce come misurata la timeline Whisper reale del video e rifiuta la frase spalmata", () => {
    const measured = [
      ["I'm", 0, .56], ["scared", .56, .9], ["to", .9, 1.28], ["be", 1.28, 1.68], ["alone", 1.68, 2.6],
      ["When", 3.17, 3.74], ["the", 3.74, 4.1], ["morning", 4.1, 4.68], ["never", 4.68, 5.4], ["comes", 5.4, 6.26],
      ["When", 7.13, 7.7], ["the", 7.7, 8.02], ["people", 8.02, 8.68], ["that", 8.68, 9.14], ["I", 9.14, 9.72],
      ["loved,", 9.72, 10.18], ["loved", 11.16, 11.3]
    ] as const;
    const result = { text: measured.map(([text]) => text).join(" "), chunks: measured.map(([text, start, end]) => ({ text, timestamp: [start, end] as [number, number] })) };
    expect(hasMeasuredWhisperWordTimeline(result, 15.042)).toBe(true);
    expect(timestampedWords(result, 15.042).map((word) => [word.text, word.start, word.end])).toEqual(measured.map(([text, start, end]) => [text, start, end]));
    expect(hasMeasuredWhisperWordTimeline({ text: result.text, chunks: [{ text: result.text, timestamp: [0, 15.042] }] }, 15.042)).toBe(false);
    expect(hasMeasuredWhisperWordTimeline({ text: result.text }, 15.042)).toBe(false);
  });

  it("preferisce pause e punteggiatura al numero indicativo di parole", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("one").mockReturnValueOnce("two") });
    const cues = phraseCues([
      { text: "One", start: 0, end: .2, confidence: .9 },
      { text: "two", start: .21, end: .4, confidence: .8 },
      { text: "three.", start: .41, end: .7, confidence: .95 },
      { text: "Four", start: 1.6, end: 2, confidence: .9 }
    ], 2);
    expect(cues.map((cue) => cue.text)).toEqual(["One two three.", "Four"]);
    expect(cues[0]?.text.split(/\s+/)).toHaveLength(3);
    expect(cues.every((cue) => cue.endSeconds > cue.startSeconds)).toBe(true);
    vi.unstubAllGlobals();
  });

  it("esporta un SRT standard con millisecondi", () => {
    const srt = subtitleSrt([{ id: "cue", startSeconds: 1.25, endSeconds: 3.5, text: "Testo LED", confidence: 1, verified: true, manual: false }]);
    expect(srt).toContain("00:00:01,250 --> 00:00:03,500");
    expect(srt).toContain("Testo LED");
  });

  it("esporta il documento Whisper con parole e frasi verificabili", () => {
    const json = subtitleTranscriptJson({
      schemaVersion: 1,
      engine: "Whisper",
      model: "whisper-base_timestamped",
      durationSeconds: 2,
      transcript: "Hello world",
      words: [{ text: "Hello", start: .1, end: .4, confidence: .9 }],
      phrases: [{ start: .1, end: .8, text: "Hello world", confidence: .88 }]
    });
    expect(JSON.parse(json)).toMatchObject({ engine: "Whisper", model: "whisper-base_timestamped", words: [{ start: .1 }], phrases: [{ text: "Hello world" }] });
  });

  it("impone durata e ingombro senza prolungare la fine oltre la voce", () => {
    const source = Array.from({ length: 12 }, (_, index) => ({ text: `word${index}`, start: index * .43, end: index * .43 + .3, confidence: .9 }));
    const cues = phraseCues(source, 10, { maxCueDuration: 2.1, maxCharsPerLine: 18, maxReadingSpeed: 22 });
    expect(cues.length).toBeGreaterThan(2);
    expect(cues.every((cue) => cue.endSeconds - cue.startSeconds <= 2.22)).toBe(true);
    expect(cues.every((cue) => cue.text.length <= 36)).toBe(true);
    expect(cues.at(-1)?.endSeconds).toBeLessThanOrEqual(source.at(-1)!.end + .081);
  });

  it("segnala blocchi fuori standard prima della conferma del consiglio", () => {
    const options = { preferredWords: 6, maxCueDuration: 4, maxCharsPerLine: 30, maxReadingSpeed: 19 };
    const previous = { id: "a", startSeconds: 0, endSeconds: 2, text: "Prima frase", confidence: 1, verified: false, manual: false };
    const cue = { id: "b", startSeconds: 1.9, endSeconds: 7, text: "Una frase decisamente troppo lunga per essere letta comodamente tutta in un singolo blocco", confidence: 1, verified: false, manual: false };
    expect(subtitleCueIssues(cue, previous, options)).toEqual(expect.arrayContaining(["durata", "righe", "sovrapposizione"]));
  });

  it("corregge il testo dei blocchi senza cambiare i timestamp", () => {
    const corrected = alignLyricsToCues([
      { id: "a", startSeconds: 1, endSeconds: 2, text: "Helo wrld", confidence: .7, verified: false, manual: false },
      { id: "b", startSeconds: 2.2, endSeconds: 3, text: "tonite", confidence: .6, verified: false, manual: false }
    ], "Hello world tonight");
    expect(corrected.map((cue) => cue.text)).toEqual(["Hello world", "tonight"]);
    expect(corrected.map((cue) => [cue.startSeconds, cue.endSeconds])).toEqual([[1, 2], [2.2, 3]]);
  });
});
