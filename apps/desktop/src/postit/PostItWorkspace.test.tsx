import { IDBFactory } from "fake-indexeddb";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPostItWorkspaceForTests } from "./postit-store";
import { PostItWorkspace } from "./PostItWorkspace";

vi.mock("../components/MemoryStudio", () => ({ MemoryButton: () => <button type="button">Memory</button> }));
vi.mock("../components/ArtistSupport", () => ({ SupportArtistButton: () => <button type="button">Supportami</button> }));
vi.mock("../components/StudioSettings", () => ({ SettingsButton: () => <button type="button">Impostazioni</button> }));
vi.mock("./postit-favicon", () => ({ fetchRealPostItFavicon: async (link: string) => link ? "data:image/png;base64,AA==" : null, isGeneratedPostItFavicon: (value: string) => value.includes("svg+xml") }));

describe("PostItWorkspace", () => {
  beforeEach(() => { localStorage.clear(); vi.stubGlobal("indexedDB", new IDBFactory()); resetPostItWorkspaceForTests(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("crea post-it, li collega in un flusso e li riordina semanticamente", async () => {
    render(<PostItWorkspace onHome={vi.fn()} />);
    expect(await screen.findByText(/Nessun post-it/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Nuovo post-it" })[0]!);
    fireEvent.change(screen.getByLabelText("Titolo"), { target: { value: "Produzione musicale" } });
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://example.com/music" } });
    fireEvent.change(screen.getByLabelText("Testo"), { target: { value: "Creare una canzone e rifinire il nuovo brano" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect(await screen.findByRole("heading", { name: "Produzione musicale" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Nuovo post-it/ }));
    fireEvent.change(screen.getByLabelText("Titolo"), { target: { value: "Pubblicazione" } });
    fireEvent.change(screen.getByLabelText("Testo"), { target: { value: "Distribuire la musica sulle piattaforme" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect(await screen.findByRole("heading", { name: "Pubblicazione" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Nuovo post-it/ }));
    fireEvent.change(screen.getByLabelText("Titolo"), { target: { value: "Mastering" } });
    fireEvent.change(screen.getByLabelText("Testo"), { target: { value: "Preparare il master finale" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect(await screen.findByRole("heading", { name: "Mastering" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Nuovo flusso/ }));
    const dialog = screen.getByRole("dialog", { name: "Crea flusso" });
    fireEvent.change(within(dialog).getByLabelText("Titolo"), { target: { value: "Lancio del singolo" } });
    fireEvent.change(within(dialog).getByLabelText("Descrizione del flusso"), { target: { value: "Dalla produzione alla distribuzione" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Produzione musicale" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Pubblicazione" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Mastering" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salva" }));

    fireEvent.click(screen.getByRole("button", { name: /^Flussi/ }));
    expect(await screen.findByRole("heading", { name: "Lancio del singolo" })).toBeInTheDocument();
    expect(screen.getByText("Dalla produzione alla distribuzione")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Apri: Produzione musicale" })).toHaveAttribute("href", "https://example.com/music");
    fireEvent.click(screen.getByRole("button", { name: "Rimuovi dal flusso: Pubblicazione" }));
    await waitFor(() => expect(screen.queryByText("Distribuire la musica sulle piattaforme")).not.toBeInTheDocument());

    fireEvent.change(screen.getByRole("textbox", { name: "Cerca per significato…" }), { target: { value: "musica canzone" } });
    await waitFor(() => expect(screen.getByText(/coseno/)).toBeInTheDocument());
  });
});
