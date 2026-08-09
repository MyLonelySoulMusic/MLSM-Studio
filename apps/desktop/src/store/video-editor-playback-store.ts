import { create } from "zustand";

/**
 * Il Video Editor ha un proprio trasporto: la sua timeline non dipende dal brano
 * importato nelle altre modalità, quindi preview e timeline condividono qui il
 * playhead invece di passarlo attraverso l’intera applicazione.
 */
interface VideoEditorPlaybackState {
  currentTime: number;
  playing: boolean;
  looping: boolean;
  zoom: number;
  setCurrentTime: (timeSeconds: number) => void;
  setPlaying: (playing: boolean) => void;
  setLooping: (looping: boolean) => void;
  setZoom: (zoom: number) => void;
  stop: () => void;
}

export type VideoEditorTransportAction = "toggle" | "stop";
type VideoEditorTransportHandler = (action: VideoEditorTransportAction) => void;
const transportHandlers = new Set<VideoEditorTransportHandler>();

/**
 * Collega i comandi della timeline al monitor che possiede decoder e grafo audio.
 * Il callback è sincrono: `media.play()` resta dentro il gesto dell'utente e non
 * viene respinto dalle regole autoplay del browser.
 */
export function registerVideoEditorTransport(handler: VideoEditorTransportHandler): () => void {
  transportHandlers.add(handler);
  return () => transportHandlers.delete(handler);
}

export function requestVideoEditorTransport(action: VideoEditorTransportAction): void {
  if (transportHandlers.size) {
    for (const handler of transportHandlers) handler(action);
    return;
  }
  // Fallback utile durante il caricamento del monitor o nei test isolati.
  const state = useVideoEditorPlayback.getState();
  if (action === "stop") state.stop();
  else state.setPlaying(!state.playing);
}

export const useVideoEditorPlayback = create<VideoEditorPlaybackState>((set) => ({
  currentTime: 0,
  playing: false,
  looping: false,
  zoom: 1,
  setCurrentTime: (timeSeconds) => set({ currentTime: Math.max(0, timeSeconds) }),
  setPlaying: (playing) => set({ playing }),
  setLooping: (looping) => set({ looping }),
  setZoom: (zoom) => set({ zoom: Math.max(1, Math.min(24, zoom)) }),
  stop: () => set({ playing: false, currentTime: 0 })
}));
