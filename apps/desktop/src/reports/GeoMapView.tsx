import { useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatReportNumber, type WidgetData } from "./aggregation";
import { buildGeoPoints } from "./geo";
import type { ReportTheme, ReportWidget } from "./types";
import type { UiLanguage } from "../services/ui-preferences";

const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

function tooltipNode(label: string, value: string): HTMLSpanElement {
  const element = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = label;
  element.append(name, document.createElement("br"), document.createTextNode(value));
  return element;
}

export default function GeoMapView({ widget, theme, data, language }: { widget: ReportWidget; theme: ReportTheme; data: WidgetData; language: UiLanguage }) {
  const container = useRef<HTMLDivElement>(null);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  const geo = useMemo(() => buildGeoPoints(data.points), [data.points]);
  const color = widget.color || theme.accent;

  useEffect(() => {
    if (!container.current || !geo.points.length) return;
    setTilesUnavailable(false);
    const map = L.map(container.current, { worldCopyJump: true, zoomControl: true });
    const tiles = L.tileLayer(OSM_TILES, { attribution: OSM_ATTRIBUTION, maxZoom: 19, minZoom: 1, crossOrigin: true });
    let tileErrors = 0;
    tiles.on("tileerror", () => { tileErrors += 1; if (tileErrors >= 3) setTilesUnavailable(true); });
    tiles.on("tileload", () => setTilesUnavailable(false));
    tiles.addTo(map);

    const maximum = Math.max(...geo.points.map(point => Math.abs(point.value)), 1);
    const bounds = L.latLngBounds([]);
    for (const point of geo.points) {
      const position = L.latLng(point.latitude, point.longitude);
      bounds.extend(position);
      L.circleMarker(position, {
        radius: Math.min(24, 6 + Math.sqrt(Math.abs(point.value) / maximum) * 16), color: widget.mapBackground, weight: 2,
        fillColor: color, fillOpacity: 0.82,
      }).bindTooltip(tooltipNode(point.label, formatReportNumber(point.value, widget.format, widget.currency, widget.decimals, language)), {
        direction: "top", opacity: 0.96,
      }).addTo(map);
    }
    if (geo.points.length === 1) {
      const point = geo.points[0]!;
      map.setView([point.latitude, point.longitude], point.kind === "country" ? 4 : 9);
    } else map.fitBounds(bounds, { padding: [30, 30], maxZoom: 7 });
    const frame = window.requestAnimationFrame(() => map.invalidateSize());
    return () => { window.cancelAnimationFrame(frame); map.remove(); };
  }, [color, geo.points, language, widget.currency, widget.decimals, widget.format, widget.mapBackground]);

  if (!geo.points.length) return <div className="rpt-widget-content rpt-widget-empty" role="status">Nessuna località riconosciuta. Usa codici ISO (IT, USA), nomi di nazioni, città comuni oppure coordinate “latitudine, longitudine”.</div>;
  return <div className="rpt-widget-content rpt-map-widget">
    <div ref={container} className="rpt-leaflet-map" style={{ backgroundColor: widget.mapBackground }} role="img" aria-label={`${widget.title}: mappa OpenStreetMap con ${geo.points.length} località riconosciute`} />
    <div className="rpt-map-legend"><span style={{ background: color }} />Dimensione bolla proporzionale al valore · cartografia OpenStreetMap</div>
    {tilesUnavailable && <p className="rpt-widget-note rpt-map-warning" role="status">Cartografia momentaneamente non disponibile. Controlla la connessione Internet; i punti geografici restano elaborati localmente.</p>}
    {geo.unresolved.length > 0 && <p className="rpt-widget-note">{geo.unresolved.length.toLocaleString(language === "en" ? "en-GB" : "it-IT")} località non riconosciute: {geo.unresolved.slice(0, 4).join(", ")}{geo.unresolved.length > 4 ? "…" : ""}</p>}
    <details className="rpt-chart-data"><summary>Mostra località <span>({geo.points.length.toLocaleString(language === "en" ? "en-GB" : "it-IT")})</span></summary><div className="rpt-table-wrap"><table className="rpt-data-table"><thead><tr><th>Località</th><th>Tipo</th><th>Latitudine</th><th>Longitudine</th><th>Valore</th></tr></thead><tbody>{geo.points.map(point => <tr key={`${point.label}-${point.latitude}-${point.longitude}`}><td data-no-localize>{point.label}</td><td>{point.kind === "country" ? "Nazione" : point.kind === "city" ? "Città" : "Coordinate"}</td><td>{point.latitude.toFixed(3)}</td><td>{point.longitude.toFixed(3)}</td><td>{formatReportNumber(point.value, widget.format, widget.currency, widget.decimals, language)}</td></tr>)}</tbody></table></div></details>
  </div>;
}
