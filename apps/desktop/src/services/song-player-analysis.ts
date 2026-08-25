import type { ImportedAudio } from "./audio-import";
import { cancelSongPlayerJob, getSongPlayerCapabilities, isSongPlayerJobTerminal, startSongPlayerJob, waitForSongPlayerJob } from "./song-player-native";
import { songPlayerAnalysisCache } from "./song-player-analysis-cache";
import type { SongPlayerAnalysis } from "./song-player-types";
import { analyzeSongPlayerInBrowser } from "./song-player-browser-audio";

interface WorkerFingerprint { algorithm: string; frameCount: number; hashes: string[]; }
interface WorkerSpectrogram { encoding: string; rows: number; columns: number; data: string; }
interface WorkerAnalysisResult { hash?: unknown; durationSeconds?: unknown; frameHopSeconds?: unknown; fingerprint?: unknown; spectrogram?: unknown; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" ? value as Record<string, unknown> : null; }
function decodeBase64(value: string): Uint8Array {
  if (typeof atob === "function") { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
  const nodeBuffer = (globalThis as { Buffer?: { from(value: string, encoding: string): Uint8Array } }).Buffer;
  if (nodeBuffer) return new Uint8Array(nodeBuffer.from(value, "base64"));
  throw new Error("Decoder base64 non disponibile.");
}
function parseFingerprint(value: unknown): WorkerFingerprint {
  const source = record(value); const hashes = source?.hashes;
  // The worker encodes two pitch classes (0..11 => hex 0..b) followed by a
  // strength nibble (0..15). Accepting c..f in the first two positions would
  // write outside the 12-bin chroma frame and could corrupt the next frame.
  if (source?.algorithm !== "mlsm-chroma-v1" || !Number.isInteger(source.frameCount) || !Array.isArray(hashes) || !hashes.length || hashes.some((hash) => typeof hash !== "string" || !/^[0-9ab][0-9ab][0-9a-f]$/i.test(hash))) throw new Error("Fingerprint Song Player non valido.");
  return { algorithm: "mlsm-chroma-v1", frameCount: source.frameCount as number, hashes: hashes as string[] };
}
function fingerprintChroma(fingerprint: WorkerFingerprint): Float32Array {
  const chroma = new Float32Array(fingerprint.hashes.length * 12);
  fingerprint.hashes.forEach((hash, frame) => { const primary = Number.parseInt(hash[0]!, 16); const secondary = Number.parseInt(hash[1]!, 16); const strength = Number.parseInt(hash[2]!, 16) / 15; chroma[frame * 12 + primary] = strength; chroma[frame * 12 + secondary] = Math.max(chroma[frame * 12 + secondary] ?? 0, strength * .5); });
  return chroma;
}
function parseSpectrogram(value: unknown): WorkerSpectrogram {
  const source = record(value);
  if (source?.encoding !== "base64-uint8" || !Number.isInteger(source.rows) || !Number.isInteger(source.columns) || (source.rows as number) <= 0 || (source.columns as number) <= 0 || typeof source.data !== "string") throw new Error("Spettrogramma Song Player non valido.");
  return { encoding: "base64-uint8", rows: source.rows as number, columns: source.columns as number, data: source.data };
}
export function decodeNativeSongPlayerAnalysis(result: WorkerAnalysisResult, sourceHash: string, fallbackDurationSeconds: number): SongPlayerAnalysis {
  if (typeof result.hash === "string" && result.hash !== sourceHash) throw new Error("Hash analisi Song Player non coerente con la sorgente.");
  const durationSeconds = typeof result.durationSeconds === "number" && Number.isFinite(result.durationSeconds) && result.durationSeconds > 0 ? result.durationSeconds : fallbackDurationSeconds;
  const fingerprint = parseFingerprint(result.fingerprint); const spectrogram = parseSpectrogram(result.spectrogram); const rowMajor = decodeBase64(spectrogram.data);
  if (rowMajor.byteLength !== spectrogram.rows * spectrogram.columns) throw new Error("Dimensione spettrogramma Song Player non valida.");
  const frameMajor = new Uint8Array(rowMajor.byteLength);
  for (let row = 0; row < spectrogram.rows; row += 1) for (let column = 0; column < spectrogram.columns; column += 1) frameMajor[column * spectrogram.rows + row] = rowMajor[row * spectrogram.columns + column]!;
  return { sourceHash, durationSeconds, chromaHopSeconds: durationSeconds / fingerprint.hashes.length, chroma: fingerprintChroma(fingerprint), fingerprintVersion: "v1", spectrogram: { version: 1, sourceHash, sampleRate: spectrogram.columns / durationSeconds, fftSize: 1024, hopSize: 1, bands: spectrogram.rows, frameCount: spectrogram.columns, durationSeconds, minDb: -80, maxDb: 0, data: frameMajor.buffer } };
}

function nativeAnalysisFailure(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Analisi audio reale non riuscita: ${message}`, { cause: error });
}

/** Uses the native FFT worker when available and otherwise performs a real FFT
 * over the decoded local file in the browser. No synthetic frequency data is
 * generated from the low-resolution waveform preview. */
export async function analyzeSongPlayerAudio(audio: ImportedAudio, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<SongPlayerAnalysis> {
  if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
  const cached = await songPlayerAnalysisCache.get(audio.metadata.hash); if (cached) { onProgress?.(1); return cached; }
  if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
  const capabilities = await getSongPlayerCapabilities();
  if (capabilities.nativeAnalysis && audio.metadata.path) {
    let nativeJobId: string | null = null;
    try {
      const started = await startSongPlayerJob({ kind: "analyze", inputPath: audio.metadata.path });
      nativeJobId = started.jobId;
      const terminal = isSongPlayerJobTerminal(started.status) ? started : await waitForSongPlayerJob(started.jobId, { ...(signal ? { signal } : {}), onSnapshot: (next) => onProgress?.(next.progress ?? 0) });
      if (terminal.status === "failed" || terminal.status === "cancelled" || !terminal.result) throw new Error(typeof terminal.error === "string" ? terminal.error : terminal.error?.message ?? "Analisi Song Player non riuscita.");
      const analysis = decodeNativeSongPlayerAnalysis(terminal.result, audio.metadata.hash, audio.metadata.durationSeconds);
      await songPlayerAnalysisCache.set(analysis); onProgress?.(1); return analysis;
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) { if (nativeJobId) await cancelSongPlayerJob(nativeJobId).catch(() => undefined); throw error; }
      onProgress?.(0); try { const analysis = await analyzeSongPlayerInBrowser(audio, onProgress, signal); await songPlayerAnalysisCache.set(analysis); return analysis; }
      catch (browserError) { throw new Error(`${nativeAnalysisFailure(error).message} Fallback browser non riuscito: ${browserError instanceof Error ? browserError.message : String(browserError)}`, { cause: browserError }); }
    }
  }
  try { const analysis = await analyzeSongPlayerInBrowser(audio, onProgress, signal); await songPlayerAnalysisCache.set(analysis); return analysis; }
  catch (error) { if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error; throw new Error(`Analisi FFT locale non riuscita: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
}

export function sampleSongPlayerChroma(analysis: SongPlayerAnalysis, timeSeconds: number): Float32Array {
  const frame = Math.max(0, Math.min(Math.floor(analysis.chroma.length / 12) - 1, Math.round(timeSeconds / analysis.chromaHopSeconds)));
  return analysis.chroma.slice(frame * 12, frame * 12 + 12);
}
