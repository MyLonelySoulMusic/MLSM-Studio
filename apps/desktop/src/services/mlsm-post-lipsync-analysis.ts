import { alignCanonicalWordSequence, buildWordAnchors, lipsyncTimedWords } from "./mlsm-post-lipsync-alignment";
import { normalizeLipsyncWord, parseCanonicalLipsyncSubtitles } from "./mlsm-post-lipsync-lyrics";
import { buildLipsyncTimeMap, lipsyncMapIsMonotonic } from "./mlsm-post-lipsync-time-map";
import { unmeasuredMlsmWaveformAlignment } from "./mlsm-post-lipsync-waveform";
import {
  MLSM_POST_LIPSYNC_ANALYSIS_VERSION,
  type CanonicalLyricWord,
  type LipsyncAnalysisReport,
  type LipsyncGroundTruthWord,
  type LipsyncHardGateResult,
  type LipsyncAnalysisDetail,
  type MlsmPostLipsyncAnalysis,
  type WordAnchor
} from "./mlsm-post-lipsync-types";
import type { WhisperTranscriptDocument } from "./subtitle-generation";

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

export interface MlsmPostLipsyncTargetWindow {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  matchedWords: number;
  canonicalWords: number;
}

export interface MlsmPostLipsyncWhisperAlignment {
  canonicalLyrics: CanonicalLyricWord[];
  targetWindow: MlsmPostLipsyncTargetWindow;
}

function clipTranscript(document: WhisperTranscriptDocument, startSeconds: number, endSeconds: number): WhisperTranscriptDocument {
  const durationSeconds = endSeconds - startSeconds;
  return {
    ...document,
    durationSeconds,
    words: document.words
      .filter((word) => word.end >= startSeconds - .25 && word.start <= endSeconds + .25)
      .map((word) => ({ ...word, start: Math.max(0, word.start - startSeconds), end: Math.min(durationSeconds, Math.max(.001, word.end - startSeconds)) }))
      .filter((word) => word.end > word.start),
    phrases: document.phrases
      .filter((phrase) => phrase.end >= startSeconds - .25 && phrase.start <= endSeconds + .25)
      .map((phrase) => ({ ...phrase, start: Math.max(0, phrase.start - startSeconds), end: Math.min(durationSeconds, Math.max(.001, phrase.end - startSeconds)) }))
      .filter((phrase) => phrase.end > phrase.start)
  };
}

/** Locates the pasted lyric sequence inside the complete master transcript.
 * SRT/VTT timestamps are treated as clip-local timing; words decide where that
 * clip lives in the full song. The master duration is never used as output
 * duration. */
export function resolveMlsmPostLipsyncTargetWindow(input: {
  canonicalLyrics: readonly CanonicalLyricWord[];
  targetTranscript: WhisperTranscriptDocument;
  targetMasterDurationSeconds: number;
}): MlsmPostLipsyncTargetWindow {
  const subtitleDuration = Math.max(...input.canonicalLyrics.map((word) => word.cueEndSeconds));
  if (!Number.isFinite(subtitleDuration) || subtitleDuration <= 0) throw new Error("La porzione SRT/VTT non ha una durata valida.");
  if (subtitleDuration > input.targetMasterDurationSeconds + .05) throw new Error("La porzione SRT/VTT è più lunga del master audio.");
  const targetWords = lipsyncTimedWords(input.targetTranscript);
  const matches = alignCanonicalWordSequence(input.canonicalLyrics, targetWords, { matchTranscriptSubsequence: true });
  const requiredMatches = input.canonicalLyrics.length === 1 ? 1 : Math.max(2, Math.ceil(input.canonicalLyrics.length * .5));
  if (matches.length < requiredMatches) {
    throw new Error(`Le parole della porzione SRT/VTT non sono state riconosciute nel master (${matches.length}/${input.canonicalLyrics.length}).`);
  }
  const offsets = matches.map((match) => {
    const lyric = input.canonicalLyrics[match.canonicalIndex]!;
    const heard = targetWords[match.transcriptIndex]!;
    const expectedCenter = (lyric.estimatedStartSeconds + lyric.estimatedEndSeconds) / 2;
    return heard.centerSeconds - expectedCenter;
  });
  const estimatedStart = median(offsets);
  if (estimatedStart === null || !Number.isFinite(estimatedStart)) throw new Error("Impossibile localizzare la porzione cantata nel master.");
  const maximumStart = Math.max(0, input.targetMasterDurationSeconds - subtitleDuration);
  const startSeconds = Math.min(maximumStart, Math.max(0, estimatedStart));
  return {
    startSeconds,
    endSeconds: startSeconds + subtitleDuration,
    durationSeconds: subtitleDuration,
    matchedWords: matches.length,
    canonicalWords: input.canonicalLyrics.length
  };
}

