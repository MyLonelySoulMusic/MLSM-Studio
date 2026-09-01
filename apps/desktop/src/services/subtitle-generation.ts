import type { RhythmBallProject } from "@rbs/project-schema";
import { getLocalTextGenerator, getLocalTranscriber, localGeneratedAnswer, runLocalTextGeneration, type LocalChatMessage } from "./local-model-runtime";

export type SubtitleCue = RhythmBallProject["subtitles"]["cues"][number];
export interface TimestampedWord { text: string; start: number; end: number; confidence: number; confidenceSource?: "model" | "estimated" | "unknown"; }
interface WhisperChunk { text?: string; timestamp?: [number | null, number | null]; confidence?: number; score?: number; }
interface WhisperResult { text?: string; chunks?: WhisperChunk[]; }
export interface WhisperTranscriptDocument {
  schemaVersion: 1;
  engine: "Whisper";
  model: WhisperModelId;
  durationSeconds: number;
  transcript: string;
  words: TimestampedWord[];
  phrases: { start: number; end: number; text: string; confidence: number }[];
}

export type SmartSubtitleStage = "setup" | "whisper" | "editing" | "agents" | "final";
export type SmartSubtitleAgentId = "transcript-editor" | "timing-director" | "quality-supervisor";
export type SmartSubtitleAgentTarget = SmartSubtitleAgentId | "all";
export type SubtitleGenerationEvent =
  | { type: "stage"; stage: SmartSubtitleStage; progress: number; message: string; indeterminate?: boolean }
  | { type: "whisper-output"; stage: "whisper"; progress: number; document: WhisperTranscriptDocument }
  | { type: "user-message"; stage: "agents"; progress: number; target: SmartSubtitleAgentTarget; message: string }
  | { type: "agent"; stage: "agents"; progress: number; agentId: SmartSubtitleAgentId; agentName: string; specialty: string; turn: number; totalTurns: number; state: "thinking" | "answered"; message: string; interactive?: boolean };
export type SubtitleGenerationEventHandler = (event: SubtitleGenerationEvent) => void;

export interface SubtitleSegmentationOptions {
  preferredWords: number;
  maxCueDuration: number;
  maxCharsPerLine: number;
  maxReadingSpeed: number;
}

export type SubtitleCouncilRole = "Pulizia testo Suno" | "Allineamento parole" | "Montaggio sulle pause" | "Controllo qualità" | "Coordinatore";

const defaultSegmentation: SubtitleSegmentationOptions = {
  preferredWords: 6,
  maxCueDuration: 4.2,
  maxCharsPerLine: 34,
  maxReadingSpeed: 19
};

