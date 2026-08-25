import { create } from "zustand";
import type { ImportedAudio } from "../services/audio-import";

interface AudioState {
  imported: ImportedAudio | null; fullTrack: ImportedAudio | null; playbackSource: "fragment" | "fullTrack"; songPlayerSegmentOffsetSeconds: number; currentTime: number; playing: boolean; looping: boolean; loading: boolean; error: string | null; previewFps: number; droppedFrames: number; driftMs: number;
  setImported: (audio: ImportedAudio) => void; setFullTrack: (audio: ImportedAudio | null) => void; selectPlaybackSource: (source: "fragment" | "fullTrack") => void; setSongPlayerSegmentOffsetSeconds: (value: number) => void; setCurrentTime: (time: number) => void; setPlaying: (playing: boolean) => void;
  setLoading: (loading: boolean) => void; setLooping: (looping: boolean) => void; setDiagnostics: (fps: number, dropped: number, driftMs: number) => void; setError: (error: string | null) => void; reset: () => void;
}
export const useAudioStore = create<AudioState>((set, get) => ({
  imported: null, fullTrack: null, playbackSource: "fragment", songPlayerSegmentOffsetSeconds: 0, currentTime: 0, playing: false, looping: false, loading: false, error: null, previewFps: 0, droppedFrames: 0, driftMs: 0,
  setImported: (audio) => { const previous = get().imported?.url; if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous); set({ imported: audio, currentTime: 0, playing: false, loading: false, error: null }); },
  setFullTrack: (audio) => { const previous = get().fullTrack?.url; if (previous && previous !== audio?.url && previous.startsWith("blob:")) URL.revokeObjectURL(previous); set({ fullTrack: audio, playbackSource: "fragment", currentTime: 0, playing: false }); },
  selectPlaybackSource: (playbackSource) => set({ playbackSource, currentTime: 0, playing: false }),
  setSongPlayerSegmentOffsetSeconds: (songPlayerSegmentOffsetSeconds) => set({ songPlayerSegmentOffsetSeconds: Number.isFinite(songPlayerSegmentOffsetSeconds) ? songPlayerSegmentOffsetSeconds : 0 }),
  setCurrentTime: (currentTime) => set({ currentTime }), setPlaying: (playing) => set({ playing }), setLoading: (loading) => set({ loading }), setLooping: (looping) => set({ looping }),
  setDiagnostics: (previewFps, droppedFrames, driftMs) => set({ previewFps, droppedFrames, driftMs }),
  setError: (error) => set({ error, loading: false }), reset: () => { const previous = get().imported?.url; const fullTrack = get().fullTrack?.url; if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous); if (fullTrack?.startsWith("blob:")) URL.revokeObjectURL(fullTrack); set({ imported: null, fullTrack: null, playbackSource: "fragment", currentTime: 0, playing: false, loading: false, error: null }); }
}));