/** Builds the canonical sequence from the two measured Whisper transcripts.
 * No subtitle timestamp is consulted: the first and last matched master words
 * define the exported audio window, while their local timestamps become the
 * target timing priors used by the normal anchor builder. */
export function resolveMlsmPostLipsyncWhisperAlignment(input: {
  sourceTranscript: WhisperTranscriptDocument;
  targetTranscript: WhisperTranscriptDocument;
}): MlsmPostLipsyncWhisperAlignment {
  const sourceWords = lipsyncTimedWords(input.sourceTranscript);
  const targetWords = lipsyncTimedWords(input.targetTranscript);
  if (!sourceWords.length) throw new Error("Whisper non ha riconosciuto parole nella voce del video sorgente.");
  if (!targetWords.length) throw new Error("Whisper non ha riconosciuto parole nella voce del master.");

  const sourceCanonical: CanonicalLyricWord[] = sourceWords.map((word, canonicalIndex) => ({
    canonicalIndex,
    text: word.text,
    normalizedText: word.normalizedText,
    cueIndex: 0,
    cueStartSeconds: word.startSeconds,
    cueEndSeconds: word.endSeconds,
    estimatedStartSeconds: word.startSeconds,
    estimatedEndSeconds: word.endSeconds
  }));
  const allMatches = alignCanonicalWordSequence(sourceCanonical, targetWords, {
    matchTranscriptSubsequence: true,
    preferTranscriptCenter: true
  });

  // A repeated chorus must not stitch two distant occurrences together. Split
  // only when the target has a very large discontinuity that is absent from the
  // source, then retain the strongest/longest compact sequence.
  const groups: typeof allMatches[] = [];
  for (const match of allMatches) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    let beginsNewGroup = !group;
    if (previous) {
      const sourceGap = sourceWords[match.canonicalIndex]!.startSeconds - sourceWords[previous.canonicalIndex]!.endSeconds;
      const targetGap = targetWords[match.transcriptIndex]!.startSeconds - targetWords[previous.transcriptIndex]!.endSeconds;
      beginsNewGroup = targetGap > Math.max(8, Math.max(0, sourceGap) * 3 + 2);
    }
    if (beginsNewGroup) groups.push([match]); else group!.push(match);
  }
  const matches = groups.sort((left, right) => {
    if (right.length !== left.length) return right.length - left.length;
    return right.reduce((sum, match) => sum + match.similarity, 0) - left.reduce((sum, match) => sum + match.similarity, 0);
  })[0] ?? [];
  // Source clips generated by AI can repeat the same requested line at either
  // edge. Repetitions must not raise the acceptance threshold as if they were
  // new lyrics, otherwise a valid single performance inside the master fails.
  const distinctSourceWords = new Set(sourceWords.map((word) => word.normalizedText)).size;
  const requiredMatches = sourceWords.length === 1 ? 1 : Math.max(2, Math.ceil(Math.min(8, distinctSourceWords, targetWords.length) * .5));
  if (matches.length < requiredMatches) {
    throw new Error(`Whisper non ha trovato una corrispondenza vocale sufficiente tra video e master (${matches.length}/${sourceWords.length} parole).`);
  }

  const firstTarget = targetWords[matches[0]!.transcriptIndex]!;
  const lastTarget = targetWords[matches.at(-1)!.transcriptIndex]!;
  const startSeconds = firstTarget.startSeconds;
  const endSeconds = lastTarget.endSeconds;
  if (!(endSeconds > startSeconds)) throw new Error("La porzione vocale individuata da Whisper non ha una durata valida.");

  let cueIndex = 0;
  const matchedWords = matches.map((match, index) => {
    const source = sourceWords[match.canonicalIndex]!;
    const target = targetWords[match.transcriptIndex]!;
    const previousMatch = matches[index - 1];
    if (previousMatch) {
      const previousSource = sourceWords[previousMatch.canonicalIndex]!;
      const previousTarget = targetWords[previousMatch.transcriptIndex]!;
      if (Math.max(source.startSeconds - previousSource.endSeconds, target.startSeconds - previousTarget.endSeconds) > .65) cueIndex += 1;
    }
    return {
      canonicalIndex: index,
      text: source.text,
      normalizedText: normalizeLipsyncWord(source.text),
      cueIndex,
      estimatedStartSeconds: Math.max(0, target.startSeconds - startSeconds),
      estimatedEndSeconds: Math.max(.001, target.endSeconds - startSeconds)
    };
  });
  const cueBounds = new Map<number, { start: number; end: number }>();
  for (const word of matchedWords) {
    const current = cueBounds.get(word.cueIndex);
    cueBounds.set(word.cueIndex, {
      start: current ? Math.min(current.start, word.estimatedStartSeconds) : word.estimatedStartSeconds,
      end: current ? Math.max(current.end, word.estimatedEndSeconds) : word.estimatedEndSeconds
    });
  }
  const canonicalLyrics: CanonicalLyricWord[] = matchedWords.map((word) => ({
    ...word,
    cueStartSeconds: cueBounds.get(word.cueIndex)!.start,
    cueEndSeconds: cueBounds.get(word.cueIndex)!.end
  }));
  return {
    canonicalLyrics,
    targetWindow: {
      startSeconds,
      endSeconds,
      durationSeconds: endSeconds - startSeconds,
      matchedWords: matches.length,
      canonicalWords: canonicalLyrics.length
    }
  };
}

