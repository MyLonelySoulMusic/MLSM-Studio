import { MLSM_POST_LIPSYNC_STORE_NAME, openAnalysisDatabase } from "./analysis-database";
import { MLSM_POST_LIPSYNC_ANALYSIS_VERSION, type MlsmPostLipsyncAnalysis } from "./mlsm-post-lipsync-types";

const memory = new Map<string, MlsmPostLipsyncAnalysis>();

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const unit = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;

function validVisualWord(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const word = value as Record<string, unknown>;
  return typeof word.id === "string" && word.id.length > 0
    && typeof word.text === "string" && word.text.trim().length > 0
    && Number.isInteger(word.canonicalIndex) && Number(word.canonicalIndex) >= 0
    && finite(word.startSeconds) && finite(word.centerSeconds) && finite(word.endSeconds)
    && word.startSeconds >= 0 && word.startSeconds <= word.centerSeconds && word.centerSeconds <= word.endSeconds
    && unit(word.confidence) && unit(word.semanticSimilarity);
}

function validViseme(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const viseme = value as Record<string, unknown>;
  return Number.isInteger(viseme.canonicalIndex) && Number(viseme.canonicalIndex) >= 0
    && typeof viseme.label === "string" && viseme.label.length > 0
    && typeof viseme.visemeClass === "string" && viseme.visemeClass.length > 0
    && finite(viseme.startSeconds) && finite(viseme.centerSeconds) && finite(viseme.endSeconds)
    && viseme.startSeconds >= 0 && viseme.startSeconds <= viseme.centerSeconds && viseme.centerSeconds <= viseme.endSeconds
    && unit(viseme.confidence);
}

function validWhisperDocument(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== 1 || document.engine !== "Whisper" || typeof document.model !== "string"
    || !finite(document.durationSeconds) || document.durationSeconds <= 0 || typeof document.transcript !== "string"
    || !Array.isArray(document.words) || !Array.isArray(document.phrases)) return false;
  let previousCenter = -Infinity;
  for (const value of document.words) {
    if (!value || typeof value !== "object") return false;
    const word = value as Record<string, unknown>;
    if (typeof word.text !== "string" || !word.text.trim() || !finite(word.start) || !finite(word.end)
      || word.start < 0 || word.end <= word.start || word.end > document.durationSeconds + .05 || !unit(word.confidence)) return false;
    const center = (word.start + word.end) / 2;
    if (center <= previousCenter) return false;
    previousCenter = center;
  }
  return true;
}

function valid(value: unknown): value is MlsmPostLipsyncAnalysis {
  if (!value || typeof value !== "object") return false;
  const candidate = value as MlsmPostLipsyncAnalysis;
  return candidate.analysisVersion === MLSM_POST_LIPSYNC_ANALYSIS_VERSION
    && (candidate.detailMode === "word" || candidate.detailMode === "phoneme")
    && (candidate.alignmentSource === "subtitles" || candidate.alignmentSource === "whisper")
    && typeof candidate.localLlmCorrection?.enabled === "boolean"
    && typeof candidate.localLlmCorrection?.applied === "boolean"
    && ["applied", "exact-constraint", "no-change", "unavailable", "disabled", "skipped-subtitles"].includes(candidate.localLlmCorrection?.status)
    && Array.isArray(candidate.localLlmCorrection?.recoveredWords)
    && (candidate.localLlmCorrection?.model === null || typeof candidate.localLlmCorrection?.model === "string")
    && (candidate.localLlmCorrection?.exactLyrics === null || typeof candidate.localLlmCorrection?.exactLyrics === "string")
    && typeof candidate.visualSpeech?.enabled === "boolean"
    && typeof candidate.visualSpeech?.applied === "boolean"
    && ["applied", "no-confident-visemes", "unavailable", "disabled"].includes(candidate.visualSpeech?.status)
    && (candidate.visualSpeech?.provider === null || candidate.visualSpeech?.provider === "Auto-AVSR")
    && (candidate.visualSpeech?.model === null || typeof candidate.visualSpeech?.model === "string")
    && (candidate.visualSpeech?.revision === null || typeof candidate.visualSpeech?.revision === "string")
    && (candidate.visualSpeech?.device === null || typeof candidate.visualSpeech?.device === "string")
    && typeof candidate.visualSpeech?.visualTranscript === "string"
    && (candidate.visualSpeech?.faceCoverage === null || unit(candidate.visualSpeech?.faceCoverage))
    && Array.isArray(candidate.visualSpeech?.words) && candidate.visualSpeech.words.every(validVisualWord)
    && new Set(candidate.visualSpeech?.words.map((word) => word.canonicalIndex)).size === candidate.visualSpeech?.words.length
    && Array.isArray(candidate.visualSpeech?.visemes) && candidate.visualSpeech.visemes.every(validViseme)
    && (candidate.visualSpeech?.error === null || typeof candidate.visualSpeech?.error === "string")
    && Number.isFinite(candidate.sourceDurationSeconds) && candidate.sourceDurationSeconds > 0
    && Number.isFinite(candidate.targetMasterDurationSeconds) && candidate.targetMasterDurationSeconds > 0
    && Number.isFinite(candidate.targetAnalysisStartSeconds) && candidate.targetAnalysisStartSeconds >= 0
    && Number.isFinite(candidate.targetAnalysisEndSeconds) && candidate.targetAnalysisEndSeconds > candidate.targetAnalysisStartSeconds
    && candidate.targetAnalysisEndSeconds <= candidate.targetMasterDurationSeconds + .05
    && Number.isFinite(candidate.targetAudioStartSeconds) && candidate.targetAudioStartSeconds >= 0
    && Number.isFinite(candidate.targetAudioEndSeconds) && candidate.targetAudioEndSeconds > candidate.targetAudioStartSeconds
    && candidate.targetAudioEndSeconds <= candidate.targetMasterDurationSeconds + .05
    && Number.isFinite(candidate.targetDurationSeconds) && candidate.targetDurationSeconds > 0
    && Array.isArray(candidate.canonicalLyrics)
    && validWhisperDocument(candidate.whisperTranscripts?.source)
    && validWhisperDocument(candidate.whisperTranscripts?.target)
    && Array.isArray(candidate.anchors)
    && Array.isArray(candidate.unresolved)
    && candidate.timeMap?.version === 1
    && Array.isArray(candidate.timeMap.points)
    && Array.isArray(candidate.timeMap.segments);
}

