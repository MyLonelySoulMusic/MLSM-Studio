import { aggregateWidget, displayCell, filterRows, formatReportNumber } from "./aggregation";
import { filtersForWidget } from "./filter-targets";
import { buildGeoPoints } from "./geo";
import { buildPivotTable } from "./pivot";
import { validateDashboard } from "./storage";
import { AGGREGATION_LABELS, type ReportDashboard, type ReportWidget } from "./types";
import { timeSeriesPoints } from "./time-series-playback";
import { barRaceValueDecimals, buildBarRaceFrames } from "./bar-race-playback";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function format(value: number, widget: ReportWidget): string {
  return formatReportNumber(value, widget.format, widget.currency, widget.decimals);
}

function renderPointTable(widget: ReportWidget, points: { label: string; value: number }[]): string {
  return `<details><summary>Dati del grafico (${points.length.toLocaleString("it-IT")})</summary><div class="table-wrap"><table><thead><tr><th>Categoria</th><th>Valore</th></tr></thead><tbody>${points.map(point => `<tr><td>${escapeHtml(point.label)}</td><td>${escapeHtml(format(point.value, widget))}</td></tr>`).join("")}</tbody></table></div></details>`;
}

function tickIndexes(length: number, maximum: number | null): number[] {
  if (length < 1) return [];
  const count = Math.max(2, Math.min(length, maximum ?? 8));
  return [...new Set(Array.from({ length: count }, (_, index) => Math.round(index * (length - 1) / Math.max(1, count - 1))))];
}

function numericTicks(minimum: number, maximum: number, count: number | null): number[] {
  const total = Math.max(2, count ?? 6);
  return Array.from({ length: total }, (_, index) => minimum + (maximum - minimum) * index / (total - 1));
}

function renderAxisTitles(xAxisTitle: string, yAxisTitle: string): string {
  return `<text class="axis-title" x="505" y="494" text-anchor="middle">${escapeHtml(xAxisTitle)}</text><text class="axis-title" x="17" y="250" text-anchor="middle" transform="rotate(-90 17 250)">${escapeHtml(yAxisTitle)}</text>`;
}