export type WhisperModelId = RhythmBallProject["subtitles"]["whisperModel"];
export type LlmModelId = RhythmBallProject["subtitles"]["llmModel"];
export const whisperModelOptions: readonly { id: WhisperModelId; label: string; detail: string; localSize: string }[] = [
  { id: "whisper-tiny_timestamped", label: "Whisper Tiny", detail: "Più rapido · adatto a preview e macchine meno potenti", localSize: "96 MB" },
  { id: "whisper-base_timestamped", label: "Whisper Base", detail: "Buon equilibrio tra precisione, memoria e velocità", localSize: "151 MB" },
  { id: "whisper-medium_timestamped", label: "Whisper Medium", detail: "Precisione superiore · richiede più RAM/GPU e tempi di analisi maggiori", localSize: "circa 686 MB" }
];
export const llmModelOptions: readonly { id: LlmModelId; label: string; detail: string; localSize: string }[] = [
  { id: "qwen2.5-0.5b-instruct", label: "Qwen2.5 0.5B Instruct · consigliato", detail: "Italiano, istruzioni e JSON nettamente migliori; profilo bilanciato per computer modesti", localSize: "circa 483 MB WebGPU · 786 MB WASM" }
];
function normalized(value: string): string { return value.normalize("NFKD").toLocaleLowerCase().replace(/[^\p{L}\p{N}']/gu, ""); }
function words(value: string): string[] { return value.trim().split(/\s+/).filter(Boolean); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }

function stageEvent(handler: SubtitleGenerationEventHandler | undefined, stage: SmartSubtitleStage, progress: number, message: string, indeterminate = false): void {
  handler?.({ type: "stage", stage, progress: clamp(progress, 0, 100), message, ...(indeterminate ? { indeterminate: true } : {}) });
}

function modelProgressReporter(progress: (message: string) => void, handler: SubtitleGenerationEventHandler | undefined, stage: SmartSubtitleStage = "setup", from = 4, to = 18): (message: string) => void {
  return (message) => {
    progress(message);
    const match = message.match(/(\d{1,3})%/); const downloadProgress = match ? clamp(Number(match[1]), 0, 100) : null;
    stageEvent(handler, stage, downloadProgress === null ? from : from + downloadProgress / 100 * (to - from), message, downloadProgress === null);
  };
}

export function cleanReferenceLyrics(value: string): string {
  const withoutTags = value
    .replace(/\[[^\]\r\n]{1,120}\]/g, "\n")
    .replace(/^\s*(?:instrumental|intro|outro|interlude|break|guitar solo|piano solo|drum solo)\s*:?\s*$/gimu, "");
  return withoutTags
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function editDistance(left: string, right: string): number {
  const a = normalized(left); const b = normalized(right);
  if (!a.length) return b.length; if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) current[column] = Math.min(
      (current[column - 1] ?? 0) + 1,
      (previous[column] ?? 0) + 1,
      (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1)
    );
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

function wordSimilarity(left: string, right: string): number {
  const a = normalized(left); const b = normalized(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

export function timestampedWords(result: WhisperResult, durationSeconds: number): TimestampedWord[] {
  const chunks = result.chunks ?? [];
  if (chunks.length) {
    const timestampsAreUsable = chunks.some((chunk) => {
      const start = chunk.timestamp?.[0]; const end = chunk.timestamp?.[1];
      return typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end)
        && start >= 0 && start < durationSeconds && end > start && end <= durationSeconds + .05;
    });
    if (!timestampsAreUsable) {
      // Some Whisper backends return every sung token at the chunk limit (for
      // example 29.98s for a 15s clip). Those values are not evidence. Preserve
      // the recognized words as low-confidence seeds so the phrase-level
      // MFCC/DTW pass can recover their actual timing.
      const tokens = words(result.text ?? chunks.map((chunk) => chunk.text ?? "").join(" "));
      return tokens.map((text, index) => ({
        text,
        start: index / Math.max(1, tokens.length) * durationSeconds,
        end: (index + 1) / Math.max(1, tokens.length) * durationSeconds,
        confidence: .35,
        confidenceSource: "estimated" as const
      }));
    }
    const expanded = chunks.flatMap((chunk, index) => {
    const text = chunk.text?.trim() ?? ""; if (!text) return [];
      const rawStart = chunk.timestamp?.[0]; const rawEnd = chunk.timestamp?.[1];
      const validTimestamp = typeof rawStart === "number" && typeof rawEnd === "number" && Number.isFinite(rawStart) && Number.isFinite(rawEnd)
        && rawStart >= 0 && rawStart < durationSeconds && rawEnd > rawStart && rawEnd <= durationSeconds + .05;
      const start = validTimestamp ? rawStart : index / chunks.length * durationSeconds;
      const end = validTimestamp ? Math.min(durationSeconds, rawEnd) : (index + 1) / chunks.length * durationSeconds;
      const tokens = words(text); const weights = tokens.map((token) => Math.max(1, normalized(token).length)); const totalWeight = weights.reduce((sum, value) => sum + value, 0);
      let elapsedWeight = 0;
      return tokens.map((token, tokenIndex) => {
        const tokenStart = start + (end - start) * elapsedWeight / Math.max(1, totalWeight); elapsedWeight += weights[tokenIndex] ?? 1;
        const tokenEnd = start + (end - start) * elapsedWeight / Math.max(1, totalWeight);
        const reportedConfidence = validTimestamp && typeof chunk.confidence === "number" ? chunk.confidence : validTimestamp && typeof chunk.score === "number" ? chunk.score : null;
        return { text: token, start: tokenStart, end: Math.max(tokenStart + .025, tokenEnd), confidence: reportedConfidence === null ? (validTimestamp ? .62 : .35) : clamp(reportedConfidence, 0, 1), confidenceSource: reportedConfidence === null ? "estimated" as const : "model" as const };
      });
    }).sort((left, right) => left.start - right.start);
    const monotonic: TimestampedWord[] = [];
    for (const item of expanded) {
      const previous = monotonic.at(-1);
      if (previous && normalized(previous.text) === normalized(item.text) && Math.abs(previous.start - item.start) < .12) continue;
      const start = Math.max(0, item.start, previous?.end ?? 0);
      if (start >= durationSeconds - .001) continue;
      const end = Math.min(durationSeconds, Math.max(start + .025, item.end));
      if (end <= start) continue;
      monotonic.push({ ...item, start, end });
    }
    return monotonic;
  }
  const tokens = words(result.text ?? "");
  return tokens.map((text, index) => ({ text, start: index / Math.max(1, tokens.length) * durationSeconds, end: (index + 1) / Math.max(1, tokens.length) * durationSeconds, confidence: .45, confidenceSource: "estimated" as const }));
}

/** Combines the stable long-context Whisper pass with a second short-window
 * pass. Short windows resolve consonant attacks and word releases more tightly;
 * the long pass remains the authority for sequence/order when the detail pass
 * misses a sung token. */
export function fuseDetailedTimestampWords(primary: readonly TimestampedWord[], detail: readonly TimestampedWord[]): TimestampedWord[] {
  if (!primary.length || !detail.length) return [...primary];
  let detailCursor = 0;
  const fused = primary.map((word) => {
    let bestIndex = -1; let bestScore = 0;
    const searchEnd = Math.min(detail.length, detailCursor + 6);
    for (let index = detailCursor; index < searchEnd; index += 1) {
      const candidate = detail[index]!;
      const score = wordSimilarity(word.text, candidate.text) - (index - detailCursor) * .035;
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    }
    if (bestIndex < 0 || bestScore < .58) return { ...word };
    const measured = detail[bestIndex]!; detailCursor = bestIndex + 1;
    return {
      ...word,
      start: measured.start,
      end: measured.end,
      confidence: Math.max(word.confidence, measured.confidence),
      confidenceSource: measured.confidenceSource === "model" || word.confidenceSource === "model" ? "model" as const : measured.confidenceSource ?? word.confidenceSource ?? "unknown"
    };
  });
  const monotonic: TimestampedWord[] = [];
  const maximumEnd = Math.max(...fused.map((item) => item.end), 0);
  for (const word of fused) {
    const previous = monotonic.at(-1);
    const start = Math.max(0, word.start, previous?.end ?? 0);
    if (start >= maximumEnd - .001) continue;
    const end = Math.min(maximumEnd, Math.max(start + .012, word.end));
    monotonic.push({ ...word, start, end });
  }
  return monotonic;
}

export function reconcileWithLyrics(transcript: readonly TimestampedWord[], lyrics: string): TimestampedWord[] {
  const official = words(cleanReferenceLyrics(lyrics)); if (!official.length || !transcript.length) return [...transcript];
  const rows = transcript.length + 1; const columns = official.length + 1;
  const costs = new Float32Array(rows * columns); const trace = new Uint8Array(rows * columns);
  const at = (row: number, column: number) => row * columns + column;
  for (let row = 1; row < rows; row += 1) { costs[at(row, 0)] = row * .82; trace[at(row, 0)] = 1; }
  for (let column = 1; column < columns; column += 1) { costs[at(0, column)] = column * .72; trace[at(0, column)] = 2; }
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const similarity = wordSimilarity(transcript[row - 1]!.text, official[column - 1]!);
      const positionDrift = Math.abs((row - 1) / Math.max(1, transcript.length - 1) - (column - 1) / Math.max(1, official.length - 1));
      const diagonal = costs[at(row - 1, column - 1)]! + (1 - similarity) + positionDrift * .08;
      const skipTranscript = costs[at(row - 1, column)]! + .82;
      const skipLyrics = costs[at(row, column - 1)]! + .72;
      if (diagonal <= skipTranscript && diagonal <= skipLyrics) { costs[at(row, column)] = diagonal; trace[at(row, column)] = 0; }
      else if (skipTranscript <= skipLyrics) { costs[at(row, column)] = skipTranscript; trace[at(row, column)] = 1; }
      else { costs[at(row, column)] = skipLyrics; trace[at(row, column)] = 2; }
    }
  }
  const matches = new Map<number, number>(); let row = transcript.length; let column = official.length;
  while (row > 0 || column > 0) {
    const direction = trace[at(row, column)];
    if (row > 0 && column > 0 && direction === 0) { matches.set(row - 1, column - 1); row -= 1; column -= 1; }
    else if (row > 0 && (column === 0 || direction === 1)) row -= 1;
    else column -= 1;
  }
  return transcript.map((source, index) => {
    const officialIndex = matches.get(index); if (officialIndex === undefined) return source;
    const replacement = official[officialIndex]!; const similarity = wordSimilarity(source.text, replacement);
    return similarity >= .42 ? { ...source, text: replacement, confidence: Math.max(source.confidence, clamp(similarity, .76, .98)) } : source;
  });
}

function segmentationOptions(preferredWords: number, overrides?: Partial<SubtitleSegmentationOptions>): SubtitleSegmentationOptions {
  return {
    preferredWords: clamp(Math.round(overrides?.preferredWords ?? preferredWords), 2, 20),
    maxCueDuration: clamp(overrides?.maxCueDuration ?? defaultSegmentation.maxCueDuration, 1.5, 7),
    maxCharsPerLine: clamp(Math.round(overrides?.maxCharsPerLine ?? defaultSegmentation.maxCharsPerLine), 18, 60),
    maxReadingSpeed: clamp(overrides?.maxReadingSpeed ?? defaultSegmentation.maxReadingSpeed, 10, 28)
  };
}

function cueMetrics(text: string, start: number, end: number): { characters: number; duration: number; readingSpeed: number } {
  const characters = [...text].length; const duration = Math.max(.05, end - start);
  return { characters, duration, readingSpeed: characters / duration };
}

export function phraseCues(source: readonly TimestampedWord[], preferredWords: number, overrides?: Partial<SubtitleSegmentationOptions>): SubtitleCue[] {
  const options = segmentationOptions(preferredWords, overrides); const target = options.preferredWords; const cues: SubtitleCue[] = [];
  const hardWordLimit = Math.min(20, Math.max(target + 3, Math.ceil(target * 1.55))); const hardCharacterLimit = options.maxCharsPerLine * 2;
  for (let index = 0; index < source.length;) {
    const start = index; const minimumWords = Math.max(2, Math.floor(target * .55));
    const searchLimit = Math.min(source.length - 1, start + hardWordLimit - 1);
    let bestEnd = start; let bestScore = -Infinity; let lastAllowed = start;
    for (let end = start; end <= searchLimit; end += 1) {
      const current = source[end]!; const next = source[end + 1]; const count = end - start + 1;
      const pause = next ? Math.max(0, next.start - current.end) : 2;
      const duration = current.end - source[start]!.start;
      const text = source.slice(start, end + 1).map((item) => item.text).join(" ");
      const metrics = cueMetrics(text, source[start]!.start, current.end);
      const strongPunctuation = /[.!?…]["')\]]*$/.test(current.text);
      const softPunctuation = /[,;:]["')\]]*$/.test(current.text);
      const allowed = duration <= options.maxCueDuration + .001 && metrics.characters <= hardCharacterLimit;
      if (!allowed && end > start) break;
      lastAllowed = end;
      if (count >= minimumWords || strongPunctuation || pause >= .45 || !next) {
        const pauseScore = pause >= .9 ? 15 : pause >= .55 ? 11 : pause >= .32 ? 7 : pause >= .16 ? 3 : 0;
        const punctuationScore = strongPunctuation ? 13 : softPunctuation ? 4 : 0;
        const lengthPenalty = Math.abs(count - target) * .72;
        const densityPenalty = Math.max(0, metrics.readingSpeed - options.maxReadingSpeed) * .45;
        const linePenalty = metrics.characters > options.maxCharsPerLine ? 1.4 : 0;
        const score = pauseScore + punctuationScore - lengthPenalty - densityPenalty - linePenalty + (!next ? 20 : 0);
        if (score > bestScore) { bestScore = score; bestEnd = end; }
      }
      if (!next || strongPunctuation && count >= minimumWords || pause >= .9 || duration >= options.maxCueDuration) break;
    }
    if (bestScore === -Infinity) bestEnd = lastAllowed;
    const phrase = source.slice(start, bestEnd + 1); index = bestEnd + 1;
    const first = phrase[0]; const last = phrase.at(-1); if (!first || !last) continue;
    const next = source[bestEnd + 1]; const tail = next ? Math.min(.12, Math.max(0, next.start - last.end) * .24) : .08;
    cues.push({ id: `subtitle-${crypto.randomUUID()}`, startSeconds: first.start, endSeconds: Math.max(first.start + .12, last.end + tail), text: phrase.map((item) => item.text).join(" "), confidence: phrase.reduce((sum, item) => sum + item.confidence, 0) / phrase.length, verified: false, manual: false });
  }
  return cues;
}

function timedWordsFromCues(cues: readonly SubtitleCue[]): TimestampedWord[] {
  return cues.flatMap((cue) => {
    const tokens = words(cue.text); const weights = tokens.map((token) => Math.max(1, normalized(token).length)); const total = weights.reduce((sum, value) => sum + value, 0); let elapsed = 0;
    return tokens.map((text, index) => {
      const start = cue.startSeconds + (cue.endSeconds - cue.startSeconds) * elapsed / Math.max(1, total); elapsed += weights[index] ?? 1;
      const end = cue.startSeconds + (cue.endSeconds - cue.startSeconds) * elapsed / Math.max(1, total);
      return { text, start, end: Math.max(start + .025, end), confidence: cue.confidence };
    });
  });
}

export function alignLyricsToCues(cues: readonly SubtitleCue[], lyrics: string): SubtitleCue[] {
  if (!lyrics.trim() || !cues.length) return [...cues];
  const corrected = reconcileWithLyrics(timedWordsFromCues(cues), lyrics); let cursor = 0;
  return cues.map((cue) => {
    const count = words(cue.text).length; const phrase = corrected.slice(cursor, cursor + count); cursor += count;
    return { ...cue, text: phrase.map((item) => item.text).join(" "), confidence: phrase.length ? phrase.reduce((sum, item) => sum + item.confidence, 0) / phrase.length : cue.confidence, verified: false };
  });
}

interface CouncilSnapshot {
  cueCount: number;
  whisperWordCount: number;
  referenceWordCount: number;
  strongPauseCount: number;
  issueCounts: Record<string, number>;
  totalIssues: number;
}

function councilSnapshot(cues: readonly SubtitleCue[], wordTimeline: readonly TimestampedWord[], lyrics: string, options: SubtitleSegmentationOptions): CouncilSnapshot {
  const issueCounts: Record<string, number> = {};
  cues.forEach((cue, index) => subtitleCueIssues(cue, cues[index - 1], options).forEach((issue) => {
    issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
  }));
  const strongPauseCount = wordTimeline.slice(1).filter((word, index) => word.start - (wordTimeline[index]?.end ?? word.start) >= .42).length;
  return {
    cueCount: cues.length,
    whisperWordCount: wordTimeline.length,
    referenceWordCount: words(lyrics).length,
    strongPauseCount,
    issueCounts,
    totalIssues: Object.values(issueCounts).reduce((sum, count) => sum + count, 0)
  };
}

function councilCaseFile(cues: readonly SubtitleCue[], wordTimeline: readonly TimestampedWord[], lyrics: string, options: SubtitleSegmentationOptions): string {
  const rows = cues.slice(0, 18).map((cue, index) => {
    const metrics = cueMetrics(cue.text, cue.startSeconds, cue.endSeconds);
    return { id: index + 1, start: Number(cue.startSeconds.toFixed(3)), end: Number(cue.endSeconds.toFixed(3)), duration: Number(metrics.duration.toFixed(3)), readingSpeed: Number(metrics.readingSpeed.toFixed(1)), text: cue.text };
  });
  return JSON.stringify({
    summary: councilSnapshot(cues, wordTimeline, lyrics, options),
    constraints: { maxDuration: options.maxCueDuration, maxCharsPerLine: options.maxCharsPerLine, maxReadingSpeed: options.maxReadingSpeed },
    whisperExcerpt: wordTimeline.slice(0, 220).map((word) => word.text).join(" "),
    cueSamples: rows,
    referenceExcerpt: lyrics.slice(0, 2_400)
  });
}

function roleInstruction(role: SubtitleCouncilRole): string {
  if (role === "Pulizia testo Suno") return "Ripulisci il testo: elimina tag Suno tra parentesi quadre, intestazioni e indicazioni strumentali, senza riscrivere o inventare versi. Rispondi solo JSON: {\"clean_text\":\"...\"}.";
  if (role === "Allineamento parole") return "Confronta in ordine parole Whisper e testo ripulito. Individua soltanto omissioni o sostituzioni plausibili, rispettando ripetizioni e senza inventare parole non cantate. Rispondi solo JSON: {\"status\":\"OK|CHECK\",\"notes\":\"...\"}.";
  if (role === "Montaggio sulle pause") return "Controlla attacchi, code, pause, sovrapposizioni e blocchi troppo lunghi. Il numero di parole è solo un obiettivo morbido. Rispondi solo JSON: {\"status\":\"OK|CHECK\",\"notes\":\"...\"}.";
  if (role === "Controllo qualità") return "Controlla leggibilità, densità e alternanze innaturali fra frasi brevi e lunghe. Non proporre timestamp inventati. Rispondi solo JSON: {\"status\":\"OK|CHECK\",\"notes\":\"...\"}.";
  return "Sintetizza i rapporti. Rispondi solo JSON: {\"verdict\":\"APPROVE|CHECK\",\"notes\":\"...\"}. APPROVE richiede testo coerente, pause naturali e nessun blocco fuori specifica.";
}

function visibleAgent(role: SubtitleCouncilRole): { id: SmartSubtitleAgentId; name: string; specialty: string } {
  if (role === "Pulizia testo Suno" || role === "Allineamento parole") return { id: "transcript-editor", name: "Agent 1 · Transcript Editor", specialty: "Testo Suno e parole Whisper" };
  if (role === "Montaggio sulle pause") return { id: "timing-director", name: "Agent 2 · Timing Director", specialty: "Pause, attacchi e leggibilità" };
  return { id: "quality-supervisor", name: "Agent 3 · Quality Supervisor", specialty: role === "Coordinatore" ? "Verdetto e montaggio finale" : "Controllo qualità" };
}

export function subtitleCueIssues(cue: SubtitleCue, previous: SubtitleCue | undefined, options: SubtitleSegmentationOptions): string[] {
  const metrics = cueMetrics(cue.text, cue.startSeconds, cue.endSeconds); const issues: string[] = [];
  if (metrics.duration > options.maxCueDuration + .02) issues.push("durata");
  if (metrics.characters > options.maxCharsPerLine * 2) issues.push("righe");
  if (metrics.readingSpeed > options.maxReadingSpeed * 1.12) issues.push("velocità");
  if (previous && cue.startSeconds < previous.endSeconds - .01) issues.push("sovrapposizione");
  return issues;
}

function jsonObjectFromAnswer(answer: string): Record<string, unknown> | null {
  const start = answer.indexOf("{"); const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(answer.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function visibleAgentAnswer(role: SubtitleCouncilRole, answer: string): string {
  const parsed = jsonObjectFromAnswer(answer);
  if (role === "Pulizia testo Suno" && typeof parsed?.clean_text === "string") {
    const cleaned = cleanReferenceLyrics(parsed.clean_text); const preview = cleaned.replace(/\n/g, " · ").slice(0, 260);
    return `Testo ripulito: ${words(cleaned).length} parole. ${preview}${cleaned.length > 260 ? "…" : ""}`;
  }
  const notes = typeof parsed?.notes === "string" ? parsed.notes.trim() : "";
  const verdict = typeof parsed?.verdict === "string" ? parsed.verdict : typeof parsed?.status === "string" ? parsed.status : "";
  if (verdict && notes) return `${verdict}: ${notes}`;
  if (verdict) return verdict;
  if (notes) return notes;
  return answer.replace(/\s+/g, " ").trim().slice(0, 360) || "Analisi completata senza osservazioni.";
}

function acceptableCleanedLyrics(candidate: string, deterministic: string): boolean {
  const candidateWords = words(candidate); const baselineWords = words(deterministic);
  if (!candidateWords.length || /\[[^\]]+\]/.test(candidate)) return false;
  const ratio = candidateWords.length / Math.max(1, baselineWords.length);
  if (ratio < .72 || ratio > 1.16) return false;
  const baseline = new Set(baselineWords.map(normalized).filter(Boolean));
  const overlap = candidateWords.map(normalized).filter((token) => baseline.has(token)).length / candidateWords.length;
  return overlap >= .68;
}

function deterministicAgentAnswer(role: SubtitleCouncilRole, snapshot: CouncilSnapshot, cleanedLyrics: string): string {
  if (role === "Pulizia testo Suno") return JSON.stringify({ clean_text: cleanedLyrics });
  if (role === "Allineamento parole") return JSON.stringify({
    status: "OK",
    notes: `Allineamento deterministico completato: ${snapshot.whisperWordCount} parole Whisper confrontate con ${snapshot.referenceWordCount} parole del testo ripulito.`
  });
  if (role === "Montaggio sulle pause") return JSON.stringify({
    status: snapshot.totalIssues ? "CHECK" : "OK",
    notes: `${snapshot.cueCount} blocchi controllati, ${snapshot.strongPauseCount} pause forti; ${snapshot.totalIssues} criticità temporali o di leggibilità.`
  });
  if (role === "Controllo qualità") return JSON.stringify({
    status: snapshot.totalIssues ? "CHECK" : "OK",
    notes: snapshot.totalIssues ? `Controllo deterministico: ${JSON.stringify(snapshot.issueCounts)}.` : "Durata, densità, righe e sovrapposizioni rispettano i limiti impostati."
  });
  return JSON.stringify({
    verdict: snapshot.totalIssues ? "CHECK" : "APPROVE",
    notes: snapshot.totalIssues ? `${snapshot.totalIssues} criticità da verificare prima dell’approvazione.` : "Montaggio coerente con parole Whisper, pause e vincoli di leggibilità."
  });
}

function degenerateAgentAnswer(answer: string): boolean {
  if (!answer.trim() || answer.length > 1_200) return true;
  const tokens = words(answer).map(normalized).filter(Boolean);
  if (tokens.length < 12) return false;
  return new Set(tokens).size / tokens.length < .28;
}

function validatedAgentAnswer(role: SubtitleCouncilRole, answer: string, fallback: string, deterministicLyrics: string): { answer: string; usedFallback: boolean } {
  if (degenerateAgentAnswer(answer)) return { answer: fallback, usedFallback: true };
  const parsed = jsonObjectFromAnswer(answer);
  if (!parsed) return { answer: fallback, usedFallback: true };
  if (role === "Pulizia testo Suno") {
    const candidate = typeof parsed.clean_text === "string" ? cleanReferenceLyrics(parsed.clean_text) : "";
    return acceptableCleanedLyrics(candidate, deterministicLyrics)
      ? { answer: JSON.stringify({ clean_text: candidate }), usedFallback: false }
      : { answer: fallback, usedFallback: true };
  }
  const notes = typeof parsed.notes === "string" ? parsed.notes.replace(/\s+/g, " ").trim().slice(0, 360) : "";
  if (role === "Coordinatore") {
    const verdict = parsed.verdict;
    return verdict === "APPROVE" || verdict === "CHECK"
      ? { answer: JSON.stringify({ verdict, notes: notes || "Nessuna nota aggiuntiva." }), usedFallback: false }
      : { answer: fallback, usedFallback: true };
  }
  const status = parsed.status;
  return status === "OK" || status === "CHECK"
    ? { answer: JSON.stringify({ status, notes: notes || "Nessuna criticità aggiuntiva." }), usedFallback: false }
    : { answer: fallback, usedFallback: true };
}

async function generateAgentAnswer(verifier: Awaited<ReturnType<typeof getLocalTextGenerator>>, conversation: LocalChatMessage[], timeoutMs = 20_000): Promise<string> {
  const output = await runLocalTextGeneration(verifier, conversation, {
    max_new_tokens: 72,
    do_sample: false,
    repetition_penalty: 1.18,
    no_repeat_ngram_size: 4
  }, timeoutMs);
  return localGeneratedAnswer(output);
}

async function runLocalAgentCouncil(cues: readonly SubtitleCue[], wordTimeline: readonly TimestampedWord[], rawLyrics: string, model: LlmModelId, passes: number, options: SubtitleSegmentationOptions, progress: (message: string) => void, onEvent?: SubtitleGenerationEventHandler): Promise<{ approved: boolean; cleanedLyrics: string }> {
  const verifier = await getLocalTextGenerator(model, modelProgressReporter(progress, onEvent, "agents", 58, 62));
  const totalTurns = clamp(Math.round(passes), 1, 10);
  const specialists: SubtitleCouncilRole[] = ["Pulizia testo Suno", "Allineamento parole", "Montaggio sulle pause", "Controllo qualità"];
  const deterministicLyrics = cleanReferenceLyrics(rawLyrics); let cleanedLyrics = deterministicLyrics; const snapshot = councilSnapshot(cues, wordTimeline, deterministicLyrics, options);
  const caseFile = councilCaseFile(cues, wordTimeline, deterministicLyrics, options);
  const reports: string[] = [];
  let lastAnswer = deterministicAgentAnswer("Coordinatore", snapshot, deterministicLyrics);
  let invalidAnswers = 0; let modelEnabled = true; const councilStartedAt = Date.now();
  for (let turn = 0; turn < totalTurns; turn += 1) {
    const role: SubtitleCouncilRole = turn === totalTurns - 1 ? "Coordinatore" : specialists[turn % specialists.length]!;
    const agent = visibleAgent(role); const turnProgress = 60 + turn / Math.max(1, totalTurns) * 34;
    progress(`Consiglio locale · ${role} · turno ${turn + 1}/${totalTurns}…`);
    onEvent?.({ type: "agent", stage: "agents", progress: turnProgress, agentId: agent.id, agentName: agent.name, specialty: agent.specialty, turn: turn + 1, totalTurns, state: "thinking", message: roleInstruction(role) });
    const fallback = deterministicAgentAnswer(role, snapshot, deterministicLyrics);
    let usedFallback = role === "Pulizia testo Suno" || !modelEnabled;
    lastAnswer = fallback;
    if (!usedFallback) {
      const conversation: LocalChatMessage[] = [
        { role: "system", content: "Sei un revisore di sottotitoli musicali. Rispondi in italiano con un solo oggetto JSON breve e valido. Massimo 240 caratteri nelle note. Non ripetere parole, non produrre elenchi e non modificare timestamp. Whisper e i controlli numerici sono l'autorità." },
        { role: "user", content: `DOSSIER COMPATTO\n${caseFile}\n\nRAPPORTI PRECEDENTI\n${reports.slice(-3).join("\n") || "Nessuno"}\n\nINCARICO ${role}\n${roleInstruction(role)}` }
      ];
      try {
        const rawAnswer = await generateAgentAnswer(verifier, conversation);
        const validated = validatedAgentAnswer(role, rawAnswer, fallback, deterministicLyrics);
        lastAnswer = validated.answer; usedFallback = validated.usedFallback;
        invalidAnswers = usedFallback ? invalidAnswers + 1 : 0;
      } catch (error) {
        usedFallback = true; invalidAnswers += 1;
        if (error instanceof Error && /timeout/i.test(error.message)) modelEnabled = false;
        progress(`Consiglio locale · ${role}: ${error instanceof Error ? error.message : String(error)} · rapporto deterministico applicato.`);
      }
      if (invalidAnswers >= 2 || Date.now() - councilStartedAt > 90_000) modelEnabled = false;
    }
    if (role === "Pulizia testo Suno") cleanedLyrics = deterministicLyrics;
    const readableAnswer = visibleAgentAnswer(role, lastAnswer);
    const fallbackLabel = usedFallback ? "Controllo deterministico: " : "";
    onEvent?.({ type: "agent", stage: "agents", progress: 60 + (turn + 1) / Math.max(1, totalTurns) * 34, agentId: agent.id, agentName: agent.name, specialty: agent.specialty, turn: turn + 1, totalTurns, state: "answered", message: `${fallbackLabel}${readableAnswer}` });
    reports.push(`[${role}] ${lastAnswer.slice(0, 440)}`);
  }
  const verdict = jsonObjectFromAnswer(lastAnswer)?.verdict;
  return { approved: snapshot.totalIssues === 0 && (verdict === "APPROVE" || /\bAPPROVE\b/i.test(lastAnswer)), cleanedLyrics };
}

interface InteractiveSubtitleChange {
  action: "replace" | "split" | "merge" | "retime";
  cue: number;
  text?: string;
  afterWord?: number;
  start?: number;
  end?: number;
}

export interface InteractiveSubtitleAgentResult {
  cues: SubtitleCue[];
  changedCount: number;
  summary?: string;
}

export interface InteractiveSubtitleRecoveryContext {
  exactWordTimeline?: readonly TimestampedWord[];
  audioUrl?: string | null;
  durationSeconds?: number;
  whisperModel?: WhisperModelId;
  language?: string;
}

function interactiveAgentRoles(target: SmartSubtitleAgentTarget): SmartSubtitleAgentId[] {
  return target === "all" ? ["transcript-editor", "timing-director", "quality-supervisor"] : [target];
}

function interactiveAgentIdentity(agentId: SmartSubtitleAgentId): { role: SubtitleCouncilRole; instruction: string } {
  if (agentId === "transcript-editor") return {
    role: "Allineamento parole",
    instruction: "Correggi ortografia, parole e punteggiatura seguendo la richiesta e il testo ufficiale. Preferisci replace; non inventare versi non richiesti."
  };
  if (agentId === "timing-director") return {
    role: "Montaggio sulle pause",
    instruction: "Correggi struttura e tempi. Puoi usare split, merge e retime; non creare sovrapposizioni e conserva gli attacchi vocali."
  };
  return {
    role: "Controllo qualità",
    instruction: "Controlla la richiesta e la versione corrente. Applica soltanto correzioni necessarie e leggibili; se è già corretta restituisci changes vuoto."
  };
}

function requestsMissingOpening(request: string): boolean {
  const normalizedRequest = request.normalize("NFKD").toLocaleLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  return /(?:manc\w*|assent\w*|saltat\w*|pers\w*).{0,36}(?:iniz\w*|intro|apertura|prima parte)/.test(normalizedRequest)
    || /(?:iniz\w*|intro|apertura|prima parte).{0,36}(?:manc\w*|assent\w*|saltat\w*|pers\w*)/.test(normalizedRequest);
}

function missingOpeningWords(timeline: readonly TimestampedWord[], cues: readonly SubtitleCue[]): TimestampedWord[] {
  const orderedCues = [...cues].sort((left, right) => left.startSeconds - right.startSeconds);
  const firstCue = orderedCues[0]; if (!firstCue || !timeline.length) return [];
  const orderedWords = [...timeline].sort((left, right) => left.start - right.start);
  const beforeFirstCue = orderedWords.filter((word) => word.end <= firstCue.startSeconds - .025);
  if (beforeFirstCue.length) return beforeFirstCue;
  if (firstCue.startSeconds > .18) return [];
  const cueTokens = words(firstCue.text).slice(0, 4);
  if (!cueTokens.length) return [];
  let bestIndex = -1; let bestScore = 0;
  for (let index = 0; index < Math.min(orderedWords.length, 40); index += 1) {
    const compared = Math.min(cueTokens.length, orderedWords.length - index);
    if (compared < Math.min(2, cueTokens.length)) continue;
    const score = cueTokens.slice(0, compared).reduce((sum, token, offset) => sum + wordSimilarity(token, orderedWords[index + offset]?.text ?? ""), 0) / compared;
    if (score > bestScore) { bestScore = score; bestIndex = index; }
  }
  return bestIndex > 0 && bestScore >= .68 ? orderedWords.slice(0, bestIndex) : [];
}

function referenceOpening(lyrics: string, firstCueText: string): string {
  const reference = words(cleanReferenceLyrics(lyrics)); const cueTokens = words(firstCueText).slice(0, 5);
  if (!reference.length || !cueTokens.length) return "";
  let bestIndex = 0; let bestScore = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const compared = Math.min(cueTokens.length, reference.length - index);
    if (compared < Math.min(2, cueTokens.length)) continue;
    const score = cueTokens.slice(0, compared).reduce((sum, token, offset) => sum + wordSimilarity(token, reference[index + offset] ?? ""), 0) / compared;
    if (score > bestScore) { bestScore = score; bestIndex = index; }
  }
  return bestIndex > 0 && bestScore >= .5 ? reference.slice(0, bestIndex).join(" ") : "";
}

function alignRecoverableOpening(candidateWords: readonly TimestampedWord[], reference: string): TimestampedWord[] {
  if (!reference) return [...candidateWords];
  const referenceTokens = words(reference);
  const grounded = candidateWords.filter((candidate) => referenceTokens.some((token) => wordSimilarity(candidate.text, token) >= .55)).length;
  if (grounded / Math.max(1, candidateWords.length) < .55) return [];
  return reconcileWithLyrics(candidateWords, reference);
}

async function decodeLeadingAudio(audioUrl: string, seconds: number, targetSampleRate = 16_000): Promise<Float32Array> {
  const response = await fetch(audioUrl);
  if (!response.ok) throw new Error("Impossibile leggere l’audio per il recupero dell’introduzione.");
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const sourceLength = Math.min(buffer.length, Math.max(1, Math.floor(seconds * buffer.sampleRate)));
    const outputLength = Math.max(1, Math.floor(sourceLength / buffer.sampleRate * targetSampleRate));
    const output = new Float32Array(outputLength); const ratio = buffer.sampleRate / targetSampleRate;
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const from = Math.min(sourceLength - 1, Math.floor(outputIndex * ratio));
      const until = Math.max(from + 1, Math.min(sourceLength, Math.floor((outputIndex + 1) * ratio)));
      let sum = 0; let samples = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let sourceIndex = from; sourceIndex < until; sourceIndex += 1) { sum += data[sourceIndex] ?? 0; samples += 1; }
      }
      output[outputIndex] = samples ? sum / samples : 0;
    }
    return output;
  } finally {
    await context.close();
  }
}

