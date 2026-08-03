export const DEFAULT_TIMELINE_HEIGHT = 270;
export const MIN_TIMELINE_HEIGHT = 150;
export const MIN_WORKSPACE_HEIGHT = 220;
const FIXED_APP_HEIGHT = 84;

export function clampTimelineHeight(height: number, viewportHeight: number): number {
  const maximum = Math.max(MIN_TIMELINE_HEIGHT, Math.floor(viewportHeight - FIXED_APP_HEIGHT - MIN_WORKSPACE_HEIGHT));
  const requested = Number.isFinite(height) ? height : DEFAULT_TIMELINE_HEIGHT;
  return Math.round(Math.max(MIN_TIMELINE_HEIGHT, Math.min(maximum, requested)));
}

export function parseTimelineHeight(value: string | null, viewportHeight: number): number {
  const parsed = value === null ? DEFAULT_TIMELINE_HEIGHT : Number(value);
  return clampTimelineHeight(parsed, viewportHeight);
}
