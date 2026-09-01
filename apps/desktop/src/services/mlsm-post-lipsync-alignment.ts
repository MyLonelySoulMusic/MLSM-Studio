import type { TimestampedWord, WhisperTranscriptDocument } from "./subtitle-generation";
import { normalizeLipsyncWord } from "./mlsm-post-lipsync-lyrics";
import type {
  CanonicalLyricWord,
  LipsyncConfidenceBand,
  LipsyncTimedWord,
  UnresolvedLyricWord,
  WordAnchor
} from "./mlsm-post-lipsync-types";

export interface SequenceMatch {
  canonicalIndex: number;
  transcriptIndex: number;
  similarity: number;
  sequenceMargin: number;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function editDistance(left: string, right: string): number {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) current[column] = Math.min(
      (current[column - 1] ?? 0) + 1,
      (previous[column] ?? 0) + 1,
      (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1)
    );
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

export function lipsyncWordSimilarity(left: string, right: string): number {
  const a = normalizeLipsyncWord(left);
  const b = normalizeLipsyncWord(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const edit = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  const prefix = a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)) ? .78 : 0;
  return clamp(Math.max(edit, prefix));
}

export function lipsyncTimedWords(document: WhisperTranscriptDocument): LipsyncTimedWord[] {
  return document.words
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .map((word) => ({
      text: word.text,
      normalizedText: normalizeLipsyncWord(word.text),
      startSeconds: Math.max(0, word.start),
      centerSeconds: Math.max(0, (word.start + word.end) / 2),
      endSeconds: Math.max(word.start + .001, word.end),
      confidence: clamp(word.confidence),
      confidenceSource: word.confidenceSource ?? "unknown"
    }))
    .filter((word) => word.normalizedText.length > 0)
    .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);
}

function targetTimingPrior(canonical: CanonicalLyricWord, word: LipsyncTimedWord, enabled: boolean): number {
  if (!enabled) return 1;
  const cueDuration = Math.max(.05, canonical.cueEndSeconds - canonical.cueStartSeconds);
  const slack = Math.max(.18, cueDuration * .18);
  if (word.centerSeconds >= canonical.cueStartSeconds - slack && word.centerSeconds <= canonical.cueEndSeconds + slack) return 1;
  const distance = word.centerSeconds < canonical.cueStartSeconds
    ? canonical.cueStartSeconds - word.centerSeconds
    : word.centerSeconds - canonical.cueEndSeconds;
  return clamp(1 - distance / Math.max(.5, cueDuration));
}

/** Global dynamic-programming sequence alignment. Traceback can only move left,
 * up or diagonally, therefore repeated choruses can never make the result jump
 * backwards in either the canonical or transcript sequence. */