async function targetedOpeningTimeline(
  cues: readonly SubtitleCue[],
  recovery: InteractiveSubtitleRecoveryContext,
  progress: (message: string) => void,
  onEvent?: SubtitleGenerationEventHandler
): Promise<{ words: TimestampedWord[]; scannedSeconds: number } | null> {
  const firstCue = [...cues].sort((left, right) => left.startSeconds - right.startSeconds)[0];
  if (!firstCue || !recovery.audioUrl || !recovery.whisperModel) return null;
  const duration = Math.max(.5, recovery.durationSeconds ?? firstCue.endSeconds);
  const scannedSeconds = Math.min(duration, 30, Math.max(8, firstCue.startSeconds + 1.5));
  progress(`Recupero introduzione · nuova analisi Whisper dei primi ${scannedSeconds.toFixed(1)} secondi…`);
  stageEvent(onEvent, "whisper", 100, `Analisi mirata dei primi ${scannedSeconds.toFixed(1)} secondi per recuperare l’apertura…`, true);
  const samples = await decodeLeadingAudio(recovery.audioUrl, scannedSeconds);
  const transcriber = await getLocalTranscriber(recovery.whisperModel, modelProgressReporter(progress, onEvent, "whisper", 100, 100)) as (input: Float32Array, options: Record<string, unknown>) => Promise<WhisperResult>;
  const result = await transcriber(samples, {
    return_timestamps: "word",
    force_full_sequences: true,
    task: "transcribe",
    language: !recovery.language || recovery.language === "auto" ? undefined : recovery.language
  });
  return { words: timestampedWords(result, scannedSeconds), scannedSeconds };
}

