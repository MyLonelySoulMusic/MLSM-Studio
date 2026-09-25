import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController,
  Filler, Legend, LinearScale, LineController, LineElement, PointElement,
  ScatterController, Tooltip,
  type ChartConfiguration,
} from "chart.js";
import { aggregateWidget, displayCell, filterRows, formatReportNumber, type WidgetData } from "./aggregation";
import { AGGREGATION_LABELS_BY_LANGUAGE, type ReportDataset, type ReportFilter, type ReportTheme, type ReportWidget } from "./types";
import { filtersForWidget } from "./filter-targets";
import { buildPivotTable } from "./pivot";
import { useUiPreferences, type UiLanguage } from "../services/ui-preferences";
import { ReportIcon } from "./ReportIcon";

const GeoMapView = lazy(() => import("./GeoMapView"));

Chart.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, Filler,
  Legend, LinearScale, LineController, LineElement, PointElement, ScatterController, Tooltip);

interface WidgetViewProps { widget: ReportWidget; dataset: ReportDataset | undefined; theme: ReportTheme; filters: ReportFilter[] }
type SupportedChart = "bar" | "line" | "doughnut" | "scatter";

function formatWidgetNumber(value: number, widget: ReportWidget, language: UiLanguage): string {
  return formatReportNumber(value, widget.format, widget.currency, widget.decimals, language);
}

