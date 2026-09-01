import { alignCanonicalWordSequence, lipsyncTimedWords } from "./mlsm-post-lipsync-alignment";
import { normalizeLipsyncWord, tokenizeCanonicalLyricText } from "./mlsm-post-lipsync-lyrics";
import type { CanonicalLyricWord, LipsyncTimedWord } from "./mlsm-post-lipsync-types";
import {
  getLocalTextGenerator,
  localGeneratedAnswer,
  preferredLocalAssistantModel,
  runLocalTextGeneration,
  type LocalChatMessage
} from "./local-model-runtime";
import type { TimestampedWord, WhisperTranscriptDocument } from "./subtitle-generation";

interface RecoveryCandidate {
  targetIndex: number;
  text: string;
  startSeconds: number;
  endSeconds: number;
}

interface RecoveryContext {
  sourceDurationSeconds: number;
  sourceWords: LipsyncTimedWord[];
  targetWords: LipsyncTimedWord[];
  matches: Array<{ canonicalIndex: number; transcriptIndex: number; similarity: number }>;
  prependCandidates: RecoveryCandidate[];
  appendCandidates: RecoveryCandidate[];
  requiredPrependIndices: number[];
  requiredAppendIndices: number[];
}

export interface MlsmPostLipsyncLlmRepairResult {
  sourceTranscript: WhisperTranscriptDocument;
  applied: boolean;
  recoveredWords: string[];
  model: string;
}

function canonicalSource(words: readonly LipsyncTimedWord[]): CanonicalLyricWord[] {
  return words.map((word, canonicalIndex) => ({
    canonicalIndex,
    text: word.text,
    normalizedText: word.normalizedText,
    cueIndex: 0,
    cueStartSeconds: word.startSeconds,
    cueEndSeconds: word.endSeconds,
    estimatedStartSeconds: word.startSeconds,
    estimatedEndSeconds: word.endSeconds
  }));
}

function canonicalExactLyrics(exactSungLyrics: string): CanonicalLyricWord[] {
  return tokenizeCanonicalLyricText(exactSungLyrics).map((token, canonicalIndex) => ({
    canonicalIndex,
    text: token.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ""),
    normalizedText: normalizeLipsyncWord(token),
    cueIndex: 0,
    cueStartSeconds: canonicalIndex,
    cueEndSeconds: canonicalIndex + 1,
    estimatedStartSeconds: canonicalIndex,
    estimatedEndSeconds: canonicalIndex + 1
  }));
}

function mergeCandidates(base: readonly RecoveryCandidate[], exact: readonly RecoveryCandidate[]): RecoveryCandidate[] {
  const merged = new Map(base.map((candidate) => [candidate.targetIndex, candidate]));
  for (const candidate of exact) merged.set(candidate.targetIndex, candidate);
  return [...merged.values()].sort((left, right) => left.targetIndex - right.targetIndex);
}