function openingRecoveryEvents(
  target: SmartSubtitleAgentTarget,
  result: { insertedCues: number; insertedWords: number; scannedSeconds?: number; source: "existing-whisper" | "targeted-whisper" | "unavailable" },
  onEvent?: SubtitleGenerationEventHandler
): void {
  const roles = interactiveAgentRoles(target);
  roles.forEach((agentId, index) => {
    const identity = interactiveAgentIdentity(agentId); const visible = visibleAgent(identity.role);
    const thinking = agentId === "transcript-editor"
      ? "Confronto l’apertura, il testo ufficiale e le parole Whisper disponibili."
      : agentId === "timing-director"
        ? "Verifico se esistono timestamp vocali reali prima del primo blocco."
        : "Controllo che il recupero non inventi testo, tempi o sovrapposizioni.";
    onEvent?.({ type: "agent", stage: "agents", progress: 100, agentId, agentName: visible.name, specialty: visible.specialty, turn: index + 1, totalTurns: roles.length, state: "thinking", message: thinking, interactive: true });
    let message: string;
    if (result.insertedCues > 0) {
      message = agentId === "transcript-editor"
        ? `Recuperate ${result.insertedWords} parole iniziali dalla trascrizione Whisper.`
        : agentId === "timing-director"
          ? `Inseriti ${result.insertedCues} blocchi prima della timeline esistente usando esclusivamente i timestamp Whisper, senza sovrapposizioni.`
          : `Recupero approvato: testo e tempi dell’apertura derivano dall’audio${result.source === "targeted-whisper" ? ` rianalizzato nei primi ${result.scannedSeconds?.toFixed(1)} secondi` : ""}.`;
    } else {
      message = agentId === "transcript-editor"
        ? "Il testo o la trascrizione disponibili non contengono parole iniziali recuperabili con sufficiente certezza."
        : agentId === "timing-director"
          ? "Non risultano timestamp vocali affidabili prima del primo blocco: non posso posizionare nuovi sottotitoli senza inventare i tempi."
          : "Nessuna modifica applicata per proteggere il sincronismo. Serve una nuova analisi Whisper dell’apertura oppure il testo iniziale con un riferimento temporale.";
    }
    onEvent?.({ type: "agent", stage: "agents", progress: 100, agentId, agentName: visible.name, specialty: visible.specialty, turn: index + 1, totalTurns: roles.length, state: "answered", message, interactive: true });
  });
}

