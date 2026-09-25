import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarController, BarElement, CategoryScale, Chart, Filler, Legend, LinearScale,
  LineController, LineElement, PointElement, Tooltip, type ChartDataset, type Plugin,
} from "chart.js";
import { aggregateWidget, formatReportNumber } from "./aggregation";
import { filtersForWidget } from "./filter-targets";
import { ReportIcon } from "./ReportIcon";
import { AGGREGATION_LABELS_BY_LANGUAGE, type ReportDataset, type ReportFilter, type ReportTheme, type ReportWidget } from "./types";
import { TIME_GRAIN_LABELS_BY_LANGUAGE } from "./time-buckets";
import { playbackPointIndex, timeSeriesPlaybackTiming, timeSeriesPoints, timeSeriesRevealProgress } from "./time-series-playback";
import { useUiPreferences } from "../services/ui-preferences";

Chart.register(BarController, BarElement, CategoryScale, Filler, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip);

interface TimeSeriesAnimationModalProps {
  widget: ReportWidget;
  dataset: ReportDataset;
  filters: ReportFilter[];
  theme: ReportTheme;
  onClose: () => void;
}

function trend(values: number[]): number[] {
  if (values.length < 2) return values;
  const count = values.length;
  const xAverage = (count - 1) / 2;
  const yAverage = values.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - xAverage) * (value - yAverage);
    denominator += (index - xAverage) ** 2;
  });
  const slope = denominator ? numerator / denominator : 0;
  return values.map((_, index) => yAverage + slope * (index - xAverage));
}

