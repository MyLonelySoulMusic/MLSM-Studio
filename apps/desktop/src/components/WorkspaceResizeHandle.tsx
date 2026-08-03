import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { WorkspacePanelSide } from "../services/workspace-layout";

interface WorkspaceResizeHandleProps {
  side: WorkspacePanelSide;
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
}

export function WorkspaceResizeHandle({ side, width, onResize, onReset }: WorkspaceResizeHandleProps) {
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const direction = side === "left" ? 1 : -1;
    const move = (moveEvent: globalThis.PointerEvent) => onResize(startWidth + (moveEvent.clientX - startX) * direction);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("workspace-panel-resizing");
      stopDrag.current = null;
    };
    stopDrag.current?.();
    stopDrag.current = stop;
    document.body.classList.add("workspace-panel-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };

  const keyboardResize = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") { event.preventDefault(); onResize(180); return; }
    if (event.key === "End") { event.preventDefault(); onResize(480); return; }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const dividerDirection = event.key === "ArrowRight" ? 1 : -1;
    onResize(width + dividerDirection * (side === "left" ? 16 : -16));
  };

  return <div
    className={`workspace-resize-handle ${side}`}
    role="separator"
    aria-label={`Ridimensiona pannello ${side === "left" ? "sinistro" : "destro"}`}
    aria-orientation="vertical"
    aria-valuemin={180}
    aria-valuemax={480}
    aria-valuenow={Math.round(width)}
    tabIndex={0}
    onPointerDown={begin}
    onKeyDown={keyboardResize}
    onDoubleClick={onReset}
  ><span aria-hidden="true" /></div>;
}
