import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ warm: vi.fn() }));

vi.mock("../services/local-model-runtime", () => ({
  preferredLocalAssistantModel: "qwen2.5-0.5b-instruct",
  preferredLocalAssistantLabel: "Qwen2.5 0.5B",
  isLocalTextGeneratorReady: () => false,
  warmLocalTextGenerator: runtime.warm,
  getLocalTextGenerator: vi.fn(async () => vi.fn().mockRejectedValue(new Error("modello non pronto"))),
  runLocalTextGeneration: (generator: (input: unknown, options: unknown) => Promise<unknown>, input: unknown, options: unknown) => generator(input, options),
  localGeneratedAnswer: vi.fn()
}));

import { ApplicationAssistant } from "./ApplicationAssistant";

const context = { modeId: "walkingCube", modeLabel: "Cube Animation", aspectRatio: "9:16", hasAudio: true, analysisReady: true };

describe("ApplicationAssistant", () => {
  afterEach(() => { cleanup(); localStorage.clear(); runtime.warm.mockReset(); });

  it("sblocca subito la chat e persiste il riepilogo della conversazione", async () => {
    runtime.warm.mockResolvedValue(false);
    const { unmount } = render(<ApplicationAssistant context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri assistente applicazione" }));
    const assistant = screen.getByRole("region", { name: "Assistente applicazione" });
    fireEvent.change(within(assistant).getByLabelText("Domanda per l’assistente"), { target: { value: "Come cambio lo sfondo del cubo?" } });
    fireEvent.click(within(assistant).getByRole("button", { name: "Invia domanda" }));

    await waitFor(() => expect(within(assistant).getByText(/risposta verificata dalla knowledge base/i)).toBeInTheDocument());
    expect(assistant.querySelector(".assistant.thinking")).toBeNull();
    expect(within(assistant).getByText("Elaborazione locale · memoria: 1 richieste")).toBeInTheDocument();
    expect(localStorage.getItem("dynamic-sound-animation-studio.assistant-memory.v2")).toContain("Come cambio lo sfondo del cubo?");
    expect(runtime.warm).toHaveBeenCalledOnce();

    unmount();
    render(<ApplicationAssistant context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri assistente applicazione" }));
    expect(screen.getByText("Elaborazione locale · memoria: 1 richieste")).toBeInTheDocument();
  });

  it("risponde ai saluti senza mostrare un fallback tecnico", async () => {
    runtime.warm.mockResolvedValue(false);
    render(<ApplicationAssistant context={{ ...context, modeId: "instrumentalFalling", modeLabel: "Instrumental Falling" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri assistente applicazione" }));
    const assistant = screen.getByRole("region", { name: "Assistente applicazione" });
    fireEvent.change(within(assistant).getByLabelText("Domanda per l’assistente"), { target: { value: "Ehi, tutto bene?" } });
    fireEvent.click(within(assistant).getByRole("button", { name: "Invia domanda" }));

    await waitFor(() => expect(within(assistant).getByText(/Tutto bene, grazie/)).toBeInTheDocument());
    expect(within(assistant).getAllByText("Risposta conversazionale locale")).toHaveLength(2);
    expect(within(assistant).getByText("Elaborazione locale · memoria: 0 richieste")).toBeInTheDocument();
    expect(within(assistant).queryByText(/biglia/)).not.toBeInTheDocument();
    expect(within(assistant).queryByText(/fallback/i)).not.toBeInTheDocument();
  });

  it("non riutilizza la vecchia memoria che può contenere fallback fuori contesto", () => {
    localStorage.setItem("dynamic-sound-animation-studio.assistant-memory.v1", JSON.stringify({ summary: "Risposta casuale sulla biglia", turnCount: 4 }));
    runtime.warm.mockResolvedValue(false);
    render(<ApplicationAssistant context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri assistente applicazione" }));

    expect(screen.getByText("Elaborazione locale · memoria: 0 richieste")).toBeInTheDocument();
    expect(localStorage.getItem("dynamic-sound-animation-studio.assistant-memory.v1")).toBeNull();
  });
});
