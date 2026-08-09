import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIQuantizerWorkspace } from "./AIQuantizerWorkspace";

describe("AIQuantizerWorkspace", () => {
  beforeEach(() => { localStorage.clear(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runtime: "mlsm-internal-ai-quantizer" }) })); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("incorpora il motore locale nella nuova area Music e mantiene il ritorno Home", async () => {
    const onHome = vi.fn(); render(<AIQuantizerWorkspace onHome={onHome} />);
    await waitFor(() => expect(screen.getByText("Motore audio pronto")).toBeInTheDocument());
    expect(screen.getByTitle("MLSM Studio AI Quantizer")).toHaveAttribute("src", "/music/ai-quantizer/?lang=it&theme=day");
    fireEvent.click(screen.getByRole("button", { name: "Home" })); expect(onHome).toHaveBeenCalledOnce();
  });

  it("mostra nella pagina percentuale, fase e log durante il primo setup", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runtime: "mlsm-ai-quantizer-bootstrap", status: "setting-up", progress: 42, message: "Installazione dipendenze", logs: ["Creazione ambiente", "pip install beat-this"] }) } as Response);
    render(<AIQuantizerWorkspace />);
    expect(await screen.findByText("42%")).toBeInTheDocument();
    expect(screen.getByText("Installazione dipendenze")).toBeInTheDocument();
    expect(screen.getByText(/pip install beat-this/)).toBeInTheDocument();
    expect(screen.queryByTitle("MLSM Studio AI Quantizer")).not.toBeInTheDocument();
  });

  it("traduce shell, bootstrap e log e invia il cambio lingua al quantizer senza ricaricarlo", async () => {
    localStorage.setItem("dynamic-sound-animation-studio.ui.v1", JSON.stringify({ language: "en", theme: "night" }));
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runtime: "mlsm-ai-quantizer-bootstrap", status: "setting-up", progress: 18, message: "Creazione dell’ambiente isolato .venv-ai-quantizer", logs: ["Verifica dell’ambiente Python"] }) } as Response);
    const { unmount } = render(<AIQuantizerWorkspace />);
    expect(await screen.findByText("Preparing AI Quantizer")).toBeInTheDocument();
    expect(screen.getByText("Creating the isolated .venv-ai-quantizer environment")).toBeInTheDocument();
    expect(screen.getByText(/Checking the Python environment/)).toBeInTheDocument();
    unmount();

    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runtime: "mlsm-internal-ai-quantizer" }) } as Response);
    render(<AIQuantizerWorkspace />);
    const frame = await screen.findByTitle("MLSM Studio AI Quantizer") as HTMLIFrameElement;
    expect(frame).toHaveAttribute("src", "/music/ai-quantizer/?lang=en&theme=night");
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "it" } });
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: "mlsm-language", language: "it" }, window.location.origin));
    expect(frame).toHaveAttribute("src", "/music/ai-quantizer/?lang=en&theme=night");
  });
});
