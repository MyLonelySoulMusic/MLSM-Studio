export const VIDEO_EDITOR_WORKSPACE_LAYOUT_KEY = "dynamic-sound-animation-studio.video-editor.workspace-layout.v2";
export const DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH = 360;
export const MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH = 280;
export const MAX_VIDEO_EDITOR_LEFT_DOCK_WIDTH = 600;
export const VIDEO_EDITOR_CENTER_MIN_WIDTH = 420;
export const VIDEO_EDITOR_INSPECTOR_WIDTH = 264;
export const VIDEO_EDITOR_RESIZE_HANDLE_WIDTH = 14;

/** Below this width the library becomes a deliberate overlay drawer. */
export const VIDEO_EDITOR_INLINE_LAYOUT_MIN_WIDTH =
  MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH + VIDEO_EDITOR_RESIZE_HANDLE_WIDTH + VIDEO_EDITOR_CENTER_MIN_WIDTH;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * A compact window uses an overlay drawer so the preview never becomes a
 * sliver.  The drawer still keeps the user's preferred width; CSS limits its
 * visible extent to the window.
 */
export function videoEditorUsesLeftDockDrawer(workspaceWidth: number): boolean {
  return !Number.isFinite(workspaceWidth) || workspaceWidth < VIDEO_EDITOR_INLINE_LAYOUT_MIN_WIDTH;
}

export function videoEditorLeftDockMaxWidth(workspaceWidth: number): number {
  if (videoEditorUsesLeftDockDrawer(workspaceWidth)) return MAX_VIDEO_EDITOR_LEFT_DOCK_WIDTH;
  const available = workspaceWidth - VIDEO_EDITOR_CENTER_MIN_WIDTH - VIDEO_EDITOR_RESIZE_HANDLE_WIDTH;
  return Math.max(MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH, Math.min(MAX_VIDEO_EDITOR_LEFT_DOCK_WIDTH, available));
}

export function clampVideoEditorLeftDockWidth(requestedWidth: number, workspaceWidth: number): number {
  const maximum = videoEditorLeftDockMaxWidth(workspaceWidth);
  return Math.round(clamp(requestedWidth, MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH, maximum));
}

/** The inspector remains inline only when it can coexist with the preview. */
export function videoEditorInspectorUsesOverlay(workspaceWidth: number, leftDockWidth: number, inspectorVisible: boolean): boolean {
  if (!inspectorVisible) return false;
  const dockWidth = clamp(leftDockWidth, MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH, MAX_VIDEO_EDITOR_LEFT_DOCK_WIDTH);
  return dockWidth + VIDEO_EDITOR_RESIZE_HANDLE_WIDTH + VIDEO_EDITOR_CENTER_MIN_WIDTH + VIDEO_EDITOR_INSPECTOR_WIDTH > workspaceWidth;
}

export function parseVideoEditorLeftDockWidth(value: string | null): number {
  if (!value) return DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH;
  try {
    const parsed = JSON.parse(value) as { left?: unknown };
    return typeof parsed.left === "number" && Number.isFinite(parsed.left) ? Math.round(clamp(parsed.left, MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH, MAX_VIDEO_EDITOR_LEFT_DOCK_WIDTH)) : DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH;
  } catch {
    return DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH;
  }
}
