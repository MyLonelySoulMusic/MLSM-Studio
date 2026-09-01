import { isTauri } from "@tauri-apps/api/core";
import { replaceMlsmPostLipsyncAnchors } from "./mlsm-post-lipsync-analysis";
import type { LipsyncVisemeEvent, LipsyncVisualWordEvent, MlsmPostLipsyncAnalysis, WordAnchor } from "./mlsm-post-lipsync-types";
import { ensureSongPlayerRuntime, getSongPlayerCapabilities, getSongPlayerRuntimeSetup, isSongPlayerJobTerminal, startSongPlayerJob, waitForSongPlayerJob, type SongPlayerVisualAnchorRequest } from "./song-player-native";
import { fetchBrowserVocalService } from "./cassette-desk-vocals-browser";

export interface MlsmVisualSpeechResult {
  kind: "analyzeVisemes";
  provider: "Auto-AVSR";
  model: string;
  revision: string;
  device: string;
  faceCoverage: number;
  visualTranscript: string;
  words: LipsyncVisualWordEvent[];
  visemes: LipsyncVisemeEvent[];
}

const abortError = () => new DOMException("Analisi visiva del labiale annullata", "AbortError");
const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const timer = globalThis.setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => { globalThis.clearTimeout(timer); reject(abortError()); }, { once: true });
});
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const unit = (value: number) => Math.max(0, Math.min(1, value));
const isUnit = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;

function decodeWord(value: unknown): LipsyncVisualWordEvent | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id.length > 0 && typeof item.text === "string" && item.text.trim().length > 0 && Number.isInteger(item.canonicalIndex) && Number(item.canonicalIndex) >= 0
    && finite(item.startSeconds) && finite(item.centerSeconds) && finite(item.endSeconds)
    && item.startSeconds >= 0 && item.startSeconds <= item.centerSeconds && item.centerSeconds <= item.endSeconds
    && isUnit(item.confidence) && isUnit(item.semanticSimilarity)
    ? { id: item.id, text: item.text, canonicalIndex: Number(item.canonicalIndex), startSeconds: item.startSeconds, centerSeconds: item.centerSeconds, endSeconds: item.endSeconds, confidence: unit(item.confidence), semanticSimilarity: unit(item.semanticSimilarity) }
    : null;
}

function decodeViseme(value: unknown): LipsyncVisemeEvent | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.canonicalIndex) && Number(item.canonicalIndex) >= 0 && typeof item.label === "string" && item.label.length > 0 && typeof item.visemeClass === "string" && item.visemeClass.length > 0
    && finite(item.startSeconds) && finite(item.centerSeconds) && finite(item.endSeconds)
    && item.startSeconds >= 0 && item.startSeconds <= item.centerSeconds && item.centerSeconds <= item.endSeconds && isUnit(item.confidence)
    ? { canonicalIndex: Number(item.canonicalIndex), label: item.label, visemeClass: item.visemeClass, startSeconds: item.startSeconds, centerSeconds: item.centerSeconds, endSeconds: item.endSeconds, confidence: unit(item.confidence) }
    : null;
}

export function decodeMlsmVisualSpeechResult(value: unknown): MlsmVisualSpeechResult {
  if (!value || typeof value !== "object") throw new Error("Auto-AVSR ha restituito una risposta non valida.");
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.words) || !Array.isArray(source.visemes)) throw new Error("Auto-AVSR ha restituito liste di eventi incomplete.");
  const words = source.words.map(decodeWord).filter((item): item is LipsyncVisualWordEvent => Boolean(item));
  const visemes = source.visemes.map(decodeViseme).filter((item): item is LipsyncVisemeEvent => Boolean(item));
  const uniqueWordIndexes = new Set(words.map((word) => word.canonicalIndex));
  if (words.length !== source.words.length || visemes.length !== source.visemes.length || uniqueWordIndexes.size !== words.length) {
    throw new Error("Auto-AVSR ha restituito eventi visivi non validi o duplicati.");
  }
  if (source.kind !== "analyzeVisemes" || source.provider !== "Auto-AVSR" || typeof source.model !== "string" || typeof source.revision !== "string" || typeof source.device !== "string" || !isUnit(source.faceCoverage) || typeof source.visualTranscript !== "string") {
    throw new Error("Auto-AVSR ha restituito metadati incompleti.");
  }
  return { kind: "analyzeVisemes", provider: "Auto-AVSR", model: source.model, revision: source.revision, device: source.device, faceCoverage: unit(source.faceCoverage), visualTranscript: source.visualTranscript, words, visemes };
}