export async function mlsmPostLipsyncCacheKey(input: {
  sourceVideoHash: string;
  targetAudioHash: string;
  subtitleHash: string;
  whisperModel: string;
  demucsModel?: string;
  alignmentParameters?: Record<string, unknown>;
}): Promise<string> {
  const serialized = JSON.stringify({
    analysisVersion: MLSM_POST_LIPSYNC_ANALYSIS_VERSION,
    sourceVideoHash: input.sourceVideoHash,
    targetAudioHash: input.targetAudioHash,
    subtitleHash: input.subtitleHash,
    whisperModel: input.whisperModel,
    demucsModel: input.demucsModel ?? "htdemucs",
    alignmentParameters: input.alignmentParameters ?? {}
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return `mlsm-post-lipsync:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export class MlsmPostLipsyncCache {
  async get(key: string): Promise<MlsmPostLipsyncAnalysis | null> {
    const fallback = memory.get(key) ?? null;
    if (!("indexedDB" in globalThis)) return fallback;
    try {
      const database = await openAnalysisDatabase();
      try {
        const value = await new Promise<unknown>((resolve, reject) => {
          const request = database.transaction(MLSM_POST_LIPSYNC_STORE_NAME, "readonly").objectStore(MLSM_POST_LIPSYNC_STORE_NAME).get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return valid(value) ? value : fallback;
      } finally { database.close(); }
    } catch { return fallback; }
  }

  async set(key: string, analysis: MlsmPostLipsyncAnalysis): Promise<void> {
    if (!valid(analysis)) throw new Error("Analisi MLSM POST LIPSYNC non valida: cache rifiutata.");
    memory.set(key, analysis);
    if (!("indexedDB" in globalThis)) return;
    try {
      const database = await openAnalysisDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const request = database.transaction(MLSM_POST_LIPSYNC_STORE_NAME, "readwrite").objectStore(MLSM_POST_LIPSYNC_STORE_NAME).put(analysis, key);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      } finally { database.close(); }
    } catch { /* Memory cache remains available for this session. */ }
  }

  async delete(key: string): Promise<void> {
    memory.delete(key);
    if (!("indexedDB" in globalThis)) return;
    try {
      const database = await openAnalysisDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const request = database.transaction(MLSM_POST_LIPSYNC_STORE_NAME, "readwrite").objectStore(MLSM_POST_LIPSYNC_STORE_NAME).delete(key);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      } finally { database.close(); }
    } catch { /* Best effort. */ }
  }

  async clear(): Promise<void> {
    memory.clear();
    if (!("indexedDB" in globalThis)) return;
    try {
      const database = await openAnalysisDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const request = database.transaction(MLSM_POST_LIPSYNC_STORE_NAME, "readwrite").objectStore(MLSM_POST_LIPSYNC_STORE_NAME).clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      } finally { database.close(); }
    } catch { /* The in-memory analysis cache has still been cleared. */ }
  }
}

export const mlsmPostLipsyncCache = new MlsmPostLipsyncCache();

export function serializeMlsmPostLipsyncAnalysis(analysis: MlsmPostLipsyncAnalysis): string {
  if (!valid(analysis)) throw new Error("Analisi MLSM POST LIPSYNC non valida.");
  return `${JSON.stringify(analysis, null, 2)}\n`;
}

export function parseMlsmPostLipsyncAnalysis(serialized: string): MlsmPostLipsyncAnalysis {
  const value = JSON.parse(serialized) as unknown;
  if (!valid(value)) throw new Error("Il progetto MLSM POST LIPSYNC non è valido o usa una versione incompatibile.");
  return value;
}
