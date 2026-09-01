import { replaceMlsmPostLipsyncAnchors } from "./mlsm-post-lipsync-analysis";
import type { MlsmPostLipsyncAnalysis, WordAnchor } from "./mlsm-post-lipsync-types";
import { fetchBrowserVocalService } from "./cassette-desk-vocals-browser";
import { isSongPlayerJobTerminal, startSongPlayerJob, waitForSongPlayerJob, type SongPlayerRefineAnchorRequest } from "./song-player-native";
import { isTauri } from "@tauri-apps/api/core";

export interface RefinedAnchorResult {
  id: string;
  sourceStart?: number;
  sourceCenter: number;
  sourceEnd?: number;
  targetStart?: number;
  targetShiftMs?: number;
  targetConfidence?: number;
  shiftMs: number;
  confidence: number;
  method: string;
}
const batchSize = 128;

function decode(value: unknown): RefinedAnchorResult[] {
  if (!value || typeof value !== "object") throw new Error("Micro allineamento: risposta non valida.");
  const source = value as Record<string, unknown>;
  if (source.kind !== "refineAlignment" || !Array.isArray(source.anchors)) throw new Error("Micro allineamento: lista anchor assente.");
  return source.anchors.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    return typeof item.id === "string" && typeof item.sourceCenter === "number" && Number.isFinite(item.sourceCenter)
      && typeof item.shiftMs === "number" && Number.isFinite(item.shiftMs) && typeof item.confidence === "number" && Number.isFinite(item.confidence)
      && typeof item.method === "string"
      ? [{
        id: item.id,
        ...(typeof item.sourceStart === "number" && Number.isFinite(item.sourceStart) ? { sourceStart: item.sourceStart } : {}),
        sourceCenter: item.sourceCenter,
        ...(typeof item.sourceEnd === "number" && Number.isFinite(item.sourceEnd) ? { sourceEnd: item.sourceEnd } : {}),
        ...(typeof item.targetStart === "number" && Number.isFinite(item.targetStart) ? { targetStart: item.targetStart } : {}),
        ...(typeof item.targetShiftMs === "number" && Number.isFinite(item.targetShiftMs) ? { targetShiftMs: item.targetShiftMs } : {}),
        ...(typeof item.targetConfidence === "number" && Number.isFinite(item.targetConfidence) ? { targetConfidence: Math.max(0, Math.min(1, item.targetConfidence)) } : {}),
        shiftMs: item.shiftMs,
        confidence: Math.max(0, Math.min(1, item.confidence)),
        method: item.method
      }]
      : [];
  });
}

function request(anchor: WordAnchor, maxShiftMs: number, targetAudioStartSeconds: number): SongPlayerRefineAnchorRequest {
  return {
    id: anchor.id,
    cueIndex: anchor.cueIndex,
    sourceStart: anchor.sourceStart,
    sourceCenter: anchor.sourceCenter,
    sourceEnd: anchor.sourceEnd,
    targetStart: anchor.targetStart + targetAudioStartSeconds,
    targetCenter: anchor.targetCenter + targetAudioStartSeconds,
    targetEnd: anchor.targetEnd + targetAudioStartSeconds,
    maxShiftMs
  };
}

