import { fetchBrowserVocalService } from "./cassette-desk-vocals-browser";
import { isSongPlayerJobTerminal, startSongPlayerJob, waitForSongPlayerJob } from "./song-player-native";
import type { MlsmWaveformAlignment } from "./mlsm-post-lipsync-types";
import { isTauri } from "@tauri-apps/api/core";

/** Minimum evidence required before a measured overlay may move a timestamp.
 *
 * `clarity` is the decisive one: a looped backing track correlates almost
 * perfectly one bar away too, and a bar-shifted “perfect” match is exactly the
 * failure the transcript path already produces. Reject it instead of trusting
 * a high correlation on its own. */
export const mlsmWaveformTrustThresholds = { confidence: .55, clarity: .2, localAgreement: .6, windows: 3 } as const;

/** Search radius the MFCC pass may use once the overlay supplies the seed.
 *
 * The overlay fixes the absolute position, so the radius only has to cover how
 * much the sung performance breathes around a single global ratio — which the
 * worker measures per window and returns as `spreadMs`. */
export function mlsmWaveformSearchRadiusMs(alignment: MlsmWaveformAlignment): number {
  if (!alignment.trusted) return 0;
  return Math.round(Math.max(150, Math.min(900, alignment.spreadMs * 1.5 + 150)));
}

/** Source-stem time predicted for a target-stem time by the measured overlay. */
export function predictMlsmWaveformSourceSeconds(alignment: MlsmWaveformAlignment, targetStemSeconds: number): number {
  return Math.max(0, alignment.scale * targetStemSeconds + alignment.offsetSeconds);
}

export function unmeasuredMlsmWaveformAlignment(status: MlsmWaveformAlignment["status"], detail: string | null = null): MlsmWaveformAlignment {
  return { method: "onset-rms-xcorr-v1", status, detail, trusted: false, offsetSeconds: 0, scale: 1, confidence: 0, clarity: 0, residualMs: 0, spreadMs: 0, localAgreement: 0, windows: 0, overlapSeconds: 0, searchRadiusMs: 0 };
}

const number = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const unit = (value: unknown): number => Math.max(0, Math.min(1, number(value, 0)));

export function decodeMlsmWaveformAlignment(value: unknown): MlsmWaveformAlignment {
  if (!value || typeof value !== "object") throw new Error("Sovrapposizione onde: risposta non valida.");
  const source = value as Record<string, unknown>;
  if (source.kind !== "alignWaveform") throw new Error("Sovrapposizione onde: risposta non pertinente.");
  if (source.aligned !== true) {
    return unmeasuredMlsmWaveformAlignment("unmeasurable", typeof source.reason === "string" ? source.reason : null);
  }
  const scale = number(source.scale, Number.NaN);
  const offsetSeconds = number(source.offsetSeconds, Number.NaN);
  if (!Number.isFinite(scale) || !Number.isFinite(offsetSeconds) || scale <= 0) throw new Error("Sovrapposizione onde: mappa temporale non valida.");
  const measured = {
    method: typeof source.method === "string" ? source.method : "onset-rms-xcorr-v1",
    offsetSeconds,
    scale,
    confidence: unit(source.confidence),
    clarity: unit(source.clarity),
    residualMs: Math.max(0, number(source.residualMs, 0)),
    spreadMs: Math.max(0, number(source.spreadMs, 0)),
    localAgreement: unit(source.localAgreement),
    windows: Math.max(0, Math.round(number(source.windows, 0))),
    overlapSeconds: Math.max(0, number(source.overlapSeconds, 0))
  };
  const trusted = measured.confidence >= mlsmWaveformTrustThresholds.confidence
    && measured.clarity >= mlsmWaveformTrustThresholds.clarity
    && measured.localAgreement >= mlsmWaveformTrustThresholds.localAgreement
    && measured.windows >= mlsmWaveformTrustThresholds.windows;
  const alignment: MlsmWaveformAlignment = { ...measured, trusted, status: trusted ? "measured" : "ambiguous", detail: null, searchRadiusMs: 0 };
  return { ...alignment, searchRadiusMs: mlsmWaveformSearchRadiusMs(alignment) };
}

/** Overlay the two isolated vocals and measure the global time mapping.
 *
 * This runs before any transcript is consulted, so its result is the one piece
 * of timing evidence in the pipeline that Whisper and the LLM cannot skew. A
 * failure is never fatal: the caller keeps the transcript-only behaviour. */
export async function measureMlsmPostLipsyncWaveformAlignment(input: {
  sourceVocalPath: string;
  targetVocalPath: string;
  signal?: AbortSignal;
  onProgress?: (progress: number | null, message: string) => void;
}): Promise<MlsmWaveformAlignment> {
  input.onProgress?.(0, "Sovrapposizione delle onde sonore · misura di offset e rapporto di tempo");
  let result: unknown;
  if (!isTauri()) {
    const response = await fetchBrowserVocalService("/align-waveform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourcePath: input.sourceVocalPath, targetPath: input.targetVocalPath }),
      ...(input.signal ? { signal: input.signal } : {})
    }, "sovrapposizione delle onde sonore");
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Sovrapposizione delle onde non riuscita.");
    result = payload;
  } else {
    const started = await startSongPlayerJob({ kind: "alignWaveform", sourcePath: input.sourceVocalPath, targetPath: input.targetVocalPath });
    const terminal = isSongPlayerJobTerminal(started.status) ? started : await waitForSongPlayerJob(started.jobId, {
      ...(input.signal ? { signal: input.signal } : {}),
      onSnapshot: (snapshot) => input.onProgress?.(snapshot.progress ?? null, snapshot.message ?? "Sovrapposizione delle onde sonore")
    });
    if (terminal.status === "cancelled") throw new DOMException("Sovrapposizione delle onde annullata", "AbortError");
    if (terminal.status === "failed" || !terminal.result) throw new Error(typeof terminal.error === "string" ? terminal.error : terminal.error?.message ?? "Sovrapposizione delle onde non riuscita.");
    result = terminal.result;
  }
  const alignment = decodeMlsmWaveformAlignment(result);
  input.onProgress?.(1, alignment.trusted
    ? `Onde sovrapposte · scarto ${alignment.offsetSeconds.toFixed(3)} s · tempo ×${alignment.scale.toFixed(4)} · corrispondenza ${Math.round(alignment.confidence * 100)}%`
    : `Sovrapposizione non affidabile (corrispondenza ${Math.round(alignment.confidence * 100)}%, unicità ${Math.round(alignment.clarity * 100)}%) · restano i tempi del trascritto`);
  return alignment;
}
