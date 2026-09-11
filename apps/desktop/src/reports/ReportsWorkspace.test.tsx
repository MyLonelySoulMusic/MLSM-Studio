import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportsWorkspace } from "./ReportsWorkspace";
import { createDemoDashboard } from "./data";

const reportMocks = vi.hoisted(() => ({
  listDashboards: vi.fn(),
  saveDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
  downloadDashboard: vi.fn(),
}));

vi.mock("./storage", () => ({
  deleteDashboard: reportMocks.deleteDashboard,
  importDashboard: vi.fn(),
  listDashboards: reportMocks.listDashboards,
  saveDashboard: reportMocks.saveDashboard,
}));

vi.mock("./files", () => ({ downloadDashboard: reportMocks.downloadDashboard }));

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
    expect(screen.getByRole("complementary", { name: "Widget e proprietà" })).toHaveTextContent("9 tipi");
    expect(screen.getByRole("button", { name: /Le mie dashboard/ })).toHaveTextContent("0");
    expect(onHome).not.toHaveBeenCalled();
  });

  it("carica l'esempio dimostrativo con origine, widget e palette MLSM", async () => {
    await renderReports();

    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));

    expect(screen.getByRole("heading", { name: "MLSM · Audience & crescita" })).toBeInTheDocument();
    expect(screen.getByText("Performance dei canali")).toBeInTheDocument();
    expect(screen.getByText("18 righe · 5 campi")).toBeInTheDocument();
    expect(screen.getAllByText(/5 widget/).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("report-widget-preview")).toHaveLength(5);
    expect(screen.getByText("Modifiche da salvare")).toBeInTheDocument();
  });

  it("aggiunge un widget alla dashboard e lo seleziona nell'inspector", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("button", { name: /Esplora un esempio/ }));

    const inspector = screen.getByRole("complementary", { name: "Widget e proprietà" });
    fireEvent.click(within(inspector).getByRole("button", { name: "Barre" }));

    expect(screen.getAllByText(/6 widget/).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("report-widget-preview")).toHaveLength(6);
    expect(screen.getByLabelText("Titolo")).toHaveValue("Barre");
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