export function applyMlsmPostLipsyncRefinements(
  anchors: readonly WordAnchor[],
  refinements: ReadonlyMap<string, RefinedAnchorResult>,
  targetAudioStartSeconds = 0,
  options: { allowBidirectionalTargetOnset?: boolean } = {}
): WordAnchor[] {
  const output: WordAnchor[] = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index]!;
    if (anchor.locked || anchor.manuallyEdited) { output.push(anchor); continue; }
    const refinement = refinements.get(anchor.id);
    if (!refinement || refinement.method !== "mfcc-dtw-v1" && refinement.method !== "phrase-dtw-v2" && refinement.method !== "mfcc-dtw-unresolved") { output.push(anchor); continue; }
    let appliesSource = refinement.confidence >= .45 && refinement.method !== "mfcc-dtw-unresolved";
    const proposedTargetStart = refinement.targetStart === undefined ? anchor.targetStart : refinement.targetStart - targetAudioStartSeconds;
    const targetShift = proposedTargetStart - anchor.targetStart;
    const appliesTarget = (refinement.targetConfidence ?? 0) >= (options.allowBidirectionalTargetOnset ? .68 : .6)
      && (options.allowBidirectionalTargetOnset ? Math.abs(targetShift) > 1e-6 : targetShift > 1e-6)
      && proposedTargetStart < anchor.targetCenter - .001;
    if (!appliesSource && !appliesTarget) { output.push(anchor); continue; }
    const previous = output.at(-1);
    const following = anchors[index + 1];
    const minimum = previous ? previous.sourceCenter + .015 : 0;
    const maximum = following ? following.sourceCenter - .015 : Number.POSITIVE_INFINITY;
    if (appliesSource && (refinement.sourceCenter <= minimum || refinement.sourceCenter >= maximum)) appliesSource = false;
    const sourceCenter = appliesSource ? refinement.sourceCenter : anchor.sourceCenter;
    const shift = sourceCenter - anchor.sourceCenter;
    if (!Number.isFinite(sourceCenter)) { output.push(anchor); continue; }
    const sourceStart = appliesSource
      ? refinement.sourceStart === undefined ? Math.max(0, anchor.sourceStart + shift) : Math.max(0, Math.min(sourceCenter, refinement.sourceStart))
      : anchor.sourceStart;
    const sourceEnd = appliesSource
      ? refinement.sourceEnd === undefined ? Math.max(sourceCenter, anchor.sourceEnd + shift) : Math.max(sourceCenter, refinement.sourceEnd)
      : anchor.sourceEnd;
    const minimumTargetStart = previous ? previous.targetEnd : 0;
    const targetStart = appliesTarget ? Math.max(minimumTargetStart, Math.min(anchor.targetCenter - .001, proposedTargetStart)) : anchor.targetStart;
    if (Math.abs(shift) < 1e-6 && Math.abs(sourceStart - anchor.sourceStart) < 1e-6 && Math.abs(sourceEnd - anchor.sourceEnd) < 1e-6 && Math.abs(targetStart - anchor.targetStart) < 1e-6) { output.push(anchor); continue; }
    output.push({
      ...anchor,
      sourceStart,
      sourceCenter,
      sourceEnd,
      targetStart,
      evidence: {
        ...anchor.evidence,
        sequenceMargin: Math.max(anchor.evidence.sequenceMargin, refinement.confidence * .8, (refinement.targetConfidence ?? 0) * .8),
        audioRefinement: {
          method: refinement.method,
          shiftMs: refinement.shiftMs + (refinement.targetShiftMs ?? 0),
          confidence: Math.max(refinement.confidence, refinement.targetConfidence ?? 0)
        }
      }
    });
  }
  // A refinement batch is atomic: never keep a proposal set that reverses two
  // words. The previous implementation clamped every proposal against stale
  // neighbours and could silently turn “asked me” into an inverted path.
  if (output.some((anchor, index) => index > 0 && (anchor.sourceCenter <= output[index - 1]!.sourceCenter + .001 || anchor.targetCenter <= output[index - 1]!.targetCenter + .001))) return [...anchors];
  return output;
}