function visualAnchors(analysis: MlsmPostLipsyncAnalysis): SongPlayerVisualAnchorRequest[] {
  return analysis.anchors.map((anchor) => ({ id: anchor.id, text: anchor.text, canonicalIndex: anchor.canonicalIndex, cueIndex: anchor.cueIndex, sourceStart: anchor.sourceStart, sourceCenter: anchor.sourceCenter, sourceEnd: anchor.sourceEnd, sourceConfidence: anchor.sourceConfidence }));
}

async function ensureNativeVisualRuntime(signal?: AbortSignal, onProgress?: (progress: number | null, message: string) => void) {
  let capabilities = await getSongPlayerCapabilities();
  if (capabilities.visualSpeech) return;
  let setup = await ensureSongPlayerRuntime();
  const deadline = Date.now() + 30 * 60 * 1_000;
  while (setup.status !== "ready") {
    if (signal?.aborted) throw abortError();
    if (setup.status === "failed") throw new Error(setup.error ?? setup.message ?? "Installazione Auto-AVSR non riuscita.");
    if (Date.now() > deadline) throw new Error("La preparazione automatica di Auto-AVSR ha superato 30 minuti.");
    onProgress?.(Math.min(.18, setup.progress / 100 * .18), setup.message || "Preparazione automatica Auto-AVSR");
    await wait(650, signal);
    setup = await getSongPlayerRuntimeSetup();
  }
  capabilities = await getSongPlayerCapabilities();
  if (!capabilities.visualSpeech) throw new Error("Il runtime è stato installato, ma Auto-AVSR non ha superato la verifica delle dipendenze.");
}

async function ensureBrowserVisualRuntime(signal?: AbortSignal, onProgress?: (progress: number | null, message: string) => void) {
  const read = async (response: Response) => {
    const value = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok && response.status !== 202) throw new Error(typeof value.error === "string" ? value.error : typeof value.message === "string" ? value.message : "Runtime Auto-AVSR non raggiungibile.");
    return value;
  };
  let status = await read(await fetchBrowserVocalService("/ensure?feature=analyzeVisemes", { method: "POST", ...(signal ? { signal } : {}) }, "runtime Auto-AVSR"));
  while (status.ready !== true) {
    if (status.status === "failed") throw new Error(typeof status.error === "string" ? status.error : "Installazione Auto-AVSR non riuscita.");
    onProgress?.(typeof status.progress === "number" ? Math.min(.18, status.progress / 100 * .18) : null, typeof status.message === "string" ? status.message : "Preparazione automatica Auto-AVSR");
    await wait(650, signal);
    status = await read(await fetchBrowserVocalService("/status", signal ? { signal } : {}, "runtime Auto-AVSR"));
  }
}

