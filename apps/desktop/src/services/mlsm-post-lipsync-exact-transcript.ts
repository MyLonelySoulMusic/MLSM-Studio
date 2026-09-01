import { lipsyncWordSimilarity } from "./mlsm-post-lipsync-alignment";
import { normalizeLipsyncWord, tokenizeCanonicalLyricText } from "./mlsm-post-lipsync-lyrics";
import type { TimestampedWord, WhisperTranscriptDocument } from "./subtitle-generation";

interface ExactToken {
  text: string;
  normalizedText: string;
}

interface ObservedToken extends TimestampedWord {
  normalizedText: string;
}

interface MatchedGroup {
  exactStart: number;
  exactEnd: number;
  observedStart: number;
  observedEnd: number;
  similarity: number;
}

interface AlignmentPath {
  cost: number;
  groups: MatchedGroup[];
  groundedWords: number;
  centerDistance: number;
}

const enum TraceOperation {
  None = 0,
  MissingExact = 1,
  SkipObserved = 2,
  MatchOneToOne = 3,
  MatchTwoExactToOneObserved = 4,
  MatchOneExactToTwoObserved = 5
}

const minimumWordDuration = .001;

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function exactTokens(value: string): ExactToken[] {
  return tokenizeCanonicalLyricText(value).flatMap((text) => {
    const normalizedText = normalizeLipsyncWord(text);
    return normalizedText ? [{ text, normalizedText }] : [];
  });
}

function observedTokens(document: WhisperTranscriptDocument): ObservedToken[] {
  return document.words.flatMap((word) => {
    const normalizedText = normalizeLipsyncWord(word.text);
    return normalizedText && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start
      ? [{ ...word, start: Math.max(0, word.start), end: Math.min(document.durationSeconds, word.end), normalizedText }]
      : [];
  }).filter((word) => word.end > word.start).sort((left, right) => left.start - right.start || left.end - right.end);
}

function joinedExact(tokens: readonly ExactToken[], start: number, end: number): string {
  return tokens.slice(start, end).map((token) => token.normalizedText).join("");
}

function joinedObserved(tokens: readonly ObservedToken[], start: number, end: number): string {
  return tokens.slice(start, end).map((token) => token.normalizedText).join("");
}

function matchThreshold(left: string, right: string, compound = false): number {
  if (!compound && Math.min(left.length, right.length) <= 2) return left === right ? 1 : Number.POSITIVE_INFINITY;
  return compound ? .5 : .52;
}

function usableSimilarity(left: string, right: string, compound = false): number | null {
  if (compound && Math.min(left.length, right.length) / Math.max(left.length, right.length) < .62) return null;
  const similarity = lipsyncWordSimilarity(left, right);
  return similarity >= matchThreshold(left, right, compound) ? similarity : null;
}

function observedSkipCost(word: ObservedToken): number {
  // Whisper often turns a sustained vowel into hundreds of tokens such as
  // "-o". They are useful acoustic evidence, but never lexical evidence.
  return /^[-–—]+\p{L}{1,3}$/iu.test(word.text.trim()) ? .001 : .02;
}

function tracePriority(operation: TraceOperation): number {
  if (operation === TraceOperation.MatchOneToOne) return 5;
  if (operation === TraceOperation.MatchTwoExactToOneObserved || operation === TraceOperation.MatchOneExactToTwoObserved) return 4;
  if (operation === TraceOperation.MissingExact) return 2;
  if (operation === TraceOperation.SkipObserved) return 1;
  return 0;
}

