import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController,
  Filler, Legend, LinearScale, LineController, LineElement, PointElement,
  ScatterController, Tooltip,
  type ChartConfiguration,
} from "chart.js";
import { aggregateWidget, displayCell, filterRows, formatReportNumber, type WidgetData } from "./aggregation";
import { AGGREGATION_LABELS, type ReportDataset, type ReportFilter, type ReportTheme, type ReportWidget } from "./types";
import { filtersForWidget } from "./filter-targets";
import { buildPivotTable } from "./pivot";

Chart.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, Filler,
  Legend, LinearScale, LineController, LineElement, PointElement, ScatterController, Tooltip);

interface WidgetViewProps { widget: ReportWidget; dataset: ReportDataset | undefined; theme: ReportTheme; filters: ReportFilter[] }
type SupportedChart = "bar" | "line" | "doughnut" | "scatter";

function formatWidgetNumber(value: number, widget: ReportWidget): string {
  return formatReportNumber(value, widget.format, widget.currency, widget.decimals);
}

function withAlpha(color: string, alpha: string): string {
  return /^#[\da-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

function palette(color: string, ink: string, length: number): string[] {
  const colors = [color, ink, withAlpha(color, "b8"), withAlpha(ink, "a6"), withAlpha(color, "75"), withAlpha(ink, "66")];
  return Array.from({ length }, (_, index) => colors[index % colors.length] ?? color);
}

function ChartView({ widget, dataset, theme, data }: Omit<WidgetViewProps, "filters"> & { data: WidgetData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const color = widget.color || theme.accent;
  const dimensionName = dataset?.fields.find(field => field.id === widget.dimension)?.name ?? "Dimensione";
  const measureName = widget.aggregation === "count" && widget.type !== "scatter" ? "Righe" : dataset?.fields.find(field => field.id === widget.measure)?.name ?? "Valore";
  const valueLabel = widget.type === "scatter" ? measureName : `${AGGREGATION_LABELS[widget.aggregation]} · ${measureName}`;
  const scatter = widget.type === "scatter";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const doughnut = widget.type === "doughnut";
    const type: SupportedChart = widget.type === "area" ? "line" : widget.type === "bar" || widget.type === "line" || widget.type === "doughnut" || widget.type === "scatter" ? widget.type : "bar";
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
                  return point ? `${dimensionName}: ${formatReportNumber(point.x, "number")} · ${measureName}: ${formatWidgetNumber(point.y, widget)}` : "";
                }
                const point = data.points[context.dataIndex];
                return point ? `${point.label}: ${formatWidgetNumber(point.value, widget)}` : "";
              },
            },
          },
        },
        ...(doughnut ? { cutout: "66%" } : {
          scales: {
            x: {
              type: scatter ? "linear" : "category",
              grid: { display: false },
              border: { display: false },
              ticks: { color: withAlpha(theme.ink, "b3"), maxRotation: 40, autoSkip: true, maxTicksLimit: 14 },
              title: { display: scatter, text: dimensionName, color: theme.ink },
            },
            y: {
              beginAtZero: !scatter,
              grid: { color: withAlpha(theme.ink, "10") },
              border: { display: false },
              ticks: { color: withAlpha(theme.ink, "b3"), maxTicksLimit: 6, callback: value => formatWidgetNumber(Number(value), widget) },
              title: { display: scatter, text: measureName, color: theme.ink },
            },
          },
        }),
      },
    };
    const chart = new Chart(canvas, configuration);
    return () => chart.destroy();
  }, [color, data, dimensionName, measureName, scatter, theme.ink, theme.paper, valueLabel, widget]);

  const count = scatter ? data.scatter.length : data.points.length;
  return <>
    <div className="rpt-chart-shell">
      <canvas ref={canvasRef} role="img" aria-label={`${widget.title}. ${dimensionName}, ${valueLabel}. ${count} ${scatter ? "punti" : "categorie"}. Valori disponibili in Mostra dati del grafico.`} />
    </div>
    {data.excludedRows > 0 && <p className="rpt-widget-note">{data.excludedRows.toLocaleString("it-IT")} righe senza valori numerici escluse.</p>}
    <details className="rpt-chart-data">
      <summary>Mostra dati del grafico <span>({count.toLocaleString("it-IT")})</span></summary>
      <div className="rpt-table-wrap"><table className="rpt-data-table">
        <caption className="rpt-sr-only">Dati di {widget.title}</caption>
        <thead><tr><th scope="col">{dimensionName}</th><th scope="col">{valueLabel}</th></tr></thead>
        <tbody>{scatter ? data.scatter.slice(0, 200).map((point, index) => <tr key={index}><td>{formatReportNumber(point.x, "number")}</td><td>{formatWidgetNumber(point.y, widget)}</td></tr>) : data.points.map((point, index) => <tr key={index}><td>{point.label}</td><td>{formatWidgetNumber(point.value, widget)}</td></tr>)}</tbody>
      </table></div>
      {scatter && count > 200 && <p className="rpt-widget-note">Prime 200 coppie mostrate. Aggiungi una tabella per consultare tutte le righe.</p>}
    </details>
  </>;
}

