/** Shared by preview and export. FPS changes sampling, never playback speed. */
export function cleanReferenceTime(sourceElapsedSeconds: number, offsetSeconds: number, referenceDurationSeconds: number): number | null {
  const time = sourceElapsedSeconds + offsetSeconds;
  return Number.isFinite(time) && time >= 0 && time < referenceDurationSeconds ? time : null;
}