function recoveryContext(sourceTranscript: WhisperTranscriptDocument, targetTranscript: WhisperTranscriptDocument, exactSungLyrics = ""): RecoveryContext | null {
  const sourceWords = lipsyncTimedWords(sourceTranscript);
  const targetWords = lipsyncTimedWords(targetTranscript);
  if (!sourceWords.length || !targetWords.length) return null;
  const matches = alignCanonicalWordSequence(canonicalSource(sourceWords), targetWords, {
    matchTranscriptSubsequence: true,
    preferTranscriptCenter: true
  });
  const first = matches[0]; const last = matches.at(-1);
  if (!first || !last) return null;
  const firstSource = sourceWords[first.canonicalIndex]!; const lastSource = sourceWords[last.canonicalIndex]!;
  let prependCandidates: RecoveryCandidate[] = [];
  if (firstSource.startSeconds >= .28) {
    let nextStart = targetWords[first.transcriptIndex]!.startSeconds;
    for (let index = first.transcriptIndex - 1; index >= 0 && prependCandidates.length < 4; index -= 1) {
      const word = targetWords[index]!; const gap = nextStart - word.endSeconds;
      if (gap > 2.25) break;
      prependCandidates.unshift({ targetIndex: index, text: word.text, startSeconds: word.startSeconds, endSeconds: word.endSeconds });
      nextStart = word.startSeconds;
    }
  }
  let appendCandidates: RecoveryCandidate[] = [];
  if (sourceTranscript.durationSeconds - lastSource.endSeconds >= .28) {
    let previousEnd = targetWords[last.transcriptIndex]!.endSeconds;
    for (let index = last.transcriptIndex + 1; index < targetWords.length && appendCandidates.length < 4; index += 1) {
      const word = targetWords[index]!; const gap = word.startSeconds - previousEnd;
      if (gap > 2.25) break;
      appendCandidates.push({ targetIndex: index, text: word.text, startSeconds: word.startSeconds, endSeconds: word.endSeconds });
      previousEnd = word.endSeconds;
    }
  }
  const exactCanonical = canonicalExactLyrics(exactSungLyrics);
  const exactMatches = exactCanonical.length ? alignCanonicalWordSequence(exactCanonical, targetWords, {
    matchTranscriptSubsequence: true,
    preferTranscriptCenter: true
  }).filter((match) => match.similarity >= .64) : [];
  const sourceTargetIndexes = new Set(matches.map((match) => match.transcriptIndex));
  const referenceOverlapsSource = exactMatches.some((match) => sourceTargetIndexes.has(match.transcriptIndex));
  const exactByTargetIndex = new Map(exactMatches.map((match) => {
    const exact = exactCanonical[match.canonicalIndex]!;
    const target = targetWords[match.transcriptIndex]!;
    return [match.transcriptIndex, {
      targetIndex: match.transcriptIndex,
      text: exact.text || target.text,
      startSeconds: target.startSeconds,
      endSeconds: target.endSeconds
    } satisfies RecoveryCandidate] as const;
  }));
  const exactPrepend = referenceOverlapsSource && firstSource.startSeconds >= .28
    ? exactMatches.filter((match) => match.transcriptIndex < first.transcriptIndex).slice(-12).map((match) => exactByTargetIndex.get(match.transcriptIndex)!)
    : [];
  const exactAppend = referenceOverlapsSource && sourceTranscript.durationSeconds - lastSource.endSeconds >= .28
    ? exactMatches.filter((match) => match.transcriptIndex > last.transcriptIndex).slice(0, 12).map((match) => exactByTargetIndex.get(match.transcriptIndex)!)
    : [];
  prependCandidates = mergeCandidates(prependCandidates, exactPrepend);
  appendCandidates = mergeCandidates(appendCandidates, exactAppend);
  return {
    sourceDurationSeconds: sourceTranscript.durationSeconds,
    sourceWords,
    targetWords,
    matches,
    prependCandidates,
    appendCandidates,
    requiredPrependIndices: exactPrepend.map((candidate) => candidate.targetIndex),
    requiredAppendIndices: exactAppend.map((candidate) => candidate.targetIndex)
  };
}

function jsonObject(value: string): Record<string, unknown> | null {
  const start = value.indexOf("{"); const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(value.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function integerIndexes(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is number => Number.isInteger(item) && item >= 0))]
    : [];
}

/** Accept only contiguous words already present beside the measured target
 * match. The model can recover an omitted phrase, but it cannot invent lyrics,
 * reorder words or modify a timestamp. */
