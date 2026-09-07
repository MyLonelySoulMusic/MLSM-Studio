import { create } from "zustand";
import { beginTask } from "../services/task-history";
import type { ExportProgress, ExportProgressPhase } from "@rbs/export-engine";

interface ExportState {
  open: boolean;
  running: boolean;
  progress: number;
  currentFrame: number;
  totalFrames: number;
  phase: ExportProgressPhase;
  phaseLabel: string | null;
  stageProgress: number | null;
  stageCurrentFrame: number;
  stageTotalFrames: number;
  processedBytes: number;
  totalBytes: number;
  indeterminate: boolean;
  elapsedMs: number;
  estimatedRemainingMs: number;
  error: string | null;
  controller: AbortController | null;
  show: () => void;
  hide: () => void;
  start: (controller: AbortController) => void;
  update: (progress: ExportProgress | number, currentFrame?: number, totalFrames?: number) => void;
  complete: () => void;
  fail: (error: string) => void;
  cancel: () => void;
}

const initialProgress = {
  progress: 0,
  currentFrame: 0,
  totalFrames: 0,
  phase: "preparing" as ExportProgressPhase,
  phaseLabel: null,
  stageProgress: 0,
  stageCurrentFrame: 0,
  stageTotalFrames: 0,
  processedBytes: 0,
  totalBytes: 0,
  indeterminate: false,
  elapsedMs: 0,
  estimatedRemainingMs: 0
};

let finishHistory: ReturnType<typeof beginTask> | null = null;

export const useExportStore = create<ExportState>((set, get) => ({
  open: false,
  running: false,
  ...initialProgress,
  error: null,
  controller: null,
  show: () => set({ open: true, error: null, ...(get().running ? {} : initialProgress) }),
  hide: () => { if (!get().running) set({ open: false }); },
  start: (controller) => { finishHistory?.("interrupted"); finishHistory = beginTask("Video export"); set({ open: true, running: true, controller, error: null, ...initialProgress }); },
  update: (value, currentFrame, totalFrames) => {
    const progress: ExportProgress = typeof value === "number"
      ? { progress: value, currentFrame: currentFrame ?? 0, totalFrames: totalFrames ?? 0, elapsedMs: 0, estimatedRemainingMs: 0 }
      : value;
    set({
      progress: Math.max(0, Math.min(1, progress.progress)),
      currentFrame: progress.currentFrame,
      totalFrames: progress.totalFrames,
      phase: progress.phase ?? "rendering",
      phaseLabel: progress.phaseLabel ?? null,
      stageProgress: progress.stageProgress === undefined ? progress.progress : progress.stageProgress,
      stageCurrentFrame: progress.stageCurrentFrame ?? progress.currentFrame,
      stageTotalFrames: progress.stageTotalFrames ?? progress.totalFrames,
      processedBytes: progress.processedBytes ?? 0,
      totalBytes: progress.totalBytes ?? 0,
      indeterminate: progress.indeterminate === true,
      elapsedMs: progress.elapsedMs,
      estimatedRemainingMs: progress.estimatedRemainingMs
    });
  },
  complete: () => { finishHistory?.("completed"); finishHistory = null; set({ running: false, controller: null, progress: 1, phase: "complete", phaseLabel: null, stageProgress: 1, indeterminate: false }); },
  fail: (error) => { finishHistory?.(get().phase === "cancelled" ? "cancelled" : "failed", error); finishHistory = null; set((state) => ({ running: false, controller: null, phase: state.phase === "cancelled" ? "cancelled" : "error", phaseLabel: null, error })); },
  cancel: () => { get().controller?.abort(); set({ phase: "cancelled", phaseLabel: null }); }
}));