function parseInteractiveChanges(answer: string): { reply: string; changes: InteractiveSubtitleChange[] } | null {
  if (degenerateAgentAnswer(answer)) return null;
  const parsed = jsonObjectFromAnswer(answer);
  if (!parsed || typeof parsed.reply !== "string" || !Array.isArray(parsed.changes)) return null;
  const changes: InteractiveSubtitleChange[] = [];
  for (const value of parsed.changes.slice(0, 24)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (item.action !== "replace" && item.action !== "split" && item.action !== "merge" && item.action !== "retime") continue;
    const cue = typeof item.cue === "number" ? item.cue : Number.NaN;
    if (!Number.isInteger(cue) || cue < 1) continue;
    const change: InteractiveSubtitleChange = { action: item.action, cue };
    if (typeof item.text === "string") change.text = item.text;
    if (typeof item.after_word === "number" && Number.isInteger(item.after_word)) change.afterWord = item.after_word;
    if (typeof item.start === "number" && Number.isFinite(item.start)) change.start = item.start;
    if (typeof item.end === "number" && Number.isFinite(item.end)) change.end = item.end;
    changes.push(change);
  }
  return { reply: parsed.reply.replace(/\s+/g, " ").trim().slice(0, 480), changes };
}

function groundedReplacement(candidate: string, current: string, trustedText: string): boolean {
  const trusted = words(`${current} ${trustedText}`).map(normalized).filter(Boolean);
  return words(candidate).map(normalized).filter(Boolean).every((token) =>
    token.length <= 2
    || trusted.includes(token)
    || trusted.some((source) => Math.max(source.length, token.length) >= 4 && wordSimilarity(source, token) >= .72)
  );
}

