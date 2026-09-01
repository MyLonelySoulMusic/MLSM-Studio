/** Builds a compact amplitude envelope for the selected master-audio window.
 * Imported waveforms contain interleaved minimum/maximum pairs. The returned
 * values are normalized amplitudes, ready to render as vertical bars. */
export function lipsyncMasterWaveformBars(
  waveform: readonly number[],
  masterDurationSeconds: number,
  windowStartSeconds: number,
  windowDurationSeconds: number,
  barCount = 240
): number[] {
  const sourceColumns = Math.floor(waveform.length / 2);
  const count = Math.max(1, Math.floor(barCount));
  if (sourceColumns <= 0 || !Number.isFinite(masterDurationSeconds) || masterDurationSeconds <= 0 || !Number.isFinite(windowDurationSeconds) || windowDurationSeconds <= 0) {
    return Array.from({ length: count }, () => 0);
  }
  const startRatio = Math.max(0, Math.min(1, windowStartSeconds / masterDurationSeconds));
  const endRatio = Math.max(startRatio, Math.min(1, (windowStartSeconds + windowDurationSeconds) / masterDurationSeconds));
  const from = Math.min(sourceColumns - 1, Math.floor(startRatio * sourceColumns));
  const to = Math.max(from + 1, Math.min(sourceColumns, Math.ceil(endRatio * sourceColumns)));
  const span = to - from;
  return Array.from({ length: count }, (_, barIndex) => {
    const bucketStart = from + Math.floor(barIndex / count * span);
    const bucketEnd = Math.max(bucketStart + 1, from + Math.ceil((barIndex + 1) / count * span));
    let amplitude = 0;
    for (let column = bucketStart; column < Math.min(to, bucketEnd); column += 1) {
      amplitude = Math.max(amplitude, Math.abs(waveform[column * 2] ?? 0), Math.abs(waveform[column * 2 + 1] ?? 0));
    }
    return Math.max(0, Math.min(1, amplitude));
  });
}

/** Standard timeline selection: click selects one word, Cmd/Ctrl toggles words,
 * and Shift selects the whole canonical range from the last focused word. */
export function selectLipsyncTimelineWords(input: {
  selected: readonly number[];
  clicked: number;
  lastFocused: number | null;
  additive?: boolean;
  range?: boolean;
}): number[] {
  const current = new Set(input.selected);
  if (input.range && input.lastFocused !== null) {
    const start = Math.min(input.lastFocused, input.clicked);
    const end = Math.max(input.lastFocused, input.clicked);
    if (!input.additive) current.clear();
    for (let index = start; index <= end; index += 1) current.add(index);
  } else if (input.additive) {
    if (current.has(input.clicked)) current.delete(input.clicked); else current.add(input.clicked);
  } else {
    current.clear(); current.add(input.clicked);
  }
  return [...current].sort((left, right) => left - right);
}

export type LipsyncTimelineEditMode = "move" | "resize-start" | "resize-end";

/** Applies an NLE-style edit to the output/master side of one or more word
 * clips. The source performance stays untouched: moving right delays the lip
 * action, moving left anticipates it, and resizing changes its retimed output
 * duration. Group moves are clamped as one rigid block. */
export function editLipsyncTimelineAnchors(input: {
  anchors: readonly WordAnchor[];
  canonicalIndexes: readonly number[];
  mode: LipsyncTimelineEditMode;
  deltaSeconds: number;
  targetDurationSeconds: number;
}): WordAnchor[] {
  if (!Number.isFinite(input.deltaSeconds) || !Number.isFinite(input.targetDurationSeconds) || input.targetDurationSeconds <= 0) throw new Error("Modifica timeline non valida.");
  const selected = new Set(input.canonicalIndexes);
  const ordered = [...input.anchors].sort((left, right) => left.canonicalIndex - right.canonicalIndex);
  const moving = ordered.filter((anchor) => selected.has(anchor.canonicalIndex));
  if (!moving.length) return [...input.anchors];
  const minimumDuration = .02;
  let delta = input.deltaSeconds;

  if (input.mode === "move") {
    let minimumDelta = -Math.min(...moving.map((anchor) => anchor.targetStart));
    let maximumDelta = input.targetDurationSeconds - Math.max(...moving.map((anchor) => anchor.targetEnd));
    for (const anchor of moving) {
      const index = ordered.findIndex((candidate) => candidate.id === anchor.id);
      const previous = ordered[index - 1]; const following = ordered[index + 1];
      if (previous && !selected.has(previous.canonicalIndex)) minimumDelta = Math.max(minimumDelta, previous.targetEnd - anchor.targetStart);
      if (following && !selected.has(following.canonicalIndex)) maximumDelta = Math.min(maximumDelta, following.targetStart - anchor.targetEnd);
    }
    delta = Math.max(minimumDelta, Math.min(maximumDelta, delta));
  }

  const edited = ordered.map((anchor, index) => {
    if (!selected.has(anchor.canonicalIndex)) return anchor;
    let targetStart = anchor.targetStart; let targetEnd = anchor.targetEnd;
    if (input.mode === "move") { targetStart += delta; targetEnd += delta; }
    if (input.mode === "resize-start") {
      const previous = ordered[index - 1]; const minimum = previous ? previous.targetEnd : 0;
      targetStart = Math.max(minimum, Math.min(targetEnd - minimumDuration, targetStart + delta));
    }
    if (input.mode === "resize-end") {
      const following = ordered[index + 1]; const maximum = following ? following.targetStart : input.targetDurationSeconds;
      targetEnd = Math.min(maximum, Math.max(targetStart + minimumDuration, targetEnd + delta));
    }
    return {
      ...anchor,
      targetStart,
      targetCenter: (targetStart + targetEnd) / 2,
      targetEnd,
      locked: false,
      origin: "manual" as const,
      manuallyEdited: true,
      confidenceBand: "high" as const
    };
  });
  for (let index = 1; index < edited.length; index += 1) {
    const previous = edited[index - 1]!; const current = edited[index]!;
    if (current.targetStart < previous.targetEnd - 1e-6 || current.targetCenter <= previous.targetCenter) throw new Error("Le parole editate non possono sovrapporsi.");
  }
  const byId = new Map(edited.map((anchor) => [anchor.id, anchor]));
  return input.anchors.map((anchor) => byId.get(anchor.id) ?? anchor);
}
import type { WordAnchor } from "./mlsm-post-lipsync-types";