export function createMlsmPostLipsyncAnalysis(input: {
  subtitles?: string;
  sourceTranscript: WhisperTranscriptDocument;
  targetTranscript: WhisperTranscriptDocument;
  sourceDurationSeconds: number;
  /** Duration of the analyzed master excerpt; target transcript timestamps are local to it. */
  targetDurationSeconds: number;
  targetMasterDurationSeconds?: number;
  targetAnalysisStartSeconds?: number;
  detailMode?: LipsyncAnalysisDetail;
  localLlmCorrection?: MlsmPostLipsyncAnalysis["localLlmCorrection"];
  waveformAlignment?: MlsmPostLipsyncAnalysis["waveformAlignment"];
  visualSpeech?: MlsmPostLipsyncAnalysis["visualSpeech"];
  whisperTranscripts?: MlsmPostLipsyncAnalysis["whisperTranscripts"];
}): MlsmPostLipsyncAnalysis {
  const subtitleText = input.subtitles?.trim() ?? "";
  const targetAnalysisStartSeconds = input.targetAnalysisStartSeconds ?? 0;
  const targetMasterDurationSeconds = input.targetMasterDurationSeconds ?? input.targetDurationSeconds;
  if (!Number.isFinite(targetAnalysisStartSeconds) || targetAnalysisStartSeconds < 0 || targetAnalysisStartSeconds + input.targetDurationSeconds > targetMasterDurationSeconds + .05) throw new Error("L’intervallo analizzato non rientra nel master audio.");
  const resolved = subtitleText
    ? (() => {
      const parsed = parseCanonicalLipsyncSubtitles(subtitleText, input.targetDurationSeconds);
      return {
        alignmentSource: "subtitles" as const,
        canonicalLyrics: parsed.words,
        targetWindow: resolveMlsmPostLipsyncTargetWindow({ canonicalLyrics: parsed.words, targetTranscript: input.targetTranscript, targetMasterDurationSeconds: input.targetDurationSeconds })
      };
    })()
    : { alignmentSource: "whisper" as const, ...resolveMlsmPostLipsyncWhisperAlignment({ sourceTranscript: input.sourceTranscript, targetTranscript: input.targetTranscript }) };
  const { alignmentSource, canonicalLyrics, targetWindow } = resolved;
  const localTargetTranscript = clipTranscript(input.targetTranscript, targetWindow.startSeconds, targetWindow.endSeconds);
  const aligned = buildWordAnchors(canonicalLyrics, input.sourceTranscript, localTargetTranscript);
  const detailMode = input.detailMode ?? "word";
  const timeMap = buildLipsyncTimeMap({ anchors: aligned.anchors, sourceDurationSeconds: input.sourceDurationSeconds, targetDurationSeconds: targetWindow.durationSeconds, detailMode });
  const corrections = aligned.anchors.map((anchor) => Math.abs(anchor.targetCenter - anchor.sourceCenter) * 1_000);
  const report: LipsyncAnalysisReport = {
    canonicalWords: canonicalLyrics.length,
    matchedWords: aligned.anchors.length,
    highConfidence: aligned.anchors.filter((anchor) => anchor.confidenceBand === "high").length,
    mediumConfidence: aligned.anchors.filter((anchor) => anchor.confidenceBand === "medium").length,
    lowConfidence: aligned.anchors.filter((anchor) => anchor.confidenceBand === "low").length,
    unresolved: aligned.unresolved.length,
    averageTimingCorrectionMs: mean(corrections),
    maximumTimingCorrectionMs: corrections.length ? Math.max(...corrections) : 0,
    segmentsRequiringInterpolation: timeMap.segments.filter((segment) => segment.requiresInterpolation).length,
    criticalRetimeSegments: timeMap.segments.filter((segment) => segment.speedBand === "critical").length,
    monotonic: lipsyncMapIsMonotonic(timeMap)
  };
  return {
    analysisVersion: MLSM_POST_LIPSYNC_ANALYSIS_VERSION,
    detailMode,
    alignmentSource,
    localLlmCorrection: input.localLlmCorrection ?? { enabled: false, applied: false, status: "disabled", recoveredWords: [], model: null, exactLyrics: null },
    waveformAlignment: input.waveformAlignment ?? unmeasuredMlsmWaveformAlignment("disabled"),
    visualSpeech: input.visualSpeech ?? { enabled: false, applied: false, status: "disabled", provider: null, model: null, revision: null, device: null, visualTranscript: "", faceCoverage: null, words: [], visemes: [], error: null },
    sourceDurationSeconds: input.sourceDurationSeconds,
    targetMasterDurationSeconds,
    targetAnalysisStartSeconds,
    targetAnalysisEndSeconds: targetAnalysisStartSeconds + input.targetDurationSeconds,
    targetAudioStartSeconds: targetAnalysisStartSeconds + targetWindow.startSeconds,
    targetAudioEndSeconds: targetAnalysisStartSeconds + targetWindow.endSeconds,
    targetDurationSeconds: targetWindow.durationSeconds,
    canonicalLyrics,
    whisperTranscripts: input.whisperTranscripts ?? { source: input.sourceTranscript, target: input.targetTranscript },
    sourceTranscript: input.sourceTranscript,
    targetTranscript: localTargetTranscript,
    anchors: aligned.anchors,
    unresolved: aligned.unresolved,
    timeMap,
    report
  };
}

