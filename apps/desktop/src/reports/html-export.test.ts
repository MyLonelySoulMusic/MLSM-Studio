import { describe, expect, it } from "vitest";
import { createDemoDashboard } from "./data";
import { createDashboardHtml } from "./html-export";
import { createWidget } from "./types";

describe("Reports standalone HTML export", () => {
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
    dashboard.tabs.push(tab);
    dashboard.layoutRows.push(row);
    dashboard.widgets.push(map);

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
  });
});
