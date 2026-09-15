import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WidgetView } from "./WidgetView";
import { createWidget, DEFAULT_REPORT_THEME, type ReportDataset } from "./types";

afterEach(cleanup);

const dataset: ReportDataset = {
  id: "source", name: "Campagna", sourceName: "campagna.csv",
  sources: [{ id: "source-campaign", fileName: "campagna.csv", sheetName: "Campagna", importedAt: "2026-01-01T00:00:00.000Z", rowCount: 3 }],
  fields: [{ id: "city", name: "Città", type: "text" }, { id: "value", name: "Valore", type: "number" }],
  rows: [{ city: "Milano", value: 10 }, { city: "Roma", value: 20 }, { city: "Torino", value: 30 }],
};

describe("Reports widget views", () => {
  it("paginates original table rows and resets pagination when filters change", () => {
    const widget = { ...createWidget("table", dataset), limit: 2 };
    const { rerender } = render(<WidgetView widget={widget} dataset={dataset} theme={DEFAULT_REPORT_THEME} filters={[]} />);
    expect(screen.getByRole("cell", { name: "Milano" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Torino" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pagina successiva/ }));
    expect(screen.getByRole("cell", { name: "Torino" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pagina successiva/ })).toBeDisabled();
    rerender(<WidgetView widget={widget} dataset={dataset} theme={DEFAULT_REPORT_THEME} filters={[{ id: "filter", datasetId: dataset.id, fieldId: "city", value: "Roma", defaultValue: "Roma", includeAll: true, targetMode: "all", widgetIds: [] }]} />);
    expect(screen.getByRole("cell", { name: "Roma" })).toBeInTheDocument();
    expect(screen.getByText("1–1 di 1 righe")).toBeInTheDocument();
  });

  it("shows an empty state for missing KPI values and a true zero for actual zero values", () => {
    const widget = createWidget("kpi", dataset);
    const { rerender } = render(<WidgetView widget={widget} dataset={{ ...dataset, rows: [{ city: "Roma", value: null }] }} theme={DEFAULT_REPORT_THEME} filters={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Nessun valore numerico");
    rerender(<WidgetView widget={widget} dataset={{ ...dataset, rows: [{ city: "Roma", value: 0 }] }} theme={DEFAULT_REPORT_THEME} filters={[]} />);
    expect(screen.getByText("0", { selector: "strong" })).toBeInTheDocument();
  });

  it("keeps KPI details hidden by default and shows only the explicitly enabled information", () => {
    const widget = createWidget("kpi", dataset);
    const { rerender } = render(<WidgetView widget={widget} dataset={dataset} theme={DEFAULT_REPORT_THEME} filters={[]} />);

    expect(screen.queryByText("Somma · Valore")).not.toBeInTheDocument();
    expect(screen.queryByText("3 righe · Campagna")).not.toBeInTheDocument();

    rerender(<WidgetView widget={{ ...widget, showKpiLabel: true, showKpiMeta: true }} dataset={dataset} theme={DEFAULT_REPORT_THEME} filters={[]} />);
    expect(screen.getByText("Somma · Valore")).toBeInTheDocument();
    expect(screen.getByText("3 righe · Campagna")).toBeInTheDocument();
  });

  it("renders imported notes as plain text without interpreting markup", () => {
    const widget = { ...createWidget("text"), text: '<img src="x" onerror="alert(1)">Report' };
    render(<WidgetView widget={widget} dataset={undefined} theme={DEFAULT_REPORT_THEME} filters={[]} />);
    expect(screen.getByText(widget.text)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("applies a targeted filter only to the selected widget", () => {
    const selectedWidget = { ...createWidget("table", dataset), id: "selected-widget" };
    const otherWidget = { ...selectedWidget, id: "other-widget" };
    const filters = [{ id: "filter", datasetId: dataset.id, fieldId: "city", value: "Roma", defaultValue: "Roma", includeAll: true, targetMode: "selected" as const, widgetIds: [selectedWidget.id] }];
    const { rerender } = render(<WidgetView widget={selectedWidget} dataset={dataset} theme={DEFAULT_REPORT_THEME} filters={filters} />);

    expect(screen.getByText("1–1 di 1 righe")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Roma" })).toBeInTheDocument();

    rerender(<WidgetView widget={otherWidget} dataset={dataset} theme={DEFAULT_REPORT_THEME} filters={filters} />);
    expect(screen.getByText("1–3 di 3 righe")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Milano" })).toBeInTheDocument();
  });

  it("renders a pivot table with month buckets and totals", () => {
    const pivotDataset: ReportDataset = {
      id: "pivot-source", name: "Vendite", sourceName: "vendite.csv",
      sources: [{ id: "source-pivot", fileName: "vendite.csv", sheetName: "Vendite", importedAt: "2026-01-01T00:00:00.000Z", rowCount: 3 }],
      fields: [
        { id: "date", name: "Data", type: "date" },
        { id: "channel", name: "Canale", type: "text" },
        { id: "value", name: "Ricavi", type: "number" },
      ],
      rows: [
        { date: "2026-01-03", channel: "Web", value: 10 },
        { date: "2026-01-20", channel: "Web", value: 20 },
        { date: "2026-02-02", channel: "Negozio", value: 30 },
      ],
    };
    const widget = {
      ...createWidget("pivot", pivotDataset), dimension: "date", secondaryDimension: "channel",
      measure: "value", timeGrain: "month" as const,
    };
    render(<WidgetView widget={widget} dataset={pivotDataset} theme={DEFAULT_REPORT_THEME} filters={[]} />);

    expect(screen.getByRole("table", { name: /Tabella pivot: Data per Canale/ })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "gen 2026" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "feb 2026" })).toBeInTheDocument();
    expect(screen.getAllByText("60").length).toBeGreaterThan(0);
  });

  it("renders an interactive OpenStreetMap from city and country labels", async () => {
    Object.defineProperty(SVGSVGElement.prototype, "createSVGRect", { configurable: true, value: () => ({}) });
    const mapDataset: ReportDataset = {
      ...dataset,
      rows: [{ city: "Roma", value: 20 }, { city: "IT", value: 10 }, { city: "Atlantide", value: 5 }],
    };
    const widget = { ...createWidget("map", mapDataset), dimension: "city", measure: "value", mapBackground: "#E0E0E0", color: "#211B1F" };
    render(<WidgetView widget={widget} dataset={mapDataset} theme={DEFAULT_REPORT_THEME} filters={[]} />);

    expect(await screen.findByRole("img", { name: /mappa OpenStreetMap con 2 località riconosciute/ })).toHaveStyle({ backgroundColor: "#E0E0E0" });
    expect(screen.getByText(/1 località non riconosciute: Atlantide/)).toBeInTheDocument();
    expect(screen.getByText(/cartografia OpenStreetMap/)).toBeInTheDocument();
  });
});
