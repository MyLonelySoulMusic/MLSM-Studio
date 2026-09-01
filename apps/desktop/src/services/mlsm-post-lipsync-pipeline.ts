import type { ImportedAudio } from "./audio-import";
import { loadAudioFromPath, releaseImportedAudio } from "./audio-import";
import { separateCassetteDeskVocals } from "./cassette-desk-vocals";
import { createMlsmPostLipsyncAnalysis } from "./mlsm-post-lipsync-analysis";
import { constrainMlsmPostLipsyncTranscriptToExactLyrics } from "./mlsm-post-lipsync-exact-transcript";
import { repairMlsmPostLipsyncTranscriptWithLocalLlm } from "./mlsm-post-lipsync-llm";
import { mlsmPostLipsyncCache, mlsmPostLipsyncCacheKey } from "./mlsm-post-lipsync-cache";
import { refineMlsmPostLipsyncAlignment } from "./mlsm-post-lipsync-refinement";
import { markMlsmVisualSpeechUnavailable, refineMlsmPostLipsyncWithVisualSpeech } from "./mlsm-post-lipsync-visual";
import type { MlsmPostLipsyncAnalysis } from "./mlsm-post-lipsync-types";
import {
  ensureSongPlayerRuntime,
  getSongPlayerCapabilities,
  isSongPlayerJobTerminal,
  startSongPlayerJob,
  waitForSongPlayerJob
} from "./song-player-native";
import { transcribeTimestampedAudio, type WhisperModelId } from "./subtitle-generation";
import { isTauri } from "@tauri-apps/api/core";
import { releaseBrowserVocalStem } from "./cassette-desk-vocals-browser";

export type MlsmPostLipsyncPipelineStage = "extract-source-audio" | "cache" | "separate-source-vocal" | "separate-target-vocal" | "transcribe-source" | "transcribe-target" | "llm-correct" | "align" | "micro-align" | "visual-align";

export interface MlsmPostLipsyncPipelineProgress {
  stage: MlsmPostLipsyncPipelineStage;
  stageProgress: number | null;
  message: string;
}

function abortError(): DOMException { return new DOMException("Analisi MLSM POST LIPSYNC annullata", "AbortError"); }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw abortError(); }
async function textHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Reuses the cancellable Song Player worker. FFmpeg writes a PCM WAV beside the
 * native job while the source video remains byte-for-byte untouched. */
export async function extractMlsmPostLipsyncSourceAudio(
  sourceVideoPath: string,
  signal?: AbortSignal,
  onProgress?: (progress: number | null, message: string) => void
): Promise<ImportedAudio> {
  throwIfAborted(signal);
  let capabilities = await getSongPlayerCapabilities();
  if (!capabilities.audioExtraction && capabilities.desktop) {
    onProgress?.(null, "Preparazione automatica del runtime FFmpeg locale");
    await ensureSongPlayerRuntime();
    capabilities = await getSongPlayerCapabilities();
  }
  if (!capabilities.desktop || !capabilities.audioExtraction) throw new Error("L’estrazione audio cancellabile richiede il runtime desktop locale MLSM.");
  const started = await startSongPlayerJob({ kind: "extractAudio", inputPath: sourceVideoPath });
  const terminal = isSongPlayerJobTerminal(started.status) ? started : await waitForSongPlayerJob(started.jobId, {
    ...(signal ? { signal } : {}),
    onSnapshot: (snapshot) => onProgress?.(snapshot.progress ?? null, snapshot.message ?? "Estrazione audio dal video")
  });
  if (terminal.status === "cancelled") throw abortError();
  if (terminal.status === "failed" || !terminal.result || typeof terminal.result.path !== "string") {
    throw new Error(typeof terminal.error === "string" ? terminal.error : terminal.error?.message ?? "Estrazione audio dal video non riuscita.");
  }
  throwIfAborted(signal);
  return loadAudioFromPath(terminal.result.path);
}