function withAlpha(color: string, alpha: string): string {
  return /^#[\da-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

function palette(color: string, ink: string, length: number): string[] {
  const colors = [color, ink, withAlpha(color, "b8"), withAlpha(ink, "a6"), withAlpha(color, "75"), withAlpha(ink, "66")];
  return Array.from({ length }, (_, index) => colors[index % colors.length] ?? color);
}

function ChartView({ widget, dataset, theme, data, language }: Omit<WidgetViewProps, "filters"> & { data: WidgetData; language: UiLanguage }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const color = widget.color || theme.accent;
  const dimensionName = dataset?.fields.find(field => field.id === widget.dimension)?.name ?? (language === "en" ? "Dimension" : "Dimensione");
  const measureName = widget.aggregation === "count" && widget.type !== "scatter" ? (language === "en" ? "Rows" : "Righe") : dataset?.fields.find(field => field.id === widget.measure)?.name ?? (language === "en" ? "Value" : "Valore");
  const valueLabel = widget.type === "scatter" ? measureName : `${AGGREGATION_LABELS_BY_LANGUAGE[language][widget.aggregation]} · ${measureName}`;
  const scatter = widget.type === "scatter";
  const horizontalBar = widget.type === "bar";
  const xAxisTitle = widget.xAxisLabel.trim() || (horizontalBar ? valueLabel : dimensionName);
  const yAxisTitle = widget.yAxisLabel.trim() || (horizontalBar ? dimensionName : measureName);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const doughnut = widget.type === "doughnut";
    const type: SupportedChart = widget.type === "area" ? "line" : widget.type === "bar" || widget.type === "column" ? "bar" : widget.type === "line" || widget.type === "doughnut" || widget.type === "scatter" ? widget.type : "bar";
    const configuration: ChartConfiguration<SupportedChart> = {
      type,
      data: {
        labels: data.points.map(point => point.label),
        datasets: [{
          label: valueLabel,
          data: scatter ? data.scatter : data.points.map(point => point.value),
          backgroundColor: doughnut ? palette(color, theme.ink, data.points.length) : widget.type === "area" ? withAlpha(color, "30") : withAlpha(color, "d9"),
          borderColor: doughnut ? theme.paper : color,
          borderWidth: doughnut ? 3 : type === "line" ? 2.5 : 0,
          pointRadius: scatter ? 4 : data.points.length > 30 ? 0 : 3,
          pointHoverRadius: 6,
          pointBackgroundColor: color,
          fill: widget.type === "area",
          tension: 0.2,
          ...(type === "bar" ? { borderRadius: 5, maxBarThickness: 48 } : {}),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        ...(type === "bar" ? { indexAxis: widget.type === "bar" ? "y" as const : "x" as const } : {}),
        color: theme.ink,
        font: { family: "Inter, system-ui, sans-serif", size: 11 },
        plugins: {
          legend: { display: doughnut, position: "bottom", labels: { color: theme.ink, usePointStyle: true, boxWidth: 8, padding: 14 } },
          tooltip: {
            backgroundColor: theme.ink,
            titleColor: theme.paper,
            bodyColor: theme.paper,
            padding: 12,
            callbacks: {
              label: context => {
                if (scatter) {
                  const point = data.scatter[context.dataIndex];
                  return point ? `${dimensionName}: ${formatReportNumber(point.x, "number", "EUR", 2, language)} · ${measureName}: ${formatWidgetNumber(point.y, widget, language)}` : "";
                }
                const point = data.points[context.dataIndex];
                return point ? `${point.label}: ${formatWidgetNumber(point.value, widget, language)}` : "";
              },
            },
          },
        },
        ...(doughnut ? { cutout: "66%" } : {
          scales: {
            x: {
              type: scatter || horizontalBar ? "linear" : "category",
              beginAtZero: horizontalBar,
              ...(scatter || horizontalBar ? {
                ...(widget.xAxisMin !== null ? { min: widget.xAxisMin } : {}),
                ...(widget.xAxisMax !== null ? { max: widget.xAxisMax } : {}),
              } : {}),
              grid: { display: horizontalBar },
              border: { display: false },
              ticks: { display: widget.showXTicks, color: withAlpha(theme.ink, "b3"), maxRotation: 40, autoSkip: true, maxTicksLimit: widget.xTickCount ?? 14, ...(horizontalBar ? { callback: (value: string | number) => formatWidgetNumber(Number(value), widget, language) } : {}) },
              title: { display: true, text: xAxisTitle, color: theme.ink },
            },
            y: {
              type: horizontalBar ? "category" : "linear",
              beginAtZero: !scatter && !horizontalBar,
              ...(!horizontalBar ? {
                ...(widget.yAxisMin !== null ? { min: widget.yAxisMin } : {}),
                ...(widget.yAxisMax !== null ? { max: widget.yAxisMax } : {}),
              } : {}),
              grid: horizontalBar ? { display: false } : { color: withAlpha(theme.ink, "10") },
              border: { display: false },
              ticks: { display: widget.showYTicks, color: withAlpha(theme.ink, "b3"), maxTicksLimit: widget.yTickCount ?? (horizontalBar ? 20 : 6), ...(!horizontalBar ? { callback: (value: string | number) => formatWidgetNumber(Number(value), widget, language) } : {}) },
              title: { display: true, text: yAxisTitle, color: theme.ink },
            },
          },
        }),
      },
    };
    const chart = new Chart(canvas, configuration);
    return () => chart.destroy();
  }, [color, data, dimensionName, horizontalBar, language, measureName, scatter, theme.ink, theme.paper, valueLabel, widget, xAxisTitle, yAxisTitle]);

  const count = scatter ? data.scatter.length : data.points.length;
  return <>
    <div className="rpt-chart-shell">
      <canvas ref={canvasRef} role="img" aria-label={`${widget.title}. Asse X: ${xAxisTitle}. Asse Y: ${yAxisTitle}. ${count} ${scatter ? "punti" : "categorie"}. Valori disponibili in Mostra dati del grafico.`} />
    </div>
    {data.excludedRows > 0 && <p className="rpt-widget-note">{data.excludedRows.toLocaleString(language === "en" ? "en-GB" : "it-IT")} righe senza valori numerici escluse.</p>}
    <details className="rpt-chart-data">
      <summary>Mostra dati del grafico <span>({count.toLocaleString(language === "en" ? "en-GB" : "it-IT")})</span></summary>
      <div className="rpt-table-wrap"><table className="rpt-data-table">
        <caption className="rpt-sr-only">Dati di {widget.title}</caption>
        <thead><tr><th scope="col">{dimensionName}</th><th scope="col">{valueLabel}</th></tr></thead>
        <tbody>{scatter ? data.scatter.slice(0, 200).map((point, index) => <tr key={index}><td>{formatReportNumber(point.x, "number", "EUR", 2, language)}</td><td>{formatWidgetNumber(point.y, widget, language)}</td></tr>) : data.points.map((point, index) => <tr key={index}><td>{point.label}</td><td>{formatWidgetNumber(point.value, widget, language)}</td></tr>)}</tbody>
      </table></div>
      {scatter && count > 200 && <p className="rpt-widget-note">Prime 200 coppie mostrate. Aggiungi una tabella per consultare tutte le righe.</p>}
    </details>
  </>;
}

function DataTable({ widget, dataset, filters, language }: { widget: ReportWidget; dataset: ReportDataset; filters: ReportFilter[]; language: UiLanguage }) {
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const selected = filterRows(dataset, filters);
    if (widget.sort === "source") return selected;
    const field = dataset.fields.find(candidate => candidate.id === (widget.measure || widget.dimension));
    if (!field) return selected;
    return [...selected].sort((a, b) => {
      const left = a[field.id];
      const right = b[field.id];
      const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), language, { numeric: true });
      return widget.sort === "asc" ? comparison : -comparison;
    });
  }, [dataset, filters, language, widget.dimension, widget.measure, widget.sort]);
  const pageSize = widget.limit === null ? 50 : Math.max(1, Math.min(100, Math.floor(widget.limit)));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const offset = currentPage * pageSize;

  useEffect(() => { setPage(0); }, [dataset, filters, widget.limit, widget.sort]);

  return <>
    <div className="rpt-table-wrap"><table className="rpt-data-table">
      <caption className="rpt-sr-only">{widget.title}: {rows.length.toLocaleString(language === "en" ? "en-GB" : "it-IT")} righe</caption>
      <thead><tr>{dataset.fields.map(field => <th key={field.id} scope="col">{field.name}</th>)}</tr></thead>
      <tbody>{rows.slice(offset, offset + pageSize).map((row, rowIndex) => <tr key={offset + rowIndex}>{dataset.fields.map(field => <td key={field.id}>{typeof row[field.id] === "number" ? field.id === widget.measure ? formatWidgetNumber(row[field.id] as number, widget, language) : formatReportNumber(row[field.id] as number, "number", "EUR", 2, language) : displayCell(row[field.id])}</td>)}</tr>)}</tbody>
    </table></div>
    <div className="rpt-table-footer">
      <span>{(rows.length ? offset + 1 : 0).toLocaleString("it-IT")}–{Math.min(offset + pageSize, rows.length).toLocaleString("it-IT")} di {rows.length.toLocaleString("it-IT")} righe</span>
      <div><button type="button" aria-label={`Pagina precedente: ${widget.title}`} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹</button><span>{currentPage + 1} / {pageCount}</span><button type="button" aria-label={`Pagina successiva: ${widget.title}`} disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>›</button></div>
    </div>
  </>;
}

