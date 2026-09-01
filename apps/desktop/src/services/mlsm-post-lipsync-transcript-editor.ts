import { createMlsmPostLipsyncAnalysis, replaceMlsmPostLipsyncAnchors } from "./mlsm-post-lipsync-analysis";
import type { MlsmPostLipsyncAnalysis, WordAnchor } from "./mlsm-post-lipsync-types";
import type { TimestampedWord, WhisperTranscriptDocument } from "./subtitle-generation";

export type MlsmWhisperTrack = "source" | "target";

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function secondsToSrt(value: number): string {
  const milliseconds = Math.max(0, Math.round(value * 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds % 3_600_000 / 60_000);
  const seconds = Math.floor(milliseconds % 60_000 / 1_000);
  const remainder = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(remainder).padStart(3, "0")}`;
}

function normalizeWords(words: readonly TimestampedWord[], durationSeconds: number, track: MlsmWhisperTrack): TimestampedWord[] {
  const label = track === "source" ? "video" : "master";
  if (!words.length) throw new Error(`La lista parole Whisper del ${label} non può essere vuota.`);
  let previousCenter = -Infinity;
  return words.map((word, index) => {
    const text = word.text.trim().replace(/\s+/gu, " ");
    const start = Number(word.start);
    const end = Number(word.end);
    if (!text) throw new Error(`La parola ${index + 1} del ${label} è vuota.`);
    if (!finite(start) || !finite(end) || start < 0 || end <= start + .001 || end > durationSeconds + .01) {
      throw new Error(`Timestamp non valido per “${text}” nel ${label}.`);
    }
    const center = (start + end) / 2;
    if (center <= previousCenter + .0005) throw new Error(`I timestamp del ${label} devono restare in ordine crescente (parola ${index + 1}).`);
    previousCenter = center;
    return {
      text,
      start,
      end: Math.min(durationSeconds, end),
      confidence: Math.min(1, Math.max(0, finite(word.confidence) ? word.confidence : .62)),
      confidenceSource: word.confidenceSource ?? "estimated"
    };
  });
}

function rebuildPhrases(words: readonly TimestampedWord[]): WhisperTranscriptDocument["phrases"] {
  const groups: TimestampedWord[][] = [];
  for (const word of words) {
    const group = groups.at(-1);
    if (!group || word.start - group.at(-1)!.end > .65) groups.push([word]);
    else group.push(word);
  }
  return groups.map((group) => ({
    start: group[0]!.start,
    end: group.at(-1)!.end,
    text: group.map((word) => word.text).join(" "),
    confidence: group.reduce((sum, word) => sum + word.confidence, 0) / group.length
  }));
}

export function rebuildWhisperTranscript(
  document: WhisperTranscriptDocument,
  words: readonly TimestampedWord[],
  track: MlsmWhisperTrack
): WhisperTranscriptDocument {
  const normalized = normalizeWords(words, document.durationSeconds, track);
  return {
    ...document,
    transcript: normalized.map((word) => word.text).join(" "),
    words: normalized,
    phrases: rebuildPhrases(normalized)
  };
}

function targetWordsAsSrt(words: readonly TimestampedWord[]): string {
  return words.map((word, index) => `${index + 1}\n${secondsToSrt(word.start)} --> ${secondsToSrt(word.end)}\n${word.text}`).join("\n\n");
}

function manualAnchor(anchor: WordAnchor): WordAnchor {
  return {
    ...anchor,
    origin: "manual",
    locked: false,
    manuallyEdited: true
  };
}

/**
 * Applies the edited `WhisperTranscriptDocument.words` as authoritative input.
 * The resulting anchors and time-map are rebuilt, so preview and export consume
 * the correction instead of merely displaying an edited copy in the UI.
 */
export function applyMlsmWhisperWordCorrection(input: {
  analysis: MlsmPostLipsyncAnalysis;
  sourceWords: readonly TimestampedWord[];
  targetWords: readonly TimestampedWord[];
}): MlsmPostLipsyncAnalysis {
  const sourceTranscript = rebuildWhisperTranscript(input.analysis.whisperTranscripts.source, input.sourceWords, "source");
  const targetTranscript = rebuildWhisperTranscript(input.analysis.whisperTranscripts.target, input.targetWords, "target");
  const rebuilt = createMlsmPostLipsyncAnalysis({
    subtitles: targetWordsAsSrt(targetTranscript.words),
    sourceTranscript,
    targetTranscript,
    sourceDurationSeconds: input.analysis.sourceDurationSeconds,
    targetDurationSeconds: targetTranscript.durationSeconds,
    targetMasterDurationSeconds: input.analysis.targetMasterDurationSeconds,
    targetAnalysisStartSeconds: input.analysis.targetAnalysisStartSeconds,
    detailMode: input.analysis.detailMode,
    localLlmCorrection: { enabled: false, applied: false, status: "disabled", recoveredWords: [], model: null, exactLyrics: null },
    visualSpeech: {
      enabled: false,
      applied: false,
      status: "disabled",
      provider: null,
      model: null,
      revision: null,
      device: null,
      visualTranscript: "",
      faceCoverage: null,
      words: [],
      visemes: [],
      error: null
    },
    whisperTranscripts: { source: sourceTranscript, target: targetTranscript }
  });
  const corrected = replaceMlsmPostLipsyncAnchors(rebuilt, rebuilt.anchors.map(manualAnchor));
  return { ...corrected, alignmentSource: "whisper" };
}
