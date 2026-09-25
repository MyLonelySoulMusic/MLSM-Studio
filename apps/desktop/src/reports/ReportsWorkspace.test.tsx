import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportsWorkspace } from "./ReportsWorkspace";
import { createDemoDashboard } from "./data";

const reportMocks = vi.hoisted(() => ({
  listDashboards: vi.fn(),
  saveDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
  downloadDashboard: vi.fn(),
  downloadDashboardHtml: vi.fn(),
  dashboardEmbedCode: vi.fn(),
}));

vi.mock("./storage", () => ({
  deleteDashboard: reportMocks.deleteDashboard,
  importDashboard: vi.fn(),
  listDashboards: reportMocks.listDashboards,
  saveDashboard: reportMocks.saveDashboard,
}));

vi.mock("./files", () => ({ downloadDashboard: reportMocks.downloadDashboard, downloadDashboardHtml: reportMocks.downloadDashboardHtml, dashboardEmbedCode: reportMocks.dashboardEmbedCode }));

vi.mock("./WidgetView", () => ({
  WidgetView: ({ widget }: { widget: { title: string } }) => <div data-testid="report-widget-preview">{widget.title}</div>,
}));

async function renderReports() {
  const onHome = vi.fn();
  const onOpenViewer = vi.fn();
  render(<ReportsWorkspace onHome={onHome} onOpenViewer={onOpenViewer} />);
  await waitFor(() => expect(reportMocks.listDashboards).toHaveBeenCalledTimes(1));
  return { onHome, onOpenViewer };
}

