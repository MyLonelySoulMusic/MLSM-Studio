import type { RhythmBallProject } from "@rbs/project-schema";
import { getLocalTextGenerator, getLocalTranscriber, localGeneratedAnswer, type LocalChatMessage } from "./local-model-runtime";

export type SubtitleCue = RhythmBallProject["subtitles"]["cues"][number];
export interface TimestampedWord { text: string; start: number; end: number; confidence: number; }
interface WhisperChunk { text?: string; timestamp?: [number | null, number | null]; }
interface WhisperResult { text?: string; chunks?: WhisperChunk[]; }

export interface SubtitleSegmentationOptions {
  preferredWords: number;
  maxCueDuration: number;
  maxCharsPerLine: number;
  maxReadingSpeed: number;
}

export type SubtitleCouncilRole = "Editor del testo" | "Montatore del timing" | "Controllo qualità" | "Coordinatore";

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
  { id: "smollm2-135m-instruct", label: "SmolLM2 135M Instruct", detail: "Correzione locale leggera con testo ufficiale", localSize: "177 MB" }
];
function normalized(value: string): string { return value.normalize("NFKD").toLocaleLowerCase().replace(/[^\p{L}\p{N}']/gu, ""); }
function words(value: string): string[] { return value.trim().split(/\s+/).filter(Boolean); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }

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
    const expanded = chunks.flatMap((chunk, index) => {
    const text = chunk.text?.trim() ?? ""; if (!text) return [];
    const start = Math.max(0, chunk.timestamp?.[0] ?? index / chunks.length * durationSeconds);
      const end = Math.min(durationSeconds, Math.max(start + .04, chunk.timestamp?.[1] ?? (index + 1) / chunks.length * durationSeconds));
      const tokens = words(text); const weights = tokens.map((token) => Math.max(1, normalized(token).length)); const totalWeight = weights.reduce((sum, value) => sum + value, 0);
      let elapsedWeight = 0;
      return tokens.map((token, tokenIndex) => {
        const tokenStart = start + (end - start) * elapsedWeight / Math.max(1, totalWeight); elapsedWeight += weights[tokenIndex] ?? 1;
        const tokenEnd = start + (end - start) * elapsedWeight / Math.max(1, totalWeight);
        return { text: token, start: tokenStart, end: Math.max(tokenStart + .025, tokenEnd), confidence: .82 };
      });
    }).sort((left, right) => left.start - right.start);
    const monotonic: TimestampedWord[] = [];
    for (const item of expanded) {
      const previous = monotonic.at(-1);
      if (previous && normalized(previous.text) === normalized(item.text) && Math.abs(previous.start - item.start) < .12) continue;
      const start = previous ? Math.max(item.start, Math.min(item.end - .025, previous.end)) : item.start;
      monotonic.push({ ...item, start, end: Math.max(start + .025, item.end) });
    }
    return monotonic;
  }
  const tokens = words(result.text ?? "");
  return tokens.map((text, index) => ({ text, start: index / Math.max(1, tokens.length) * durationSeconds, end: (index + 1) / Math.max(1, tokens.length) * durationSeconds, confidence: .68 }));
}

export function reconcileWithLyrics(transcript: readonly TimestampedWord[], lyrics: string): TimestampedWord[] {
  const official = words(lyrics); if (!official.length || !transcript.length) return [...transcript];
  let officialCursor = 0;
  return transcript.map((source, transcriptIndex) => {
    let bestIndex = -1; let bestSimilarity = 0;
    const expected = Math.round(transcriptIndex / Math.max(1, transcript.length - 1) * Math.max(0, official.length - 1));
    const from = Math.max(officialCursor, expected - 5); const until = Math.min(official.length, Math.max(officialCursor + 8, expected + 7));
    for (let index = from; index < until; index += 1) {
      const similarity = wordSimilarity(source.text, official[index] ?? "");
      const score = similarity - Math.abs(index - expected) * .012;
      if (score > bestSimilarity) { bestSimilarity = score; bestIndex = index; }
    }
    // Cantato, elisioni e grafie fonetiche ("tonite"/"tonight") richiedono una
    // soglia più permissiva del parlato, ma la finestra resta monotona e corta:
    // una parola non può quindi saltare avanti e colonizzare un'intera strofa.
    if (bestIndex >= 0 && bestSimilarity >= .46) {
      officialCursor = bestIndex + 1;
      return { ...source, text: official[bestIndex]!, confidence: Math.max(source.confidence, clamp(bestSimilarity, .76, .98)) };
    }
    return source;
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

function councilCaseFile(cues: readonly SubtitleCue[], lyrics: string, options: SubtitleSegmentationOptions): string {
  const rows = cues.slice(0, 80).map((cue, index) => {
    const metrics = cueMetrics(cue.text, cue.startSeconds, cue.endSeconds);
    return `${index + 1}. ${cue.startSeconds.toFixed(2)}-${cue.endSeconds.toFixed(2)} | ${metrics.duration.toFixed(2)}s | ${metrics.readingSpeed.toFixed(1)}c/s | ${cue.text}`;
  }).join("\n");
  return `CASO SOTTOTITOLI\nVincoli: durata <= ${options.maxCueDuration.toFixed(1)}s; riga <= ${options.maxCharsPerLine} caratteri; lettura <= ${options.maxReadingSpeed.toFixed(1)} caratteri/s.\nBLOCCHI:\n${rows}\nTESTO DI RIFERIMENTO:\n${lyrics.slice(0, 2600)}`;
}

function roleInstruction(role: SubtitleCouncilRole): string {
  if (role === "Editor del testo") return "Confronta parole e testo di riferimento. Segnala soltanto parole dubbie o mancanti; non inventare versi non pronunciati.";
  if (role === "Montatore del timing") return "Controlla pause, attacchi e code. Segnala blocchi troppo lunghi, sovrapposti o con fine distante dall'ultima parola.";
  if (role === "Controllo qualità") return "Controlla uniformità, leggibilità e alternanze innaturali fra blocchi molto brevi e molto lunghi.";
  return "Leggi i rapporti degli altri agenti e formula il verdetto finale. Rispondi APPROVE se testo, timing e leggibilità sono coerenti; altrimenti CHECK seguito da una motivazione breve.";
}

export function subtitleCueIssues(cue: SubtitleCue, previous: SubtitleCue | undefined, options: SubtitleSegmentationOptions): string[] {
  const metrics = cueMetrics(cue.text, cue.startSeconds, cue.endSeconds); const issues: string[] = [];
  if (metrics.duration > options.maxCueDuration + .02) issues.push("durata");
  if (metrics.characters > options.maxCharsPerLine * 2) issues.push("righe");
  if (metrics.readingSpeed > options.maxReadingSpeed * 1.12) issues.push("velocità");
  if (previous && cue.startSeconds < previous.endSeconds - .01) issues.push("sovrapposizione");
  return issues;
}

async function runLocalAgentCouncil(cues: readonly SubtitleCue[], lyrics: string, model: LlmModelId, passes: number, options: SubtitleSegmentationOptions, progress: (message: string) => void): Promise<boolean> {
  const verifier = await getLocalTextGenerator(model, progress);
  const totalTurns = clamp(Math.round(passes), 1, 10); const specialists: SubtitleCouncilRole[] = ["Editor del testo", "Montatore del timing", "Controllo qualità"];
  const conversation: LocalChatMessage[] = [
    { role: "system", content: "Sei parte di un consiglio locale di montaggio sottotitoli. Ogni agente legge i rapporti precedenti, è conciso e non modifica mai direttamente i timestamp. Il motore deterministico resta l'autorità sui tempi." },
    { role: "user", content: councilCaseFile(cues, lyrics, options) }
  ];
  let lastAnswer = "";
  for (let turn = 0; turn < totalTurns; turn += 1) {
    const role: SubtitleCouncilRole = turn === totalTurns - 1 ? "Coordinatore" : specialists[turn % specialists.length]!;
    progress(`Consiglio locale · ${role} · turno ${turn + 1}/${totalTurns}…`);
    conversation.push({ role: "user", content: `[${role}] ${roleInstruction(role)}` });
    const output = await verifier(conversation, { max_new_tokens: role === "Coordinatore" ? 40 : 56, do_sample: false, repetition_penalty: 1.08 });
    lastAnswer = localGeneratedAnswer(output);
    conversation.push({ role: "assistant", content: `[${role}] ${lastAnswer.slice(-700)}` });
  }
  return /\bAPPROVE\b/i.test(lastAnswer);
}

export async function reviewSubtitles(cues: readonly SubtitleCue[], lyrics: string, model: LlmModelId, passes: number, progress: (message: string) => void, overrides?: Partial<SubtitleSegmentationOptions>): Promise<SubtitleCue[]> {
  if (!lyrics.trim()) throw new Error("Incolla il testo ufficiale prima della revisione LLM.");
  const options = segmentationOptions(overrides?.preferredWords ?? defaultSegmentation.preferredWords, overrides);
  progress("Editor deterministico · riallineamento parola per parola…");
  const alignedWords = reconcileWithLyrics(timedWordsFromCues(cues), lyrics);
  const corrected = phraseCues(alignedWords, options.preferredWords, options);
  let councilApproved = false;
  try { councilApproved = await runLocalAgentCouncil(corrected, lyrics, model, passes, options, progress); } catch { councilApproved = false; }
  return corrected.map((cue, index) => ({ ...cue, verified: subtitleCueIssues(cue, corrected[index - 1], options).length === 0 && councilApproved, manual: false }));
}

export async function generateSubtitles(audioUrl: string, durationSeconds: number, options: { lyrics: string; maxWords: number; maxCueDuration?: number; maxCharsPerLine?: number; maxReadingSpeed?: number; language: string; whisperModel: WhisperModelId; llmEnabled: boolean; llmModel: LlmModelId; llmPasses: number }, progress: (message: string) => void): Promise<SubtitleCue[]> {
  progress(`Preparazione ${whisperModelOptions.find((item) => item.id === options.whisperModel)?.label ?? "Whisper"} · al primo utilizzo verrà scaricato…`);
  const transcriber = await getLocalTranscriber(options.whisperModel, progress) as (input: string, options: Record<string, unknown>) => Promise<WhisperResult>;
  const result = await transcriber(audioUrl, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5, language: options.language === "auto" ? undefined : options.language });
  progress("Montaggio professionale · pause, timestamp e leggibilità…");
  const segmentation = segmentationOptions(options.maxWords, {
    preferredWords: options.maxWords,
    ...(options.maxCueDuration === undefined ? {} : { maxCueDuration: options.maxCueDuration }),
    ...(options.maxCharsPerLine === undefined ? {} : { maxCharsPerLine: options.maxCharsPerLine }),
    ...(options.maxReadingSpeed === undefined ? {} : { maxReadingSpeed: options.maxReadingSpeed })
  });
  const rawWords = timestampedWords(result, durationSeconds); const aligned = options.lyrics.trim() ? reconcileWithLyrics(rawWords, options.lyrics) : rawWords; const cues = phraseCues(aligned, options.maxWords, segmentation);
  if (!options.llmEnabled || !options.lyrics.trim()) return cues;
  try { return await reviewSubtitles(cues, options.lyrics, options.llmModel, options.llmPasses, progress, segmentation); } catch { return cues; }
}

export function subtitleSrt(cues: readonly SubtitleCue[]): string {
  const stamp = (seconds: number) => { const totalMilliseconds = Math.max(0, Math.round(seconds * 1000)); const hours = Math.floor(totalMilliseconds / 3_600_000); const minutes = Math.floor(totalMilliseconds % 3_600_000 / 60_000); const whole = Math.floor(totalMilliseconds % 60_000 / 1000); const milliseconds = totalMilliseconds % 1000; return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`; };
  return cues.map((cue, index) => `${index + 1}\n${stamp(cue.startSeconds)} --> ${stamp(cue.endSeconds)}\n${cue.text}\n`).join("\n");
}