function validatedSelection(answer: string, context: RecoveryContext): { prepend: RecoveryCandidate[]; append: RecoveryCandidate[] } {
  const parsed = jsonObject(answer);
  const requestedPrepend = parsed ? integerIndexes(parsed.prepend) : [];
  const requestedAppend = parsed ? integerIndexes(parsed.append) : [];
  const prependSet = new Set(context.prependCandidates.map((candidate) => candidate.targetIndex));
  const appendSet = new Set(context.appendCandidates.map((candidate) => candidate.targetIndex));
  const validPrepend = [...new Set([...requestedPrepend.filter((index) => prependSet.has(index)), ...context.requiredPrependIndices])];
  const validAppend = [...new Set([...requestedAppend.filter((index) => appendSet.has(index)), ...context.requiredAppendIndices])];
  const prepend = validPrepend.length
    ? context.prependCandidates.filter((candidate) => candidate.targetIndex >= Math.min(...validPrepend))
    : [];
  const append = validAppend.length
    ? context.appendCandidates.filter((candidate) => candidate.targetIndex <= Math.max(...validAppend))
    : [];
  return { prepend, append };
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right); const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function measuredScale(context: RecoveryContext): number {
  const ratios = context.matches.slice(1).flatMap((match, index) => {
    const previous = context.matches[index]!;
    const sourceDelta = context.sourceWords[match.canonicalIndex]!.centerSeconds - context.sourceWords[previous.canonicalIndex]!.centerSeconds;
    const targetDelta = context.targetWords[match.transcriptIndex]!.centerSeconds - context.targetWords[previous.transcriptIndex]!.centerSeconds;
    return sourceDelta > .02 && targetDelta > .02 ? [sourceDelta / targetDelta] : [];
  });
  const scale = median(ratios);
  return scale !== null && Number.isFinite(scale) && scale >= .35 && scale <= 3 ? scale : 1;
}

function inferredPrefixWords(candidates: readonly RecoveryCandidate[], context: RecoveryContext, scale: number): TimestampedWord[] {
  if (!candidates.length) return [];
  const firstMatch = context.matches[0]!;
  const sourceBoundary = context.sourceWords[firstMatch.canonicalIndex]!.startSeconds;
  const targetBoundary = context.targetWords[firstMatch.transcriptIndex]!.startSeconds;
  const targetStart = candidates[0]!.startSeconds;
  const sourceStart = Math.max(0, sourceBoundary - (targetBoundary - targetStart) * scale);
  const targetSpan = Math.max(.001, targetBoundary - targetStart); const sourceSpan = Math.max(.001, sourceBoundary - sourceStart);
  return candidates.map((candidate) => ({
    text: candidate.text,
    start: sourceStart + (candidate.startSeconds - targetStart) / targetSpan * sourceSpan,
    end: Math.min(sourceBoundary - .001, sourceStart + (candidate.endSeconds - targetStart) / targetSpan * sourceSpan),
    confidence: .34,
    confidenceSource: "estimated" as const
  })).filter((word) => word.end > word.start);
}

function inferredSuffixWords(candidates: readonly RecoveryCandidate[], context: RecoveryContext, scale: number): TimestampedWord[] {
  if (!candidates.length) return [];
  const lastMatch = context.matches.at(-1)!;
  const sourceBoundary = context.sourceWords[lastMatch.canonicalIndex]!.endSeconds;
  const targetBoundary = context.targetWords[lastMatch.transcriptIndex]!.endSeconds;
  const targetEnd = candidates.at(-1)!.endSeconds;
  const boundedEnd = Math.min(context.sourceDurationSeconds, sourceBoundary + Math.max(.001, targetEnd - targetBoundary) * scale);
  const targetSpan = Math.max(.001, targetEnd - targetBoundary); const sourceSpan = Math.max(.001, boundedEnd - sourceBoundary);
  return candidates.map((candidate) => ({
    text: candidate.text,
    start: sourceBoundary + (candidate.startSeconds - targetBoundary) / targetSpan * sourceSpan,
    end: Math.min(boundedEnd, sourceBoundary + (candidate.endSeconds - targetBoundary) / targetSpan * sourceSpan),
    confidence: .34,
    confidenceSource: "estimated" as const
  })).filter((word) => word.end > word.start);
}

function correctedTranscript(document: WhisperTranscriptDocument, recovered: readonly TimestampedWord[]): WhisperTranscriptDocument {
  const words = [...document.words, ...recovered].sort((left, right) => left.start - right.start || left.end - right.end);
  return { ...document, transcript: words.map((word) => word.text).join(" "), words };
}

