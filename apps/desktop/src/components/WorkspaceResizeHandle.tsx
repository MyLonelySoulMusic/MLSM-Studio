import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { WorkspacePanelSide } from "../services/workspace-layout";

interface WorkspaceResizeHandleProps {
  side: WorkspacePanelSide;
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
  minWidth?: number;
  maxWidth?: number;
  keyboardStep?: number;
  label?: string;
  className?: string;
}

export function WorkspaceResizeHandle({ side, width, onResize, onReset, minWidth = 180, maxWidth = 480, keyboardStep = 16, label, className }: WorkspaceResizeHandleProps) {
  const stopDrag = useRef<(() => void) | null>(null);
  const captureTarget = useRef<HTMLDivElement | null>(null);
  const capturePointerId = useRef<number | null>(null);
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
      const target = captureTarget.current;
      const pointerId = capturePointerId.current;
      if (target && pointerId !== null && target.hasPointerCapture?.(pointerId)) target.releasePointerCapture?.(pointerId);
      captureTarget.current = null;
      capturePointerId.current = null;
      document.body.classList.remove("workspace-panel-resizing");
      stopDrag.current = null;
    };
    stopDrag.current?.();
    stopDrag.current = stop;
    captureTarget.current = event.currentTarget;
    capturePointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add("workspace-panel-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };

  const keyboardResize = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") { event.preventDefault(); onResize(minWidth); return; }
    if (event.key === "End") { event.preventDefault(); onResize(maxWidth); return; }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const dividerDirection = event.key === "ArrowRight" ? 1 : -1;
    onResize(width + dividerDirection * (side === "left" ? keyboardStep : -keyboardStep));
  };

  return <div
    className={`workspace-resize-handle ${side}${className ? ` ${className}` : ""}`}
    role="separator"
    aria-label={label ?? `Ridimensiona pannello ${side === "left" ? "sinistro" : "destro"}`}
    aria-orientation="vertical"
    aria-valuemin={minWidth}
    aria-valuemax={maxWidth}
    aria-valuenow={Math.round(width)}
    tabIndex={0}
    onPointerDown={begin}
    onKeyDown={keyboardResize}
    onDoubleClick={onReset}
  ><span aria-hidden="true" /></div>;
}
