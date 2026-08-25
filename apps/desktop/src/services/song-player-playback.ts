export interface SongPlayerPlaybackRange { startSeconds: number; endSeconds: number; durationSeconds: number; }
export function songPlayerPlaybackRange(offsetSeconds: number, fragmentDurationSeconds: number, fullTrackDurationSeconds: number): SongPlayerPlaybackRange {
  const safeFragmentDuration = Number.isFinite(fragmentDurationSeconds) ? fragmentDurationSeconds : 0;
  const safeFullTrackDuration = Number.isFinite(fullTrackDurationSeconds) ? fullTrackDurationSeconds : 0;
  const duration = Math.max(0, Math.min(safeFragmentDuration, safeFullTrackDuration));
  const start = Math.max(0, Math.min(Number.isFinite(offsetSeconds) ? offsetSeconds : 0, Math.max(0, safeFullTrackDuration - duration)));
  return { startSeconds: start, endSeconds: start + duration, durationSeconds: duration };
}
export function songPlayerPersistedOffsetMs(offsetMs: number, fragmentDurationSeconds: number, fullTrackDurationSeconds: number | null): number {
  if (fullTrackDurationSeconds === null) return Math.max(0, Math.min(7_200_000, Math.round(Number.isFinite(offsetMs) ? offsetMs : 0)));
  return Math.round(songPlayerPlaybackRange(offsetMs / 1000, fragmentDurationSeconds, fullTrackDurationSeconds).startSeconds * 1000);
}
export function songPlayerMediaTime(localTimeSeconds: number, range: SongPlayerPlaybackRange): number { return range.startSeconds + Math.max(0, Math.min(range.durationSeconds, localTimeSeconds)); }
export function songPlayerLocalTime(mediaTimeSeconds: number, range: SongPlayerPlaybackRange): number { return Math.max(0, Math.min(range.durationSeconds, mediaTimeSeconds - range.startSeconds)); }
