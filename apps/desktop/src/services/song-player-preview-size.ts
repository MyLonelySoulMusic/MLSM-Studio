import type { RhythmBallProject } from "@rbs/project-schema";

type SongPlayerAspectRatio = RhythmBallProject["canvas"]["aspectRatio"];
export interface SongPlayerPreviewFrame { cssWidth: number; cssHeight: number; pixelWidth: number; pixelHeight: number; sourceWidth: number; sourceHeight: number; }

export function fitSongPlayerPreviewFrame(containerWidth: number, containerHeight: number, aspectRatio: SongPlayerAspectRatio, customWidth = 1, customHeight = 1, devicePixelRatio = 1): SongPlayerPreviewFrame {
  const presets: Partial<Record<SongPlayerAspectRatio, readonly [number, number]>> = { "9:16": [9, 16], "16:9": [16, 9], "1:1": [1, 1], "4:5": [4, 5] };
  const [sourceWidth, sourceHeight] = presets[aspectRatio] ?? [Math.max(1, customWidth), Math.max(1, customHeight)];
  const safeWidth = Math.max(1, containerWidth); const safeHeight = Math.max(1, containerHeight); const scale = Math.min(safeWidth / sourceWidth, safeHeight / sourceHeight); const cssWidth = sourceWidth * scale; const cssHeight = sourceHeight * scale; const dpr = Math.max(1, devicePixelRatio);
  return { cssWidth, cssHeight, pixelWidth: Math.max(1, Math.round(cssWidth * dpr)), pixelHeight: Math.max(1, Math.round(cssHeight * dpr)), sourceWidth, sourceHeight };
}
