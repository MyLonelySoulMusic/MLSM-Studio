export type WorkspacePanelSide = "left" | "right";

export interface WorkspacePanelWidths {
  left: number;
  right: number;
}

export const DEFAULT_WORKSPACE_PANEL_WIDTHS: WorkspacePanelWidths = { left: 230, right: 260 };
export const MIN_WORKSPACE_PANEL_WIDTH = 180;
export const MAX_WORKSPACE_PANEL_WIDTH = 480;
export const MIN_WORKSPACE_VIEWPORT_WIDTH = 420;
export const WORKSPACE_RESIZE_GUTTERS = 14;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function fitWorkspacePanelWidths(widths: WorkspacePanelWidths, workspaceWidth: number): WorkspacePanelWidths {
  const left = clamp(widths.left, MIN_WORKSPACE_PANEL_WIDTH, MAX_WORKSPACE_PANEL_WIDTH);
  const right = clamp(widths.right, MIN_WORKSPACE_PANEL_WIDTH, MAX_WORKSPACE_PANEL_WIDTH);
  const maximumPanelSum = Math.max(
    MIN_WORKSPACE_PANEL_WIDTH * 2,
    workspaceWidth - MIN_WORKSPACE_VIEWPORT_WIDTH - WORKSPACE_RESIZE_GUTTERS
  );
  if (left + right <= maximumPanelSum) return { left: Math.round(left), right: Math.round(right) };
  const leftExtra = left - MIN_WORKSPACE_PANEL_WIDTH;
  const rightExtra = right - MIN_WORKSPACE_PANEL_WIDTH;
  const availableExtra = maximumPanelSum - MIN_WORKSPACE_PANEL_WIDTH * 2;
  const factor = availableExtra / Math.max(1, leftExtra + rightExtra);
  return {
    left: Math.round(MIN_WORKSPACE_PANEL_WIDTH + leftExtra * factor),
    right: Math.round(MIN_WORKSPACE_PANEL_WIDTH + rightExtra * factor)
  };
}

export function resizeWorkspacePanel(
  widths: WorkspacePanelWidths,
  side: WorkspacePanelSide,
  requestedWidth: number,
  workspaceWidth: number
): WorkspacePanelWidths {
  const fitted = fitWorkspacePanelWidths(widths, workspaceWidth);
  const otherWidth = side === "left" ? fitted.right : fitted.left;
  const availableMaximum = Math.max(
    MIN_WORKSPACE_PANEL_WIDTH,
    workspaceWidth - otherWidth - MIN_WORKSPACE_VIEWPORT_WIDTH - WORKSPACE_RESIZE_GUTTERS
  );
  const nextWidth = Math.round(clamp(
    requestedWidth,
    MIN_WORKSPACE_PANEL_WIDTH,
    Math.min(MAX_WORKSPACE_PANEL_WIDTH, availableMaximum)
  ));
  return side === "left" ? { ...fitted, left: nextWidth } : { ...fitted, right: nextWidth };
}

export function parseWorkspacePanelWidths(value: string | null): WorkspacePanelWidths {
  if (!value) return DEFAULT_WORKSPACE_PANEL_WIDTHS;
  try {
    const parsed = JSON.parse(value) as Partial<WorkspacePanelWidths>;
    return {
      left: Number.isFinite(parsed.left) ? clamp(Number(parsed.left), MIN_WORKSPACE_PANEL_WIDTH, MAX_WORKSPACE_PANEL_WIDTH) : DEFAULT_WORKSPACE_PANEL_WIDTHS.left,
      right: Number.isFinite(parsed.right) ? clamp(Number(parsed.right), MIN_WORKSPACE_PANEL_WIDTH, MAX_WORKSPACE_PANEL_WIDTH) : DEFAULT_WORKSPACE_PANEL_WIDTHS.right
    };
  } catch {
    return DEFAULT_WORKSPACE_PANEL_WIDTHS;
  }
}