export function alignCanonicalWordSequence(
  canonical: readonly CanonicalLyricWord[],
  transcript: readonly LipsyncTimedWord[],
  options: { useSubtitleTimingPrior?: boolean; matchTranscriptSubsequence?: boolean; preferTranscriptCenter?: boolean } = {}
): SequenceMatch[] {
  if (!canonical.length || !transcript.length) return [];
  const rows = canonical.length + 1;
  const columns = transcript.length + 1;
  const costs = new Float64Array(rows * columns);
  const trace = new Uint8Array(rows * columns);
  const at = (row: number, column: number) => row * columns + column;
  const canonicalGap = .74;
  const transcriptGap = .82;
  for (let row = 1; row < rows; row += 1) { costs[at(row, 0)] = row * canonicalGap; trace[at(row, 0)] = 1; }
  for (let column = 1; column < columns; column += 1) {
    costs[at(0, column)] = options.matchTranscriptSubsequence ? 0 : column * transcriptGap;
    trace[at(0, column)] = 2;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const lyric = canonical[row - 1]!;
      const heard = transcript[column - 1]!;
      const similarity = lipsyncWordSimilarity(lyric.text, heard.text);
      const timingPrior = targetTimingPrior(lyric, heard, options.useSubtitleTimingPrior === true);
      const positionDrift = options.matchTranscriptSubsequence ? 0 : Math.abs((row - 1) / Math.max(1, canonical.length - 1) - (column - 1) / Math.max(1, transcript.length - 1));
      const diagonal = costs[at(row - 1, column - 1)]! + (1 - similarity) + (1 - timingPrior) * .38 + positionDrift * .035;
      const skipCanonical = costs[at(row - 1, column)]! + canonicalGap;
      const skipTranscript = costs[at(row, column - 1)]! + transcriptGap;
      if (diagonal <= skipCanonical && diagonal <= skipTranscript) { costs[at(row, column)] = diagonal; trace[at(row, column)] = 0; }
      else if (skipCanonical <= skipTranscript) { costs[at(row, column)] = skipCanonical; trace[at(row, column)] = 1; }
      else { costs[at(row, column)] = skipTranscript; trace[at(row, column)] = 2; }
    }
  }

  const reversed: SequenceMatch[] = [];
  let row = canonical.length;
  let column = transcript.length;
  if (options.matchTranscriptSubsequence) {
    let bestCost = costs[at(row, column)]!;
    for (let candidate = 1; candidate < columns; candidate += 1) {
      bestCost = Math.min(bestCost, costs[at(row, candidate)]!);
    }
    const candidates = Array.from({ length: columns - 1 }, (_, index) => index + 1)
      .filter((candidate) => Math.abs(costs[at(row, candidate)]! - bestCost) <= 1e-9);
    if (candidates.length) {
      column = options.preferTranscriptCenter
        ? candidates.reduce((best, candidate) => {
          const candidateCenter = candidate - canonical.length / 2;
          const bestCenter = best - canonical.length / 2;
          return Math.abs(candidateCenter - transcript.length / 2) < Math.abs(bestCenter - transcript.length / 2) ? candidate : best;
        })
        : candidates[0]!;
    }
  }
  while (row > 0 || !options.matchTranscriptSubsequence && column > 0) {
    const direction = trace[at(row, column)];
    if (row > 0 && column > 0 && direction === 0) {
      const lyric = canonical[row - 1]!;
      const heard = transcript[column - 1]!;
      const similarity = lipsyncWordSimilarity(lyric.text, heard.text);
      const alternative = Math.max(
        column > 1 ? lipsyncWordSimilarity(lyric.text, transcript[column - 2]!.text) : 0,
        row > 1 ? lipsyncWordSimilarity(canonical[row - 2]!.text, heard.text) : 0
      );
      if (similarity >= .42) reversed.push({ canonicalIndex: row - 1, transcriptIndex: column - 1, similarity, sequenceMargin: clamp(similarity - alternative + .5) });
      row -= 1;
      column -= 1;
    } else if (row > 0 && (column === 0 || direction === 1)) row -= 1;
    else column -= 1;
  }
  return reversed.reverse();
}

function confidenceBand(value: number, resolved: boolean): LipsyncConfidenceBand {
  if (!resolved) return "unresolved";
  if (value >= .78) return "high";
  if (value >= .58) return "medium";
  return "low";
}

function effectiveTranscriptConfidence(word: LipsyncTimedWord): number {
  // Estimated confidence remains useful as weak evidence, but it is never
  // treated as a real token probability.
  return word.confidenceSource === "model" ? word.confidence : Math.min(.62, word.confidence);
}