function PivotTable({ widget, dataset, filters, language }: { widget: ReportWidget; dataset: ReportDataset; filters: ReportFilter[]; language: UiLanguage }) {
  const rowField = dataset.fields.find(field => field.id === widget.dimension);
  const columnField = dataset.fields.find(field => field.id === widget.secondaryDimension);
  const result = buildPivotTable({
    dataset, filters, rowFieldId: widget.dimension, columnFieldId: widget.secondaryDimension,
    measureFieldId: widget.measure, aggregation: widget.aggregation, timeGrain: widget.timeGrain,
    timeAxis: rowField?.type === "date" ? "row" : "none", language,
  });
  if (result.message) return <div className="rpt-widget-content rpt-widget-empty" role="status">{result.message}</div>;
  const totalLabel = widget.aggregation === "avg" ? "Media complessiva" : widget.aggregation === "count" ? "Totale righe" : widget.aggregation === "distinct" ? "Distinti complessivi" : "Totale";
  return <div className="rpt-widget-content rpt-table-widget rpt-pivot-widget"><div className="rpt-table-wrap"><table className="rpt-data-table rpt-pivot-table">
    <caption className="rpt-sr-only">{widget.title}: {rowField?.name} per {columnField?.name}</caption>
    <thead><tr><th scope="col">{rowField?.name ?? "Righe"} × {columnField?.name ?? "Colonne"}</th>{result.columnLabels.map(label => <th scope="col" key={label}>{label}</th>)}<th scope="col">{totalLabel}</th></tr></thead>
    <tbody>{result.rowLabels.map((label, rowIndex) => <tr key={label}><th scope="row">{label}</th>{result.cells[rowIndex]!.map((value, columnIndex) => <td key={`${label}-${result.columnLabels[columnIndex]}`}>{value === null ? "—" : formatWidgetNumber(value, widget, language)}</td>)}<td className="rpt-pivot-total">{result.rowTotals[rowIndex] === null ? "—" : formatWidgetNumber(result.rowTotals[rowIndex]!, widget, language)}</td></tr>)}</tbody>
    <tfoot><tr><th scope="row">{totalLabel}</th>{result.columnTotals.map((value, index) => <td key={result.columnLabels[index]}>{value === null ? "—" : formatWidgetNumber(value, widget, language)}</td>)}<td>{result.grandTotal === null ? "—" : formatWidgetNumber(result.grandTotal, widget, language)}</td></tr></tfoot>
  </table></div></div>;
}

