import { create } from "zustand";
import type { AnalysisProgress, AudioAnalysisResult } from "@rbs/audio-analysis";
import type { SongPlayerAnalysis } from "../services/song-player-types";
interface AnalysisState { result: AudioAnalysisResult | null; resultsByHash: Record<string, AudioAnalysisResult>; songPlayerByHash: Record<string, SongPlayerAnalysis>; running: boolean; progress: AnalysisProgress | null; cached: boolean; error: string | null; start: () => void; updateProgress: (progress: AnalysisProgress) => void; complete: (result: AudioAnalysisResult, cached: boolean) => void; completeFor: (hash: string, result: AudioAnalysisResult, cached: boolean) => void; completeSongPlayer: (hash: string, analysis: SongPlayerAnalysis) => void; fail: (message: string) => void; reset: () => void; }
export const useAnalysisStore = create<AnalysisState>((set) => ({
  result: null, resultsByHash: {}, songPlayerByHash: {}, running: false, progress: null, cached: false, error: null,
  start: () => set({ running: true, progress: { stage: "features", progress: 0 }, error: null }), updateProgress: (progress) => set({ progress }),
  complete: (result, cached) => set((state) => ({ result, resultsByHash: { ...state.resultsByHash }, cached, running: false, progress: { stage: "complete", progress: 1 }, error: null })),
  completeFor: (hash, result, cached) => set((state) => ({ result, resultsByHash: { ...state.resultsByHash, [hash]: result }, cached, running: false, progress: { stage: "complete", progress: 1 }, error: null })),
  completeSongPlayer: (hash, analysis) => set((state) => ({ songPlayerByHash: { ...state.songPlayerByHash, [hash]: analysis } })),
  fail: (error) => set({ error, running: false }),
  reset: () => set({ result: null, resultsByHash: {}, songPlayerByHash: {}, running: false, progress: null, cached: false, error: null })
}));