function applyInteractiveChanges(cues: readonly SubtitleCue[], changes: readonly InteractiveSubtitleChange[], options: SubtitleSegmentationOptions, trustedText: string): { cues: SubtitleCue[]; applied: number } {
  type WorkingCue = SubtitleCue & { sourceIndex: number };
  const working: WorkingCue[] = cues.map((cue, index) => ({ ...cue, sourceIndex: index + 1 }));
  let applied = 0;
  for (const change of changes.filter((item) => item.action === "replace" || item.action === "retime")) {
    const index = working.findIndex((cue) => cue.sourceIndex === change.cue);
    const cue = working[index]; if (!cue) continue;
    if (change.action === "replace") {
      const text = change.text?.replace(/\s+/g, " ").trim() ?? "";
      if (!text || text.length > options.maxCharsPerLine * 3 || /\[[^\]]+\]/.test(text) || text === cue.text || !groundedReplacement(text, cue.text, trustedText)) continue;
      working[index] = { ...cue, text, verified: false }; applied += 1;
      continue;
    }
    const previous = working[index - 1]; const next = working[index + 1];
    const requestedStart = change.start ?? cue.startSeconds; const requestedEnd = change.end ?? cue.endSeconds;
    const start = Math.max(previous ? previous.endSeconds + .01 : 0, requestedStart);
    const end = Math.min(next ? next.startSeconds - .01 : Number.POSITIVE_INFINITY, requestedEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + .08 || Math.abs(start - cue.startSeconds) > 2 || Math.abs(end - cue.endSeconds) > 2) continue;
    if (Math.abs(start - cue.startSeconds) < .005 && Math.abs(end - cue.endSeconds) < .005) continue;
    working[index] = { ...cue, startSeconds: start, endSeconds: end, verified: false }; applied += 1;
  }
  for (const change of [...changes].reverse().filter((item) => item.action === "merge")) {
    const index = working.findIndex((cue) => cue.sourceIndex === change.cue);
    const cue = working[index]; const next = working[index + 1]; if (!cue || !next) continue;
    const text = `${cue.text} ${next.text}`.replace(/\s+/g, " ").trim();
    if (text.length > options.maxCharsPerLine * 2 || next.startSeconds - cue.endSeconds > 1.2) continue;
    working.splice(index, 2, { ...cue, endSeconds: next.endSeconds, text, confidence: (cue.confidence + next.confidence) / 2, verified: false });
    applied += 1;
  }
  for (const change of [...changes].reverse().filter((item) => item.action === "split")) {
    const index = working.findIndex((cue) => cue.sourceIndex === change.cue);
    const cue = working[index]; if (!cue) continue;
    const tokens = words(cue.text); const after = change.afterWord ?? Math.floor(tokens.length / 2);
    if (after < 1 || after >= tokens.length) continue;
    const splitAt = cue.startSeconds + (cue.endSeconds - cue.startSeconds) * after / tokens.length;
    if (splitAt <= cue.startSeconds + .08 || splitAt >= cue.endSeconds - .08) continue;
    const left: WorkingCue = { ...cue, text: tokens.slice(0, after).join(" "), endSeconds: splitAt, verified: false };
    const right: WorkingCue = { ...cue, id: `subtitle-${crypto.randomUUID()}`, sourceIndex: cue.sourceIndex + .5, text: tokens.slice(after).join(" "), startSeconds: splitAt + .01, verified: false };
    working.splice(index, 1, left, right); applied += 1;
  }
  const result = working.sort((left, right) => left.startSeconds - right.startSeconds).map((cue) => {
    const subtitleCue: SubtitleCue & { sourceIndex?: number } = { ...cue };
    delete subtitleCue.sourceIndex;
    return subtitleCue;
  });
  return {
    cues: result.map((cue, index) => ({ ...cue, manual: false, verified: subtitleCueIssues(cue, result[index - 1], options).length === 0 })),
    applied
  };
}