export async function refineMlsmPostLipsyncAlignment(input: {
  analysis: MlsmPostLipsyncAnalysis;
  sourceVocalPath: string;
  targetVocalPath: string;
  maxShiftMs?: number;
  detailedTiming?: boolean;
  focusCanonicalIndexes?: readonly number[];
  signal?: AbortSignal;
  onProgress?: (progress: number | null, message: string) => void;
}): Promise<MlsmPostLipsyncAnalysis> {
  const focused = new Set(input.focusCanonicalIndexes ?? []);
  const isRecoveryAnchor = (anchor: WordAnchor) => anchor.sourceConfidence < .5 || focused.has(anchor.canonicalIndex);
  const needsPhraseRecovery = input.analysis.anchors.some(isRecoveryAnchor);
  // Degenerate Whisper timing needs the same subtitle-constrained, phrase-wide
  // MFCC/DTW recovery used by the original successful prototype. Keep it in a
  // separate worker request: one recovered opening must not give the already
  // reliable words (for example "Still loves me") a 30-second search radius.
  const reliableMaxShiftMs = input.maxShiftMs ?? (input.detailedTiming ? 350 : 50);
  const recoveryMaxShiftMs = input.maxShiftMs ?? Math.min(30_000, input.analysis.sourceDurationSeconds * 1_000);
  const groups = needsPhraseRecovery ? [
    { label: "parole misurate", maxShiftMs: reliableMaxShiftMs, anchors: input.analysis.anchors.filter((anchor) => !isRecoveryAnchor(anchor)) },
    { label: focused.size ? "revisione fonetica/MFCC mirata" : "parole recuperate", maxShiftMs: recoveryMaxShiftMs, anchors: input.analysis.anchors.filter(isRecoveryAnchor) }
  ] : [{ label: "parole misurate", maxShiftMs: reliableMaxShiftMs, anchors: [...input.analysis.anchors] }];
  const jobs = groups.flatMap((group) => Array.from({ length: Math.ceil(group.anchors.length / batchSize) }, (_, batchIndex) => ({
    label: group.label,
    maxShiftMs: group.maxShiftMs,
    anchors: group.anchors.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize)
  })));
  const refinements = new Map<string, RefinedAnchorResult>();
  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
    if (input.signal?.aborted) throw new DOMException("Micro allineamento annullato", "AbortError");
    const job = jobs[jobIndex]!;
    const targetStemOffsetSeconds = input.analysis.targetAudioStartSeconds - input.analysis.targetAnalysisStartSeconds;
    const anchors = job.anchors.map((anchor) => request(anchor, job.maxShiftMs, targetStemOffsetSeconds));
    let result: unknown;
    if (!isTauri()) {
      input.onProgress?.(jobIndex / Math.max(1, jobs.length), `Micro allineamento browser · ${job.label} · ${jobIndex + 1}/${jobs.length}`);
      const response = await fetchBrowserVocalService("/refine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: input.sourceVocalPath, targetPath: input.targetVocalPath, anchors, maxShiftMs: job.maxShiftMs }), ...(input.signal ? { signal: input.signal } : {}) }, "micro-allineamento MFCC/DTW");
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Micro allineamento browser non riuscito.");
      result = payload;
    } else {
      const started = await startSongPlayerJob({ kind: "refineAlignment", sourcePath: input.sourceVocalPath, targetPath: input.targetVocalPath, anchors });
      const terminal = isSongPlayerJobTerminal(started.status) ? started : await waitForSongPlayerJob(started.jobId, {
        ...(input.signal ? { signal: input.signal } : {}),
        onSnapshot: (snapshot) => {
          const child = snapshot.progress ?? 0;
          input.onProgress?.((jobIndex + child) / Math.max(1, jobs.length), snapshot.message ?? `Micro allineamento · ${job.label} · ${jobIndex + 1}/${jobs.length}`);
        }
      });
      if (terminal.status === "cancelled") throw new DOMException("Micro allineamento annullato", "AbortError");
      if (terminal.status === "failed" || !terminal.result) throw new Error(typeof terminal.error === "string" ? terminal.error : terminal.error?.message ?? "Micro allineamento non riuscito.");
      result = terminal.result;
    }
    for (const item of decode(result)) refinements.set(item.id, item);
  }
  input.onProgress?.(1, "Micro allineamento MFCC/DTW completato");
  const targetStemOffsetSeconds = input.analysis.targetAudioStartSeconds - input.analysis.targetAnalysisStartSeconds;
  return replaceMlsmPostLipsyncAnchors(input.analysis, applyMlsmPostLipsyncRefinements(input.analysis.anchors, refinements, targetStemOffsetSeconds, { allowBidirectionalTargetOnset: input.detailedTiming === true }));
}
