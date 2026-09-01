import { lipsyncTargetToSource } from "./mlsm-post-lipsync-time-map";
import type { LipsyncRenderPlan, LipsyncTimeMap } from "./mlsm-post-lipsync-types";

function finitePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} deve essere un numero positivo.`);
}

/**
 * Produces the canonical target-timeline sampling contract used by preview and
 * offline export. It never advances time cumulatively: every sample is derived
 * independently from the inverse time map, preventing long-export drift.
 */
export function buildLipsyncRenderPlan(input: {
  timeMap: LipsyncTimeMap;
  sourceFps: number;
  outputFps: number;
  targetStart?: number;
  targetEnd?: number;
  targetAudioStartSeconds?: number;
}): LipsyncRenderPlan {
  finitePositive("FPS sorgente", input.sourceFps);
  finitePositive("FPS output", input.outputFps);
  const targetStart = input.targetStart ?? 0;
  const targetEnd = input.targetEnd ?? input.timeMap.targetDurationSeconds;
  if (!Number.isFinite(targetStart) || !Number.isFinite(targetEnd) || targetStart < 0 || targetEnd <= targetStart || targetEnd > input.timeMap.targetDurationSeconds + 1e-9) {
    throw new Error("Intervallo target non valido per il render MLSM POST LIPSYNC.");
  }
  const duration = targetEnd - targetStart;
  const sampleCount = Math.max(1, Math.ceil(duration * input.outputFps));
  const samples = Array.from({ length: sampleCount }, (_, outputFrameIndex) => {
    const relativeTargetTime = outputFrameIndex / input.outputFps;
    const targetTime = Math.min(targetEnd, targetStart + relativeTargetTime);
    const sourceTime = lipsyncTargetToSource(input.timeMap, targetTime);
    const exactSourceFrame = Math.max(0, sourceTime * input.sourceFps);
    const sourceFrameLeft = Math.floor(exactSourceFrame);
    const sourceFrameRight = Math.ceil(exactSourceFrame);
    const sourceBlend = exactSourceFrame - sourceFrameLeft;
    const nextTargetTime = Math.min(targetEnd, targetStart + (outputFrameIndex + 1) / input.outputFps);
    const segment = input.timeMap.segments.find((candidate) => targetTime >= candidate.targetStart - 1e-9 && targetTime <= candidate.targetEnd + 1e-9);
    return {
      outputFrameIndex,
      targetTime,
      sourceTime,
      sourceFrameLeft,
      sourceFrameRight,
      sourceBlend,
      durationSeconds: nextTargetTime - targetTime,
      requiresInterpolation: Boolean(segment?.requiresInterpolation)
    };
  });
  const targetAudioStartSeconds = input.targetAudioStartSeconds ?? 0;
  if (!Number.isFinite(targetAudioStartSeconds) || targetAudioStartSeconds < 0) throw new Error("Offset audio target non valido per il render MLSM POST LIPSYNC.");
  return { sourceFps: input.sourceFps, outputFps: input.outputFps, targetStart, targetEnd, targetAudioStartSeconds, targetAudioEndSeconds: targetAudioStartSeconds + duration, outputDurationSeconds: duration, samples };
}

export function auditLipsyncRenderPlan(plan: LipsyncRenderPlan): { valid: boolean; durationErrorSeconds: number; monotonic: boolean } {
  const composedDuration = plan.samples.reduce((total, sample) => total + sample.durationSeconds, 0);
  const monotonic = plan.samples.every((sample, index) => index === 0 || sample.targetTime > plan.samples[index - 1]!.targetTime);
  const durationErrorSeconds = Math.abs(composedDuration - plan.outputDurationSeconds);
  return { valid: monotonic && durationErrorSeconds <= 1e-9, durationErrorSeconds, monotonic };
}