export function replaceMlsmPostLipsyncAnchors(analysis: MlsmPostLipsyncAnalysis, anchors: readonly WordAnchor[]): MlsmPostLipsyncAnalysis {
  const timeMap = buildLipsyncTimeMap({ anchors, sourceDurationSeconds: analysis.sourceDurationSeconds, targetDurationSeconds: analysis.targetDurationSeconds, speedLimits: analysis.timeMap.speedLimits, detailMode: analysis.detailMode });
  const corrections = anchors.map((anchor) => Math.abs(anchor.targetCenter - anchor.sourceCenter) * 1_000);
  const resolvedIndexes = new Set(anchors.map((anchor) => anchor.canonicalIndex));
  const unresolved = analysis.unresolved.filter((word) => !resolvedIndexes.has(word.canonicalIndex));
  return {
    ...analysis,
    anchors: [...anchors],
    unresolved,
    timeMap,
    report: {
      ...analysis.report,
      matchedWords: anchors.length,
      highConfidence: anchors.filter((anchor) => anchor.confidenceBand === "high").length,
      mediumConfidence: anchors.filter((anchor) => anchor.confidenceBand === "medium").length,
      lowConfidence: anchors.filter((anchor) => anchor.confidenceBand === "low").length,
      unresolved: unresolved.length,
      averageTimingCorrectionMs: mean(corrections),
      maximumTimingCorrectionMs: corrections.length ? Math.max(...corrections) : 0,
      segmentsRequiringInterpolation: timeMap.segments.filter((segment) => segment.requiresInterpolation).length,
      criticalRetimeSegments: timeMap.segments.filter((segment) => segment.speedBand === "critical").length,
      monotonic: lipsyncMapIsMonotonic(timeMap)
    }
  };
}

