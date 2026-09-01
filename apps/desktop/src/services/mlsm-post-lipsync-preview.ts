export interface LipsyncPreviewSize {
  width: number;
  height: number;
}

export interface LipsyncPreviewClockAdjustment {
  playbackRate: number;
  shouldSeek: boolean;
  shouldPlay: boolean;
}

/** A media element remains in the ended state until its clock is moved. Keep
 * pause/resume untouched, but make Play after the natural end equivalent to a
 * fresh playback from zero so the user never has to press Stop first. */
export function lipsyncPreviewStartTime(
  currentTime: number,
  duration: number,
  mediaEnded = false
): number {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrent = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  const atEnd = mediaEnded || safeDuration > 0 && safeCurrent >= safeDuration - .025;
  return atEnd ? 0 : Math.min(safeCurrent, safeDuration || safeCurrent);
}

/** Keeps the target master as clock without seeking the video on every frame.
 * Chromium can play muted video well above 4x; the previous 4x clamp forced a
 * seek on every animation frame for the 9.14x hard-gate segment and caused the
 * visible stutter. Small drift is absorbed continuously by playback rate and a
 * hard seek is reserved for a real clock discontinuity. Speeds outside the
 * native media-element range are sampled from the master clock instead: this
 * is essential for the 0.02x opening hold in the The Fallen reference. */
export function lipsyncPreviewClockAdjustment(
  segmentSpeed: number,
  currentSourceTime: number,
  expectedSourceTime: number
): LipsyncPreviewClockAdjustment {
  const safeSpeed = Number.isFinite(segmentSpeed) && segmentSpeed > 0 ? segmentSpeed : 1;
  const drift = Number.isFinite(expectedSourceTime - currentSourceTime) ? expectedSourceTime - currentSourceTime : 0;
  const shouldPlay = safeSpeed >= .0625 && safeSpeed <= 16;
  // Preview and offline export must show the same word boundary. A 400 ms
  // tolerance could hide almost half a lyric while the exported frame map was
  // already correct; 120 ms still avoids per-frame seeking but cannot mask a
  // visibly different phrase onset.
  const shouldSeek = !shouldPlay || Math.abs(drift) > .12;
  const correction = shouldSeek ? 0 : Math.max(-.3, Math.min(.3, drift * 1.5));
  return { playbackRate: Math.max(.0625, Math.min(16, safeSpeed + correction)), shouldSeek, shouldPlay };
}

export function fitLipsyncPreview(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number
): LipsyncPreviewSize | null {
  if (![containerWidth, containerHeight, videoWidth, videoHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight);
  return { width: videoWidth * scale, height: videoHeight * scale };
}