export async function reviseSubtitlesWithAgentInstruction(
  cues: readonly SubtitleCue[],
  instruction: string,
  target: SmartSubtitleAgentTarget,
  model: LlmModelId,
  lyrics: string,
  overrides: Partial<SubtitleSegmentationOptions> | undefined,
  progress: (message: string) => void,
  onEvent?: SubtitleGenerationEventHandler,
  recovery: InteractiveSubtitleRecoveryContext = {}
): Promise<InteractiveSubtitleAgentResult> {
  const request = instruction.replace(/\s+/g, " ").trim();
  if (!request) throw new Error("Scrivi un’istruzione per gli agenti.");
  if (!cues.length) throw new Error("Non ci sono blocchi di sottotitoli da correggere.");
  const options = segmentationOptions(overrides?.preferredWords ?? defaultSegmentation.preferredWords, overrides);
  if (requestsMissingOpening(request)) {
    const firstCue = [...cues].sort((left, right) => left.startSeconds - right.startSeconds)[0]!;
    let source: "existing-whisper" | "targeted-whisper" | "unavailable" = "unavailable";
    let scannedSeconds: number | undefined;
    let candidateWords = missingOpeningWords(recovery.exactWordTimeline ?? [], cues);
    if (candidateWords.length) source = "existing-whisper";
    else {
      try {
        const targeted = await targetedOpeningTimeline(cues, recovery, progress, onEvent);
        if (targeted) {
          scannedSeconds = targeted.scannedSeconds;
          candidateWords = missingOpeningWords(targeted.words, cues);
          if (candidateWords.length) source = "targeted-whisper";
        }
      } catch (error) {
        progress(`Recupero introduzione non riuscito: ${error instanceof Error ? error.message : String(error)}`);
        stageEvent(onEvent, "whisper", 100, `Analisi mirata non riuscita: ${error instanceof Error ? error.message : String(error)}.`, false);
      }
    }
    const reference = referenceOpening(lyrics, firstCue.text);
    const alignedWords = alignRecoverableOpening(candidateWords, reference);
    const recovered = phraseCues(alignedWords, options.preferredWords, options).flatMap((cue) => {
      const endSeconds = Math.min(cue.endSeconds, firstCue.startSeconds - .01);
      return endSeconds > cue.startSeconds + .08 ? [{ ...cue, endSeconds, manual: false, verified: false }] : [];
    });
    const combined = [...recovered, ...cues].sort((left, right) => left.startSeconds - right.startSeconds);
    const validated = combined.map((cue, index) => ({ ...cue, verified: subtitleCueIssues(cue, combined[index - 1], options).length === 0 }));
    openingRecoveryEvents(target, { insertedCues: recovered.length, insertedWords: alignedWords.length, source, ...(scannedSeconds === undefined ? {} : { scannedSeconds }) }, onEvent);
    const summary = recovered.length
      ? `Apertura recuperata · ${recovered.length} nuovi blocchi e ${alignedWords.length} parole inseriti con timestamp Whisper.`
      : "Apertura non inserita: Whisper non ha fornito parole e timestamp iniziali sufficientemente affidabili.";
    progress(summary);
    return { cues: validated, changedCount: recovered.length, summary };
  }
  const verifier = await getLocalTextGenerator(model, modelProgressReporter(progress, onEvent, "agents", 100, 100));
  const roles = interactiveAgentRoles(target);
  let current = [...cues]; let changedCount = 0;
  for (let index = 0; index < roles.length; index += 1) {
    const agentId = roles[index]!; const identity = interactiveAgentIdentity(agentId); const visible = visibleAgent(identity.role);
    onEvent?.({ type: "agent", stage: "agents", progress: 100, agentId, agentName: visible.name, specialty: visible.specialty, turn: index + 1, totalTurns: roles.length, state: "thinking", message: `Richiesta dell’utente: ${request}`, interactive: true });
    const caseFile = JSON.stringify({
      request,
      constraints: { maxDuration: options.maxCueDuration, maxCharsPerLine: options.maxCharsPerLine, maxReadingSpeed: options.maxReadingSpeed },
      officialLyricsExcerpt: cleanReferenceLyrics(lyrics).slice(0, 3_000),
      cues: current.slice(0, 100).map((cue, cueIndex) => ({ cue: cueIndex + 1, start: Number(cue.startSeconds.toFixed(3)), end: Number(cue.endSeconds.toFixed(3)), text: cue.text }))
    });
    const conversation: LocalChatMessage[] = [
      { role: "system", content: "Sei un agente editoriale per sottotitoli. Esegui la richiesta dell’utente senza inventare parole o timestamp. Rispondi con un solo JSON valido: {\"reply\":\"spiegazione breve\",\"changes\":[{\"action\":\"replace|split|merge|retime\",\"cue\":1,\"text\":\"solo replace\",\"after_word\":2,\"start\":0.0,\"end\":1.0}]}. Usa solo i campi necessari. Gli indici cue partono da 1. Massimo 24 modifiche." },
      { role: "user", content: `${identity.instruction}\n\nDOSSIER\n${caseFile}` }
    ];
    let message = ""; let plan: ReturnType<typeof parseInteractiveChanges> = null;
    try {
      progress(`Intervento ${visible.name} · ${index + 1}/${roles.length}…`);
      const output = await runLocalTextGeneration(verifier, conversation, { max_new_tokens: 240, do_sample: false, repetition_penalty: 1.16, no_repeat_ngram_size: 4 }, 20_000);
      plan = parseInteractiveChanges(localGeneratedAnswer(output));
      if (!plan) message = "Risposta non valida o ripetitiva: nessuna modifica applicata.";
    } catch (error) {
      message = `Intervento interrotto: ${error instanceof Error ? error.message : String(error)}. Nessuna modifica applicata.`;
    }
    if (plan) {
      const applied = applyInteractiveChanges(current, plan.changes, options, `${request}\n${cleanReferenceLyrics(lyrics)}`);
      current = applied.cues; changedCount += applied.applied;
      message = `${plan.reply || "Controllo completato."} · ${applied.applied} modifiche validate e applicate.`;
    }
    onEvent?.({ type: "agent", stage: "agents", progress: 100, agentId, agentName: visible.name, specialty: visible.specialty, turn: index + 1, totalTurns: roles.length, state: "answered", message, interactive: true });
  }
  return { cues: current, changedCount };
}