export async function analyzeMlsmPostLipsync(input: {
  sourceVideoPath: string;
  sourceVideoUrl?: string;
  sourceVideoName?: string;
  sourceAudio?: ImportedAudio;
  targetMaster: ImportedAudio;
  targetMasterRange?: { startSeconds: number; endSeconds: number };
  subtitles?: string;
  language: string;
  whisperModel: WhisperModelId;
  deepPhonemeAnalysis?: boolean;
  focusCanonicalIndexes?: readonly number[];
  localLlmCorrection?: boolean;
  visualSpeechAnalysis?: boolean;
  exactSungLyrics?: string;
  reuseCachedAnalysis?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: MlsmPostLipsyncPipelineProgress) => void;
}): Promise<MlsmPostLipsyncAnalysis> {
  const report = (stage: MlsmPostLipsyncPipelineStage, stageProgress: number | null, message: string) => input.onProgress?.({ stage, stageProgress, message });
  const targetMasterRange = input.targetMasterRange ?? { startSeconds: 0, endSeconds: input.targetMaster.metadata.durationSeconds };
  if (!Number.isFinite(targetMasterRange.startSeconds) || !Number.isFinite(targetMasterRange.endSeconds) || targetMasterRange.startSeconds < 0 || targetMasterRange.endSeconds <= targetMasterRange.startSeconds + .05 || targetMasterRange.endSeconds > input.targetMaster.metadata.durationSeconds + .05) throw new Error("L’intervallo selezionato del master audio non è valido.");
  const targetAnalysisDurationSeconds = targetMasterRange.endSeconds - targetMasterRange.startSeconds;
  const ownsSourceAudio = !input.sourceAudio;
  const sourceAudio = input.sourceAudio ?? await extractMlsmPostLipsyncSourceAudio(input.sourceVideoPath, input.signal, (progress, message) => report("extract-source-audio", progress, message));
  if (input.sourceAudio) report("extract-source-audio", 1, "Audio del video disponibile nel browser");
  let sourceVocalAudio: ImportedAudio | null = null; let targetVocalAudio: ImportedAudio | null = null;
  const browserStemPaths: string[] = [];
  try {
    throwIfAborted(input.signal);
    report("cache", null, input.reuseCachedAnalysis ? "Verifica della cache di analisi versionata" : "Preparazione di una nuova analisi");
    const subtitleText = input.subtitles?.trim() ?? "";
    const alignmentSource = subtitleText ? "subtitles" : "whisper";
    const localLlmCorrectionEnabled = input.localLlmCorrection !== false;
    const visualSpeechEnabled = input.visualSpeechAnalysis !== false;
    const exactSungLyrics = input.exactSungLyrics?.trim().replace(/\s+/gu, " ") ?? "";
    const cacheKey = await mlsmPostLipsyncCacheKey({
      sourceVideoHash: sourceAudio.metadata.hash,
      targetAudioHash: input.targetMaster.metadata.hash,
      subtitleHash: await textHash(subtitleText || "__MLSM_WHISPER_ONLY__"),
      whisperModel: input.whisperModel,
      alignmentParameters: { language: input.language, alignmentSource, localLlmCorrection: localLlmCorrectionEnabled, visualSpeech: visualSpeechEnabled ? "auto-avsr-ctc-v1" : "disabled", exactLyricsHash: await textHash(exactSungLyrics || "__NO_EXACT_LYRICS__"), targetRangeStartMs: Math.round(targetMasterRange.startSeconds * 1_000), targetRangeEndMs: Math.round(targetMasterRange.endSeconds * 1_000), focusCanonicalIndexes: [...(input.focusCanonicalIndexes ?? [])].sort((left, right) => left - right), microAlignment: "phrase-dtw-v2", maxShiftMs: input.deepPhonemeAnalysis ? 350 : 50, detailMode: input.deepPhonemeAnalysis ? "phoneme" : "word" }
    });
    if (input.reuseCachedAnalysis) {
      const cached = await mlsmPostLipsyncCache.get(cacheKey);
      if (cached) {
        report("cache", 1, "Analisi MLSM POST LIPSYNC recuperata dalla cache");
        return cached;
      }
    }
    report("cache", 1, "Nuova analisi audio avviata");
    const sourceVocal = await separateCassetteDeskVocals(sourceAudio, input.signal, (progress, message) => report("separate-source-vocal", progress, message));
    if (!isTauri()) browserStemPaths.push(sourceVocal.stemPath);
    throwIfAborted(input.signal);
    const analyzesFullMaster = targetMasterRange.startSeconds <= .001 && targetMasterRange.endSeconds >= input.targetMaster.metadata.durationSeconds - .05;
    const targetVocal = await separateCassetteDeskVocals(input.targetMaster, input.signal, (progress, message) => report("separate-target-vocal", progress, message), analyzesFullMaster ? undefined : targetMasterRange);
    if (!isTauri()) browserStemPaths.push(targetVocal.stemPath);
    throwIfAborted(input.signal);
    if (isTauri()) [sourceVocalAudio, targetVocalAudio] = await Promise.all([loadAudioFromPath(sourceVocal.stemPath), loadAudioFromPath(targetVocal.stemPath)]);
    const sourceVocalUrl = sourceVocalAudio?.url ?? sourceVocal.stemPath; const targetVocalUrl = targetVocalAudio?.url ?? targetVocal.stemPath;
    const rawSourceTranscript = await transcribeTimestampedAudio(sourceVocalUrl, sourceAudio.metadata.durationSeconds, {
      language: input.language,
      whisperModel: input.whisperModel,
      timingDetail: input.deepPhonemeAnalysis ? "phoneme" : "word",
      ...(input.signal ? { signal: input.signal } : {})
    }, (message) => report("transcribe-source", null, message));
    const rawTargetTranscript = await transcribeTimestampedAudio(targetVocalUrl, targetAnalysisDurationSeconds, {
      language: input.language,
      whisperModel: input.whisperModel,
      timingDetail: input.deepPhonemeAnalysis ? "phoneme" : "word",
      ...(input.signal ? { signal: input.signal } : {})
    }, (message) => report("transcribe-target", null, message));
    throwIfAborted(input.signal);
    const sourceTranscript = exactSungLyrics
      ? constrainMlsmPostLipsyncTranscriptToExactLyrics(rawSourceTranscript, exactSungLyrics)
      : rawSourceTranscript;
    const targetTranscript = exactSungLyrics
      ? constrainMlsmPostLipsyncTranscriptToExactLyrics(rawTargetTranscript, exactSungLyrics)
      : rawTargetTranscript;
    let effectiveSourceTranscript = sourceTranscript;
    let localLlmCorrection: MlsmPostLipsyncAnalysis["localLlmCorrection"] = {
      enabled: localLlmCorrectionEnabled,
      applied: false,
      status: !localLlmCorrectionEnabled ? "disabled" : subtitleText && !exactSungLyrics ? "skipped-subtitles" : "no-change",
      recoveredWords: [],
      model: null,
      exactLyrics: localLlmCorrectionEnabled && exactSungLyrics ? exactSungLyrics : null
    };
    if (localLlmCorrectionEnabled && (!subtitleText || exactSungLyrics)) {
      report("llm-correct", null, "LLM locale · confronto delle parole saltate da Whisper");
      try {
        const repaired = await repairMlsmPostLipsyncTranscriptWithLocalLlm({
          sourceTranscript,
          targetTranscript,
          ...(exactSungLyrics ? { exactSungLyrics } : {}),
          onProgress: (message) => report("llm-correct", null, message)
        });
        effectiveSourceTranscript = repaired.sourceTranscript;
        const exactConstraintOnly = Boolean(exactSungLyrics) && !repaired.applied;
        localLlmCorrection = { enabled: true, applied: repaired.applied || exactConstraintOnly, status: repaired.applied ? "applied" : exactConstraintOnly ? "exact-constraint" : "no-change", recoveredWords: repaired.recoveredWords, model: repaired.model, exactLyrics: exactSungLyrics || null };
        report("llm-correct", 1, repaired.applied ? `LLM locale · recuperate: ${repaired.recoveredWords.join(" ")}` : exactConstraintOnly ? "Sequenza esatta applicata · Whisper mantiene l’autorità sui tempi" : "LLM locale · nessuna omissione confermata");
      } catch (reason) {
        const recoveredWords = exactSungLyrics ? sourceTranscript.words.filter((word) => word.confidenceSource === "estimated" && word.confidence <= .35).map((word) => word.text) : [];
        localLlmCorrection = exactSungLyrics
          ? { enabled: true, applied: true, status: "exact-constraint", recoveredWords, model: null, exactLyrics: exactSungLyrics }
          : { enabled: true, applied: false, status: "unavailable", recoveredWords: [], model: null, exactLyrics: null };
        report("llm-correct", 1, exactSungLyrics ? `LLM locale non disponibile (${reason instanceof Error ? reason.message : String(reason)}); vincolo esatto deterministico applicato e tempi lasciati a Whisper/MFCC` : `LLM locale non disponibile: ${reason instanceof Error ? reason.message : String(reason)} · allineamento Whisper invariato`);
      }
    } else {
      report("llm-correct", 1, subtitleText ? "Vincolo SRT/VTT presente · correzione LLM non necessaria" : "Correzione LLM locale disattivata");
    }
    throwIfAborted(input.signal);
    report("align", null, subtitleText ? "Allineamento con vincolo SRT/VTT e generazione time map" : "Allineamento esclusivo Whisper e generazione time map");
    const analysis = createMlsmPostLipsyncAnalysis({
      ...(subtitleText ? { subtitles: subtitleText } : {}),
      sourceTranscript: effectiveSourceTranscript,
      targetTranscript,
      sourceDurationSeconds: sourceAudio.metadata.durationSeconds,
      targetDurationSeconds: targetAnalysisDurationSeconds,
      targetMasterDurationSeconds: input.targetMaster.metadata.durationSeconds,
      targetAnalysisStartSeconds: targetMasterRange.startSeconds,
      detailMode: input.deepPhonemeAnalysis ? "phoneme" : "word",
      localLlmCorrection,
      whisperTranscripts: { source: rawSourceTranscript, target: rawTargetTranscript }
    });
    report("align", 1, "Anchor e time map verificati");
    const refined = analysis.anchors.length ? await refineMlsmPostLipsyncAlignment({
      analysis,
      sourceVocalPath: sourceVocal.stemPath,
      targetVocalPath: targetVocal.stemPath,
      ...(input.deepPhonemeAnalysis === undefined ? {} : { detailedTiming: input.deepPhonemeAnalysis }),
      ...(input.focusCanonicalIndexes?.length ? { focusCanonicalIndexes: input.focusCanonicalIndexes } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      onProgress: (progress, message) => report("micro-align", progress, message)
    }) : analysis;
    throwIfAborted(input.signal);
    let visuallyRefined = refined;
    if (visualSpeechEnabled) {
      report("visual-align", 0, "Auto-AVSR · preparazione dell’analisi visiva del labiale");
      try {
        visuallyRefined = await refineMlsmPostLipsyncWithVisualSpeech({
          analysis: refined,
          sourceVideoPath: input.sourceVideoPath,
          ...(input.sourceVideoUrl ? { sourceVideoUrl: input.sourceVideoUrl } : {}),
          ...(input.sourceVideoName ? { sourceVideoName: input.sourceVideoName } : {}),
          language: input.language,
          ...(input.signal ? { signal: input.signal } : {}),
          onProgress: (progress, message) => report("visual-align", progress, message)
        });
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
        visuallyRefined = markMlsmVisualSpeechUnavailable(refined, reason);
        report("visual-align", 1, `Auto-AVSR non disponibile · time-map audio mantenuta: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    } else {
      report("visual-align", 1, "Analisi visiva del labiale disattivata");
    }
    throwIfAborted(input.signal);
    await mlsmPostLipsyncCache.set(cacheKey, visuallyRefined);
    return visuallyRefined;
  } finally {
    if (ownsSourceAudio) releaseImportedAudio(sourceAudio); releaseImportedAudio(sourceVocalAudio); releaseImportedAudio(targetVocalAudio);
    if (browserStemPaths.length) await Promise.all(browserStemPaths.map((path) => releaseBrowserVocalStem(path))).catch(() => undefined);
  }
}
