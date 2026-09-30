import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { PanelLayout, WidgetId } from "./streamer-layout";
export function AnalyzerGrid({ layout, onChange, render, titles, language }: { layout: PanelLayout[]; onChange: (value: PanelLayout[]) => void; render: (id: WidgetId) => ReactNode; titles: Record<WidgetId, string>; language: "it" | "en" }) {
  const ref = useRef<HTMLDivElement>(null), dialogRef = useRef<HTMLDialogElement>(null), drag = useRef<WidgetId | null>(null), hoverTarget = useRef<WidgetId | null>(null), layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [columns, setColumns] = useState(12), [expanded, setExpanded] = useState<WidgetId | null>(null), [dragging, setDragging] = useState<WidgetId | null>(null);
  useEffect(() => { if (!ref.current) return; const observer = new ResizeObserver(entries => { const w = entries[0]?.contentRect.width ?? 1000; setColumns(w < 550 ? 3 : w < 1000 ? 6 : 12); }); observer.observe(ref.current); return () => observer.disconnect(); }, []);
  useEffect(() => { if (expanded) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [expanded]);
  const move = (id: WidgetId, target: WidgetId) => {
    if (id === target) return;
    const next = [...layoutRef.current], from = next.findIndex(p => p.id === id), to = next.findIndex(p => p.id === target);
    const item = next.splice(from, 1)[0];
    if (item && to >= 0) onChange([...next.slice(0, to), item, ...next.slice(to)]);
  };
  const stopPointerDrag = () => { drag.current = null; hoverTarget.current = null; setDragging(null); };
  const startPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: WidgetId) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = id; setDragging(id);
    const onMove = (pointer: PointerEvent) => {
      const target = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>("[data-widget-id]")?.dataset.widgetId as WidgetId | undefined;
      if (target && target !== hoverTarget.current && layoutRef.current.some(panel => panel.id === target && panel.visible)) { hoverTarget.current = target; move(id, target); }
    };
    const onEnd = () => { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onEnd); document.removeEventListener("pointercancel", onEnd); stopPointerDrag(); };
    document.addEventListener("pointermove", onMove); document.addEventListener("pointerup", onEnd); document.addEventListener("pointercancel", onEnd);
  };
  const hide = (id: WidgetId) => onChange(layoutRef.current.map(panel => panel.id === id ? { ...panel, visible: false } : panel));
  return <><div ref={ref} className="sav-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
    {layout.filter(panel => panel.visible).map(panel => <section key={panel.id} data-widget-id={panel.id} className={`sav-panel ${dragging === panel.id ? "is-dragging" : ""}`} style={{ gridColumn: `span ${Math.min(columns, panel.width)}`, gridRow: `span ${panel.height}` }} onDragOver={event => { if (drag.current) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (drag.current) move(drag.current, panel.id); stopPointerDrag(); }}>
      <header><button className="sav-grip" draggable title={language === "it" ? "Trascina · Alt + frecce per spostare" : "Drag · Alt + arrows to move"} aria-label={titles[panel.id]} onPointerDown={event => startPointerDrag(event, panel.id)} onDragStart={event => { drag.current = panel.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", panel.id); }} onDragEnd={stopPointerDrag} onKeyDown={event => { if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); const index = layoutRef.current.findIndex(p => p.id === panel.id), target = layoutRef.current[index + (event.key === "ArrowUp" ? -1 : 1)]; if (target) move(panel.id, target.id); }}>⠿ <span>{titles[panel.id]}</span></button><button className="sav-panel-remove" title={language === "it" ? "Rimuovi widget" : "Remove widget"} aria-label={`${language === "it" ? "Rimuovi widget" : "Remove widget"} ${titles[panel.id]}`} onClick={() => hide(panel.id)}>×</button><button title={language === "it" ? "Espandi" : "Maximize"} aria-label={`${language === "it" ? "Espandi" : "Maximize"} ${titles[panel.id]}`} onClick={() => setExpanded(panel.id)}>⛶</button></header>
      <div className="sav-panel-content">{expanded === panel.id ? null : render(panel.id)}</div>
      <button className="sav-resize" aria-label={`${language === "it" ? "Ridimensiona" : "Resize"} ${titles[panel.id]}`} title={language === "it" ? "Trascina o usa le frecce" : "Drag or use arrow keys"} onKeyDown={event => { if (!event.key.startsWith("Arrow")) return; event.preventDefault(); onChange(layout.map(p => p.id !== panel.id ? p : { ...p, width: Math.max(3, Math.min(columns, p.width + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0))), height: Math.max(2, Math.min(7, p.height + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0))) })); }} onPointerDown={event => { event.preventDefault(); const button = event.currentTarget, startX = event.clientX, startY = event.clientY, columnWidth = (ref.current?.clientWidth ?? 1000) / columns; button.setPointerCapture(event.pointerId); const movePointer = (e: PointerEvent) => onChange(layout.map(p => p.id !== panel.id ? p : { ...p, width: Math.max(3, Math.min(columns, panel.width + Math.round((e.clientX - startX) / columnWidth))), height: Math.max(2, Math.min(7, panel.height + Math.round((e.clientY - startY) / 90))) })); const end = () => { button.removeEventListener("pointermove", movePointer); button.removeEventListener("pointerup", end); button.removeEventListener("pointercancel", end); }; button.addEventListener("pointermove", movePointer); button.addEventListener("pointerup", end); button.addEventListener("pointercancel", end); }}>◢</button>
    </section>)}
  </div><dialog ref={dialogRef} className="sav-expanded" onCancel={() => setExpanded(null)} onClose={() => setExpanded(null)}><header><strong>{expanded && titles[expanded]}</strong><button aria-label={language === "it" ? "Chiudi" : "Close"} onClick={() => setExpanded(null)}>×</button></header><div>{expanded && render(expanded)}</div></dialog></>;
}