export function TimeSeriesAnimationModal({ widget, dataset, filters, theme, onClose }: TimeSeriesAnimationModalProps) {
  const { language } = useUiPreferences();
  const locale = language === "en" ? "en-GB" : "it-IT";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [playbackPhase, setPlaybackPhase] = useState<"series" | "trend" | "complete">("series");
  const animation = widget.animation?.type === "timeSeries" ? widget.animation : null;
  const color = widget.color || theme.accent;
  const activeFilters = useMemo(() => filtersForWidget(filters, widget.id, widget.datasetId), [filters, widget.datasetId, widget.id]);
  const data = useMemo(() => {
    if (!animation) return null;
    const aggregated = aggregateWidget({
      ...widget,
      type: animation.chartType,
      dimension: animation.dimension,
      timeGrain: animation.timeGrain,
      sort: "source",
      xSort: "asc",
      limit: null,
    }, dataset, activeFilters, language);
    return { ...aggregated, points: timeSeriesPoints(aggregated.points, animation.valueMode) };
  }, [activeFilters, animation, dataset, language, widget]);
  const values = useMemo(() => data?.points.map(point => point.value) ?? [], [data]);
  const timing = useMemo(() => timeSeriesPlaybackTiming(values.length, Boolean(animation?.showTrendLine)), [animation?.showTrendLine, values.length]);
  const maximumIndex = values.length ? values.reduce((best, value, index) => value > values[best]! ? index : best, 0) : -1;
  const dimensionName = dataset.fields.find(field => field.id === animation?.dimension)?.name ?? (language === "en" ? "Time" : "Tempo");
  const measureName = widget.aggregation === "count" ? (language === "en" ? "Rows" : "Righe") : dataset.fields.find(field => field.id === widget.measure)?.name ?? (language === "en" ? "Value" : "Valore");

  function requestClose() {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onClose, 220);
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") requestClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  useEffect(() => {
    setPlaybackIndex(-1);
    setPlaybackPhase("series");
    if (!values.length) return;
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) {
      setPlaybackIndex(values.length - 1);
      setPlaybackPhase("complete");
      return;
    }
    const startedAt = performance.now();
    let previousIndex = -2;
    let previousPhase: typeof playbackPhase = "series";
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const index = playbackPointIndex(elapsed, values.length, timing);
      if (index !== previousIndex) { previousIndex = index; setPlaybackIndex(index); }
      const phase = animation?.showTrendLine
        ? elapsed >= timing.totalDuration ? "complete" : elapsed >= timing.trendStart ? "trend" : "series"
        : elapsed >= timing.seriesEnd ? "complete" : "series";
      if (phase !== previousPhase) { previousPhase = phase; setPlaybackPhase(phase); }
      if (elapsed < timing.totalDuration) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animation?.showTrendLine, replayKey, timing, values.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !animation || !data?.points.length) return;
    // JSDOM intentionally has no canvas implementation; the semantic preview
    // remains testable without pretending to render pixels.
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return;
    const line = animation.chartType !== "bar";
    const trendStep = values.length ? timing.trendDuration / values.length : 0;
    const animationDelay = (datasetIndex: number, dataIndex: number) => datasetIndex === 0
      ? timing.startDelay + (dataIndex * timing.stepDelay)
      : timing.trendStart + (dataIndex * trendStep);
    const animationDuration = (datasetIndex: number) => datasetIndex === 0
      ? timing.pointDuration
      : Math.max(1, trendStep);
    const primary: ChartDataset<"line" | "bar", number[]> = {
      type: line ? "line" : "bar",
      label: `${AGGREGATION_LABELS_BY_LANGUAGE[language][widget.aggregation]} · ${measureName}`,
      data: values,
      backgroundColor: line ? `${color}24` : values.map((_, index) => animation.highlightMaximum && index === maximumIndex ? theme.ink : `${color}d9`),
      borderColor: color,
      borderWidth: line ? 3 : 0,
      borderRadius: line ? 0 : 7,
      maxBarThickness: 54,
      fill: animation.chartType === "area",
      tension: 0.32,
      pointRadius: line ? values.map((_, index) => animation.highlightMaximum && index === maximumIndex ? 8 : values.length > 35 ? 0 : 3.5) : 0,
      pointHoverRadius: 8,
      pointBackgroundColor: line ? values.map((_, index) => animation.highlightMaximum && index === maximumIndex ? theme.ink : color) : color,
      pointBorderColor: theme.paper,
      pointBorderWidth: 2,
    };
    const trendDataset: ChartDataset<"line" | "bar", number[]> = {
      type: "line",
      label: language === "en" ? "Trend line" : "Linea di tendenza",
      data: trend(values),
      borderColor: theme.ink,
      borderWidth: 2,
      borderDash: [7, 6],
      pointRadius: 0,
      fill: false,
      tension: 0,
    };
    const startedAt = performance.now();
    const maximumReveal = timing.startDelay + (maximumIndex * timing.stepDelay);
    const revealPlugin: Plugin<"line" | "bar"> = {
      id: `mlsm-maximum-${widget.id}-${replayKey}`,
      beforeDatasetDraw(chart, args) {
        const elapsed = performance.now() - startedAt;
        const duration = args.index === 0 ? timing.seriesEnd - timing.startDelay : timing.trendDuration;
        const offset = args.index === 0 ? timing.startDelay : timing.trendStart;
        const reveal = timeSeriesRevealProgress(elapsed, offset, duration);
        if (reveal === null) return false;
        const { left, right, top, bottom } = chart.chartArea;
        chart.ctx.save();
        chart.ctx.beginPath();
        chart.ctx.rect(left - 12, top - 20, ((right - left) * reveal) + 24, (bottom - top) + 40);
        chart.ctx.clip();
      },
      afterDatasetDraw(chart) {
        chart.ctx.restore();
      },
      afterDatasetsDraw(chart: Chart<"line" | "bar">) {
        if (!animation.highlightMaximum || maximumIndex < 0) return;
        const elapsed = performance.now() - startedAt - maximumReveal;
        if (elapsed < 0 || elapsed > 1_150) return;
        const element = chart.getDatasetMeta(0).data[maximumIndex];
        if (!element) return;
        const progress = elapsed / 1_150;
        const pulse = Math.sin(progress * Math.PI);
        const context = chart.ctx;
        context.save();
        context.beginPath();
        context.arc(element.x, element.y, 12 + (progress * 25), 0, Math.PI * 2);
        context.strokeStyle = `${color}${Math.round((1 - progress) * 150).toString(16).padStart(2, "0")}`;
        context.lineWidth = 3 + (pulse * 2);
        context.stroke();
        context.beginPath();
        context.arc(element.x, element.y, 10 + (pulse * 7), 0, Math.PI * 2);
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.stroke();
        context.restore();
      },
    };
    const chart = new Chart(canvas, {
      type: line ? "line" : "bar",
      data: {
        labels: data.points.map(point => point.label),
        datasets: animation.showTrendLine && values.length > 1 ? [primary, trendDataset] : [primary],
      },
      plugins: [revealPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animations: {
          x: {
            type: "number",
            easing: "easeOutCubic",
            duration: context => context.type === "data" ? animationDuration(context.datasetIndex) : timing.pointDuration,
            delay: context => context.type === "data" ? animationDelay(context.datasetIndex, context.dataIndex) : 0,
            from: context => context.type === "data"
              ? context.chart.scales.x?.getPixelForValue(Math.max(0, context.dataIndex - 1))
              : 0,
          },
          y: {
            type: "number",
            easing: "easeOutQuart",
            duration: context => context.type === "data" ? animationDuration(context.datasetIndex) : timing.pointDuration,
            delay: context => context.type === "data" ? animationDelay(context.datasetIndex, context.dataIndex) : 0,
            from: context => {
              if (context.type !== "data") return 0;
              if (animation.chartType === "bar" && context.datasetIndex === 0) return context.chart.scales.y?.getPixelForValue(0);
              const previous = context.chart.getDatasetMeta(context.datasetIndex).data[Math.max(0, context.dataIndex - 1)];
              return previous?.getProps(["y"], true).y ?? context.chart.scales.y?.getPixelForValue(0);
            },
          },
          radius: {
            type: "number",
            easing: "easeOutBack",
            duration: context => context.type === "data" && context.datasetIndex === 1 ? 0 : context.type === "data" && context.dataIndex === maximumIndex ? 950 : 360,
            delay: context => context.type === "data" ? animationDelay(context.datasetIndex, context.dataIndex) : 0,
            from: 0,
          },
        },
        color: theme.ink,
        font: { family: "Inter, system-ui, sans-serif", size: 12 },
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: animation.showTrendLine, position: "top", align: "end", labels: { usePointStyle: true, boxWidth: 8, color: theme.ink } },
          tooltip: {
            backgroundColor: theme.ink,
            titleColor: theme.paper,
            bodyColor: theme.paper,
            padding: 12,
            callbacks: { label: context => `${context.dataset.label}: ${formatReportNumber(Number(context.raw), widget.format, widget.currency, widget.decimals, language)}` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: `${theme.ink}a6`, maxRotation: 35, autoSkip: true, maxTicksLimit: 14 }, title: { display: true, text: dimensionName, color: theme.ink } },
          y: { beginAtZero: false, grid: { color: `${theme.ink}12` }, border: { display: false }, ticks: { color: `${theme.ink}a6`, callback: value => formatReportNumber(Number(value), widget.format, widget.currency, widget.decimals, language) }, title: { display: true, text: measureName, color: theme.ink } },
        },
      },
    });
    return () => chart.destroy();
  }, [animation, color, data, dimensionName, language, maximumIndex, measureName, replayKey, theme.ink, theme.paper, timing, values, widget.aggregation, widget.currency, widget.decimals, widget.format, widget.id]);

  if (!animation) return null;
  const maximum = maximumIndex >= 0 ? data?.points[maximumIndex] : undefined;
  const current = playbackIndex >= 0 ? data?.points[playbackIndex] : undefined;
  const maximumReached = animation.highlightMaximum && maximumIndex >= 0 && playbackIndex >= maximumIndex;
  const progress = values.length ? Math.max(0, ((playbackIndex + 1) / values.length) * 100) : 0;
  return <div className={`rpt-modal-backdrop rpt-animation-backdrop${leaving ? " is-closing" : ""}`} onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <section className="rpt-modal rpt-animation-modal" role="dialog" aria-modal="true" aria-labelledby="rpt-animation-title">
      <header>
        <div><span className="rpt-eyebrow">TIME SERIES · {TIME_GRAIN_LABELS_BY_LANGUAGE[language][animation.timeGrain].toUpperCase()} · {animation.valueMode === "cumulative" ? (language === "en" ? "CUMULATIVE" : "CUMULATIVO") : (language === "en" ? "SINGLE PERIOD" : "SINGOLO PERIODO")}</span><h2 id="rpt-animation-title"><span data-no-localize>{widget.title}</span></h2><p>{language === "en" ? `${measureName} over time, sorted chronologically by ${dimensionName}${animation.valueMode === "cumulative" ? ", with a running total" : ""}.` : `${measureName} nel tempo, ordinato cronologicamente per ${dimensionName}${animation.valueMode === "cumulative" ? ", con somma progressiva" : ""}.`}</p></div>
        <button className="rpt-icon-button rpt-animation-close" aria-label="Chiudi animazione" onClick={requestClose}><ReportIcon name="close" /></button>
      </header>
      {data?.message ? <div className="rpt-animation-empty">{data.message}</div> : <>
        <div className="rpt-animation-chart">
          <canvas ref={canvasRef} role="img" aria-label={`Animazione temporale ${widget.title}`} />
          <div className="rpt-animation-live" aria-live="polite">
            {current ? <div key={`${replayKey}-${playbackIndex}`} className={playbackIndex === maximumIndex && animation.highlightMaximum ? "is-maximum" : ""}><small>{current.label}</small><strong>{formatReportNumber(current.value, widget.format, widget.currency, widget.decimals, language)}</strong>{playbackIndex === maximumIndex && animation.highlightMaximum && <em>{language === "en" ? "NEW MAXIMUM" : "NUOVO MASSIMO"}</em>}</div> : <span>Preparazione serie…</span>}
          </div>
          <div className="rpt-animation-progress" aria-label={`Avanzamento ${Math.round(progress)}%`}><i style={{ width: `${progress}%` }} /></div>
        </div>
        <footer className="rpt-animation-footer">
          <div><span>{data?.points.length.toLocaleString(locale)} periodi</span><span>{animation.valueMode === "cumulative" ? (language === "en" ? "Cumulative" : "Cumulativo") : (language === "en" ? "Single period" : "Singolo periodo")} · {AGGREGATION_LABELS_BY_LANGUAGE[language][widget.aggregation]} · {measureName}</span>{animation.showTrendLine && <span className={`rpt-animation-phase is-${playbackPhase}`}>{playbackPhase === "series" ? "Serie in riproduzione" : playbackPhase === "trend" ? "Calcolo tendenza" : "Riproduzione completa"}</span>}</div>
          {maximumReached && maximum && <strong className="rpt-animation-maximum"><small>{language === "en" ? "MAXIMUM REACHED" : "MASSIMO RAGGIUNTO"}</small>{maximum.label} · {formatReportNumber(maximum.value, widget.format, widget.currency, widget.decimals, language)}</strong>}
          <button className="rpt-button" onClick={() => setReplayKey(key => key + 1)}><ReportIcon name="play" />Riproduci di nuovo</button>
        </footer>
      </>}
    </section>
  </div>;
}