function alignmentPath(
  endColumn: number,
  exact: readonly ExactToken[],
  observed: readonly ObservedToken[],
  columns: number,
  costs: Float64Array,
  trace: Uint8Array,
  durationSeconds: number
): AlignmentPath {
  const at = (row: number, column: number) => row * columns + column;
  const reversed: MatchedGroup[] = [];
  let row = exact.length;
  let column = endColumn;
  while (row > 0) {
    const operation = trace[at(row, column)] as TraceOperation;
    if (operation === TraceOperation.MatchOneToOne) {
      reversed.push({ exactStart: row - 1, exactEnd: row, observedStart: column - 1, observedEnd: column, similarity: lipsyncWordSimilarity(exact[row - 1]!.normalizedText, observed[column - 1]!.normalizedText) });
      row -= 1; column -= 1;
    } else if (operation === TraceOperation.MatchTwoExactToOneObserved) {
      reversed.push({ exactStart: row - 2, exactEnd: row, observedStart: column - 1, observedEnd: column, similarity: lipsyncWordSimilarity(joinedExact(exact, row - 2, row), observed[column - 1]!.normalizedText) });
      row -= 2; column -= 1;
    } else if (operation === TraceOperation.MatchOneExactToTwoObserved) {
      reversed.push({ exactStart: row - 1, exactEnd: row, observedStart: column - 2, observedEnd: column, similarity: lipsyncWordSimilarity(exact[row - 1]!.normalizedText, joinedObserved(observed, column - 2, column)) });
      row -= 1; column -= 2;
    } else if (operation === TraceOperation.SkipObserved && column > 0) column -= 1;
    else row -= 1;
  }
  const groups = reversed.reverse();
  const groundedWords = groups.reduce((total, group) => total + group.exactEnd - group.exactStart, 0);
  const first = groups[0]; const last = groups.at(-1);
  const center = first && last
    ? (observed[first.observedStart]!.start + observed[last.observedEnd - 1]!.end) / 2
    : durationSeconds / 2;
  return { cost: costs[at(exact.length, endColumn)]!, groups, groundedWords, centerDistance: Math.abs(center - durationSeconds / 2) };
}

/**
 * Aligns exact user lyrics to a noisy Whisper sequence. Besides normal
 * one-to-one matches it supports one fused Whisper token for two lyric words
 * (for example `rubelo` -> `Rule below`) and the inverse case. Unmatched
 * observed tokens are discarded; unmatched exact words are timed later.
 */
function alignExactSequence(exact: readonly ExactToken[], observed: readonly ObservedToken[], durationSeconds: number): MatchedGroup[] {
  if (!exact.length || !observed.length) return [];
  const rows = exact.length + 1; const columns = observed.length + 1;
  const costs = new Float64Array(rows * columns); costs.fill(Number.POSITIVE_INFINITY);
  const trace = new Uint8Array(rows * columns);
  const at = (row: number, column: number) => row * columns + column;
  costs[at(0, 0)] = 0;
  // The requested phrase may live inside a complete master or a repeated AI
  // performance. Leading observed words therefore carry no cost.
  for (let column = 1; column < columns; column += 1) { costs[at(0, column)] = 0; trace[at(0, column)] = TraceOperation.SkipObserved; }
  for (let row = 1; row < rows; row += 1) { costs[at(row, 0)] = row * .74; trace[at(row, 0)] = TraceOperation.MissingExact; }

  const consider = (row: number, column: number, candidate: number, operation: TraceOperation) => {
    const index = at(row, column); const current = costs[index]!;
    if (candidate < current - 1e-9 || Math.abs(candidate - current) <= 1e-9 && tracePriority(operation) > tracePriority(trace[index] as TraceOperation)) {
      costs[index] = candidate; trace[index] = operation;
    }
  };

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      consider(row, column, costs[at(row - 1, column)]! + .74, TraceOperation.MissingExact);
      consider(row, column, costs[at(row, column - 1)]! + observedSkipCost(observed[column - 1]!), TraceOperation.SkipObserved);

      const exactWord = exact[row - 1]!.normalizedText; const observedWord = observed[column - 1]!.normalizedText;
      const oneToOne = usableSimilarity(exactWord, observedWord);
      if (oneToOne !== null) consider(row, column, costs[at(row - 1, column - 1)]! + (1 - oneToOne) * .62, TraceOperation.MatchOneToOne);

      if (row >= 2) {
        const exactPair = joinedExact(exact, row - 2, row);
        const twoToOne = usableSimilarity(exactPair, observedWord, true);
        if (twoToOne !== null) consider(row, column, costs[at(row - 2, column - 1)]! + (1 - twoToOne) * .62 + .06, TraceOperation.MatchTwoExactToOneObserved);
      }
      if (column >= 2) {
        const observedPair = joinedObserved(observed, column - 2, column);
        const oneToTwo = usableSimilarity(exactWord, observedPair, true);
        if (oneToTwo !== null) consider(row, column, costs[at(row - 1, column - 2)]! + (1 - oneToTwo) * .62 + .06, TraceOperation.MatchOneExactToTwoObserved);
      }
    }
  }

  let bestCost = Number.POSITIVE_INFINITY;
  for (let column = 0; column < columns; column += 1) bestCost = Math.min(bestCost, costs[at(exact.length, column)]!);
  const paths = Array.from({ length: columns }, (_, column) => column)
    .filter((column) => Math.abs(costs[at(exact.length, column)]! - bestCost) <= 1e-8)
    .map((column) => alignmentPath(column, exact, observed, columns, costs, trace, durationSeconds))
    .sort((left, right) => right.groundedWords - left.groundedWords || left.centerDistance - right.centerDistance);
  return paths[0]?.groups ?? [];
}