export function WidgetView({ widget, dataset, theme, filters }: WidgetViewProps) {
  const { language } = useUiPreferences();
  const activeFilters = useMemo(() => filtersForWidget(filters, widget.id, widget.datasetId) as ReportFilter[], [filters, widget.datasetId, widget.id]);
  const data = useMemo(() => aggregateWidget(widget, dataset, activeFilters, language), [widget, dataset, activeFilters, language]);
  if (widget.type === "text") return <div className="rpt-widget-content rpt-text-widget" style={{ color: widget.color || theme.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{widget.text || "Aggiungi una nota nelle impostazioni del widget."}</div>;
  if (widget.type === "replicateXls") {
    const config = widget.replicateXls;
    return <div className="rpt-widget-content rpt-replicate-widget">
      <span className="rpt-replicate-widget-icon"><ReportIcon name="replicateXls" /></span>
      <div><strong>{config?.templateName || (language === "en" ? "Template not configured" : "Template da configurare")}</strong>
        <p>{config ? `${config.sheetName} · ${config.regions.length} ${language === "en" ? "mapped regions" : "aree mappate"}` : (language === "en" ? "Open the widget to upload an Excel template and teach MLSM how to populate it." : "Apri il widget per caricare un template Excel e insegnare a MLSM come popolarlo.")}</p>
        {config && <small>{dataset?.rows.length.toLocaleString(language === "en" ? "en-GB" : "it-IT")} {language === "en" ? "source rows" : "righe sorgente"}{config.aiModel ? ` · AI ${config.aiModel}` : ""}</small>}
      </div>
      <span className="rpt-replicate-widget-action">{language === "en" ? "Open model" : "Apri modello"} →</span>
    </div>;
  }
  if (widget.type === "pivot" && dataset) return <PivotTable widget={widget} dataset={dataset} filters={activeFilters} language={language} />;
  if (data.message) return <div className="rpt-widget-content rpt-widget-empty" role="status">{data.message}</div>;
  if (widget.type === "table" && dataset) return <div className="rpt-widget-content rpt-table-widget"><DataTable widget={widget} dataset={dataset} filters={activeFilters} language={language} /></div>;
  if (widget.type === "map") return <Suspense fallback={<div className="rpt-widget-content rpt-widget-empty" role="status">Preparazione mappa geografica…</div>}><GeoMapView widget={widget} theme={theme} data={data} language={language} /></Suspense>;
  if (widget.type === "kpi") {
    const measureName = dataset?.fields.find(field => field.id === widget.measure)?.name;
    return <div className="rpt-widget-content rpt-kpi">
      {widget.showKpiLabel && <span className="rpt-kpi-label">{widget.aggregation === "count" ? AGGREGATION_LABELS_BY_LANGUAGE[language].count : `${AGGREGATION_LABELS_BY_LANGUAGE[language][widget.aggregation]} · ${measureName ?? (language === "en" ? "Measure" : "Misura")}`}</span>}
      <strong className="rpt-kpi-value" style={{ color: widget.color || theme.accent }}>{data.value === null ? "—" : formatWidgetNumber(data.value, widget, language)}</strong>
      {widget.showKpiMeta && <span className="rpt-kpi-meta">{data.rowCount.toLocaleString(language === "en" ? "en-GB" : "it-IT")} {language === "en" ? "rows" : "righe"} · {dataset?.name}</span>}
      {data.excludedRows > 0 && <span className="rpt-widget-note">{data.excludedRows.toLocaleString(language === "en" ? "en-GB" : "it-IT")} {language === "en" ? "rows without numeric values excluded." : "righe senza valori numerici escluse."}</span>}
    </div>;
  }
  return <div className="rpt-widget-content rpt-chart-widget"><ChartView widget={widget} dataset={dataset} theme={theme} data={data} language={language} /></div>;
}