function renderChart(widget: ReportWidget, points: { label: string; value: number }[], accent: string, xAxisTitle: string, yAxisTitle: string): string {
  if (!points.length) return `<p class="empty">Nessun valore disponibile.</p>`;
  const automaticMaximum = Math.max(...points.map(point => Math.abs(point.value)), 1);
  const maximum = widget.type === "bar" && widget.xAxisMax !== null ? Math.max(Math.abs(widget.xAxisMax), 1) : automaticMaximum;
  if (widget.type === "bar") return `<div class="bar-axis-titles"><span>${escapeHtml(yAxisTitle)}</span><strong>${escapeHtml(xAxisTitle)}</strong></div><div class="bars">${points.map(point => `<div><span title="${escapeHtml(point.label)}">${widget.showYTicks ? escapeHtml(point.label) : ""}</span><i><b style="width:${Math.max(2, Math.min(100, Math.abs(point.value) / maximum * 100))}%;background:${accent}"></b></i><strong>${escapeHtml(format(point.value, widget))}</strong></div>`).join("")}</div>${renderPointTable(widget, points)}`;
  if (widget.type === "column") {
    const domainMin = widget.yAxisMin ?? Math.min(...points.map(point => point.value), 0);
    const domainMax = widget.yAxisMax ?? Math.max(...points.map(point => point.value), 0, 1);
    const span = domainMax - domainMin || 1;
    const left = widget.showYTicks ? 88 : 35; const right = 970; const top = 25; const bottom = widget.showXTicks ? 430 : 470;
    const width = (right - left) / Math.max(1, points.length);
    const y = (value: number) => bottom - (Math.max(domainMin, Math.min(domainMax, value)) - domainMin) / span * (bottom - top);
    const zero = y(Math.max(domainMin, Math.min(domainMax, 0)));
    const yTicks = widget.showYTicks ? numericTicks(domainMin, domainMax, widget.yTickCount).map(value => `<line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" stroke="#211b1f12"/><text x="${left - 10}" y="${y(value) + 5}" text-anchor="end">${escapeHtml(format(value, widget))}</text>`).join("") : "";
    const xTicks = new Set(tickIndexes(points.length, widget.xTickCount));
    return `<svg class="chart columns" viewBox="0 0 1000 500" role="img" aria-label="${escapeHtml(widget.title)}">${yTicks}${points.map((point, index) => { const pointY = y(point.value); const x = left + (index * width); const barWidth = Math.max(5, width - 12); return `<g><rect x="${x + 6}" y="${Math.min(pointY, zero)}" width="${barWidth}" height="${Math.max(2, Math.abs(zero - pointY))}" rx="6" fill="${accent}"><title>${escapeHtml(point.label)}: ${escapeHtml(format(point.value, widget))}</title></rect>${widget.showXTicks && xTicks.has(index) ? `<text x="${x + width / 2}" y="460" text-anchor="middle">${escapeHtml(point.label)}</text>` : ""}</g>`; }).join("")}${renderAxisTitles(xAxisTitle, yAxisTitle)}</svg>${renderPointTable(widget, points)}`;
  }
  if (widget.type === "doughnut") {
    const positive = points.filter(point => point.value >= 0);
    const total = positive.reduce((sum, point) => sum + point.value, 0) || 1;
    let cursor = 0;
    const colors = [accent, "#211B1F", `${accent}AA`, "#72676D", `${accent}66`, "#B9AFB4"];
    const stops = positive.map((point, index) => { const start = cursor; cursor += point.value / total * 100; return `${colors[index % colors.length]} ${start}% ${cursor}%`; }).join(",");
    return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${stops})"><span>${escapeHtml(format(total, widget))}</span></div><div class="legend">${positive.map((point, index) => `<span><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(point.label)}</span>`).join("")}</div></div>${renderPointTable(widget, points)}`;
  }
  const values = points.map(point => point.value);
  const min = widget.yAxisMin ?? Math.min(...values, 0); const max = widget.yAxisMax ?? Math.max(...values, 0, 1); const span = max - min || 1;
  const left = widget.showYTicks ? 88 : 35; const right = 970; const top = 25; const bottom = widget.showXTicks ? 430 : 470;
  const x = (index: number) => points.length === 1 ? (left + right) / 2 : left + index * (right - left) / (points.length - 1);
  const y = (value: number) => bottom - (Math.max(min, Math.min(max, value)) - min) / span * (bottom - top);
  const coordinates = points.map((point, index) => `${x(index)},${y(point.value)}`);
  const fill = widget.type === "area" ? `<polygon points="${left},${bottom} ${coordinates.join(" ")} ${right},${bottom}" fill="${accent}22"/>` : "";
  const yTicks = widget.showYTicks ? numericTicks(min, max, widget.yTickCount).map(value => `<line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" stroke="#211b1f12"/><text x="${left - 10}" y="${y(value) + 5}" text-anchor="end">${escapeHtml(format(value, widget))}</text>`).join("") : "";
  const xTicks = new Set(tickIndexes(points.length, widget.xTickCount));
  const xLabels = widget.showXTicks ? points.map((point, index) => xTicks.has(index) ? `<text x="${x(index)}" y="462" text-anchor="middle">${escapeHtml(point.label)}</text>` : "").join("") : "";
  return `<svg class="chart" viewBox="0 0 1000 500" role="img" aria-label="${escapeHtml(widget.title)}">${yTicks}${fill}<polyline points="${coordinates.join(" ")}" fill="none" stroke="${accent}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>${coordinates.map((point, index) => `<circle cx="${point.split(",")[0]}" cy="${point.split(",")[1]}" r="8" fill="${accent}"><title>${escapeHtml(points[index]!.label)}: ${escapeHtml(format(points[index]!.value, widget))}</title></circle>`).join("")}${xLabels}${renderAxisTitles(xAxisTitle, yAxisTitle)}</svg>${renderPointTable(widget, points)}`;
}

function renderScatter(widget: ReportWidget, points: { x: number; y: number }[], accent: string, xAxisTitle: string, yAxisTitle: string): string {
  if (!points.length) return `<p class="empty">Nessun valore disponibile.</p>`;
  const xMin = widget.xAxisMin ?? Math.min(...points.map(point => point.x), 0); const xMax = widget.xAxisMax ?? Math.max(...points.map(point => point.x), 0, 1);
  const yMin = widget.yAxisMin ?? Math.min(...points.map(point => point.y), 0); const yMax = widget.yAxisMax ?? Math.max(...points.map(point => point.y), 0, 1);
  const left = widget.showYTicks ? 88 : 35; const right = 970; const top = 25; const bottom = widget.showXTicks ? 430 : 470;
  const x = (value: number) => left + (Math.max(xMin, Math.min(xMax, value)) - xMin) / (xMax - xMin || 1) * (right - left);
  const y = (value: number) => bottom - (Math.max(yMin, Math.min(yMax, value)) - yMin) / (yMax - yMin || 1) * (bottom - top);
  const xTicks = widget.showXTicks ? numericTicks(xMin, xMax, widget.xTickCount).map(value => `<line x1="${x(value)}" y1="${top}" x2="${x(value)}" y2="${bottom}" stroke="#211b1f0b"/><text x="${x(value)}" y="462" text-anchor="middle">${escapeHtml(formatReportNumber(value, "number", "EUR", 2))}</text>`).join("") : "";
  const yTicks = widget.showYTicks ? numericTicks(yMin, yMax, widget.yTickCount).map(value => `<line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" stroke="#211b1f12"/><text x="${left - 10}" y="${y(value) + 5}" text-anchor="end">${escapeHtml(format(value, widget))}</text>`).join("") : "";
  return `<svg class="chart" viewBox="0 0 1000 500" role="img" aria-label="${escapeHtml(widget.title)}">${xTicks}${yTicks}${points.map(point => `<circle cx="${x(point.x)}" cy="${y(point.y)}" r="9" fill="${accent}"><title>${escapeHtml(point.x)}, ${escapeHtml(format(point.y, widget))}</title></circle>`).join("")}${renderAxisTitles(xAxisTitle, yAxisTitle)}</svg>`;
}