async function runBrowserVisualSpeech(input: { sourceVideoUrl: string; sourceVideoName: string; analysis: MlsmPostLipsyncAnalysis; language: string; signal?: AbortSignal; onProgress?: (progress: number | null, message: string) => void }) {
  await ensureBrowserVisualRuntime(input.signal, input.onProgress);
  input.onProgress?.(.2, "Auto-AVSR · preparazione del video nel browser");
  const sourceResponse = await fetch(input.sourceVideoUrl, input.signal ? { signal: input.signal } : undefined);
  if (!sourceResponse.ok) throw new Error("Il video sorgente non è più leggibile dalla sessione browser.");
  const blob = await sourceResponse.blob();
  const sessionResponse = await fetchBrowserVocalService("/visemes/session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: input.sourceVideoName, language: input.language, anchors: visualAnchors(input.analysis) }),
    ...(input.signal ? { signal: input.signal } : {})
  }, "sessione Auto-AVSR");
  const session = await sessionResponse.json().catch(() => ({})) as Record<string, unknown>;
  if (!sessionResponse.ok || typeof session.uploadId !== "string") throw new Error(typeof session.error === "string" ? session.error : "Sessione Auto-AVSR non creata.");
  input.onProgress?.(.24, "Auto-AVSR · invio locale del video al lettore labiale");
  const response = await fetchBrowserVocalService(`/visemes/upload/${encodeURIComponent(session.uploadId)}`, { method: "POST", body: blob, headers: { "Content-Type": blob.type || "application/octet-stream" }, ...(input.signal ? { signal: input.signal } : {}) }, "lettore labiale Auto-AVSR");
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Analisi Auto-AVSR browser non riuscita.");
  return decodeMlsmVisualSpeechResult(payload);
}

async function runNativeVisualSpeech(input: { sourceVideoPath: string; analysis: MlsmPostLipsyncAnalysis; language: string; signal?: AbortSignal; onProgress?: (progress: number | null, message: string) => void }) {
  await ensureNativeVisualRuntime(input.signal, input.onProgress);
  const started = await startSongPlayerJob({ kind: "analyzeVisemes", inputPath: input.sourceVideoPath, language: input.language, anchors: visualAnchors(input.analysis) });
  const terminal = isSongPlayerJobTerminal(started.status) ? started : await waitForSongPlayerJob(started.jobId, {
    ...(input.signal ? { signal: input.signal } : {}),
    onSnapshot: (snapshot) => input.onProgress?.(.18 + (snapshot.progress ?? 0) * .82, snapshot.message ?? "Auto-AVSR · analisi dei visemi")
  });
  if (terminal.status === "cancelled") throw abortError();
  if (terminal.status === "failed" || !terminal.result) throw new Error(typeof terminal.error === "string" ? terminal.error : terminal.error?.message ?? "Analisi Auto-AVSR non riuscita.");
  return decodeMlsmVisualSpeechResult(terminal.result);
}

