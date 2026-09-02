import type { ImportedAudio } from "./audio-import";
import { loadAudioFromPath, releaseImportedAudio } from "./audio-import";
import { separateCassetteDeskVocals } from "./cassette-desk-vocals";
import { createMlsmPostLipsyncAnalysis } from "./mlsm-post-lipsync-analysis";
import { constrainMlsmPostLipsyncTranscriptToExactLyrics } from "./mlsm-post-lipsync-exact-transcript";
import { repairMlsmPostLipsyncTranscriptWithLocalLlm } from "./mlsm-post-lipsync-llm";
import { mlsmPostLipsyncCache, mlsmPostLipsyncCacheKey } from "./mlsm-post-lipsync-cache";
import { refineMlsmPostLipsyncAlignment } from "./mlsm-post-lipsync-refinement";
import { measureMlsmPostLipsyncWaveformAlignment, unmeasuredMlsmWaveformAlignment } from "./mlsm-post-lipsync-waveform";
import { markMlsmVisualSpeechUnavailable, refineMlsmPostLipsyncWithVisualSpeech } from "./mlsm-post-lipsync-visual";
import type { MlsmPostLipsyncAnalysis } from "./mlsm-post-lipsync-types";
import {
  ensureSongPlayerRuntime,
  getSongPlayerCapabilities,
  isSongPlayerJobTerminal,
  startSongPlayerJob,
  waitForSongPlayerJob
} from "./song-player-native";
import type { WhisperModelId } from "./subtitle-generation";
import { isTauri } from "@tauri-apps/api/core";
import { releaseBrowserVocalStem } from "./cassette-desk-vocals-browser";
import { transcribeMlsmWhisperWords, type MlsmWhisperMedia } from "./mlsm-post-lipsync-whisper";

