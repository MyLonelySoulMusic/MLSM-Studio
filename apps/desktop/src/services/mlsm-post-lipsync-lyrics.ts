import { parseProSubtitleFile, type ProSubtitleCue } from "./pro-subtitles";
import type { CanonicalLyricWord } from "./mlsm-post-lipsync-types";

const sectionOnly = /^(?:instrumental|intro|outro|interlude|break|bridge|verse|pre[ -]?chorus|chorus|refrain|hook|solo)(?:\s+\d+)?$/iu;

export function normalizeLipsyncWord(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’`´]/g, "'")
    .toLocaleLowerCase()
    .replace(/^[-–—]+|[-–—]+$/g, "")
    .replace(/[^\p{L}\p{N}']/gu, "")
    .replace(/^'+|'+$/g, "");
}

export function tokenizeCanonicalLyricText(value: string): string[] {
  return value
    .normalize("NFKC")
    .replace(/\[[^\]\r\n]{1,120}\]/gu, " ")
    .replace(/\([^\r\n)]{1,120}\)/gu, " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token && !sectionOnly.test(normalizeLipsyncWord(token)))
    .filter((token) => normalizeLipsyncWord(token).length > 0);
}

function weightedCueWords(cue: ProSubtitleCue, cueIndex: number, offset: number): CanonicalLyricWord[] {
  const tokens = tokenizeCanonicalLyricText(cue.text);
  const weights = tokens.map((token) => Math.max(1, [...normalizeLipsyncWord(token)].length));
  const totalWeight = Math.max(1, weights.reduce((total, weight) => total + weight, 0));
  const duration = Math.max(.04, cue.endSeconds - cue.startSeconds);
  let elapsed = 0;
  return tokens.map((text, index) => {
    const startWeight = elapsed;
    elapsed += weights[index] ?? 1;
    const estimatedStartSeconds = cue.startSeconds + duration * startWeight / totalWeight;
    const estimatedEndSeconds = cue.startSeconds + duration * elapsed / totalWeight;
    return {
      canonicalIndex: offset + index,
      text,
      normalizedText: normalizeLipsyncWord(text),
      cueIndex,
      cueStartSeconds: cue.startSeconds,
      cueEndSeconds: cue.endSeconds,
      estimatedStartSeconds,
      estimatedEndSeconds: Math.max(estimatedStartSeconds + .025, estimatedEndSeconds)
    };
  });
}

export function canonicalLyricsFromCues(cues: readonly ProSubtitleCue[]): CanonicalLyricWord[] {
  const result: CanonicalLyricWord[] = [];
  cues.forEach((cue, cueIndex) => result.push(...weightedCueWords(cue, cueIndex, result.length)));
  return result;
}

export function parseCanonicalLipsyncSubtitles(serialized: string, durationSeconds?: number): {
  cues: ProSubtitleCue[];
  words: CanonicalLyricWord[];
} {
  const cues = parseProSubtitleFile(serialized, durationSeconds);
  const words = canonicalLyricsFromCues(cues);
  if (!words.length) throw new Error("Il file SRT/VTT non contiene parole canoniche utilizzabili.");
  return { cues, words };
}
