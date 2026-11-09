import { createMlsmPostLipsyncAnalysis, replaceMlsmPostLipsyncAnchors } from "./mlsm-post-lipsync-analysis";
import { canonicalLyricsFromCues } from "./mlsm-post-lipsync-lyrics";
import { parseProSubtitleFile, type ProSubtitleCue } from "./pro-subtitles";
import type { WhisperTranscriptDocument } from "./subtitle-generation";

function checkedCues(text: string, duration: number, label: string): ProSubtitleCue[] {
  const cues = parseProSubtitleFile(text);
  if (!cues.length) throw new Error(`${label}: inserisci un SRT/VTT con timestamp validi.`);
  if (cues.some((cue) => cue.endSeconds > duration + .05)) throw new Error(`${label}: i timestamp superano la durata del file. Controlla il riferimento temporale.`);
  if (cues.some((cue, index) => index > 0 && cue.startSeconds < cues[index - 1]!.endSeconds)) throw new Error(`${label}: le righe si sovrappongono. Correggi i tempi prima di allineare.`);
  return cues;
}

function documentFromCues(cues: ProSubtitleCue[], durationSeconds: number, estimated = false): WhisperTranscriptDocument {
  const words = canonicalLyricsFromCues(cues).map((word) => ({
    text: word.text, start: word.estimatedStartSeconds, end: Math.min(word.cueEndSeconds, word.estimatedEndSeconds),
    confidence: estimated ? .35 : .65, confidenceSource: "estimated" as const
  }));
  if (!words.length) throw new Error("L’SRT non contiene parole utilizzabili.");
  if (words.some((word, index) => word.end <= word.start || (index > 0 && word.start < words[index - 1]!.end - .001))) {
    throw new Error("Le righe SRT sono troppo brevi per le parole contenute.");
  }
  return {
    schemaVersion: 1, engine: estimated ? "Manual" : "Subtitles", model: "whisper-medium_timestamped",
    durationSeconds, transcript: words.map((word) => word.text).join(" "), words,
    phrases: cues.map((cue) => ({ text: cue.text, start: cue.startSeconds, end: cue.endSeconds, confidence: estimated ? .35 : .65 }))
  };
}

/** SRT timing is authoritative at cue boundaries; word boundaries inside a cue
 * are estimates. Without source subtitles, video timings are only an editable
 * proportional starting point, never a claimed recognition of mouth movement. */
export function createMlsmSrtAnalysis(input: {
  targetSubtitles: string;
  sourceSubtitles?: string;
  sourceDurationSeconds: number;
  targetMasterDurationSeconds: number;
  targetRange: { startSeconds: number; endSeconds: number };
  targetTimeBase: "master" | "selection";
}) {
  const { startSeconds, endSeconds } = input.targetRange;
  const duration = endSeconds - startSeconds;
  if (!Number.isFinite(input.sourceDurationSeconds) || input.sourceDurationSeconds <= 0
    || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || duration <= .05
    || endSeconds > input.targetMasterDurationSeconds + .05) throw new Error("Durate o selezione del master non valide.");
  const offset = input.targetTimeBase === "master" ? startSeconds : 0;
  const targetCues = checkedCues(input.targetSubtitles, input.targetTimeBase === "master" ? input.targetMasterDurationSeconds : duration, "SRT master")
    .filter((cue) => cue.endSeconds > offset && cue.startSeconds < offset + duration)
    .map((cue) => ({ ...cue, startSeconds: Math.max(0, cue.startSeconds - offset), endSeconds: Math.min(duration, cue.endSeconds - offset) }));
  if (!targetCues.length) throw new Error("Nessuna riga SRT nella porzione del master selezionata.");
  const hasSource = Boolean(input.sourceSubtitles?.trim());
  const sourceCues = hasSource
    ? checkedCues(input.sourceSubtitles!, input.sourceDurationSeconds, "SRT video")
    : targetCues.map((cue) => ({ ...cue, startSeconds: cue.startSeconds * input.sourceDurationSeconds / duration, endSeconds: cue.endSeconds * input.sourceDurationSeconds / duration }));
  const sourceTranscript = documentFromCues(sourceCues, input.sourceDurationSeconds, !hasSource);
  const targetTranscript = documentFromCues(targetCues, duration);
  const analysis = createMlsmPostLipsyncAnalysis({
    sourceTranscript, targetTranscript,
    sourceDurationSeconds: input.sourceDurationSeconds,
    targetDurationSeconds: duration,
    targetMasterDurationSeconds: input.targetMasterDurationSeconds,
    targetAnalysisStartSeconds: startSeconds,
    authoritativeTargetCues: targetCues
  });
  return replaceMlsmPostLipsyncAnchors({ ...analysis, timingMode: "srt-direct" }, analysis.anchors.map((anchor) => ({
    ...anchor, origin: hasSource ? "subtitle" : "manual", confidenceBand: "low",
    sourceConfidence: hasSource ? .65 : .35, matchConfidence: hasSource ? .65 : .35, locked: false
  })));
}