describe("ReportsWorkspace", () => {
  beforeEach(() => {
    reportMocks.listDashboards.mockResolvedValue([]);
    reportMocks.saveDashboard.mockResolvedValue(undefined);
    reportMocks.deleteDashboard.mockResolvedValue(undefined);
    reportMocks.downloadDashboard.mockResolvedValue(true);
    reportMocks.downloadDashboardHtml.mockResolvedValue(true);
    reportMocks.dashboardEmbedCode.mockReturnValue('<iframe src="MLSM-Report.html"></iframe>');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renderizza l'area Reports vuota con dati, widget e CTA principali", async () => {
    const { onHome } = await renderReports();

    expect(screen.getByRole("main", { name: "MLSM Reports" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Una storia da raccontare/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carica il tuo primo file" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Origini e campi" })).toHaveTextContent("Carica un file per esplorare dimensioni e misure.");
    expect(screen.getByRole("complementary", { name: "Widget e proprietà" })).toHaveTextContent("12 tipi");
    expect(screen.getByRole("button", { name: /Le mie dashboard/ })).toHaveTextContent("0");
    expect(onHome).not.toHaveBeenCalled();
  });

  it("carica l'esempio dimostrativo con origine, widget e palette MLSM", async () => {
    await renderReports();

    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));

    expect(screen.getByRole("heading", { name: "MLSM · Audience & crescita" })).toBeInTheDocument();
    expect(screen.getByText("Performance dei canali")).toBeInTheDocument();
    expect(screen.getByText("18 righe · 5 campi · 1 file")).toBeInTheDocument();
    expect(screen.getAllByText(/5 widget/).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("report-widget-preview")).toHaveLength(5);
    expect(screen.getByText("Modifiche da salvare")).toBeInTheDocument();
  });

  it("configura come opt-in i dettagli KPI e personalizza separatamente le tacche X e Y", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));

    fireEvent.click(screen.getByRole("article", { name: "Widget Visualizzazioni totali" }));
    const aggregationDetail = screen.getByRole("checkbox", { name: /Mostra aggregazione e misura/ });
    const sourceDetail = screen.getByRole("checkbox", { name: /Mostra righe e origine dati/ });
    expect(aggregationDetail).not.toBeChecked();
    expect(sourceDetail).not.toBeChecked();
    fireEvent.click(aggregationDetail);
    fireEvent.click(sourceDetail);

    fireEvent.click(screen.getByRole("article", { name: "Widget Un pubblico in crescita" }));
    fireEvent.click(screen.getByText("ASSI E TACCHE"));
    fireEvent.change(screen.getByLabelText("Etichetta asse X"), { target: { value: "Periodo editoriale" } });
    fireEvent.change(screen.getByLabelText("Etichetta asse Y"), { target: { value: "Stream totali" } });
    fireEvent.change(screen.getByLabelText("Numero massimo tacche X"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Numero massimo tacche Y"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Minimo asse Y"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Massimo asse Y"), { target: { value: "100000" } });
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Mostra etichette delle tacche" })[0]!);

    fireEvent.click(screen.getByRole("button", { name: "Salva dashboard" }));
    await waitFor(() => expect(reportMocks.saveDashboard).toHaveBeenCalledOnce());
    const saved = reportMocks.saveDashboard.mock.calls[0]![0];
    expect(saved.widgets.find((widget: { title: string }) => widget.title === "Visualizzazioni totali")).toMatchObject({ showKpiLabel: true, showKpiMeta: true });
    expect(saved.widgets.find((widget: { title: string }) => widget.title === "Un pubblico in crescita")).toMatchObject({ xAxisLabel: "Periodo editoriale", yAxisLabel: "Stream totali", showXTicks: false, showYTicks: true, xTickCount: 7, yTickCount: 5, yAxisMin: 100, yAxisMax: 100000 });
  });

  it("creates an aggregate calculated field and exposes it in fields, preview and saved JSON", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));

    expect(screen.getByRole("button", { name: "Impostazioni Reports" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Crea campo calcolato/ }));
    const dialog = screen.getByRole("dialog", { name: "Crea un campo calcolato" });
    fireEvent.change(within(dialog).getByLabelText("Nome campo"), { target: { value: "Ricavo per vista" } });
    fireEvent.change(within(dialog).getByLabelText("Formula"), { target: { value: "SUM([Ricavi]) / SUM([Visualizzazioni])" } });
    expect(dialog).toHaveTextContent("Formula aggregata");
    fireEvent.click(within(dialog).getByRole("button", { name: "Crea campo" }));

    expect(screen.getByRole("button", { name: /Ricavo per vista Aggregato/ })).toHaveTextContent("ƒx");
    fireEvent.click(screen.getByRole("button", { name: /Anteprima dati/ }));
    expect(screen.getByRole("columnheader", { name: /Ricavo per vista MLSM Formula/ })).toHaveClass("is-calculated");
    fireEvent.click(screen.getByRole("button", { name: "Salva dashboard" }));
    await waitFor(() => expect(reportMocks.saveDashboard).toHaveBeenCalledOnce());
    expect(reportMocks.saveDashboard.mock.calls[0]![0].datasets[0].fields.at(-1)).toMatchObject({ name: "Ricavo per vista", calculated: { formula: "SUM([Ricavi]) / SUM([Visualizzazioni])" } });
  });

  it("sostituisce il file mantenendo dataset e riferimenti dei widget anche con colonne riordinate", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));

    fireEvent.click(screen.getByRole("button", { name: "Sostituisci intera origine Performance dei canali" }));
    const replacement = new File([
      "Ricavi,Canale,Mese,Visualizzazioni,Regione\n2200,Instagram,2026-07-01,88000,Europa\n1750,YouTube,2026-07-01,64000,Europa",
    ], "aggiornato.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Scegli file dati sostitutivo"), { target: { files: [replacement] } });

    await waitFor(() => expect(screen.getByText(/Origine sostituita/)).toBeInTheDocument());
    expect(screen.getByText("aggiornato")).toBeInTheDocument();
    expect(screen.getByText("2 righe · 6 campi · 1 file")).toBeInTheDocument();
    expect(screen.getAllByTestId("report-widget-preview")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Salva dashboard" }));
    await waitFor(() => expect(reportMocks.saveDashboard).toHaveBeenCalledOnce());
    const savedDashboard = reportMocks.saveDashboard.mock.calls[0]![0];
    const dataset = savedDashboard.datasets[0]!;
    expect(dataset.sourceName).toBe("aggiornato.csv");
    expect(dataset.fields.find((field: { name: string }) => field.name === "Ricavi")?.id).toBe("field-5");
    expect(dataset.fields.find((field: { name: string }) => field.name === "Mese")?.id).toBe("field-1");
    expect(dataset.fields.find((field: { name: string }) => field.name === "Interazioni")?.id).toBe("field-4");
    expect(dataset.rows.every((row: Record<string, unknown>) => row["field-4"] === null)).toBe(true);
    expect(savedDashboard.widgets.every((widget: { datasetId: string }) => widget.datasetId === dataset.id)).toBe(true);
  });

  it("appende, sostituisce e rimuove singoli file rigenerando il dataset combinato", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi file a Performance dei canali" }));
    const july = new File([
      "Mese,Canale,Visualizzazioni,Interazioni,Ricavi\n2026-07-01,Instagram,88000,7600,3400\n2026-07-01,YouTube,64000,5400,2700",
    ], "luglio.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Scegli file da aggiungere al dataset"), { target: { files: [july] } });

    await waitFor(() => expect(screen.getByText(/luglio\.csv aggiunto/)).toBeInTheDocument());
    expect(screen.getByText("20 righe · 5 campi · 2 file")).toBeInTheDocument();
    expect(screen.getByText("MLSM-demo.csv")).toBeInTheDocument();
    expect(screen.getByText("luglio.csv")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sostituisci file luglio.csv" }));
    const august = new File([
      "Ricavi,Interazioni,Visualizzazioni,Canale,Mese\n4100,8200,93000,Instagram,2026-08-01",
    ], "agosto.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Scegli sostituto del file nel dataset"), { target: { files: [august] } });

    await waitFor(() => expect(screen.getByText(/agosto\.csv sostituito/)).toBeInTheDocument());
    expect(screen.getByText("19 righe · 5 campi · 2 file")).toBeInTheDocument();
    expect(screen.queryByText("luglio.csv")).not.toBeInTheDocument();
    expect(screen.getByText("agosto.csv")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rimuovi file agosto.csv" }));
    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toHaveTextContent("Sarà rimossa 1 riga");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Rimuovi file" }));

    expect(screen.getByText("18 righe · 5 campi · 1 file")).toBeInTheDocument();
    expect(screen.queryByText("agosto.csv")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salva dashboard" }));
    await waitFor(() => expect(reportMocks.saveDashboard).toHaveBeenCalledOnce());
    expect(reportMocks.saveDashboard.mock.calls[0]![0].datasets[0].sources).toEqual([
      expect.objectContaining({ fileName: "MLSM-demo.csv", rowCount: 18 }),
    ]);
  });

  it("aggiunge un widget alla dashboard e lo seleziona nell'inspector", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));

    const inspector = screen.getByRole("complementary", { name: "Widget e proprietà" });
    fireEvent.click(within(inspector).getByRole("button", { name: "Barre orizzontali" }));

    expect(screen.getAllByText(/6 widget/).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("report-widget-preview")).toHaveLength(6);
    expect(screen.getByLabelText("Titolo")).toHaveValue("Barre orizzontali");
  });

  it("apre la scelta dei widget dal pulsante Aggiungi widget e crea una pivot", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi widget" }));
    const chooser = screen.getByRole("dialog", { name: "Scegli un widget" });
    expect(within(chooser).getByRole("button", { name: /Tabella pivot/ })).toHaveTextContent("NUOVO");

    fireEvent.click(within(chooser).getByRole("button", { name: /Tabella pivot/ }));

    expect(screen.queryByRole("dialog", { name: "Scegli un widget" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/6 widget/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Titolo")).toHaveValue("Tabella pivot");
    expect(screen.getByLabelText(/^Righe/)).toBeInTheDocument();
    expect(screen.getByLabelText("Colonne")).toBeInTheDocument();
  });

  it("creates independent dashboard tabs and lets each tab be renamed", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));

    fireEvent.click(screen.getByRole("button", { name: "Nuovo tab" }));
    expect(screen.getByRole("button", { name: /Pagina 2/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryAllByTestId("report-widget-preview")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Nome tab attivo"), { target: { value: "Geografia" } });
    expect(screen.getByRole("button", { name: /Geografia/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi widget" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Scegli un widget" })).getByRole("button", { name: /Mappa geografica/ }));
    expect(screen.getByLabelText("Titolo")).toHaveValue("Mappa geografica");
    expect(screen.getByLabelText("Tipo widget")).toHaveValue("map");

    fireEvent.click(screen.getByRole("button", { name: /Pagina 1/ }));
    expect(screen.getAllByTestId("report-widget-preview")).toHaveLength(5);
  });

  it("changes an existing widget type without recreating its title or layout", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));
    const widget = screen.getByRole("article", { name: "Widget Visualizzazioni totali" });

    fireEvent.click(within(widget).getByRole("button", { name: "Cambia tipo Visualizzazioni totali" }));
    const chooser = screen.getByRole("dialog", { name: "Cambia tipo di widget" });
    fireEvent.click(within(chooser).getByRole("button", { name: /Mappa geografica/ }));

    expect(screen.getByLabelText("Titolo")).toHaveValue("Visualizzazioni totali");
    expect(screen.getByLabelText("Tipo widget")).toHaveValue("map");
    expect(screen.getByLabelText("Larghezza manuale (1–12)")).toHaveValue(4);
    expect(screen.getByLabelText("Colore sfondo mappa")).toHaveValue("#f2f0f1");
    expect(screen.getByLabelText("Colore pallini mappa")).toHaveValue("#ff4f9a");

    fireEvent.change(screen.getByLabelText("Colore sfondo mappa"), { target: { value: "#e0e0e0" } });
    fireEvent.change(screen.getByLabelText("Colore pallini mappa"), { target: { value: "#211b1f" } });
    expect(screen.getByLabelText("Colore sfondo mappa")).toHaveValue("#e0e0e0");
    expect(screen.getByLabelText("Colore pallini mappa")).toHaveValue("#211b1f");
  });

  it("exports standalone HTML and shows the iframe embed snippet", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));
    fireEvent.click(screen.getByRole("button", { name: "Esporta HTML" }));

    await waitFor(() => expect(reportMocks.downloadDashboardHtml).toHaveBeenCalledOnce());
    const dialog = await screen.findByRole("dialog", { name: "Dashboard pronta da incorporare" });
    expect(within(dialog).getByLabelText("Codice HTML incorporamento")).toHaveValue('<iframe src="MLSM-Report.html"></iframe>');
    expect(reportMocks.dashboardEmbedCode).toHaveBeenCalledOnce();
  });

  it("crea un filtro e permette di associarlo solo ai widget selezionati", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Filtri/ }));

    const menu = screen.getByRole("region", { name: "Configura filtri dashboard" });
    fireEvent.change(within(menu).getByLabelText("Campo"), { target: { value: "field-2" } });
    fireEvent.click(within(menu).getByRole("button", { name: "Crea filtro" }));
    const defaultValue = within(menu).getByLabelText("Valore iniziale filtro Canale");
    expect(defaultValue).toHaveValue("null");
    fireEvent.change(defaultValue, { target: { value: JSON.stringify("YouTube") } });
    expect(screen.getByLabelText("Filtro Canale")).toHaveValue(JSON.stringify("YouTube"));
    const includeAll = within(menu).getByRole("checkbox", { name: "Includi l’opzione “(Tutti)”" });
    expect(includeAll).toBeChecked();
    fireEvent.click(includeAll);
    expect(within(screen.getByLabelText("Filtro Canale")).queryByRole("option", { name: "(Tutti)" })).not.toBeInTheDocument();
    fireEvent.change(within(menu).getByLabelText("Destinazione filtro Canale"), { target: { value: "selected" } });

    const target = within(menu).getByRole("checkbox", { name: /Visualizzazioni totali/ });
    expect(target).not.toBeChecked();
    fireEvent.click(target);
    expect(target).toBeChecked();
    expect(screen.queryByText("1 widget")).not.toBeInTheDocument();
  });

  it("applica i colori custom alla palette della dashboard", async () => {
    await renderReports();
    const main = screen.getByRole("main", { name: "MLSM Reports" });

    fireEvent.change(screen.getByLabelText("Colore accento"), { target: { value: "#123456" } });
    fireEvent.change(screen.getByLabelText("Colore testo"), { target: { value: "#654321" } });
    fireEvent.change(screen.getByLabelText("Colore sfondo"), { target: { value: "#f0f0f0" } });

    expect(main.style.getPropertyValue("--rpt-accent")).toBe("#123456");
    expect(main.style.getPropertyValue("--rpt-ink")).toBe("#654321");
    expect(main.style.getPropertyValue("--rpt-paper")).toBe("#f0f0f0");
    expect(screen.getByText("#123456")).toBeInTheDocument();
    expect(screen.getByText("#654321")).toBeInTheDocument();
    expect(screen.getByText("#F0F0F0")).toBeInTheDocument();
    expect(screen.getByText("Modifiche da salvare")).toBeInTheDocument();
  });

  it("protegge la dashboard quando si apre una nuova con modifiche non salvate", async () => {
    await renderReports();
    fireEvent.change(screen.getByLabelText("Nome dashboard"), { target: { value: "Bozza da conservare" } });

    fireEvent.click(screen.getByRole("button", { name: "Nuova" }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Modifiche non salvate");
    expect(screen.getByLabelText("Nome dashboard")).toHaveValue("Bozza da conservare");

    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nome dashboard")).toHaveValue("Bozza da conservare");

    fireEvent.click(screen.getByRole("button", { name: "Nuova" }));
    fireEvent.click(screen.getByRole("button", { name: "Continua senza salvare" }));
    expect(screen.getByLabelText("Nome dashboard")).toHaveValue("Dashboard senza titolo");
    expect(screen.getByText("Nuova dashboard")).toBeInTheDocument();
  });

  it("rende evidente e modificabile il nome della dashboard", async () => {
    await renderReports();
    const input = screen.getByLabelText("Nome dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Modifica nome dashboard" }));
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Report vendite Europa" } });
    expect(input).toHaveValue("Report vendite Europa");
    expect(screen.getByText("Modifiche non salvate")).toBeInTheDocument();
  });

  it("configura aggregazioni avanzate, valuta e larghezza manuale", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));
    fireEvent.click(screen.getByRole("article", { name: "Widget Visualizzazioni totali" }));
    const inspector = screen.getByRole("complementary", { name: "Widget e proprietà" });

    fireEvent.change(within(inspector).getByLabelText("Aggregazione"), { target: { value: "median" } });
    fireEvent.change(within(inspector).getByLabelText("Formato"), { target: { value: "currency" } });
    fireEvent.change(within(inspector).getByLabelText("Valuta"), { target: { value: "USD" } });
    fireEvent.change(within(inspector).getByLabelText("Larghezza predefinita"), { target: { value: "3" } });
    fireEvent.change(within(inspector).getByLabelText("Larghezza manuale (1–12)"), { target: { value: "5" } });

    expect(within(inspector).getByLabelText("Aggregazione")).toHaveValue("median");
    expect(within(inspector).getByLabelText("Valuta")).toHaveValue("USD");
    expect(within(inspector).getByLabelText("Larghezza manuale (1–12)")).toHaveValue(5);
  });

  it("usa un solo ordinamento e protegge la cronologia delle serie temporali", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));
    fireEvent.click(screen.getByRole("article", { name: "Widget Un pubblico in crescita" }));
    const order = screen.getByLabelText("Ordinamento grafico");
    expect(order).toHaveValue("x-asc");
    expect(within(order).queryByRole("option", { name: "Valore crescente" })).not.toBeInTheDocument();
    fireEvent.change(order, { target: { value: "x-desc" } });
    expect(order).toHaveValue("x-desc");
    expect(screen.getByText(/Sequenza temporale protetta/)).toBeInTheDocument();
  });

  it("permette di mostrare tutte, le prime N o le ultime N categorie", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));
    fireEvent.click(screen.getByRole("article", { name: "Widget Ricavi per canale" }));

    const categoryMode = screen.getByLabelText("Mostra categorie");
    expect(categoryMode).toHaveValue("all");
    fireEvent.change(categoryMode, { target: { value: "last" } });
    expect(categoryMode).toHaveValue("last");
    const count = screen.getByLabelText("Numero di categorie");
    expect(count).toHaveValue(12);
    fireEvent.change(count, { target: { value: "2" } });
    expect(count).toHaveValue(2);
    fireEvent.change(categoryMode, { target: { value: "first" } });
    expect(categoryMode).toHaveValue("first");
    fireEvent.change(categoryMode, { target: { value: "all" } });
    expect(screen.queryByLabelText("Numero di categorie")).not.toBeInTheDocument();
  });

  it("adds a dedicated vertical bar widget", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi widget" }));
    const chooser = screen.getByRole("dialog", { name: "Scegli un widget" });

    fireEvent.click(within(chooser).getByRole("button", { name: /Barre verticali/ }));

    expect(screen.getByLabelText("Tipo widget")).toHaveValue("column");
    expect(screen.getByLabelText("Titolo")).toHaveValue("Barre verticali");
  });

  it("configura e visualizza un'animazione Time Series professionale su un KPI", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));
    fireEvent.click(screen.getByRole("article", { name: "Widget Visualizzazioni totali" }));

    fireEvent.click(screen.getByText("AGGIUNGI ANIMAZIONE"));
    fireEvent.click(screen.getByRole("button", { name: /Time Series/ }));
    expect(screen.getByLabelText("Animazione widget")).toHaveValue("timeSeries");
    fireEvent.change(screen.getByLabelText("Grafico animato"), { target: { value: "area" } });
    fireEvent.change(screen.getByLabelText("Raggruppa asse X animazione"), { target: { value: "week" } });
    fireEvent.change(screen.getByLabelText("Valore animazione Time Series"), { target: { value: "cumulative" } });
    expect(screen.getByLabelText("Valore animazione Time Series")).toHaveValue("cumulative");
    fireEvent.click(screen.getByRole("checkbox", { name: /Linea di tendenza/ }));

    const widget = screen.getByRole("article", { name: "Widget Visualizzazioni totali" });
    const play = within(widget).getByRole("button", { name: "Riproduci animazione Visualizzazioni totali" });
    expect(play).toBeInTheDocument();
    fireEvent.click(play);

    const dialog = screen.getByRole("dialog", { name: "Visualizzazioni totali" });
    expect(dialog).toHaveTextContent("TIME SERIES");
    expect(dialog).toHaveTextContent("CUMULATIVO");
    expect(dialog).toHaveTextContent("MASSIMO");
    fireEvent.click(within(dialog).getByRole("button", { name: "Chiudi animazione" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Visualizzazioni totali" })).not.toBeInTheDocument());
  });

  it("configura una Corsa delle barre fluida con dati di periodo o cumulativi", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));
    fireEvent.click(screen.getByRole("article", { name: "Widget Visualizzazioni totali" }));

    fireEvent.click(screen.getByText("AGGIUNGI ANIMAZIONE"));
    fireEvent.click(screen.getByRole("button", { name: /Corsa delle barre/ }));
    expect(screen.getByLabelText("Animazione widget")).toHaveValue("barRace");
    expect(screen.getByLabelText("Gruppo corsa delle barre")).toHaveValue("field-2");
    fireEvent.change(screen.getByLabelText("Aggregazione corsa delle barre"), { target: { value: "avg" } });
    fireEvent.change(screen.getByLabelText("Raggruppamento data corsa delle barre"), { target: { value: "week" } });
    fireEvent.change(screen.getByLabelText("Valore corsa delle barre"), { target: { value: "cumulative" } });
    fireEvent.change(screen.getByLabelText("Orientamento corsa delle barre"), { target: { value: "vertical" } });
    fireEvent.change(screen.getByLabelText("Ordinamento corsa delle barre"), { target: { value: "asc" } });
    fireEvent.change(screen.getByLabelText("Secondi per step corsa delle barre"), { target: { value: "2.4" } });

    expect(screen.getByLabelText("Secondi per step corsa delle barre")).toHaveValue(2.4);
    const widget = screen.getByRole("article", { name: "Widget Visualizzazioni totali" });
    expect(within(widget).getByText("Bar Chart Race")).toBeInTheDocument();
    fireEvent.click(within(widget).getByRole("button", { name: "Riproduci animazione Visualizzazioni totali" }));

    const dialog = screen.getByRole("dialog", { name: "Visualizzazioni totali" });
    expect(dialog).toHaveTextContent("CORSA DELLE BARRE");
    expect(dialog).toHaveTextContent("Cumulativo");
    expect(dialog).toHaveTextContent("2,4s / step");
    const progress = within(dialog).getByLabelText(/Avanzamento/);
    expect(dialog.querySelector(".rpt-bar-race-stage")).not.toContainElement(progress);
    expect(progress.parentElement).toHaveClass("rpt-bar-race-viewport");
  });

  it("lets a selected row override widget widths with a custom column count", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));
    fireEvent.change(screen.getByLabelText("Elementi nella riga 1"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("article", { name: "Widget Visualizzazioni totali" }));

    expect(screen.getByLabelText("Elementi nella riga 1")).toHaveValue(7);
    expect(screen.getByLabelText("Larghezza manuale (1–12)")).toBeDisabled();
    expect(screen.getByText(/impone 7 elementi/)).toBeInTheDocument();
  });

  it("generates a dedicated URL and opens the read-only route", async () => {
    const { onOpenViewer } = await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));
    fireEvent.click(screen.getByRole("button", { name: "Link visualizzazione" }));
    const dialog = await screen.findByRole("dialog", { name: "URL della dashboard" });
    const url = within(dialog).getByLabelText("URL visualizzazione dashboard");
    expect((url as HTMLInputElement).value).toContain("#/reports/view/");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apri sola visualizzazione" }));
    expect(onOpenViewer).toHaveBeenCalledOnce();
    expect(reportMocks.saveDashboard).toHaveBeenCalledOnce();
  });

  it("loads a saved dashboard directly in the professional read-only view", async () => {
    const saved = createDemoDashboard();
    reportMocks.listDashboards.mockResolvedValueOnce([saved]);
    render(<ReportsWorkspace onHome={vi.fn()} viewDashboardId={saved.id} />);

    expect(await screen.findByRole("main", { name: "Report in sola visualizzazione" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: saved.name })).toBeInTheDocument());
    expect(screen.queryByRole("complementary", { name: "Origini e campi" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aggiungi widget" })).not.toBeInTheDocument();
  });
});
