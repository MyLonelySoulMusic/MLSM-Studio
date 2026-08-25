import { analyzePcm, defaultAnalysisParameters, type EnergyFrame } from "@rbs/audio-analysis";
import type { ImportedAudio } from "./audio-import";
import type { SongPlayerAnalysis } from "./song-player-types";
import type { SongPlayerMatchResult } from "./song-player-native";
import { WebAudioAnalyzer } from "./web-audio-analyzer";

const ANALYSIS_SAMPLE_RATE = 11_025;
const FFT_SIZE = 1_024;
const MAX_ANALYSIS_FRAMES = 4_096;
const SPECTROGRAM_BANDS = 96;

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
}

function normalizedChroma(bands: readonly number[]): Float32Array {
  const chroma = new Float32Array(12);
  bands.forEach((value, index) => { chroma[index % 12] = (chroma[index % 12] ?? 0) + Math.max(0, value); });
  let norm = 0; chroma.forEach((value) => { norm += value * value; }); norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < chroma.length; index += 1) chroma[index] = (chroma[index] ?? 0) / norm;
  return chroma;
}

function buildAnalysisFromEnergy(energy: readonly EnergyFrame[], durationSeconds: number, sourceHash: string, hopSize: number, onProgress?: (progress: number) => void): SongPlayerAnalysis {
  const frameCount = energy.length; if (!frameCount) throw new Error("L’analisi FFT non ha prodotto fotogrammi utilizzabili.");
  const chroma = new Float32Array(frameCount * 12); const spectrogram = new Uint8Array(frameCount * SPECTROGRAM_BANDS);
  energy.forEach((frame, frameIndex) => {
    const bands = frame.bands48 ?? []; const frameChroma = normalizedChroma(bands); chroma.set(frameChroma, frameIndex * 12);
    for (let band = 0; band < SPECTROGRAM_BANDS; band += 1) {
      const position = band / 2; const left = Math.floor(position); const right = Math.min(47, left + 1); const value = (bands[left] ?? 0) * (1 - (position - left)) + (bands[right] ?? 0) * (position - left);
      spectrogram[frameIndex * SPECTROGRAM_BANDS + band] = Math.round(Math.max(0, Math.min(1, Math.sqrt(value))) * 255);
    }
  });
  onProgress?.(1);
  return { sourceHash, durationSeconds, chromaHopSeconds: durationSeconds / frameCount, chroma, fingerprintVersion: "v1", spectrogram: { version: 1, sourceHash, sampleRate: frameCount / durationSeconds, fftSize: FFT_SIZE, hopSize, bands: SPECTROGRAM_BANDS, frameCount, durationSeconds, minDb: -80, maxDb: 0, data: spectrogram.buffer } };
}

export function buildBrowserSongPlayerAnalysis(samples: Float32Array, durationSeconds: number, sourceHash: string, onProgress?: (progress: number) => void): SongPlayerAnalysis {
  if (samples.length < FFT_SIZE) throw new Error("Il file audio è troppo corto per l’analisi FFT.");
  const hopSize = Math.max(defaultAnalysisParameters.hopSize, Math.ceil((samples.length - FFT_SIZE) / Math.max(1, MAX_ANALYSIS_FRAMES - 1)));
  const result = analyzePcm(samples, ANALYSIS_SAMPLE_RATE, { ...defaultAnalysisParameters, frameSize: FFT_SIZE, hopSize }, (progress) => onProgress?.(progress.progress * .9));
  return buildAnalysisFromEnergy(result.energy, durationSeconds, sourceHash, hopSize, onProgress);
}

