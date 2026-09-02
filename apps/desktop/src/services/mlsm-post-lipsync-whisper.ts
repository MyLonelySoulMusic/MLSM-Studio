import { isTauri } from "@tauri-apps/api/core";
import { fetchBrowserVocalService } from "./cassette-desk-vocals-browser";
import { ensureSongPlayerRuntime, getSongPlayerCapabilities, getSongPlayerRuntimeSetup, isSongPlayerJobTerminal, startSongPlayerJob, waitForSongPlayerJob } from "./song-player-native";
import type { WhisperModelId, WhisperTranscriptDocument } from "./subtitle-generation";

export interface MlsmWhisperMedia {
  path: string;
  url: string;
  fileName: string;
  durationSeconds: number;
}

interface RuntimeStatus { status: "idle" | "installing" | "ready" | "failed"; progress: number; message: string; error: string | null; ready: boolean }
type NativeWord = { text?: unknown; start?: unknown; end?: unknown; confidence?: unknown };
const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException("Trascrizione annullata", "AbortError"));
  const timer = globalThis.setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => { globalThis.clearTimeout(timer); reject(new DOMException("Trascrizione annullata", "AbortError")); }, { once: true });
});

async function json(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok && response.status !== 202) throw new Error(typeof value.error === "string" ? value.error : typeof value.message === "string" ? value.message : "Whisper Medium locale non raggiungibile.");
  return value;
}

export function decodeNativeWhisperTranscript(value: unknown, model: WhisperModelId, durationSeconds: number): WhisperTranscriptDocument {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const rawWords = source && Array.isArray(source.words) ? source.words as NativeWord[] : [];
  const words = rawWords.flatMap((item) => {
    const text = typeof item.text === "string" ? item.text.trim() : "";
    const start = typeof item.start === "number" ? item.start : NaN; const end = typeof item.end === "number" ? item.end : NaN;
    const confidence = typeof item.confidence === "number" ? item.confidence : .5;
    return text && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= durationSeconds + .1
      ? [{ text, start, end: Math.min(durationSeconds, end), confidence: Math.max(0, Math.min(1, confidence)), confidenceSource: "model" as const }]
      : [];
  });
  if (!words.length || words.some((word, index) => index > 0 && word.start < words[index - 1]!.end - .001)) {
    throw new Error("Whisper Medium nativo non ha restituito una timeline parola per parola valida.");
  }
  const rawPhrases = source && Array.isArray(source.phrases) ? source.phrases as Record<string, unknown>[] : [];
  const phrases = rawPhrases.flatMap((item) => typeof item.text === "string" && typeof item.start === "number" && typeof item.end === "number" && item.end > item.start
    ? [{ text: item.text.trim(), start: item.start, end: Math.min(durationSeconds, item.end), confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : .5 }]
    : []);
  return {
    schemaVersion: 1,
    engine: "Whisper",
    model,
    durationSeconds,
    transcript: typeof source?.transcript === "string" ? source.transcript.trim() : words.map((word) => word.text).join(" "),
    words,
    phrases: phrases.length ? phrases : [{ start: words[0]!.start, end: words.at(-1)!.end, text: words.map((word) => word.text).join(" "), confidence: words.reduce((sum, word) => sum + word.confidence, 0) / words.length }]
  };
}

async function ensureBrowserRuntime(signal: AbortSignal | undefined, onProgress: (progress: number | null, message: string) => void): Promise<void> {
  let status = await json(await fetchBrowserVocalService("/ensure?feature=transcribeWords", { method: "POST", ...(signal ? { signal } : {}) }, "runtime Whisper Medium")) as unknown as RuntimeStatus;
  while (!status.ready) {
    if (status.status === "failed") throw new Error(status.error ?? status.message ?? "Installazione automatica di Whisper non riuscita.");
    onProgress(status.progress / 100 * .2, status.message || "Installazione automatica di Whisper Medium");
    await wait(600, signal);
    status = await json(await fetchBrowserVocalService("/status", signal ? { signal } : {}, "runtime Whisper Medium")) as unknown as RuntimeStatus;
  }
}

