import { create } from "zustand";
import type { AnalysisProgress, AudioAnalysisResult } from "@rbs/audio-analysis";
interface AnalysisState { result: AudioAnalysisResult | null; running: boolean; progress: AnalysisProgress | null; cached: boolean; error: string | null; start: () => void; updateProgress: (progress: AnalysisProgress) => void; complete: (result: AudioAnalysisResult, cached: boolean) => void; fail: (message: string) => void; reset: () => void; }
export const useAnalysisStore = create<AnalysisState>((set) => ({
  result: null, running: false, progress: null, cached: false, error: null,
  start: () => set({ running: true, progress: { stage: "features", progress: 0 }, error: null }), updateProgress: (progress) => set({ progress }),
  complete: (result, cached) => set({ result, cached, running: false, progress: { stage: "complete", progress: 1 }, error: null }), fail: (error) => set({ error, running: false }),
  reset: () => set({ result: null, running: false, progress: null, cached: false, error: null })
}));