export function buildWordAnchors(
  canonical: readonly CanonicalLyricWord[],
  sourceDocument: WhisperTranscriptDocument,
  targetDocument: WhisperTranscriptDocument
): { anchors: WordAnchor[]; unresolved: UnresolvedLyricWord[] } {
  const sourceWords = lipsyncTimedWords(sourceDocument);
  const targetWords = lipsyncTimedWords(targetDocument);
  // AI video generators often repeat the requested phrase at both edges. Match
  // the complete lyric as a subsequence and prefer the central equal-quality
  // occurrence; the user must not have to trim those repetitions manually.
  const sourceMatches = new Map(alignCanonicalWordSequence(canonical, sourceWords, {
    matchTranscriptSubsequence: true,
    preferTranscriptCenter: true
  }).map((match) => [match.canonicalIndex, match]));
  const targetMatches = new Map(alignCanonicalWordSequence(canonical, targetWords, { useSubtitleTimingPrior: true }).map((match) => [match.canonicalIndex, match]));
  const anchors: WordAnchor[] = [];
  const unresolved: UnresolvedLyricWord[] = [];

  for (const lyric of canonical) {
    const sourceMatch = sourceMatches.get(lyric.canonicalIndex);
    const targetMatch = targetMatches.get(lyric.canonicalIndex);
    const source = sourceMatch ? sourceWords[sourceMatch.transcriptIndex] : undefined;
    const target = targetMatch ? targetWords[targetMatch.transcriptIndex] : undefined;
    if (!source || !target) {
      unresolved.push({
        canonicalIndex: lyric.canonicalIndex,
        text: lyric.text,
        reason: !source && !target ? "both-missing" : !source ? "source-missing" : "target-missing"
      });
      continue;
    }
    const sourceConfidence = effectiveTranscriptConfidence(source);
    const targetConfidence = effectiveTranscriptConfidence(target);
    const textSimilarity = Math.sqrt(sourceMatch!.similarity * targetMatch!.similarity);
    const subtitlePrior = targetTimingPrior(lyric, target, true);
    const sequenceMargin = Math.min(sourceMatch!.sequenceMargin, targetMatch!.sequenceMargin);
    const matchConfidence = clamp(textSimilarity * .42 + sourceConfidence * .16 + targetConfidence * .16 + subtitlePrior * .16 + sequenceMargin * .10);
    const resolved = matchConfidence >= .42;
    if (!resolved) {
      unresolved.push({ canonicalIndex: lyric.canonicalIndex, text: lyric.text, reason: "low-confidence" });
      continue;
    }
    const useCanonicalTargetTiming = source.confidenceSource !== "model";
    anchors.push({
      id: `lipsync-word-${lyric.canonicalIndex}`,
      text: lyric.text,
      canonicalIndex: lyric.canonicalIndex,
      cueIndex: lyric.cueIndex,
      sourceStart: source.startSeconds,
      sourceCenter: source.centerSeconds,
      sourceEnd: source.endSeconds,
      // SRT/VTT is the canonical clock. Whisper confirms word identity and
      // phrase onset, but its sung word timestamps are not allowed to move the
      // internal lyric boundaries arbitrarily.
      targetStart: useCanonicalTargetTiming ? lyric.estimatedStartSeconds : target.startSeconds,
      targetCenter: useCanonicalTargetTiming ? (lyric.estimatedStartSeconds + lyric.estimatedEndSeconds) / 2 : target.centerSeconds,
      targetEnd: useCanonicalTargetTiming ? lyric.estimatedEndSeconds : target.endSeconds,
      sourceConfidence,
      targetConfidence,
      matchConfidence,
      confidenceBand: confidenceBand(matchConfidence, true),
      // “estimated” is still Whisper evidence; reserve subtitle/recovered for
      // genuinely weak timing seeds that need phrase-wide recovery.
      origin: sourceConfidence < .5 ? "subtitle" : "automatic",
      locked: false,
      manuallyEdited: false,
      evidence: { textSimilarity, sourceConfidence, targetConfidence, subtitlePrior, sequenceMargin },
      sourceTranscriptText: source.text,
      targetTranscriptText: target.text
    });
  }

  // The successful hard-gate did not align only word centres: it retained the
  // beginning and end of each sung phrase (for example The fallen:start/end and
  // me:start/end). Expand the first/last resolved word in every subtitle cue to
  // the complete transcript evidence for that cue. This also preserves a
  // phrase boundary when Whisper misses one canonical word such as "The".
  for (const cueIndex of new Set(canonical.map((lyric) => lyric.cueIndex))) {
    const cueLyrics = canonical.filter((lyric) => lyric.cueIndex === cueIndex);
    const cueCanonicalIndexes = new Set(cueLyrics.map((lyric) => lyric.canonicalIndex));
    const resolved = anchors
      .filter((anchor) => cueCanonicalIndexes.has(anchor.canonicalIndex))
      .sort((left, right) => left.canonicalIndex - right.canonicalIndex);
    if (!resolved.length) continue;
    const cueSourceWords = cueLyrics.flatMap((lyric) => {
      const match = sourceMatches.get(lyric.canonicalIndex);
      return match ? [sourceWords[match.transcriptIndex]!] : [];
    });
    const cueTargetWords = cueLyrics.flatMap((lyric) => {
      const match = targetMatches.get(lyric.canonicalIndex);
      return match ? [targetWords[match.transcriptIndex]!] : [];
    });
    const first = resolved[0]!; const last = resolved.at(-1)!;
    const phraseRecovery = resolved.some((anchor) => anchor.sourceConfidence < .5);
    const firstIndex = anchors.findIndex((anchor) => anchor.id === first.id);
    const lastIndex = anchors.findIndex((anchor) => anchor.id === last.id);
    if (firstIndex >= 0) anchors[firstIndex] = {
      ...first,
      sourceStart: cueSourceWords.length ? Math.min(...cueSourceWords.map((word) => word.startSeconds)) : first.sourceStart,
      targetStart: cueTargetWords.length ? Math.min(...cueTargetWords.map((word) => word.startSeconds)) : first.targetStart
    };
    if (lastIndex >= 0) anchors[lastIndex] = {
      ...anchors[lastIndex]!,
      sourceEnd: cueSourceWords.length ? Math.max(...cueSourceWords.map((word) => word.endSeconds)) : last.sourceEnd,
      targetEnd: phraseRecovery ? cueLyrics[0]?.cueEndSeconds ?? last.targetEnd : cueTargetWords.length ? Math.max(...cueTargetWords.map((word) => word.endSeconds)) : last.targetEnd
    };
  }

  return { anchors, unresolved };
}

export function timestampedWordFromLipsync(word: LipsyncTimedWord): TimestampedWord {
  return { text: word.text, start: word.startSeconds, end: word.endSeconds, confidence: word.confidence, confidenceSource: word.confidenceSource };
}