interface TimedGroup extends MatchedGroup {
  start: number;
  end: number;
  confidence: number;
  confidenceSource: TimestampedWord["confidenceSource"];
}

function timedGroups(groups: readonly MatchedGroup[], observed: readonly ObservedToken[]): TimedGroup[] {
  const timed = groups.map((group) => {
    const evidence = observed.slice(group.observedStart, group.observedEnd);
    const compound = group.exactEnd - group.exactStart !== 1 || group.observedEnd - group.observedStart !== 1;
    return {
      ...group,
      start: evidence[0]!.start,
      end: evidence.at(-1)!.end,
      confidence: compound ? Math.min(.62, ...evidence.map((word) => word.confidence)) : evidence[0]!.confidence,
      confidenceSource: compound ? "estimated" as const : evidence[0]!.confidenceSource ?? "unknown"
    };
  });
  // Whisper chunks can overlap. Resolve only the conflicting boundary, keeping
  // the measured outer limits and the sequence strictly monotone.
  for (let index = 1; index < timed.length; index += 1) {
    const previous = timed[index - 1]!; const current = timed[index]!;
    if (current.start >= previous.end) continue;
    const minimum = previous.start + minimumWordDuration;
    const maximum = current.end - minimumWordDuration;
    const boundary = maximum > minimum ? Math.max(minimum, Math.min(maximum, (previous.end + current.start) / 2)) : Math.max(previous.start, current.start);
    previous.end = Math.max(previous.start + minimumWordDuration, boundary);
    current.start = Math.min(current.end - minimumWordDuration, boundary);
  }
  return timed;
}

function splitSpan(tokens: readonly ExactToken[], startIndex: number, endIndex: number, start: number, end: number, confidence: number, confidenceSource: TimestampedWord["confidenceSource"]): TimestampedWord[] {
  const selected = tokens.slice(startIndex, endIndex);
  const weights = selected.map((token) => Math.max(1, [...token.normalizedText].length));
  const total = Math.max(1, weights.reduce((sum, weight) => sum + weight, 0));
  let elapsed = 0;
  return selected.map((token, index) => {
    const wordStart = start + (end - start) * elapsed / total; elapsed += weights[index] ?? 1;
    const wordEnd = index === selected.length - 1 ? end : start + (end - start) * elapsed / total;
    return { text: token.text, start: wordStart, end: Math.max(wordStart + minimumWordDuration, wordEnd), confidence, ...(confidenceSource ? { confidenceSource } : {}) };
  });
}

function adjacentObservedSpan(input: {
  observed: readonly ObservedToken[];
  previous: TimedGroup | undefined;
  following: TimedGroup | undefined;
  missingWords: number;
  durationSeconds: number;
  typicalWordDuration: number;
}): { start: number; end: number } {
  if (input.previous && input.following) return { start: input.previous.end, end: input.following.start };
  const supportLimit = Math.max(1, input.missingWords * 2);
  if (input.following) {
    const before = input.observed.slice(0, input.following.observedStart).slice(-supportLimit);
    const supportStart = before[0]?.start;
    return {
      start: supportStart === undefined ? Math.max(0, input.following.start - input.typicalWordDuration * input.missingWords) : Math.max(0, supportStart),
      end: input.following.start
    };
  }
  if (input.previous) {
    const candidates: ObservedToken[] = [];
    let previousEnd = input.previous.end;
    for (const word of input.observed.slice(input.previous.observedEnd)) {
      if (word.start - previousEnd > 2.25 || candidates.length >= supportLimit) break;
      candidates.push(word); previousEnd = word.end;
    }
    return {
      start: input.previous.end,
      end: Math.min(input.durationSeconds, candidates.at(-1)?.end ?? input.previous.end + input.typicalWordDuration * input.missingWords)
    };
  }
  return { start: 0, end: input.durationSeconds };
}

