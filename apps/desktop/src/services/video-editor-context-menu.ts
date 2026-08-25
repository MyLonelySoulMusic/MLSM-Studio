export interface VideoEditorContextMenuPositionInput {
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
}

/** Vincola un menu fixed alla viewport. Se il menu è più alto dello spazio
 * disponibile, il bordo superiore resta accessibile e il CSS abilita lo scroll. */
export function videoEditorContextMenuPosition(input: VideoEditorContextMenuPositionInput): { x: number; y: number } {
  const margin = Math.max(0, input.margin ?? 8);
  const maximumX = Math.max(margin, input.viewportWidth - input.menuWidth - margin);
  const maximumY = Math.max(margin, input.viewportHeight - input.menuHeight - margin);
  return {
    x: Math.min(maximumX, Math.max(margin, input.x)),
    y: Math.min(maximumY, Math.max(margin, input.y))
  };
}