export function mlsmPostLipsyncAnchorReport(analysis: MlsmPostLipsyncAnalysis): string {
  return `${JSON.stringify({
    analysisVersion: analysis.analysisVersion,
    detailMode: analysis.detailMode,
    alignmentSource: analysis.alignmentSource,
    localLlmCorrection: analysis.localLlmCorrection,
    visualSpeech: analysis.visualSpeech,
    summary: analysis.report,
    words: analysis.canonicalLyrics.map((word) => {
      const anchor = analysis.anchors.find((item) => item.canonicalIndex === word.canonicalIndex);
      const unresolved = analysis.unresolved.find((item) => item.canonicalIndex === word.canonicalIndex);
      return anchor ? {
        canonicalIndex: word.canonicalIndex,
        canonicalText: word.text,
        sourceText: anchor.sourceTranscriptText,
        sourceStart: anchor.sourceStart,
        sourceCenter: anchor.sourceCenter,
        sourceEnd: anchor.sourceEnd,
        targetText: anchor.targetTranscriptText,
        targetStart: anchor.targetStart,
        targetCenter: anchor.targetCenter,
        targetEnd: anchor.targetEnd,
        deltaMs: Math.round((anchor.targetCenter - anchor.sourceCenter) * 1_000),
        matchMethod: anchor.evidence.audioRefinement
          ? `canonical-monotonic-dp+${analysis.alignmentSource === "subtitles" ? "subtitle-prior" : "whisper-timing"}+${anchor.evidence.audioRefinement.method}`
          : `canonical-monotonic-dp+${analysis.alignmentSource === "subtitles" ? "subtitle-prior" : "whisper-timing"}`,
        confidence: anchor.matchConfidence,
        confidenceBand: anchor.confidenceBand,
        evidence: anchor.evidence
      } : { canonicalIndex: word.canonicalIndex, canonicalText: word.text, status: "unresolved", reason: unresolved?.reason ?? "missing" };
    })
  }, null, 2)}\n`;
}

export function evaluateMlsmPostLipsyncHardGate(input: {
  analysis: MlsmPostLipsyncAnalysis;
  groundTruth: readonly LipsyncGroundTruthWord[];
  fps: number;
  cacheHit?: boolean;
}): LipsyncHardGateResult {
  const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 30;
  const frameDuration = 1 / fps;
  const errors = input.groundTruth.flatMap((truth) => {
    const anchor = input.analysis.anchors.find((item) => item.canonicalIndex === truth.canonicalIndex);
    return anchor ? [Math.max(Math.abs(anchor.sourceCenter - truth.sourceCenter), Math.abs(anchor.targetCenter - truth.targetCenter)) / frameDuration] : [];
  });
  const acceptedErrors = input.groundTruth.flatMap((truth) => {
    const anchor = input.analysis.anchors.find((item) => item.canonicalIndex === truth.canonicalIndex && item.confidenceBand !== "low");
    return anchor ? [Math.max(Math.abs(anchor.sourceCenter - truth.sourceCenter), Math.abs(anchor.targetCenter - truth.targetCenter)) / frameDuration] : [];
  });
  const matchedCoverage = input.analysis.report.canonicalWords ? input.analysis.report.matchedWords / input.analysis.report.canonicalWords : 0;
  const medianAnchorErrorFrames = median(errors);
  const maximumAcceptedAnchorErrorFrames = acceptedErrors.length ? Math.max(...acceptedErrors) : null;
  const checks = [
    { id: "monotonic", passed: input.analysis.report.monotonic, detail: input.analysis.report.monotonic ? "Mappa strettamente monotona." : "La mappa contiene un’inversione." },
    { id: "coverage", passed: matchedCoverage >= .9, detail: `Copertura parole ${(matchedCoverage * 100).toFixed(1)}% (minimo 90%).` },
    { id: "ground-truth-present", passed: input.groundTruth.length > 0 && errors.length === input.groundTruth.length, detail: `${errors.length}/${input.groundTruth.length} anchor di ground truth misurati.` },
    { id: "median-error", passed: medianAnchorErrorFrames !== null && medianAnchorErrorFrames <= .5, detail: `Errore mediano ${medianAnchorErrorFrames?.toFixed(3) ?? "n/d"} frame (massimo 0.5).` },
    { id: "accepted-error", passed: maximumAcceptedAnchorErrorFrames !== null && maximumAcceptedAnchorErrorFrames <= 1, detail: `Errore massimo anchor accettati ${maximumAcceptedAnchorErrorFrames?.toFixed(3) ?? "n/d"} frame (massimo 1).` },
    { id: "cache", passed: input.cacheHit === true, detail: input.cacheHit ? "Seconda esecuzione servita dalla cache." : "Cache hit reale non dimostrato." }
  ];
  return { passed: checks.every((check) => check.passed), fps, matchedCoverage, medianAnchorErrorFrames, maximumAcceptedAnchorErrorFrames, cacheHit: input.cacheHit === true, checks };
}