function renderMap(widget: ReportWidget, points: { label: string; value: number }[], dashboard: ReportDashboard): string {
  const geo = buildGeoPoints(points);
  if (!geo.points.length) return `<p class="empty">Nessuna località riconosciuta.</p>`;
  const maximum = Math.max(...geo.points.map(point => Math.abs(point.value)), 1);
  const accent = widget.color || dashboard.theme.accent;
  const payload = geo.points.map(point => ({
    latitude: point.latitude, longitude: point.longitude, label: point.label, kind: point.kind,
    displayValue: format(point.value, widget), radius: Math.min(24, 6 + Math.sqrt(Math.abs(point.value) / maximum) * 16),
  }));
  return `<div class="map" role="img" aria-label="${escapeHtml(widget.title)}" style="background:${widget.mapBackground}" data-points="${escapeHtml(JSON.stringify(payload))}" data-color="${accent}" data-background="${widget.mapBackground}"></div><p class="note">${geo.points.length} località riconosciute · cartografia OpenStreetMap${geo.unresolved.length ? ` · ${geo.unresolved.length} non riconosciute` : ""}</p>${renderPointTable(widget, points)}`;
}

function renderWidget(widget: ReportWidget, dashboard: ReportDashboard): string {
  const dataset = dashboard.datasets.find(item => item.id === widget.datasetId);
  const filters = filtersForWidget(dashboard.filters.map(filter => ({ ...filter, value: filter.defaultValue })), widget.id, widget.datasetId);
  const data = aggregateWidget(widget, dataset, filters);
  const accent = widget.color || dashboard.theme.accent;
  const dimensionName = dataset?.fields.find(field => field.id === widget.dimension)?.name ?? "Dimensione";
  const measureName = widget.aggregation === "count" && widget.type !== "scatter" ? "Righe" : dataset?.fields.find(field => field.id === widget.measure)?.name ?? "Valore";
  const valueLabel = widget.type === "scatter" ? measureName : `${AGGREGATION_LABELS[widget.aggregation]} · ${measureName}`;
  const xAxisTitle = widget.xAxisLabel.trim() || (widget.type === "bar" ? valueLabel : dimensionName);
  const yAxisTitle = widget.yAxisLabel.trim() || (widget.type === "bar" ? dimensionName : measureName);
  let content = "";
  if (widget.type === "text") content = `<div class="text">${escapeHtml(widget.text).replace(/\n/g, "<br>")}</div>`;
  else if (data.message) content = `<p class="empty">${escapeHtml(data.message)}</p>`;
  else if (widget.type === "kpi") {
    const measureName = widget.aggregation === "count" ? "" : dataset?.fields.find(field => field.id === widget.measure)?.name ?? "Misura";
    content = `<div class="kpi">${widget.showKpiLabel ? `<small>${escapeHtml(widget.aggregation === "count" ? AGGREGATION_LABELS.count : `${AGGREGATION_LABELS[widget.aggregation]} · ${measureName}`)}</small>` : ""}<strong style="color:${accent}">${data.value === null ? "—" : escapeHtml(format(data.value, widget))}</strong>${widget.showKpiMeta ? `<span>${data.rowCount.toLocaleString("it-IT")} righe · ${escapeHtml(dataset?.name)}</span>` : ""}</div>`;
  }
  else if (widget.type === "table" && dataset) {
    const rows = filterRows(dataset, filters).slice(0, widget.limit ?? 50);
    content = `<div class="table-wrap"><table><thead><tr>${dataset.fields.map(field => `<th>${escapeHtml(field.name)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${dataset.fields.map(field => `<td>${escapeHtml(displayCell(row[field.id]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  } else if (widget.type === "pivot" && dataset) {
    const pivot = buildPivotTable({ dataset, filters, rowFieldId: widget.dimension, columnFieldId: widget.secondaryDimension, measureFieldId: widget.measure, aggregation: widget.aggregation, timeGrain: widget.timeGrain, timeAxis: dataset.fields.find(field => field.id === widget.dimension)?.type === "date" ? "row" : "none" });
    content = pivot.message ? `<p class="empty">${escapeHtml(pivot.message)}</p>` : `<div class="table-wrap"><table><thead><tr><th>Righe × Colonne</th>${pivot.columnLabels.map(label => `<th>${escapeHtml(label)}</th>`).join("")}<th>Totale</th></tr></thead><tbody>${pivot.rowLabels.map((label, rowIndex) => `<tr><th>${escapeHtml(label)}</th>${pivot.cells[rowIndex]!.map(value => `<td>${value === null ? "—" : escapeHtml(format(value, widget))}</td>`).join("")}<td>${pivot.rowTotals[rowIndex] === null ? "—" : escapeHtml(format(pivot.rowTotals[rowIndex]!, widget))}</td></tr>`).join("")}</tbody></table></div>`;
  } else if (widget.type === "map") content = renderMap(widget, data.points, dashboard);
  else if (widget.type === "scatter") content = renderScatter(widget, data.scatter, accent, xAxisTitle, yAxisTitle);
  else content = renderChart(widget, data.points, accent, xAxisTitle, yAxisTitle);
  let animationButton = "";
  const animation = widget.animation;
  if (animation?.type === "timeSeries" && dataset) {
    const animated = aggregateWidget({ ...widget, type: animation.chartType, dimension: animation.dimension, timeGrain: animation.timeGrain, sort: "source", xSort: "asc", limit: null }, dataset, filters);
    if (animated.points.length) {
      const points = timeSeriesPoints(animated.points, animation.valueMode);
      const dimensionName = dataset.fields.find(field => field.id === animation.dimension)?.name ?? "Tempo";
      const measureName = widget.aggregation === "count" ? "Righe" : dataset.fields.find(field => field.id === widget.measure)?.name ?? "Valore";
      const payload = { type: "timeSeries",
        title: widget.title, dimensionName, measureName, chartType: animation.chartType,
        showTrendLine: animation.showTrendLine, highlightMaximum: animation.highlightMaximum,
        valueMode: animation.valueMode,
        grain: animation.timeGrain, color: accent, ink: dashboard.theme.ink, paper: dashboard.theme.paper,
        points: points.map(point => ({ ...point, displayValue: format(point.value, widget) })),
      };
      animationButton = `<button type="button" class="animation-play" data-animation="${escapeHtml(JSON.stringify(payload))}" aria-label="Riproduci animazione ${escapeHtml(widget.title)}"><span>▶</span> Time Series</button>`;
    }
  } else if (animation?.type === "barRace" && dataset) {
    const frames = buildBarRaceFrames(animation, dataset, filters);
    if (frames.length) {
      const groupName = dataset.fields.find(field => field.id === animation.groupDimension)?.name ?? "Gruppo";
      const measureName = animation.aggregation === "count" ? "Righe" : dataset.fields.find(field => field.id === animation.measure)?.name ?? "Valore";
      const payload = {
        type: "barRace", title: widget.title, groupName, measureName, orientation: animation.orientation,
        valueMode: animation.valueMode, grain: animation.timeGrain, stepDurationMs: animation.stepDurationMs,
        color: accent, ink: dashboard.theme.ink, paper: dashboard.theme.paper, format: widget.format, currency: widget.currency, decimals: barRaceValueDecimals(frames, widget.decimals),
        frames: frames.map(frame => ({ ...frame, points: frame.points.map(point => ({ id: point.id, label: point.label, value: point.value, rank: point.rank })) })),
      };
      animationButton = `<button type="button" class="animation-play" data-animation="${escapeHtml(JSON.stringify(payload))}" aria-label="Riproduci animazione ${escapeHtml(widget.title)}"><span>▶</span> Bar Chart Race</button>`;
    }
  }
  return `<article class="widget${animationButton ? " has-animation" : ""}" style="--span:${widget.width};min-height:${widget.height}px;${animationButton ? "" : "padding-bottom:18px"}"><h2>${escapeHtml(widget.title)}</h2>${content}${animationButton}</article>`;
}

export function createDashboardHtml(input: ReportDashboard): string {
  const dashboard = validateDashboard(input);
  const filters = dashboard.filters.map(filter => { const dataset = dashboard.datasets.find(item => item.id === filter.datasetId); const field = dataset?.fields.find(item => item.id === filter.fieldId); return `<span>${escapeHtml(field?.name)}: <b>${escapeHtml(filter.defaultValue ?? "Tutti")}</b></span>`; }).join("");
  const pages = dashboard.tabs.map((tab, tabIndex) => {
    const rows = dashboard.layoutRows.filter(row => row.tabId === tab.id);
    return `<section class="page" data-page="${escapeHtml(tab.id)}"${tabIndex ? " hidden" : ""}>${rows.map(row => `<div class="grid"${row.columns ? ` style="grid-template-columns:repeat(${row.columns},minmax(0,1fr))"` : ""}>${dashboard.widgets.filter(widget => widget.rowId === row.id).map(widget => renderWidget(widget, dashboard)).join("")}</div>`).join("")}</section>`;
  }).join("");
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(dashboard.name)} · MLSM Reports</title><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>
:root{--accent:${dashboard.theme.accent};--ink:${dashboard.theme.ink};--paper:${dashboard.theme.paper};font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:var(--ink);background:#f4f0f3}*{box-sizing:border-box}body{margin:0;padding:clamp(16px,4vw,52px)}main{max-width:1440px;margin:auto;padding:clamp(20px,4vw,48px);background:var(--paper);border:1px solid #211b1f18;border-radius:18px;box-shadow:0 25px 70px #211b1f18}header>small{letter-spacing:.16em;color:var(--accent);font-weight:800}h1{margin:.35rem 0;font-size:clamp(28px,4vw,48px)}header>p{color:#756970}.tabs{display:flex;gap:6px;margin:28px 0 14px;border-bottom:1px solid #211b1f1c}.tabs button{padding:11px 17px;border:0;border-bottom:3px solid transparent;background:none;color:#756970;font-weight:700;cursor:pointer}.tabs button[aria-selected=true]{border-color:var(--accent);color:var(--ink)}.filters{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}.filters span{padding:7px 10px;border-radius:999px;background:#ff4f9a12;font-size:12px}.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px;margin-bottom:14px}.widget{position:relative;grid-column:span var(--span);min-width:0;padding:18px 18px 52px;border:1px solid #211b1f14;border-radius:12px;background:var(--paper);box-shadow:0 8px 24px #211b1f0b;overflow:auto}.widget h2{margin:0 0 15px;font-size:14px}.kpi{display:grid;gap:10px}.kpi strong{font-size:clamp(34px,5vw,62px)}.kpi span,.note{font-size:11px;color:#82757c}.empty{display:grid;min-height:160px;place-items:center;color:#82757c}.bars{display:grid;gap:9px}.bars>div{display:grid;grid-template-columns:minmax(80px,1fr) 3fr auto;align-items:center;gap:10px;font-size:11px}.bars span{overflow:hidden;text-overflow:ellipsis}.bars i{height:10px;border-radius:9px;background:#211b1f0d;overflow:hidden}.bars b{display:block;height:100%;border-radius:9px}.chart,.map{width:100%;height:min(330px,45vw)}.map{border-radius:10px;background:#f2f0f1}.map .leaflet-tile-pane{filter:grayscale(1) saturate(0) contrast(.88) brightness(1.08);opacity:.68}.donut-wrap{display:flex;align-items:center;justify-content:center;gap:24px;min-height:220px}.donut{width:180px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center}.donut:after{content:"";grid-area:1/1;width:58%;aspect-ratio:1;border-radius:50%;background:var(--paper)}.donut span{grid-area:1/1;z-index:1;font-weight:800}.legend{display:grid;gap:7px;font-size:11px}.legend i{display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%}.table-wrap{max-width:100%;overflow:auto}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:8px;border-bottom:1px solid #211b1f12;text-align:left;white-space:nowrap}details{margin-top:12px;font-size:10px}summary{cursor:pointer;color:#756970}.text{line-height:1.65;white-space:normal}.animation-play{position:absolute;right:14px;bottom:13px;padding:7px 11px;border:1px solid #ff4f9a55;border-radius:99px;background:var(--paper);color:var(--ink);box-shadow:0 6px 18px #211b1f16;font-size:10px;font-weight:800;cursor:pointer}.animation-play span{color:var(--accent)}.animation-overlay{position:fixed;inset:0;z-index:999;padding:24px;background:#211b1fa3;backdrop-filter:blur(6px);display:grid;place-items:center;animation:fade-in .28s ease}.animation-overlay.closing{animation:fade-out .22s ease both}.animation-modal{width:min(1100px,96vw);max-height:88vh;overflow:hidden;border:1px solid #ff4f9a44;border-radius:18px;background:var(--paper);box-shadow:0 35px 110px #211b1f55;animation:modal-in .36s cubic-bezier(.2,.8,.2,1)}.animation-overlay.closing .animation-modal{animation:modal-out .22s ease both}.animation-head{padding:23px 28px;border-bottom:1px solid #211b1f16;display:flex;align-items:flex-start;justify-content:space-between}.animation-head small{color:var(--accent);font-weight:850;letter-spacing:.13em}.animation-head h2{margin:5px 0}.animation-close{width:34px;height:34px;border:1px solid #211b1f20;border-radius:50%;background:var(--paper);font-size:20px;cursor:pointer}.animation-stage{height:min(54vh,520px);padding:22px 27px 8px}.animation-stage svg{width:100%;height:100%;overflow:visible}.animation-foot{min-height:70px;padding:10px 28px 20px;display:flex;align-items:center;gap:12px;color:#756970;font-size:11px}.animation-max{margin-left:auto;color:var(--ink);font-weight:800}.animation-line{stroke-dasharray:1800;stroke-dashoffset:1800;animation:draw-line 1.45s cubic-bezier(.2,.8,.2,1) forwards}.animation-area{opacity:0;animation:show-area .8s .5s ease forwards}.animation-bar{transform-box:fill-box;transform-origin:center bottom;animation:grow-bar .8s cubic-bezier(.2,.8,.2,1) both}.animation-point{opacity:0;animation:show-point .28s ease forwards}.animation-peak{filter:drop-shadow(0 0 8px var(--accent))}@keyframes fade-in{from{opacity:0}}@keyframes fade-out{to{opacity:0}}@keyframes modal-in{from{opacity:0;transform:translateY(28px) scale(.965)}}@keyframes modal-out{to{opacity:0;transform:translateY(18px) scale(.975)}}@keyframes draw-line{to{stroke-dashoffset:0}}@keyframes show-area{to{opacity:1}}@keyframes grow-bar{from{transform:scaleY(0)}}@keyframes show-point{to{opacity:1}}@media(max-width:900px){.widget{grid-column:1/-1!important}.grid{grid-template-columns:1fr!important}.donut-wrap{flex-direction:column}}@media(prefers-reduced-motion:reduce){.animation-overlay,.animation-modal,.animation-line,.animation-area,.animation-bar,.animation-point{animation-duration:.01ms!important;animation-delay:0s!important}}
.chart text{font:17px Inter,system-ui,sans-serif;fill:var(--ink)}.chart .axis-title{font-size:18px;font-weight:800}.bar-axis-titles{margin:0 0 12px;display:grid;grid-template-columns:minmax(80px,1fr) 3fr auto;gap:10px;color:#6f6269;font-size:11px}.bar-axis-titles strong{text-align:center}.race-viewport{position:relative;height:min(55vh,520px);min-height:350px;overflow:hidden}.race-stage{height:100%;padding:62px 28px 32px;overflow:auto}.race-period{position:absolute;z-index:3;right:28px;top:15px;font-size:32px;font-weight:800}.race{position:relative;height:100%;min-height:270px}.race-item{position:absolute;inset:0 0 auto;display:grid;grid-template-columns:minmax(90px,150px) 1fr minmax(75px,110px);align-items:center;gap:10px}.race-item>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:700}.race-item>i{height:25px;border-radius:6px;background:#211b1f0b;overflow:hidden}.race-item b{display:block;height:100%;min-width:2px;border-radius:inherit;background:var(--accent)}.race-item>strong{font-size:12px;font-variant-numeric:tabular-nums}.race.vertical{min-width:500px;border-bottom:1px solid #211b1f1c}.race.vertical .race-item{inset:auto auto 0 0;height:100%;display:grid;grid-template-columns:1fr;grid-template-rows:25px 1fr 32px;justify-items:center;padding:0 5px}.race.vertical .race-item>i{width:min(58%,50px);height:100%;display:flex;align-items:flex-end}.race.vertical .race-item b{width:100%;height:0}.race.vertical .race-item>span{grid-row:3;padding-top:7px;text-align:center}.race.vertical .race-item>strong{grid-row:1}.race-progress{position:absolute;z-index:4;left:28px;right:28px;bottom:8px;height:3px;border-radius:9px;background:#211b1f12;overflow:hidden;pointer-events:none}.race-progress i{display:block;height:100%;background:var(--accent)}
</style></head><body><main><header><small>MLSM REPORTS · EMBED</small><h1>${escapeHtml(dashboard.name)}</h1>${dashboard.description ? `<p>${escapeHtml(dashboard.description)}</p>` : ""}</header><nav class="tabs" aria-label="Pagine dashboard">${dashboard.tabs.map((tab, index) => `<button type="button" data-tab="${escapeHtml(tab.id)}" aria-selected="${index === 0}">${escapeHtml(tab.name)}</button>`).join("")}</nav>${filters ? `<div class="filters">${filters}</div>` : ""}${pages}</main><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
document.querySelectorAll('[data-tab]').forEach(function(button){button.addEventListener('click',function(){document.querySelectorAll('[data-tab]').forEach(function(item){item.setAttribute('aria-selected',String(item===button))});document.querySelectorAll('[data-page]').forEach(function(page){page.hidden=page.getAttribute('data-page')!==button.getAttribute('data-tab')});requestAnimationFrame(function(){document.querySelectorAll('[data-page]:not([hidden]) .map').forEach(function(element){if(element._mlsmMap)element._mlsmMap.invalidateSize()})})})});
document.querySelectorAll('.map[data-points]').forEach(function(element){if(!window.L){element.textContent='Mappa non disponibile: controlla la connessione Internet.';return}var points=JSON.parse(element.getAttribute('data-points')||'[]');var map=L.map(element,{worldCopyJump:true});element._mlsmMap=map;L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,minZoom:1,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);var bounds=L.latLngBounds([]);points.forEach(function(point){var position=L.latLng(point.latitude,point.longitude);bounds.extend(position);var marker=L.circleMarker(position,{radius:point.radius,color:element.dataset.background,weight:2,fillColor:element.dataset.color,fillOpacity:.82}).addTo(map);marker.bindTooltip(document.createTextNode(point.label+' · '+point.displayValue),{direction:'top'})});if(points.length===1){map.setView([points[0].latitude,points[0].longitude],points[0].kind==='country'?4:9)}else{map.fitBounds(bounds,{padding:[30,30],maxZoom:7})}});
var svgNS='http://www.w3.org/2000/svg';function svgNode(name,attrs){var node=document.createElementNS(svgNS,name);Object.keys(attrs||{}).forEach(function(key){node.setAttribute(key,String(attrs[key]))});return node}function closeAnimation(){var overlay=document.querySelector('.animation-overlay');if(!overlay)return;overlay.classList.add('closing');setTimeout(function(){overlay.remove()},220)}function openAnimation(payload){var overlay=document.createElement('div');overlay.className='animation-overlay';overlay.innerHTML='<section class="animation-modal" role="dialog" aria-modal="true"><header class="animation-head"><div><small>TIME SERIES</small><h2></h2><p></p></div><button class="animation-close" aria-label="Chiudi animazione">×</button></header><div class="animation-stage"></div><footer class="animation-foot"><span></span><strong class="animation-max"></strong></footer></section>';overlay.querySelector('h2').textContent=payload.title;overlay.querySelector('.animation-head small').textContent='TIME SERIES · '+(payload.valueMode==='cumulative'?'CUMULATIVO':'SINGOLO PERIODO');overlay.querySelector('.animation-head p').textContent=payload.measureName+' nel tempo · '+payload.dimensionName;overlay.querySelector('.animation-foot span').textContent=payload.points.length+' periodi · '+payload.grain+' · '+(payload.valueMode==='cumulative'?'cumulativo':'singolo periodo');overlay.querySelector('.animation-close').addEventListener('click',closeAnimation);overlay.addEventListener('click',function(event){if(event.target===overlay)closeAnimation()});document.body.appendChild(overlay);var stage=overlay.querySelector('.animation-stage');var svg=svgNode('svg',{viewBox:'0 0 1000 500',role:'img','aria-label':'Animazione temporale '+payload.title});stage.appendChild(svg);var values=payload.points.map(function(point){return point.value});var min=Math.min.apply(Math,values.concat([0]));var max=Math.max.apply(Math,values.concat([0]));var span=max-min||1;var x=function(index){return payload.points.length===1?500:60+index*890/(payload.points.length-1)};var y=function(value){return 430-(value-min)/span*370};for(var grid=0;grid<5;grid++){svg.appendChild(svgNode('line',{x1:55,y1:60+grid*92,x2:960,y2:60+grid*92,stroke:payload.ink+'14','stroke-width':1}))}var points=values.map(function(value,index){return [x(index),y(value)]});var maximumIndex=values.reduce(function(best,value,index){return value>values[best]?index:best},0);if(payload.chartType==='bar'){var width=Math.max(8,Math.min(58,700/values.length));points.forEach(function(point,index){var zero=y(0);var rect=svgNode('rect',{x:point[0]-width/2,y:Math.min(point[1],zero),width:width,height:Math.max(2,Math.abs(zero-point[1])),rx:6,fill:payload.highlightMaximum&&index===maximumIndex?payload.ink:payload.color,class:'animation-bar'+(payload.highlightMaximum&&index===maximumIndex?' animation-peak':'')});rect.style.animationDelay=Math.min(index*45,600)+'ms';svg.appendChild(rect)})}else{var coords=points.map(function(point){return point.join(',')}).join(' ');if(payload.chartType==='area'){svg.appendChild(svgNode('polygon',{points:'60,430 '+coords+' 950,430',fill:payload.color+'22',class:'animation-area'}))}svg.appendChild(svgNode('polyline',{points:coords,fill:'none',stroke:payload.color,'stroke-width':7,'stroke-linecap':'round','stroke-linejoin':'round',class:'animation-line'}));points.forEach(function(point,index){var peak=payload.highlightMaximum&&index===maximumIndex;var circle=svgNode('circle',{cx:point[0],cy:point[1],r:peak?10:5,fill:peak?payload.ink:payload.color,stroke:payload.paper,'stroke-width':3,class:'animation-point'+(peak?' animation-peak':'')});circle.style.animationDelay=(800+Math.min(index*35,600))+'ms';svg.appendChild(circle)})}if(payload.showTrendLine&&values.length>1){var n=values.length,xa=(n-1)/2,ya=values.reduce(function(sum,value){return sum+value},0)/n,num=0,den=0;values.forEach(function(value,index){num+=(index-xa)*(value-ya);den+=(index-xa)*(index-xa)});var slope=den?num/den:0;var trend=values.map(function(_,index){return [x(index),y(ya+slope*(index-xa))]}).map(function(point){return point.join(',')}).join(' ');svg.appendChild(svgNode('polyline',{points:trend,fill:'none',stroke:payload.ink,'stroke-width':3,'stroke-dasharray':'10 9',opacity:.72,class:'animation-line'}))}if(payload.highlightMaximum){overlay.querySelector('.animation-max').textContent='MASSIMO · '+payload.points[maximumIndex].label+' · '+payload.points[maximumIndex].displayValue}}document.querySelectorAll('.animation-play').forEach(function(button){button.addEventListener('click',function(){openAnimation(JSON.parse(button.getAttribute('data-animation')||'{}'))})});document.addEventListener('keydown',function(event){if(event.key==='Escape')closeAnimation()});
var openTimeSeriesAnimation=openAnimation;
function openBarRace(payload){
  var overlay=document.createElement('div');overlay.className='animation-overlay';
  overlay.innerHTML='<section class="animation-modal" role="dialog" aria-modal="true"><header class="animation-head"><div><small>CORSA DELLE BARRE</small><h2></h2><p></p></div><button class="animation-close" aria-label="Chiudi animazione">×</button></header><div class="race-viewport"><strong class="race-period"></strong><div class="race-stage"><div class="race"></div></div><div class="race-progress"><i></i></div></div><footer class="animation-foot"><span></span></footer></section>';
  overlay.querySelector('h2').textContent=payload.title;overlay.querySelector('.animation-head p').textContent=payload.measureName+' per '+payload.groupName;overlay.querySelector('.animation-foot span').textContent=payload.frames.length+' periodi · '+payload.grain+' · '+(payload.valueMode==='cumulative'?'cumulativo':'singolo periodo');
  overlay.querySelector('.animation-close').addEventListener('click',closeAnimation);overlay.addEventListener('click',function(event){if(event.target===overlay)closeAnimation()});document.body.appendChild(overlay);
  var race=overlay.querySelector('.race');if(payload.orientation==='vertical')race.classList.add('vertical');var period=overlay.querySelector('.race-period');var progressBar=overlay.querySelector('.race-progress i');var frames=payload.frames;var count=frames[0].points.length;var rowHeight=Math.max(34,Math.min(58,430/count));if(payload.orientation!=='vertical')race.style.height=Math.max(270,rowHeight*count)+'px';var maximum=Math.max.apply(Math,[1].concat(frames.reduce(function(all,frame){return all.concat(frame.points.map(function(point){return Math.abs(point.value)}))},[])));var nodes={};
  var numberOptions={maximumFractionDigits:payload.decimals};if(payload.format==='currency'){numberOptions.style='currency';numberOptions.currency=payload.currency;numberOptions.currencyDisplay='narrowSymbol'}else if(payload.format==='percent'){numberOptions.style='percent'}var formatter=new Intl.NumberFormat('it-IT',numberOptions);
  frames[0].points.forEach(function(point){var item=document.createElement('div');item.className='race-item';var label=document.createElement('span');label.textContent=point.label;label.title=point.label;var track=document.createElement('i');var bar=document.createElement('b');track.appendChild(bar);var value=document.createElement('strong');item.appendChild(label);item.appendChild(track);item.appendChild(value);race.appendChild(item);nodes[point.id]={item:item,bar:bar,value:value}});
  function renderRace(from,to,amount,index){var previous={};from.points.forEach(function(point){previous[point.id]=point});to.points.forEach(function(point){var start=previous[point.id]||{value:0,rank:count};var value=start.value+(point.value-start.value)*amount;var rank=start.rank+(point.rank-start.rank)*amount;var node=nodes[point.id];if(payload.orientation==='vertical'){node.item.style.width=(100/count)+'%';node.item.style.transform='translateX('+(rank*100)+'%)';node.bar.style.height=(Math.abs(value)/maximum*100)+'%'}else{node.item.style.height=(rowHeight-7)+'px';node.item.style.transform='translateY('+(rank*rowHeight)+'px)';node.bar.style.width=(Math.abs(value)/maximum*100)+'%'}node.value.textContent=formatter.format(payload.decimals===0?Math.round(value):value)});period.textContent=(amount>.5?to:from).label;progressBar.style.width=(((index+amount)/Math.max(1,frames.length-1))*100)+'%'}
  renderRace(frames[0],frames[Math.min(1,frames.length-1)],0,0);if(frames.length<2)return;var started=performance.now()+400;function tick(now){var elapsed=Math.max(0,now-started);var index=Math.floor(elapsed/payload.stepDurationMs);if(index>=frames.length-1){renderRace(frames[frames.length-1],frames[frames.length-1],1,frames.length-1);return}var raw=(elapsed%payload.stepDurationMs)/payload.stepDurationMs;var eased=raw<.5?4*raw*raw*raw:1-Math.pow(-2*raw+2,3)/2;renderRace(frames[index],frames[index+1],eased,index);requestAnimationFrame(tick)}requestAnimationFrame(tick)
}
openAnimation=function(payload){return payload.type==='barRace'?openBarRace(payload):openTimeSeriesAnimation(payload)};
</script></body></html>`;
}
