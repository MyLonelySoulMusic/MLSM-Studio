import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatReportNumber } from "./aggregation";
import { barRaceValueDecimals, buildBarRaceFrames, interpolateBarRaceFrames } from "./bar-race-playback";
import { filtersForWidget } from "./filter-targets";
import { ReportIcon } from "./ReportIcon";
import { AGGREGATION_LABELS_BY_LANGUAGE, type BarRaceAnimation, type ReportDataset, type ReportFilter, type ReportTheme, type ReportWidget } from "./types";
import { TIME_GRAIN_LABELS_BY_LANGUAGE } from "./time-buckets";
import { useUiPreferences } from "../services/ui-preferences";

interface BarRaceAnimationModalProps {
  widget: ReportWidget;
  dataset: ReportDataset;
  filters: ReportFilter[];
  theme: ReportTheme;
  onClose: () => void;
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value ** 3 : 1 - ((-2 * value + 2) ** 3) / 2;
}

function colorFor(id: string, color: string, ink: string): string {
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  const palette = [color, ink, `${color}C7`, `${ink}B8`, `${color}91`, `${ink}7A`];
  return palette[Math.abs(hash) % palette.length] ?? color;
}

export function BarRaceAnimationModal({ widget, dataset, filters, theme, onClose }: BarRaceAnimationModalProps) {
  const { language } = useUiPreferences();
  const locale = language === "en" ? "en-GB" : "it-IT";
  const animation = widget.animation?.type === "barRace" ? widget.animation : null;
  const [leaving, setLeaving] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [playback, setPlayback] = useState({ frameIndex: 0, progress: 0, complete: false });
  const activeFilters = useMemo(() => filtersForWidget(filters, widget.id, widget.datasetId), [filters, widget.datasetId, widget.id]);
  const frames = useMemo(() => animation ? buildBarRaceFrames(animation, dataset, activeFilters, language) : [], [activeFilters, animation, dataset, language]);
  const color = widget.color || theme.accent;
  const globalMaximum = useMemo(() => Math.max(1, ...frames.flatMap(frame => frame.points.map(point => Math.abs(point.value)))), [frames]);
  const displayDecimals = useMemo(() => barRaceValueDecimals(frames, widget.decimals), [frames, widget.decimals]);
  const groupName = dataset.fields.find(field => field.id === animation?.groupDimension)?.name ?? (language === "en" ? "Group" : "Gruppo");
  const dateName = dataset.fields.find(field => field.id === animation?.dateDimension)?.name ?? (language === "en" ? "Date" : "Data");
  const measureName = animation?.aggregation === "count"
    ? (language === "en" ? "Rows" : "Righe")
    : dataset.fields.find(field => field.id === animation?.measure)?.name ?? (language === "en" ? "Value" : "Valore");

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
    setPlayback({ frameIndex: 0, progress: 0, complete: frames.length <= 1 });
    if (frames.length <= 1) return;
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) {
      setPlayback({ frameIndex: frames.length - 1, progress: 1, complete: true });
      return;
    }
    const animationConfig = animation as BarRaceAnimation;
    const delay = 420;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = Math.max(0, now - startedAt - delay);
      const rawIndex = Math.floor(elapsed / animationConfig.stepDurationMs);
      if (rawIndex >= frames.length - 1) {
        setPlayback({ frameIndex: frames.length - 1, progress: 1, complete: true });
        return;
      }
      const progress = easeInOutCubic((elapsed % animationConfig.stepDurationMs) / animationConfig.stepDurationMs);
      setPlayback({ frameIndex: Math.max(0, rawIndex), progress, complete: false });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animation, frames, replayKey]);

  if (!animation) return null;
  const from = frames[Math.min(playback.frameIndex, Math.max(0, frames.length - 1))];
  const to = frames[Math.min(playback.frameIndex + 1, Math.max(0, frames.length - 1))];
  const points = from && to ? interpolateBarRaceFrames(from, to, playback.complete ? 1 : playback.progress) : [];
  const period = playback.complete || playback.progress >= 0.5 ? to : from;
  const timelineProgress = frames.length <= 1 ? 100 : Math.min(100, ((playback.frameIndex + playback.progress) / (frames.length - 1)) * 100);
  const rowHeight = Math.max(34, Math.min(58, 440 / Math.max(1, points.length)));

  return <div className={`rpt-modal-backdrop rpt-animation-backdrop${leaving ? " is-closing" : ""}`} onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <section className="rpt-modal rpt-animation-modal rpt-bar-race-modal" role="dialog" aria-modal="true" aria-labelledby="rpt-bar-race-title">
      <header>
        <div><span className="rpt-eyebrow">{language === "en" ? "BAR CHART RACE" : "CORSA DELLE BARRE"} · {TIME_GRAIN_LABELS_BY_LANGUAGE[language][animation.timeGrain].toUpperCase()}</span><h2 id="rpt-bar-race-title">{widget.title}</h2><p>{language === "en" ? `${measureName} by ${groupName}, evolving chronologically through ${dateName}.` : `${measureName} per ${groupName}, in evoluzione cronologica attraverso ${dateName}.`}</p></div>
        <button className="rpt-icon-button rpt-animation-close" aria-label={language === "en" ? "Close animation" : "Chiudi animazione"} onClick={requestClose}><ReportIcon name="close" /></button>
      </header>
      {!frames.length ? <div className="rpt-animation-empty">{language === "en" ? "No valid periods are available for this animation." : "Nessun periodo valido disponibile per questa animazione."}</div> : <>
        <div className={`rpt-bar-race-viewport is-${animation.orientation}`}>
          <div className="rpt-bar-race-period" aria-live="polite"><strong>{period?.label}</strong><small>{playback.complete ? (language === "en" ? "Completed" : "Completata") : (language === "en" ? "In progress" : "In corso")}</small></div>
          <div className={`rpt-bar-race-stage is-${animation.orientation}`}>
            {animation.orientation === "horizontal" ? <div className="rpt-bar-race-horizontal" style={{ height: `${Math.max(260, rowHeight * points.length)}px` }}>
              {points.map(point => <div key={point.id} className="rpt-bar-race-row" style={{ transform: `translateY(${point.rank * rowHeight}px)`, height: `${rowHeight - 7}px` }}>
                <span title={point.label}>{point.label}</span><i><b style={{ width: `${Math.abs(point.value) / globalMaximum * 100}%`, background: colorFor(point.id, color, theme.ink) }} /></i><strong>{formatReportNumber(point.value, widget.format, widget.currency, displayDecimals, language)}</strong>
              </div>)}
            </div> : <div className="rpt-bar-race-vertical">
              {points.map(point => <div key={point.id} className="rpt-bar-race-column" style={{ "--rpt-race-rank": point.rank, "--rpt-race-count": points.length } as CSSProperties}>
                <strong>{formatReportNumber(point.value, widget.format, widget.currency, displayDecimals, language)}</strong><i><b style={{ height: `${Math.abs(point.value) / globalMaximum * 100}%`, background: colorFor(point.id, color, theme.ink) }} /></i><span title={point.label}>{point.label}</span>
              </div>)}
            </div>}
          </div>
          <div className="rpt-animation-progress" aria-label={`${language === "en" ? "Progress" : "Avanzamento"} ${Math.round(timelineProgress)}%`}><i style={{ width: `${timelineProgress}%` }} /></div>
        </div>
        <footer className="rpt-animation-footer">
          <div><span>{frames.length.toLocaleString(locale)} {language === "en" ? "periods" : "periodi"}</span><span>{animation.valueMode === "cumulative" ? (language === "en" ? "Cumulative" : "Cumulativo") : (language === "en" ? "Single period" : "Singolo periodo")}</span><span>{AGGREGATION_LABELS_BY_LANGUAGE[language][animation.aggregation]} · {measureName}</span><span>{(animation.stepDurationMs / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })}s / step</span></div>
          <button className="rpt-button" onClick={() => setReplayKey(key => key + 1)}><ReportIcon name="play" />{language === "en" ? "Play again" : "Riproduci di nuovo"}</button>
        </footer>
      </>}
    </section>
  </div>;
}