function DataTable({ widget, dataset, filters }: { widget: ReportWidget; dataset: ReportDataset; filters: ReportFilter[] }) {
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const selected = filterRows(dataset, filters);
    if (widget.sort === "source") return selected;
    const field = dataset.fields.find(candidate => candidate.id === (widget.measure || widget.dimension));
    if (!field) return selected;
    return [...selected].sort((a, b) => {
      const left = a[field.id];
      const right = b[field.id];
      const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), "it", { numeric: true });
      return widget.sort === "asc" ? comparison : -comparison;
    });
  }, [dataset, filters, widget.dimension, widget.measure, widget.sort]);
  const pageSize = Math.max(1, Math.min(100, Math.floor(widget.limit)));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const offset = currentPage * pageSize;

  useEffect(() => { setPage(0); }, [dataset, filters, widget.limit, widget.sort]);

  return <>
    <div className="rpt-table-wrap"><table className="rpt-data-table">
      <caption className="rpt-sr-only">{widget.title}: {rows.length.toLocaleString("it-IT")} righe</caption>
      <thead><tr>{dataset.fields.map(field => <th key={field.id} scope="col">{field.name}</th>)}</tr></thead>
      <tbody>{rows.slice(offset, offset + pageSize).map((row, rowIndex) => <tr key={offset + rowIndex}>{dataset.fields.map(field => <td key={field.id}>{typeof row[field.id] === "number" ? field.id === widget.measure ? formatWidgetNumber(row[field.id] as number, widget) : formatReportNumber(row[field.id] as number, "number") : displayCell(row[field.id])}</td>)}</tr>)}</tbody>
    </table></div>
    <div className="rpt-table-footer">
      <span>{(rows.length ? offset + 1 : 0).toLocaleString("it-IT")}–{Math.min(offset + pageSize, rows.length).toLocaleString("it-IT")} di {rows.length.toLocaleString("it-IT")} righe</span>
      <div><button type="button" aria-label={`Pagina precedente: ${widget.title}`} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹</button><span>{currentPage + 1} / {pageCount}</span><button type="button" aria-label={`Pagina successiva: ${widget.title}`} disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>›</button></div>
    </div>
  </>;
}

