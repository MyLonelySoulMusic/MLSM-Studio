import { create } from "zustand";
import type { ImportedAudio } from "../services/audio-import";

interface AudioState {
  imported: ImportedAudio | null; currentTime: number; playing: boolean; looping: boolean; loading: boolean; error: string | null; previewFps: number; droppedFrames: number; driftMs: number;
  setImported: (audio: ImportedAudio) => void; setCurrentTime: (time: number) => void; setPlaying: (playing: boolean) => void;
  setLoading: (loading: boolean) => void; setLooping: (looping: boolean) => void; setDiagnostics: (fps: number, dropped: number, driftMs: number) => void; setError: (error: string | null) => void; reset: () => void;
}
export const useAudioStore = create<AudioState>((set, get) => ({
  imported: null, currentTime: 0, playing: false, looping: false, loading: false, error: null, previewFps: 0, droppedFrames: 0, driftMs: 0,
  setImported: (audio) => { const previous = get().imported?.url; if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous); set({ imported: audio, currentTime: 0, playing: false, loading: false, error: null }); },
  setCurrentTime: (currentTime) => set({ currentTime }), setPlaying: (playing) => set({ playing }), setLoading: (loading) => set({ loading }), setLooping: (looping) => set({ looping }),
  setDiagnostics: (previewFps, droppedFrames, driftMs) => set({ previewFps, droppedFrames, driftMs }),
  setError: (error) => set({ error, loading: false }), reset: () => { const previous = get().imported?.url; if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous); set({ imported: null, currentTime: 0, playing: false, loading: false, error: null }); }
}));