export async function reviewSubtitles(cues: readonly SubtitleCue[], lyrics: string, model: LlmModelId, passes: number, progress: (message: string) => void, overrides?: Partial<SubtitleSegmentationOptions>, exactWordTimeline?: readonly TimestampedWord[], onEvent?: SubtitleGenerationEventHandler): Promise<SubtitleCue[]> {
  if (!lyrics.trim()) throw new Error("Incolla il testo ufficiale prima della revisione LLM.");
  const options = segmentationOptions(overrides?.preferredWords ?? defaultSegmentation.preferredWords, overrides);
  const deterministicLyrics = cleanReferenceLyrics(lyrics);
  progress("Editor deterministico · riallineamento parola per parola…");
  stageEvent(onEvent, "editing", 52, "Allineamento globale del testo alle parole e alle pause Whisper…", true);
  const sourceTimeline = exactWordTimeline?.length ? exactWordTimeline : timedWordsFromCues(cues);
  const alignedWords = reconcileWithLyrics(sourceTimeline, deterministicLyrics);
  let corrected = phraseCues(alignedWords, options.preferredWords, options);
  let councilApproved = false;
  try {
    stageEvent(onEvent, "agents", 58, `Apertura redazione locale · ${clamp(Math.round(passes), 1, 10)} passaggi…`);
    const council = await runLocalAgentCouncil(corrected, sourceTimeline, lyrics, model, passes, options, progress, onEvent);
    councilApproved = council.approved;
    if (council.cleanedLyrics !== deterministicLyrics) corrected = phraseCues(reconcileWithLyrics(sourceTimeline, council.cleanedLyrics), options.preferredWords, options);
  } catch (error) {
    councilApproved = false;
    stageEvent(onEvent, "agents", 94, `Redazione LLM non disponibile: ${error instanceof Error ? error.message : String(error)}. Mantengo il montaggio deterministico.`, false);
  }
  stageEvent(onEvent, "final", 96, "Validazione deterministica finale dei blocchi e dei timestamp…", true);
  return corrected.map((cue, index) => ({ ...cue, verified: subtitleCueIssues(cue, corrected[index - 1], options).length === 0 && councilApproved, manual: false }));
}

/** Shared Whisper facade used by subtitles and MLSM POST LIPSYNC. Keeping the
 * model invocation here guarantees one model instance/cache and one timestamp
 * decoder instead of creating a second transcription stack. */
export async function transcribeTimestampedAudio(audioUrl: string, durationSeconds: number, options: {
  language: string;
  whisperModel: WhisperModelId;
  phraseWords?: number;
  timingDetail?: "word" | "phoneme";
  signal?: AbortSignal;
  onEvent?: SubtitleGenerationEventHandler;
}, progress: (message: string) => void): Promise<WhisperTranscriptDocument> {
  if (options.signal?.aborted) throw new DOMException("Trascrizione annullata", "AbortError");
  progress(`Preparazione ${whisperModelOptions.find((item) => item.id === options.whisperModel)?.label ?? "Whisper"} · verifica cache locale…`);
  stageEvent(options.onEvent, "setup", 2, `Preparazione ${whisperModelOptions.find((item) => item.id === options.whisperModel)?.label ?? "Whisper"}…`, true);
  const transcriber = await getLocalTranscriber(options.whisperModel, modelProgressReporter(progress, options.onEvent)) as (input: string, options: Record<string, unknown>) => Promise<WhisperResult>;
  if (options.signal?.aborted) throw new DOMException("Trascrizione annullata", "AbortError");
  const deepTiming = options.timingDetail === "phoneme";
  stageEvent(options.onEvent, "whisper", 20, `Whisper sta analizzando ${durationSeconds.toFixed(1)} secondi di audio${deepTiming ? " · passaggio contestuale 1/2" : ""}…`, true);
  const language = options.language === "auto" ? undefined : options.language;
  const result = await transcriber(audioUrl, { return_timestamps: "word", chunk_length_s: deepTiming ? 18 : 30, stride_length_s: deepTiming ? 4 : 5, language });
  if (options.signal?.aborted) throw new DOMException("Trascrizione annullata", "AbortError");
  const primaryWords = timestampedWords(result, durationSeconds);
  let rawWords = primaryWords;
  if (deepTiming) {
    progress("Whisper approfondito · passaggio 2/2 su finestre fonetiche corte…");
    stageEvent(options.onEvent, "whisper", 34, "Whisper sta rifinendo attacchi consonantici, vocali e rilasci…", true);
    const detailedResult = await transcriber(audioUrl, { return_timestamps: "word", chunk_length_s: 8, stride_length_s: 2, condition_on_prev_tokens: false, language });
    if (options.signal?.aborted) throw new DOMException("Trascrizione annullata", "AbortError");
    rawWords = fuseDetailedTimestampWords(primaryWords, timestampedWords(detailedResult, durationSeconds));
  }
  const rawCues = phraseCues(rawWords, options.phraseWords ?? 6);
  const document: WhisperTranscriptDocument = {
    schemaVersion: 1,
    engine: "Whisper",
    model: options.whisperModel,
    durationSeconds,
    transcript: rawWords.map((word) => word.text).join(" "),
    words: rawWords,
    phrases: rawCues.map((cue) => ({ start: cue.startSeconds, end: cue.endSeconds, text: cue.text, confidence: cue.confidence }))
  };
  options.onEvent?.({ type: "whisper-output", stage: "whisper", progress: 48, document });
  return document;
}

export async function generateSubtitles(audioUrl: string, durationSeconds: number, options: { lyrics: string; maxWords: number; maxCueDuration?: number; maxCharsPerLine?: number; maxReadingSpeed?: number; language: string; whisperModel: WhisperModelId; llmEnabled: boolean; llmModel: LlmModelId; llmPasses: number; onWhisperJson?: (document: WhisperTranscriptDocument) => void; onEvent?: SubtitleGenerationEventHandler }, progress: (message: string) => void): Promise<SubtitleCue[]> {
  const whisperDocument = await transcribeTimestampedAudio(audioUrl, durationSeconds, { language: options.language, whisperModel: options.whisperModel, phraseWords: options.maxWords, ...(options.onEvent ? { onEvent: options.onEvent } : {}) }, progress);
  progress("Montaggio professionale · pause, timestamp e leggibilità…");
  const segmentation = segmentationOptions(options.maxWords, {
    preferredWords: options.maxWords,
    ...(options.maxCueDuration === undefined ? {} : { maxCueDuration: options.maxCueDuration }),
    ...(options.maxCharsPerLine === undefined ? {} : { maxCharsPerLine: options.maxCharsPerLine }),
    ...(options.maxReadingSpeed === undefined ? {} : { maxReadingSpeed: options.maxReadingSpeed })
  });
  const rawWords = whisperDocument.words;
  options.onWhisperJson?.(whisperDocument);
  const cleanedLyrics = cleanReferenceLyrics(options.lyrics);
  const aligned = cleanedLyrics ? reconcileWithLyrics(rawWords, cleanedLyrics) : rawWords; const cues = phraseCues(aligned, options.maxWords, segmentation);
  if (!options.llmEnabled || !options.lyrics.trim()) {
    stageEvent(options.onEvent, "final", 96, "Creazione finale dei blocchi senza revisione LLM…", true);
    return cues;
  }
  try { return await reviewSubtitles(cues, options.lyrics, options.llmModel, options.llmPasses, progress, segmentation, rawWords, options.onEvent); } catch { return cues; }
}

export function subtitleTranscriptJson(document: WhisperTranscriptDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function subtitleSrt(cues: readonly SubtitleCue[]): string {
  const stamp = (seconds: number) => { const totalMilliseconds = Math.max(0, Math.round(seconds * 1000)); const hours = Math.floor(totalMilliseconds / 3_600_000); const minutes = Math.floor(totalMilliseconds % 3_600_000 / 60_000); const whole = Math.floor(totalMilliseconds % 60_000 / 1000); const milliseconds = totalMilliseconds % 1000; return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`; };
  return cues.map((cue, index) => `${index + 1}\n${stamp(cue.startSeconds)} --> ${stamp(cue.endSeconds)}\n${cue.text}\n`).join("\n");
}
