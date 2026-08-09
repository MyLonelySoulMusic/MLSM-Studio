import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryEngine } from "../services/memory-engine";
import { InMemoryMemoryRepository } from "../services/memory-repository";
import { updateUiPreferences } from "../services/ui-preferences";
import { MemoryButton, MemoryStudioProvider } from "./MemoryStudio";

const native = vi.hoisted(() => ({
  select: vi.fn(),
  preview: vi.fn(),
  release: vi.fn(),
  copy: vi.fn()
}));

vi.mock("../services/memory-native", () => ({
  selectAndScanMemorySources: native.select,
  loadMemoryPreview: native.preview,
  releaseMemoryPreview: native.release,
  copyMemoryRecords: native.copy
}));

function renderMemory(engine = new MemoryEngine({ repository: new InMemoryMemoryRepository() })) {
  return { engine, ...render(<MemoryStudioProvider engine={engine}><MemoryButton /></MemoryStudioProvider>) };
}

describe("MemoryStudio", () => {
  beforeEach(() => {
    localStorage.clear();
    native.select.mockReset();
    native.preview.mockReset().mockResolvedValue({ kind: "image", mimeType: "image/png", unavailableReason: "fixture" });
    native.release.mockReset();
    native.copy.mockReset().mockResolvedValue({ items: [], failures: [], copiedFiles: 1, copiedBytes: 100 });
  });
  afterEach(cleanup);

  it("apre e chiude la memoria globale anche con Escape", () => {
    renderMemory();
    fireEvent.click(screen.getByRole("button", { name: "Apri memoria intelligente" }));
    expect(screen.getByRole("dialog", { name: "Memory" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Memory" })).not.toBeInTheDocument();
  });

  it("traduce integralmente i controlli principali in inglese", () => {
    updateUiPreferences({ language: "en" }); renderMemory();
    fireEvent.click(screen.getByRole("button", { name: "Open intelligent memory" }));
    expect(screen.getByRole("button", { name: /Find memory/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Build memory/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All types" })).toBeInTheDocument();
  });

  it("scansiona, descrive e indicizza un file con categoria personalizzata", async () => {
    native.select.mockResolvedValue({
      entries: [{ path: "/Music/Empty Streets/cover.png", parentPath: "/Music/Empty Streets", name: "cover.png", extension: "png", entryType: "file", mediaKind: "image", mimeType: "image/png", sizeBytes: 2048, isHidden: false, previewSupported: true }],
      skippedCount: 0,
      truncated: false,
      errors: []
    });
    const { engine } = renderMemory();
    fireEvent.click(screen.getByRole("button", { name: "Apri memoria intelligente" }));
    fireEvent.click(screen.getByRole("button", { name: /Costruisci memoria/ }));
    fireEvent.click(screen.getByRole("button", { name: /Seleziona file/ }));
    expect(await screen.findAllByText("cover.png")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Descrizione comune"), { target: { value: "Copertina rosa con una strada notturna" } });
    fireEvent.change(screen.getByLabelText("Nome categoria"), { target: { value: "Singolo Empty Streets" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea categoria" }));
    await screen.findByText("Singolo Empty Streets");
    fireEvent.click(screen.getByRole("button", { name: "Salva nella memoria" }));

    await screen.findByText("Copertina rosa con una strada notturna");
    const records = await engine.listRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ name: "cover.png", kind: "image", description: "Copertina rosa con una strada notturna" });
    expect((await engine.listCategories()).map((category) => category.name)).toEqual(expect.arrayContaining(["Singolo Empty Streets", "Empty Streets"]));
  });

  it("ordina i risultati, apre l’anteprima, mostra il grafo e copia la selezione", async () => {
    const engine = new MemoryEngine({ repository: new InMemoryMemoryRepository() });
    await engine.upsertRecord({ path: "/project/cover.jpg", description: "Foto rosa di una strada notturna" });
    await engine.upsertRecord({ path: "/project/drums.wav", description: "Registrazione audio della batteria" });
    renderMemory(engine);
    fireEvent.click(screen.getByRole("button", { name: "Apri memoria intelligente" }));
    expect(await screen.findByText("cover.jpg")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Descrivi ciò che cerchi/), { target: { value: "pink night photo" } });
    fireEvent.click(screen.getByRole("button", { name: "Cerca" }));
    await waitFor(() => expect(screen.getAllByRole("article")[0]).toHaveTextContent("cover.jpg"));
    fireEvent.click(screen.getAllByRole("article")[0]!);
    expect(await screen.findByLabelText("Anteprima: cover.jpg")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Copia selezionati" }));
    await waitFor(() => expect(native.copy).toHaveBeenCalledWith([expect.objectContaining({ name: "cover.jpg" })]));

    fireEvent.click(screen.getByRole("button", { name: "Grafo relazioni" }));
    expect(screen.getByRole("img", { name: "Grafo relazioni" })).toBeInTheDocument();
    expect(document.querySelectorAll(".memory-graph-node.node-record")).toHaveLength(2);
  });
});
