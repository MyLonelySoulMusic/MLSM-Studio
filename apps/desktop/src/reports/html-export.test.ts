import { describe, expect, it } from "vitest";
import { createDemoDashboard } from "./data";
import { createDashboardHtml } from "./html-export";
import { createWidget } from "./types";

describe("Reports standalone HTML export", () => {
  it("exports KPI metadata only when enabled", () => {
    const dashboard = createDemoDashboard();
    dashboard.widgets = [dashboard.widgets[0]!];

    const compact = createDashboardHtml(dashboard);
    expect(compact).not.toContain("Somma · Visualizzazioni");
    expect(compact).not.toContain("18 righe · Performance dei canali");

    dashboard.widgets[0]!.showKpiLabel = true;
    dashboard.widgets[0]!.showKpiMeta = true;
    const detailed = createDashboardHtml(dashboard);
    expect(detailed).toContain("Somma · Visualizzazioni");
    expect(detailed).toContain("18 righe · Performance dei canali");
  });

  it("exports an embeddable dashboard with tabs, real maps and escaped user content", () => {
    const dashboard = createDemoDashboard();
    dashboard.description = '</script><script>alert("x")</script>';
    dashboard.datasets[0]!.rows.forEach((row, index) => { row["field-2"] = ["IT", "Francia", "Roma"][index % 3]!; });
    const tab = { id: "tab-geography", name: "Geografia" };
    const row = { id: "row-geography", tabId: tab.id, columns: null };
    const map = {
      ...createWidget("map", dashboard.datasets[0], row.id),
      title: "Mappa mercati",
      dimension: "field-2",
      measure: "field-3",
      color: "#123ABC",
      mapBackground: "#E4E4E4",
    };
    dashboard.widgets[0]!.animation = {
      type: "timeSeries", chartType: "line", dimension: "field-1", timeGrain: "month",
      valueMode: "cumulative", showTrendLine: true, highlightMaximum: true,
    };
    dashboard.widgets[1]!.animation = {
      type: "barRace", dateDimension: "field-1", groupDimension: "field-2", measure: "field-3",
      aggregation: "sum", timeGrain: "month", valueMode: "period", orientation: "vertical", sort: "desc", stepDurationMs: 1800,
    };
    const columns = { ...createWidget("column", dashboard.datasets[0], dashboard.layoutRows[0]!.id), title: "Colonne ricavi", dimension: "field-2", measure: "field-5", xAxisLabel: "Canale custom", yAxisLabel: "Ricavo custom" };
    dashboard.tabs.push(tab);
    dashboard.layoutRows.push(row);
    dashboard.widgets.push(map);
    dashboard.widgets.push(columns);

    const html = createDashboardHtml(dashboard);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('data-tab="tab-geography"');
    expect(html).toContain("Geografia");
    expect(html).toContain("Mappa mercati");
    expect(html).not.toContain('</script><script>alert("x")</script>');
    expect(html).toContain("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
    expect(html).toContain("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    expect(html).toContain("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(html).toContain("OpenStreetMap</a> contributors");
    expect(html).toContain('data-color="#123ABC"');
    expect(html).toContain('data-background="#E4E4E4"');
    expect(html).toContain("filter:grayscale(1) saturate(0)");
    expect(html).toContain('class="animation-play"');
    expect(html).toContain("openAnimation(payload)");
    expect(html).toContain("&quot;showTrendLine&quot;:true");
    expect(html).toContain("&quot;valueMode&quot;:&quot;cumulative&quot;");
    expect(html).toContain("Colonne ricavi");
    expect(html).toContain("Canale custom");
    expect(html).toContain("Ricavo custom");
    expect(html).toContain("Bar Chart Race");
    expect(html).toContain("openBarRace(payload)");
    expect(html).toContain("&quot;orientation&quot;:&quot;vertical&quot;");
    expect(html).toContain("&quot;stepDurationMs&quot;:1800");
    expect(html).toContain("&quot;decimals&quot;:0");
    expect(html).toContain('class="race-viewport"');
    expect(html).toContain("payload.decimals===0?Math.round(value):value");
  });
});