function constrainedWords(exact: readonly ExactToken[], observed: readonly ObservedToken[], groups: readonly MatchedGroup[], durationSeconds: number): TimestampedWord[] {
  const timed = timedGroups(groups, observed);
  const result: Array<TimestampedWord | undefined> = Array.from({ length: exact.length });
  for (const group of timed) {
    const words = splitSpan(exact, group.exactStart, group.exactEnd, group.start, group.end, group.confidence, group.confidenceSource);
    words.forEach((word, offset) => { result[group.exactStart + offset] = word; });
  }
  const typicalWordDuration = Math.max(.12, Math.min(1.2, median(timed.map((group) => (group.end - group.start) / Math.max(1, group.exactEnd - group.exactStart))) ?? durationSeconds / Math.max(1, exact.length)));
  for (let index = 0; index < exact.length;) {
    if (result[index]) { index += 1; continue; }
    const startIndex = index; while (index < exact.length && !result[index]) index += 1; const endIndex = index;
    const previous = [...timed].reverse().find((group) => group.exactEnd <= startIndex);
    const following = timed.find((group) => group.exactStart >= endIndex);
    const span = adjacentObservedSpan({ observed, previous, following, missingWords: endIndex - startIndex, durationSeconds, typicalWordDuration });
    const availableEnd = Math.max(span.start + minimumWordDuration * (endIndex - startIndex), span.end);
    const inferred = splitSpan(exact, startIndex, endIndex, span.start, Math.min(durationSeconds, availableEnd), .34, "estimated");
    inferred.forEach((word, offset) => { result[startIndex + offset] = word; });
  }

  const words = result.filter((word): word is TimestampedWord => Boolean(word));
  // Final numerical guard. It is intentionally deterministic and only touches
  // a boundary that would otherwise overlap after Whisper chunk fusion.
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!; const previous = words[index - 1];
    word.start = Math.max(previous?.end ?? 0, Math.min(durationSeconds, word.start));
    word.end = Math.min(durationSeconds, Math.max(word.start + minimumWordDuration, word.end));
    if (word.end <= word.start && previous) {
      const borrowedStart = Math.max(previous.start + minimumWordDuration, durationSeconds - minimumWordDuration);
      previous.end = borrowedStart; word.start = borrowedStart; word.end = durationSeconds;
    }
  }
  return words;
}

/**
 * Makes the user's exact sung words the lexical authority while Whisper remains
 * the timing authority. The output contains the exact sequence once, strips
 * vocalisation/noise tokens, preserves grounded timing, splits fused tokens and
 * infers timestamps only for words that had no measurable Whisper match.
 */
export function constrainMlsmPostLipsyncTranscriptToExactLyrics(
  document: WhisperTranscriptDocument,
  exactSungLyrics: string
): WhisperTranscriptDocument {
  const exact = exactTokens(exactSungLyrics);
  if (!exact.length) return document;
  const observed = observedTokens(document);
  const groups = alignExactSequence(exact, observed, document.durationSeconds);
  const groundedWords = groups.reduce((total, group) => total + group.exactEnd - group.exactStart, 0);
  const minimumEvidence = exact.length === 1 ? 1 : Math.max(2, Math.ceil(exact.length * .3));
  if (groundedWords < minimumEvidence) throw new Error(`Le parole esatte non trovano evidenza sufficiente nell’audio (${groundedWords}/${exact.length}); il retiming è stato bloccato.`);
  const words = constrainedWords(exact, observed, groups, document.durationSeconds);
  const confidence = words.length ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length : 0;
  return {
    ...document,
    transcript: exact.map((token) => token.text).join(" "),
    words,
    phrases: words.length ? [{ start: words[0]!.start, end: words.at(-1)!.end, text: exact.map((token) => token.text).join(" "), confidence }] : []
  };
}