export async function repairMlsmPostLipsyncTranscriptWithLocalLlm(input: {
  sourceTranscript: WhisperTranscriptDocument;
  targetTranscript: WhisperTranscriptDocument;
  exactSungLyrics?: string;
  onProgress?: (message: string) => void;
}): Promise<MlsmPostLipsyncLlmRepairResult> {
  const exactSungLyrics = input.exactSungLyrics?.trim().replace(/\s+/gu, " ") ?? "";
  const context = recoveryContext(input.sourceTranscript, input.targetTranscript, exactSungLyrics);
  const unchanged = (): MlsmPostLipsyncLlmRepairResult => ({ sourceTranscript: input.sourceTranscript, applied: false, recoveredWords: [], model: preferredLocalAssistantModel });
  if (!context || !context.prependCandidates.length && !context.appendCandidates.length) return unchanged();
  input.onProgress?.("Preparazione del correttore Qwen2.5 locale");
  const generator = await getLocalTextGenerator(preferredLocalAssistantModel, input.onProgress);
  const firstMatch = context.matches[0]!; const lastMatch = context.matches.at(-1)!;
  const caseFile = {
    sourceTranscript: context.sourceWords.map((word, index) => ({ index, text: word.text, start: Number(word.startSeconds.toFixed(3)), end: Number(word.endSeconds.toFixed(3)) })),
    matchedSequence: context.matches.map((match) => ({ sourceIndex: match.canonicalIndex, targetIndex: match.transcriptIndex, sourceText: context.sourceWords[match.canonicalIndex]!.text, targetText: context.targetWords[match.transcriptIndex]!.text })),
    untranscribedSourceSecondsBeforeMatch: Number(context.sourceWords[firstMatch.canonicalIndex]!.startSeconds.toFixed(3)),
    untranscribedSourceSecondsAfterMatch: Number((input.sourceTranscript.durationSeconds - context.sourceWords[lastMatch.canonicalIndex]!.endSeconds).toFixed(3)),
    exactSungLyrics: exactSungLyrics || null,
    requiredReferencePrependIndices: context.requiredPrependIndices,
    requiredReferenceAppendIndices: context.requiredAppendIndices,
    allowedPrependCandidates: context.prependCandidates,
    allowedAppendCandidates: context.appendCandidates
  };
  const conversation: LocalChatMessage[] = [
    { role: "system", content: "You repair omissions in a sung Whisper transcript by comparing it with a complete master transcript. Return one JSON object only: {\"prepend\":[targetIndex...],\"append\":[targetIndex...],\"reason\":\"short reason\"}. Select only indices from the allowed candidate arrays. exactSungLyrics is the user's authoritative text for this clip: every requiredReference index was independently matched against the measured master transcript and must be included. Recover other words only when they form the immediate missing beginning or ending of the same sung phrase. Never invent words, never change matched words, never output timestamps, markdown or commentary." },
    { role: "user", content: `ALIGNMENT CASE\n${JSON.stringify(caseFile)}\n\nWhisper can omit short or softly sung opening words. Start from exactSungLyrics when present, then use the unmatched source time and phrase continuity to validate the allowed adjacent master words.` }
  ];
  input.onProgress?.("LLM locale · controllo delle parole saltate da Whisper");
  const output = await runLocalTextGeneration(generator, conversation, { max_new_tokens: 96, do_sample: false, repetition_penalty: 1.14, no_repeat_ngram_size: 4 }, 22_000);
  const selection = validatedSelection(localGeneratedAnswer(output), context);
  const scale = measuredScale(context);
  const recovered = [
    ...inferredPrefixWords(selection.prepend, context, scale),
    ...inferredSuffixWords(selection.append, context, scale)
  ];
  if (!recovered.length) return unchanged();
  return {
    sourceTranscript: correctedTranscript(input.sourceTranscript, recovered),
    applied: true,
    recoveredWords: recovered.map((word) => word.text),
    model: preferredLocalAssistantModel
  };
}
