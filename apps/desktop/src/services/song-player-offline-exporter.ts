import type { ExportProgress } from "@rbs/export-engine";
import { exportOfflineSceneVideo, offlineFrameCount, offlineFrameTiming, type SharedViewportRenderer, type ExportQuality } from "./offline-video-exporter";
import type { SongPlayerPlaybackRange } from "./song-player-playback";

export interface SongPlayerOfflineExportSettings { width: number; height: number; fps: number; playbackRange: SongPlayerPlaybackRange; fragmentAudioUrl: string; aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5" | "custom"; projectName: string; quality: ExportQuality; renderer: SharedViewportRenderer & { prepare?: () => Promise<void> }; }
export interface SongPlayerOfflineExportResult { fileName: string; width: number; height: number; fps: number; encodedFrameCount: number; audioSource: { sourceUrl: string; durationSeconds: number }; audioPacketCount: number; }
export function songPlayerFragmentAudioSource(settings: Pick<SongPlayerOfflineExportSettings, "fragmentAudioUrl">): string { if (!settings.fragmentAudioUrl) throw new Error("Frammento audio assente per l’export Song Player."); return settings.fragmentAudioUrl; }
export function songPlayerOfflineFrameCount(durationSeconds: number, fps: number): number { return offlineFrameCount(durationSeconds, fps); }
export function songPlayerOfflineFrameTiming(frameIndex: number, durationSeconds: number, fps: number) { return offlineFrameTiming(frameIndex, durationSeconds, fps); }
export async function exportSongPlayerOfflineVideo(settings: SongPlayerOfflineExportSettings, signal: AbortSignal, onProgress?: (progress: ExportProgress) => void): Promise<SongPlayerOfflineExportResult> {
  songPlayerFragmentAudioSource(settings);
  await settings.renderer.prepare?.(); if (signal.aborted) throw new DOMException("Export annullato", "AbortError");
  const durationSeconds = settings.playbackRange.durationSeconds;
  const totalFrames = offlineFrameCount(durationSeconds, settings.fps);
  const background = { colors: ["#050611", "#15132a"] as [string, string], imageUrl: null, mediaType: "image" as const, presetId: "gradient" as const, finish: "clean" as const, opacity: 1, blur: 0, effects: { glow: false, particles: false, vignette: false }, neon: { enabled: false, text: "", color: "#fff" } };
  const ball = { radius: .4, color: "#fff", emission: 0, metalness: 0, trailEnabled: false, innerColor: "#fff", innerShape: "orb" as const, innerImageUrl: null, endRevealEnabled: false, revealMode: "end" as const, revealTimeSeconds: 0, revealHoldSeconds: 0 };
  const result = await exportOfflineSceneVideo({ width: settings.width, height: settings.height, fps: settings.fps, durationSeconds, projectName: settings.projectName, quality: settings.quality, sourceUrl: settings.fragmentAudioUrl, sourceDuration: durationSeconds, aspectRatio: settings.aspectRatio ?? (settings.width * 16 === settings.height * 9 ? "9:16" : settings.width * 9 === settings.height * 16 ? "16:9" : settings.width === settings.height ? "1:1" : settings.width * 5 === settings.height * 4 ? "4:5" : "custom"), background, ball }, settings.renderer, () => undefined, signal, (progress) => onProgress?.(progress));
  return { fileName: result.fileName, width: result.width, height: result.height, fps: result.fps, encodedFrameCount: result.encodedFrameCount || totalFrames, audioSource: { sourceUrl: settings.fragmentAudioUrl, durationSeconds }, audioPacketCount: result.audioPacketCount };
}