export function applyMlsmVisualSpeechTiming(analysis: MlsmPostLipsyncAnalysis, result: MlsmVisualSpeechResult): MlsmPostLipsyncAnalysis {
  const events = new Map(result.words.map((event) => [event.canonicalIndex, event]));
  const output: WordAnchor[] = [];
  let applied = 0;
  for (let index = 0; index < analysis.anchors.length; index += 1) {
    const anchor = analysis.anchors[index]!;
    const event = events.get(anchor.canonicalIndex);
    if (!event || event.id !== anchor.id || anchor.locked || anchor.manuallyEdited || result.faceCoverage < .6 || event.confidence < .5 || event.semanticSimilarity < .08) { output.push(anchor); continue; }
    const previous = output.at(-1);
    const following = analysis.anchors[index + 1];
    const maximumShift = anchor.sourceConfidence < .5 ? .9 : .35;
    const rawShift = event.centerSeconds - anchor.sourceCenter;
    if (Math.abs(rawShift) > maximumShift && anchor.sourceConfidence >= .5) { output.push(anchor); continue; }
    const boundedShift = Math.max(-maximumShift, Math.min(maximumShift, rawShift));
    const weight = Math.min(.9, Math.max(.5, event.confidence * .88));
    const proposedCenter = anchor.sourceCenter + boundedShift * weight;
    const minimum = previous ? previous.sourceCenter + .015 : 0;
    const maximum = following ? following.sourceCenter - .015 : analysis.sourceDurationSeconds;
    if (!(proposedCenter > minimum && proposedCenter < maximum)) { output.push(anchor); continue; }
    const boundaryWeight = weight * .72;
    const proposedStart = Math.max(0, anchor.sourceStart + (event.startSeconds - anchor.sourceStart) * boundaryWeight);
    const proposedEnd = Math.min(analysis.sourceDurationSeconds, anchor.sourceEnd + (event.endSeconds - anchor.sourceEnd) * boundaryWeight);
    const sourceStart = Math.max(previous?.sourceEnd ?? 0, Math.min(proposedCenter, proposedStart));
    const sourceEnd = Math.max(proposedCenter, Math.min(following?.sourceStart ?? analysis.sourceDurationSeconds, proposedEnd));
    output.push({
      ...anchor,
      sourceStart,
      sourceCenter: proposedCenter,
      sourceEnd,
      matchConfidence: Math.max(anchor.matchConfidence, event.confidence * .85),
      evidence: { ...anchor.evidence, sequenceMargin: Math.max(anchor.evidence.sequenceMargin, event.confidence * .8), visualRefinement: { method: "auto-avsr-ctc-v1", shiftMs: (proposedCenter - anchor.sourceCenter) * 1_000, confidence: event.confidence, originalSourceCenter: anchor.sourceCenter } }
    });
    applied += 1;
  }
  const visualSpeech: MlsmPostLipsyncAnalysis["visualSpeech"] = {
    enabled: true, applied: applied > 0, status: applied > 0 ? "applied" : "no-confident-visemes",
    provider: result.provider, model: result.model, revision: result.revision, device: result.device,
    visualTranscript: result.visualTranscript, faceCoverage: result.faceCoverage, words: result.words, visemes: result.visemes, error: null
  };
  return replaceMlsmPostLipsyncAnchors({ ...analysis, visualSpeech }, output);
}

export async function refineMlsmPostLipsyncWithVisualSpeech(input: {
  analysis: MlsmPostLipsyncAnalysis;
  sourceVideoPath: string;
  sourceVideoUrl?: string;
  sourceVideoName?: string;
  language: string;
  signal?: AbortSignal;
  onProgress?: (progress: number | null, message: string) => void;
}): Promise<MlsmPostLipsyncAnalysis> {
  if (!input.analysis.anchors.length) return { ...input.analysis, visualSpeech: { enabled: true, applied: false, status: "no-confident-visemes", provider: "Auto-AVSR", model: null, revision: null, device: null, visualTranscript: "", faceCoverage: null, words: [], visemes: [], error: null } };
  const result = isTauri()
    ? await runNativeVisualSpeech(input)
    : input.sourceVideoUrl
      ? await runBrowserVisualSpeech({ sourceVideoUrl: input.sourceVideoUrl, sourceVideoName: input.sourceVideoName ?? input.sourceVideoPath, analysis: input.analysis, language: input.language, ...(input.signal ? { signal: input.signal } : {}), ...(input.onProgress ? { onProgress: input.onProgress } : {}) })
      : (() => { throw new Error("Il video sorgente browser non è più disponibile per Auto-AVSR."); })();
  input.onProgress?.(1, `Auto-AVSR · ${result.words.length} parole e ${result.visemes.length} eventi visemici analizzati`);
  return applyMlsmVisualSpeechTiming(input.analysis, result);
}

export function markMlsmVisualSpeechUnavailable(analysis: MlsmPostLipsyncAnalysis, reason: unknown): MlsmPostLipsyncAnalysis {
  return { ...analysis, visualSpeech: { enabled: true, applied: false, status: "unavailable", provider: "Auto-AVSR", model: null, revision: null, device: null, visualTranscript: "", faceCoverage: null, words: [], visemes: [], error: reason instanceof Error ? reason.message : String(reason) } };
}
