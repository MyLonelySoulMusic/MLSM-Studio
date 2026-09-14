import type { CSSProperties, DragEvent } from "react";
import type { ReportDashboard, ReportWidget } from "./types";
import { ReportIcon } from "./ReportIcon";
import { WidgetView } from "./WidgetView";

interface DashboardGridProps {
  dashboard: ReportDashboard;
  tabId?: string | undefined;
  readOnly?: boolean;
  selectedWidgetId?: string | null;
  selectedRowId?: string | null;
  onSelectWidget?: (id: string) => void;
  onSelectRow?: (id: string) => void;
  onMoveWidget?: (id: string, offset: number) => void;
  onMoveWidgetTo?: (id: string, targetId: string, rowId: string) => void;
  onDuplicateWidget?: (widget: ReportWidget) => void;
  onDeleteWidget?: (widget: ReportWidget) => void;
  onSetRowColumns?: (rowId: string, columns: number | null) => void;
  onDeleteRow?: (rowId: string) => void;
  onChangeWidgetType?: (widget: ReportWidget) => void;
  onPlayAnimation?: (widget: ReportWidget) => void;
}

export function DashboardGrid({
  dashboard, tabId, readOnly = false, selectedWidgetId, selectedRowId, onSelectWidget, onSelectRow,
  onMoveWidget, onMoveWidgetTo, onDuplicateWidget, onDeleteWidget, onSetRowColumns, onDeleteRow, onChangeWidgetType, onPlayAnimation,
}: DashboardGridProps) {
  const rows = tabId ? dashboard.layoutRows.filter(row => row.tabId === tabId) : dashboard.layoutRows;
  return <div className="rpt-layout-rows">
    {rows.map((row, rowIndex) => {
      const widgets = dashboard.widgets.filter(widget => widget.rowId === row.id);
      const fixedColumns = row.columns !== null;
      return <section
        key={row.id}
        className={`rpt-layout-row${!readOnly && selectedRowId === row.id ? " is-selected" : ""}`}
        aria-label={`Riga dashboard ${rowIndex + 1}`}
        onClick={() => { if (!readOnly) onSelectRow?.(row.id); }}
      >
        {!readOnly && <header className="rpt-layout-row-toolbar">
          <button type="button" className="rpt-row-selector" aria-pressed={selectedRowId === row.id} onClick={() => onSelectRow?.(row.id)}>
            <ReportIcon name="row" />Riga {rowIndex + 1}<small>{widgets.length} widget</small>
          </button>
          <label>Elementi per riga
            <input
              aria-label={`Elementi nella riga ${rowIndex + 1}`}
              type="number" min={1} max={12} placeholder="Auto"
              value={row.columns ?? ""}
              onChange={event => { const value = event.target.value; onSetRowColumns?.(row.id, value === "" ? null : Math.max(1, Math.min(12, Number(value) || 1))); }}
            />
          </label>
          <span>{fixedColumns ? `Griglia fissa · ${row.columns} per riga` : "Larghezze dei singoli widget"}</span>
          {rows.length > 1 && <button type="button" className="rpt-icon-button" aria-label={`Elimina riga ${rowIndex + 1}`} onClick={event => { event.stopPropagation(); onDeleteRow?.(row.id); }}><ReportIcon name="trash" /></button>}
        </header>}
        <div
          className={`rpt-widget-grid${fixedColumns ? " is-fixed-columns" : ""}`}
          style={fixedColumns ? { "--rpt-row-columns": row.columns } as CSSProperties : undefined}
        >
          {widgets.map((widget, widgetIndex) => <article
            key={widget.id}
            className={`rpt-widget${!readOnly && selectedWidgetId === widget.id ? " is-selected" : ""}`}
            style={{ "--rpt-widget-span": fixedColumns ? 1 : widget.width, "--rpt-widget-height": `${widget.height}px` } as CSSProperties}
            aria-label={`Widget ${widget.title}`}
            tabIndex={readOnly ? undefined : 0}
            onKeyDown={event => { if (!readOnly && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelectRow?.(row.id); onSelectWidget?.(widget.id); } }}
            onClick={event => { event.stopPropagation(); if (!readOnly) { onSelectRow?.(row.id); onSelectWidget?.(widget.id); } }}
            onDragOver={event => { if (!readOnly && event.dataTransfer.types.includes("application/mlsm-report-widget")) event.preventDefault(); }}
            onDrop={(event: DragEvent<HTMLElement>) => { event.preventDefault(); event.stopPropagation(); const id = event.dataTransfer.getData("application/mlsm-report-widget"); if (id) onMoveWidgetTo?.(id, widget.id, row.id); }}
          >
            <header className="rpt-widget-header"><h2>{widget.title}</h2>{!readOnly && <div className="rpt-widget-actions">
              <button className="rpt-icon-button rpt-drag-handle" aria-label={`Trascina ${widget.title}`} title="Trascina per riordinare" draggable onDragStart={event => { event.dataTransfer.setData("application/mlsm-report-widget", widget.id); event.dataTransfer.effectAllowed = "move"; }}><ReportIcon name="grip" /></button>
              <button className="rpt-icon-button" title="Sposta prima" aria-label={`Sposta prima ${widget.title}`} disabled={widgetIndex === 0} onClick={event => { event.stopPropagation(); onMoveWidget?.(widget.id, -1); }}><ReportIcon name="up" /></button>
              <button className="rpt-icon-button" title="Sposta dopo" aria-label={`Sposta dopo ${widget.title}`} disabled={widgetIndex === widgets.length - 1} onClick={event => { event.stopPropagation(); onMoveWidget?.(widget.id, 1); }}><ReportIcon name="down" /></button>
              <button className="rpt-icon-button" title="Duplica widget" aria-label={`Duplica ${widget.title}`} onClick={event => { event.stopPropagation(); onDuplicateWidget?.(widget); }}><ReportIcon name="copy" /></button>
              <button className="rpt-icon-button" title="Cambia tipo widget" aria-label={`Cambia tipo ${widget.title}`} onClick={event => { event.stopPropagation(); onSelectRow?.(row.id); onSelectWidget?.(widget.id); onChangeWidgetType?.(widget); }}><ReportIcon name="swap" /></button>
              <button className="rpt-icon-button" title="Elimina widget" aria-label={`Elimina ${widget.title}`} onClick={event => { event.stopPropagation(); onDeleteWidget?.(widget); }}><ReportIcon name="trash" /></button>
            </div>}</header>
            <WidgetView widget={widget} dataset={dashboard.datasets.find(dataset => dataset.id === widget.datasetId)} theme={dashboard.theme} filters={dashboard.filters} />
            {widget.animation && <button type="button" className="rpt-widget-play" aria-label={`Riproduci animazione ${widget.title}`} title={`Riproduci ${widget.animation.type === "barRace" ? "Corsa delle barre" : "Time Series"}`} onClick={event => { event.stopPropagation(); onPlayAnimation?.(widget); }}><ReportIcon name="play" /><span>{widget.animation.type === "barRace" ? "Bar Chart Race" : "Time Series"}</span></button>}
          </article>)}
          {!widgets.length && !readOnly && <button type="button" className="rpt-empty-row" onClick={() => onSelectRow?.(row.id)}><ReportIcon name="plus" />Seleziona questa riga, poi aggiungi i widget</button>}
        </div>
      </section>;
    })}
  </div>;
}