async function ensureNativeRuntime(signal: AbortSignal | undefined, onProgress: (progress: number | null, message: string) => void): Promise<void> {
  let capabilities = await getSongPlayerCapabilities();
  if (capabilities.wordTranscription) return;
  let status = await ensureSongPlayerRuntime();
  while (status.status === "installing" || status.status === "idle") {
    onProgress(status.progress / 100 * .2, status.message || "Installazione automatica di Whisper Medium");
    await wait(600, signal);
    status = await getSongPlayerRuntimeSetup();
  }
  if (status.status === "failed") throw new Error(status.error ?? "Installazione automatica di Whisper Medium non riuscita.");
  capabilities = await getSongPlayerCapabilities();
  if (!capabilities.wordTranscription) throw new Error("Il runtime MLSM non espone Whisper parola per parola dopo l’installazione.");
}

export async function transcribeMlsmWhisperWords(input: {
  media: MlsmWhisperMedia;
  range: { startSeconds: number; endSeconds: number };
  language: string;
  model: WhisperModelId;
  role: "source" | "target";
  signal?: AbortSignal;
  onProgress: (progress: number | null, message: string) => void;
}): Promise<WhisperTranscriptDocument> {
  const durationSeconds = input.range.endSeconds - input.range.startSeconds;
  if (!(durationSeconds > .05)) throw new Error("Intervallo Whisper non valido.");
  input.onProgress(0, `Whisper Medium nativo · preparazione audio ${input.role === "source" ? "del video" : "del brano master"}`);
  let result: unknown;
  if (isTauri()) {
    await ensureNativeRuntime(input.signal, input.onProgress);
    const fullRange = input.range.startSeconds <= .001 && input.range.endSeconds >= input.media.durationSeconds - .05;
    const started = await startSongPlayerJob({ kind: "transcribeWords", inputPath: input.media.path, language: input.language, model: input.model, ...(fullRange ? {} : { startSeconds: input.range.startSeconds, endSeconds: input.range.endSeconds }) });
    const terminal = isSongPlayerJobTerminal(started.status) ? started : await waitForSongPlayerJob(started.jobId, { ...(input.signal ? { signal: input.signal } : {}), onSnapshot: (snapshot) => input.onProgress(snapshot.progress ?? null, snapshot.message ?? "Whisper Medium · timestamp parola per parola") });
    if (terminal.status === "failed" || !terminal.result) throw new Error(typeof terminal.error === "string" ? terminal.error : terminal.error?.message ?? "Trascrizione Whisper Medium fallita.");
    if (terminal.status === "cancelled") throw new DOMException("Trascrizione annullata", "AbortError");
    result = terminal.result;
  } else {
    await ensureBrowserRuntime(input.signal, input.onProgress);
    const response = await fetch(input.media.url, input.signal ? { signal: input.signal } : undefined);
    if (!response.ok) throw new Error("Il file audio non è leggibile per Whisper Medium.");
    const blob = await response.blob();
    const query = new URLSearchParams({ filename: input.media.fileName, language: input.language, model: input.model });
    const fullRange = input.range.startSeconds <= .001 && input.range.endSeconds >= input.media.durationSeconds - .05;
    if (!fullRange) { query.set("startSeconds", input.range.startSeconds.toFixed(6)); query.set("endSeconds", input.range.endSeconds.toFixed(6)); }
    input.onProgress(.22, "Whisper Medium nativo · download automatico o caricamento dalla cache");
    result = await json(await fetchBrowserVocalService(`/transcribe?${query.toString()}`, { method: "POST", body: blob, ...(input.signal ? { signal: input.signal } : {}), headers: { "Content-Type": blob.type || "application/octet-stream" } }, "Whisper Medium nativo"));
  }
  const document = decodeNativeWhisperTranscript(result, input.model, durationSeconds);
  input.onProgress(1, `Whisper Medium · ${document.words.length} timestamp reali verificati`);
  return document;
}