export async function analyzeSongPlayerInBrowser(audio: ImportedAudio, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<SongPlayerAnalysis> {
  abortIfNeeded(signal);
  const durationSeconds = audio.metadata.durationSeconds;
  const sampleRate = audio.metadata.sampleRate || 48_000;
  const sampleCount = Math.max(FFT_SIZE, Math.round(durationSeconds * sampleRate));
  const hopSize = Math.max(defaultAnalysisParameters.hopSize, Math.ceil((sampleCount - FFT_SIZE) / Math.max(1, MAX_ANALYSIS_FRAMES - 1)));
  const completed = await new WebAudioAnalyzer().analyze(
    audio.url,
    audio.metadata.hash,
    { ...defaultAnalysisParameters, frameSize: FFT_SIZE, hopSize },
    (progress) => onProgress?.(progress.progress * .9),
    signal,
  );
  abortIfNeeded(signal);
  const resolvedDuration = completed.result.durationSeconds || durationSeconds;
  return buildAnalysisFromEnergy(completed.result.energy, resolvedDuration, audio.metadata.hash, hopSize, onProgress);
}

function sampleChroma(analysis: SongPlayerAnalysis, timeSeconds: number): Float32Array {
  const frames = Math.max(1, Math.floor(analysis.chroma.length / 12)); const frame = Math.max(0, Math.min(frames - 1, Math.round(timeSeconds / Math.max(1e-6, analysis.chromaHopSeconds))));
  return analysis.chroma.subarray(frame * 12, frame * 12 + 12);
}

function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < 12; index += 1) { const a = left[index] ?? 0; const b = right[index] ?? 0; dot += a * b; leftNorm += a * a; rightNorm += b * b; }
  return dot / Math.max(1e-8, Math.sqrt(leftNorm * rightNorm));
}

function waitForMainThread(): Promise<void> { return new Promise((resolve) => globalThis.setTimeout(resolve, 0)); }

export async function matchSongPlayerInBrowser(reference: SongPlayerAnalysis, target: SongPlayerAnalysis, signal?: AbortSignal, onProgress?: (progress: number) => void): Promise<SongPlayerMatchResult> {
  if (target.durationSeconds > reference.durationSeconds) throw new Error("La canzone completa deve durare almeno quanto lo spezzone.");
  const maximumOffset = reference.durationSeconds - target.durationSeconds; const hop = Math.max(.12, reference.durationSeconds / MAX_ANALYSIS_FRAMES, target.durationSeconds / 256); const targetFrames = Math.max(4, Math.floor(target.durationSeconds / hop)); const offsets = Math.max(1, Math.floor(maximumOffset / hop) + 1); const scored: Array<{ offsetSeconds: number; score: number }> = [];
  for (let offsetIndex = 0; offsetIndex < offsets; offsetIndex += 1) {
    abortIfNeeded(signal); const offsetSeconds = Math.min(maximumOffset, offsetIndex * hop); let score = 0;
    for (let frame = 0; frame < targetFrames; frame += 1) { const time = Math.min(target.durationSeconds, frame * hop); score += cosine(sampleChroma(reference, offsetSeconds + time), sampleChroma(target, time)); }
    scored.push({ offsetSeconds, score: score / targetFrames });
    if (offsetIndex % 128 === 0) { onProgress?.(offsetIndex / offsets); await waitForMainThread(); }
  }
  scored.sort((left, right) => right.score - left.score); const exclusion = Math.max(hop, target.durationSeconds * .2); const candidates: Array<{ offsetSeconds: number; score: number }> = [];
  for (const candidate of scored) { if (candidates.every((item) => Math.abs(item.offsetSeconds - candidate.offsetSeconds) >= exclusion)) candidates.push(candidate); if (candidates.length === 5) break; }
  const best = candidates[0]; if (!best) throw new Error("Audio insufficiente per il confronto."); const second = candidates[1]?.score ?? 0; const margin = Math.max(0, best.score - second); const confidence = Math.max(0, Math.min(1, .72 * best.score + 1.4 * margin - .18)); const status = best.score < .48 ? "unrelated" : margin < .045 || confidence < .55 ? "ambiguous" : "matched"; onProgress?.(1);
  return { kind: "match", status, offsetMs: Math.max(0, Math.round(best.offsetSeconds * 1000)), confidence, candidates: candidates.map((candidate) => ({ offsetMs: Math.max(0, Math.round(candidate.offsetSeconds * 1000)), score: Math.max(0, Math.min(1, candidate.score)) })) };
}