export type MlsmPostLipsyncPipelineStage = "extract-source-audio" | "cache" | "separate-source-vocal" | "separate-target-vocal" | "overlay-waveforms" | "transcribe-source" | "transcribe-target" | "llm-correct" | "align" | "micro-align" | "visual-align";

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
  sourceVideoHash?: string;
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
  separateVocals?: boolean;
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
    const vocalSeparationEnabled = input.separateVocals === true;
    const visualSpeechEnabled = input.visualSpeechAnalysis === true;
    const exactSungLyrics = input.exactSungLyrics?.trim().replace(/\s+/gu, " ") ?? "";
    const sourceVideoHash = input.sourceVideoHash ?? await textHash(JSON.stringify({
      path: input.sourceVideoPath,
      name: input.sourceVideoName ?? "",
      durationMs: Math.round(sourceAudio.metadata.durationSeconds * 1_000),
      extractedAudioHash: sourceAudio.metadata.hash
    }));
    const cacheKey = await mlsmPostLipsyncCacheKey({
      sourceVideoHash,
      targetAudioHash: input.targetMaster.metadata.hash,
      subtitleHash: await textHash(subtitleText || "__MLSM_WHISPER_ONLY__"),
      whisperModel: input.whisperModel,
      alignmentParameters: { language: input.language, alignmentSource, localLlmCorrection: localLlmCorrectionEnabled, vocalSeparation: vocalSeparationEnabled ? "htdemucs" : "disabled", visualSpeech: visualSpeechEnabled ? "auto-avsr-ctc-v1" : "disabled", exactLyricsHash: await textHash(exactSungLyrics || "__NO_EXACT_LYRICS__"), targetRangeStartMs: Math.round(targetMasterRange.startSeconds * 1_000), targetRangeEndMs: Math.round(targetMasterRange.endSeconds * 1_000), focusCanonicalIndexes: [...(input.focusCanonicalIndexes ?? [])].sort((left, right) => left - right), waveformOverlay: vocalSeparationEnabled ? "onset-rms-xcorr-v1" : "disabled", microAlignment: vocalSeparationEnabled ? "phrase-dtw-v2" : "disabled", transcriptionProfile: "faster-whisper-native-singing-word-timestamps-v6", maxShiftMs: input.deepPhonemeAnalysis ? 350 : 50, detailMode: input.deepPhonemeAnalysis ? "phoneme" : "word" }
    });
    if (input.reuseCachedAnalysis) {
      const cached = await mlsmPostLipsyncCache.get(cacheKey);
      if (cached) {
        report("cache", 1, "Analisi MLSM POST LIPSYNC recuperata dalla cache");
        return cached;
      }
    }
    report("cache", 1, "Nuova analisi audio avviata");
    const analyzesFullMaster = targetMasterRange.startSeconds <= .001 && targetMasterRange.endSeconds >= input.targetMaster.metadata.durationSeconds - .05;
    let sourceWhisperMedia: MlsmWhisperMedia = { path: sourceAudio.metadata.path, url: sourceAudio.url, fileName: sourceAudio.metadata.fileName, durationSeconds: sourceAudio.metadata.durationSeconds };
    let targetWhisperMedia: MlsmWhisperMedia = { path: input.targetMaster.metadata.path, url: input.targetMaster.url, fileName: input.targetMaster.metadata.fileName, durationSeconds: input.targetMaster.metadata.durationSeconds };
    let sourceWhisperRange = { startSeconds: 0, endSeconds: sourceAudio.metadata.durationSeconds };
    let targetWhisperRange = targetMasterRange;
    let sourceAlignmentPath: string | null = null; let targetAlignmentPath: string | null = null;
    if (vocalSeparationEnabled) {
      const sourceVocal = await separateCassetteDeskVocals(sourceAudio, input.signal, (progress, message) => report("separate-source-vocal", progress, message));
      if (!isTauri()) browserStemPaths.push(sourceVocal.stemPath);
      throwIfAborted(input.signal);
      const targetVocal = await separateCassetteDeskVocals(input.targetMaster, input.signal, (progress, message) => report("separate-target-vocal", progress, message), analyzesFullMaster ? undefined : targetMasterRange);
      if (!isTauri()) browserStemPaths.push(targetVocal.stemPath);
      throwIfAborted(input.signal);
      if (isTauri()) [sourceVocalAudio, targetVocalAudio] = await Promise.all([loadAudioFromPath(sourceVocal.stemPath), loadAudioFromPath(targetVocal.stemPath)]);
      sourceWhisperMedia = sourceVocalAudio
        ? { path: sourceVocalAudio.metadata.path, url: sourceVocalAudio.url, fileName: sourceVocalAudio.metadata.fileName, durationSeconds: sourceVocalAudio.metadata.durationSeconds }
        : { path: sourceVocal.stemPath, url: sourceVocal.stemPath, fileName: "source-vocals.wav", durationSeconds: sourceAudio.metadata.durationSeconds };
      targetWhisperMedia = targetVocalAudio
        ? { path: targetVocalAudio.metadata.path, url: targetVocalAudio.url, fileName: targetVocalAudio.metadata.fileName, durationSeconds: targetVocalAudio.metadata.durationSeconds }
        : { path: targetVocal.stemPath, url: targetVocal.stemPath, fileName: "target-vocals.wav", durationSeconds: targetAnalysisDurationSeconds };
      sourceWhisperRange = { startSeconds: 0, endSeconds: sourceWhisperMedia.durationSeconds };
      targetWhisperRange = { startSeconds: 0, endSeconds: targetWhisperMedia.durationSeconds };
      sourceAlignmentPath = sourceVocal.stemPath; targetAlignmentPath = targetVocal.stemPath;
    } else {
      report("separate-source-vocal", 1, "Separazione voce disattivata · Whisper Medium usa l’audio originale del video");
      report("separate-target-vocal", 1, analyzesFullMaster ? "Whisper Medium usa il master originale" : "Whisper Medium userà soltanto la porzione selezionata del master");
    }
    throwIfAborted(input.signal);
    // Overlay the two isolated vocals before a single word is transcribed. This
    // is the only measurement in the pipeline that no transcript and no LLM can
    // skew, and it is what later bounds the recovery search to the right place
    // instead of letting it hunt across the whole video.
    let waveformAlignment = unmeasuredMlsmWaveformAlignment(vocalSeparationEnabled ? "unavailable" : "disabled", vocalSeparationEnabled ? undefined : "Separazione vocale disattivata: autorità temporale affidata ai timestamp Whisper originali.");
    if (sourceAlignmentPath && targetAlignmentPath) {
      try {
        waveformAlignment = await measureMlsmPostLipsyncWaveformAlignment({
          sourceVocalPath: sourceAlignmentPath,
          targetVocalPath: targetAlignmentPath,
          ...(input.signal ? { signal: input.signal } : {}),
          onProgress: (progress, message) => report("overlay-waveforms", progress, message)
        });
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
        waveformAlignment = unmeasuredMlsmWaveformAlignment("unavailable", reason instanceof Error ? reason.message : String(reason));
        report("overlay-waveforms", 1, `Sovrapposizione delle onde non disponibile · si prosegue con i tempi del trascritto: ${waveformAlignment.detail}`);
      }
    } else report("overlay-waveforms", 1, "Sovrapposizione stem disattivata · timestamp Whisper originali invariati");
    throwIfAborted(input.signal);
    const rawSourceTranscript = await transcribeMlsmWhisperWords({
      media: sourceWhisperMedia,
      range: sourceWhisperRange,
      language: input.language,
      model: input.whisperModel,
      role: "source",
      ...(input.signal ? { signal: input.signal } : {}),
      onProgress: (progress, message) => report("transcribe-source", progress, message)
    });
    const rawTargetTranscript = await transcribeMlsmWhisperWords({
      media: targetWhisperMedia,
      range: targetWhisperRange,
      language: input.language,
      model: input.whisperModel,
      role: "target",
      ...(input.signal ? { signal: input.signal } : {}),
      onProgress: (progress, message) => report("transcribe-target", progress, message)
    });
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
          waveform: waveformAlignment,
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
      waveformAlignment,
      whisperTranscripts: { source: rawSourceTranscript, target: rawTargetTranscript }
    });
    report("align", 1, "Anchor e time map verificati");
    const refined = analysis.anchors.length && sourceAlignmentPath && targetAlignmentPath ? await refineMlsmPostLipsyncAlignment({
      analysis,
      sourceVocalPath: sourceAlignmentPath,
      targetVocalPath: targetAlignmentPath,
      ...(input.deepPhonemeAnalysis === undefined ? {} : { detailedTiming: input.deepPhonemeAnalysis }),
      ...(input.focusCanonicalIndexes?.length ? { focusCanonicalIndexes: input.focusCanonicalIndexes } : {}),
      waveform: waveformAlignment,
      ...(input.signal ? { signal: input.signal } : {}),
      onProgress: (progress, message) => report("micro-align", progress, message)
    }) : analysis;
    if (!sourceAlignmentPath || !targetAlignmentPath) report("micro-align", 1, "MFCC/DTW stem disattivato · time-map costruita dai timestamp Whisper originali");
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