function PivotTable({ widget, dataset, filters }: { widget: ReportWidget; dataset: ReportDataset; filters: ReportFilter[] }) {
  const rowField = dataset.fields.find(field => field.id === widget.dimension);
  const columnField = dataset.fields.find(field => field.id === widget.secondaryDimension);
  const result = buildPivotTable({
    dataset, filters, rowFieldId: widget.dimension, columnFieldId: widget.secondaryDimension,
    measureFieldId: widget.measure, aggregation: widget.aggregation, timeGrain: widget.timeGrain,
    timeAxis: rowField?.type === "date" ? "row" : "none",
  });
  if (result.message) return <div className="rpt-widget-content rpt-widget-empty" role="status">{result.message}</div>;
  const totalLabel = widget.aggregation === "avg" ? "Media complessiva" : widget.aggregation === "count" ? "Totale righe" : widget.aggregation === "distinct" ? "Distinti complessivi" : "Totale";
  return <div className="rpt-widget-content rpt-table-widget rpt-pivot-widget"><div className="rpt-table-wrap"><table className="rpt-data-table rpt-pivot-table">
    <caption className="rpt-sr-only">{widget.title}: {rowField?.name} per {columnField?.name}</caption>
    <thead><tr><th scope="col">{rowField?.name ?? "Righe"} × {columnField?.name ?? "Colonne"}</th>{result.columnLabels.map(label => <th scope="col" key={label}>{label}</th>)}<th scope="col">{totalLabel}</th></tr></thead>
    <tbody>{result.rowLabels.map((label, rowIndex) => <tr key={label}><th scope="row">{label}</th>{result.cells[rowIndex]!.map((value, columnIndex) => <td key={`${label}-${result.columnLabels[columnIndex]}`}>{value === null ? "—" : formatWidgetNumber(value, widget)}</td>)}<td className="rpt-pivot-total">{result.rowTotals[rowIndex] === null ? "—" : formatWidgetNumber(result.rowTotals[rowIndex]!, widget)}</td></tr>)}</tbody>
    <tfoot><tr><th scope="row">{totalLabel}</th>{result.columnTotals.map((value, index) => <td key={result.columnLabels[index]}>{value === null ? "—" : formatWidgetNumber(value, widget)}</td>)}<td>{result.grandTotal === null ? "—" : formatWidgetNumber(result.grandTotal, widget)}</td></tr></tfoot>
  </table></div></div>;
}

export function WidgetView({ widget, dataset, theme, filters }: WidgetViewProps) {
  const activeFilters = useMemo(() => filtersForWidget(filters, widget.id, widget.datasetId) as ReportFilter[], [filters, widget.datasetId, widget.id]);
  const data = useMemo(() => aggregateWidget(widget, dataset, activeFilters), [widget, dataset, activeFilters]);
  if (widget.type === "text") return <div className="rpt-widget-content rpt-text-widget" style={{ color: widget.color || theme.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{widget.text || "Aggiungi una nota nelle impostazioni del widget."}</div>;
  if (widget.type === "pivot" && dataset) return <PivotTable widget={widget} dataset={dataset} filters={activeFilters} />;
  if (data.message) return <div className="rpt-widget-content rpt-widget-empty" role="status">{data.message}</div>;
  if (widget.type === "table" && dataset) return <div className="rpt-widget-content rpt-table-widget"><DataTable widget={widget} dataset={dataset} filters={activeFilters} /></div>;
  if (widget.type === "kpi") {
    const measureName = dataset?.fields.find(field => field.id === widget.measure)?.name;
    return <div className="rpt-widget-content rpt-kpi">
      <span className="rpt-kpi-label">{widget.aggregation === "count" ? "Conteggio righe" : `${AGGREGATION_LABELS[widget.aggregation]} · ${measureName ?? "Misura"}`}</span>
      <strong className="rpt-kpi-value" style={{ color: widget.color || theme.accent }}>{data.value === null ? "—" : formatWidgetNumber(data.value, widget)}</strong>
      <span className="rpt-kpi-meta">{data.rowCount.toLocaleString("it-IT")} righe · {dataset?.name}</span>
      {data.excludedRows > 0 && <span className="rpt-widget-note">{data.excludedRows.toLocaleString("it-IT")} righe senza valori numerici escluse.</span>}
    </div>;
  }
  return <div className="rpt-widget-content rpt-chart-widget"><ChartView widget={widget} dataset={dataset} theme={theme} data={data} /></div>;
}
