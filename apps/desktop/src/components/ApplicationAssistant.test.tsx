import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ warm: vi.fn() }));
const workflows = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../services/studio-settings", () => ({
  providerLabels: { nvidia: "NVIDIA" },
  requestRemoteAnswer: async (messages: { content: string }[]) => ({ source: "nvidia", model: "Kimi K3", content: messages.at(-1)?.content.includes("Ehi, tutto bene?") ? "Tutto bene, grazie. Sono Lonely Bot." : "Questa è la Home di MLSM Studio. Puoi cambiare lo sfondo del cubo nel pannello." })
}));

vi.mock("../services/local-model-runtime", () => ({
  preferredLocalAssistantModel: "qwen2.5-0.5b-instruct",
  preferredLocalAssistantLabel: "Qwen2.5 0.5B",
  isLocalTextGeneratorReady: () => false,
  warmLocalTextGenerator: runtime.warm,
  getLocalTextGenerator: vi.fn(async () => vi.fn().mockRejectedValue(new Error("modello non pronto"))),
  runLocalTextGeneration: (generator: (input: unknown, options: unknown) => Promise<unknown>, input: unknown, options: unknown) => generator(input, options),
  localGeneratedAnswer: vi.fn()
}));

vi.mock("../services/lonely-bot-workflows", async (original) => {
  const actual = await original<typeof import("../services/lonely-bot-workflows")>();
  return { ...actual, runLonelyBotWorkflow: workflows.run };
});

import { ApplicationAssistant, OPEN_LONELY_BOT_EVENT } from "./ApplicationAssistant";

const context = { modeId: "walkingCube", modeLabel: "Cube Animation", aspectRatio: "9:16", hasAudio: true, analysisReady: true };

describe("ApplicationAssistant", () => {
  beforeEach(() => { Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test-result") }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() }); });
  afterEach(() => { cleanup(); localStorage.clear(); runtime.warm.mockReset(); workflows.run.mockReset(); vi.restoreAllMocks(); });

  it("può nascondere il launcher e aprire comunque Lonely Bot dalla barra superiore", () => {
    render(<ApplicationAssistant context={context} hideLauncher />);
    expect(screen.queryByRole("button", { name: "Apri Lonely Bot" })).not.toBeInTheDocument();
    fireEvent(window, new Event(OPEN_LONELY_BOT_EVENT));
    expect(screen.getByRole("region", { name: "Lonely Bot" })).toBeInTheDocument();
  });

  it("sblocca subito la chat e persiste il riepilogo della conversazione", async () => {
    runtime.warm.mockResolvedValue(false);
    const { unmount } = render(<ApplicationAssistant context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri Lonely Bot" }));
    const assistant = screen.getByRole("region", { name: "Lonely Bot" });
    fireEvent.change(within(assistant).getByLabelText("Domanda per Lonely Bot"), { target: { value: "Come cambio lo sfondo del cubo?" } });
    fireEvent.click(within(assistant).getByRole("button", { name: "Invia domanda" }));

    await waitFor(() => expect(within(assistant).getByText(/Questa è la Home di MLSM Studio/)).toBeInTheDocument());
    expect(assistant.querySelector(".assistant.thinking")).toBeNull();
    expect(within(assistant).getByText("Locale · memoria: 1 richieste")).toBeInTheDocument();
    expect(localStorage.getItem("dynamic-sound-animation-studio.assistant-memory.v2")).toContain("Come cambio lo sfondo del cubo?");
    expect(runtime.warm).not.toHaveBeenCalled();

    unmount();
    render(<ApplicationAssistant context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri Lonely Bot" }));
    expect(screen.getByText("Locale · memoria: 1 richieste")).toBeInTheDocument();
  });

  it("risponde ai saluti senza mostrare un fallback tecnico", async () => {
    runtime.warm.mockResolvedValue(false);
    render(<ApplicationAssistant context={{ ...context, modeId: "instrumentalFalling", modeLabel: "Instrumental Falling" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri Lonely Bot" }));
    const assistant = screen.getByRole("region", { name: "Lonely Bot" });
    fireEvent.change(within(assistant).getByLabelText("Domanda per Lonely Bot"), { target: { value: "Ehi, tutto bene?" } });
    fireEvent.click(within(assistant).getByRole("button", { name: "Invia domanda" }));

    await waitFor(() => expect(within(assistant).getByText(/Tutto bene, grazie/)).toBeInTheDocument());
    expect(within(assistant).getAllByText(/NVIDIA · Kimi K3/).length).toBeGreaterThan(0);
    expect(within(assistant).getByText("Locale · memoria: 1 richieste")).toBeInTheDocument();
    expect(within(assistant).queryByText(/biglia/)).not.toBeInTheDocument();
    expect(within(assistant).queryByText(/fallback/i)).not.toBeInTheDocument();
  });

  it("spiega la Home con la domanda reale dell'utente", async () => {
    runtime.warm.mockResolvedValue(false);
    render(<ApplicationAssistant context={{ ...context, screen: "areas", modeLabel: "Home aree" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri Lonely Bot" }));
    const assistant = screen.getByRole("region", { name: "Lonely Bot" });
    fireEvent.change(within(assistant).getByLabelText("Domanda per Lonely Bot"), { target: { value: "cosa c'è in questa pagina?" } });
    fireEvent.click(within(assistant).getByRole("button", { name: "Invia domanda" }));
    expect(await within(assistant).findByText(/Questa è la Home di MLSM Studio/)).toBeInTheDocument();
    expect(within(assistant).getAllByText(/NVIDIA · Kimi K3/).length).toBeGreaterThan(0);
  });

  it("non riutilizza la vecchia memoria che può contenere fallback fuori contesto", () => {
    localStorage.setItem("dynamic-sound-animation-studio.assistant-memory.v1", JSON.stringify({ summary: "Risposta casuale sulla biglia", turnCount: 4 }));
    runtime.warm.mockResolvedValue(false);
    render(<ApplicationAssistant context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri Lonely Bot" }));

    expect(screen.getByText("Locale · memoria: 0 richieste")).toBeInTheDocument();
    expect(localStorage.getItem("dynamic-sound-animation-studio.assistant-memory.v1")).toBeNull();
  });

  it("propone la navigazione reale quando la funzione si trova in un'altra area", async () => {
    runtime.warm.mockResolvedValue(false);
    const navigate = vi.fn();
    render(<ApplicationAssistant context={context} onNavigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri Lonely Bot" }));
    const assistant = screen.getByRole("region", { name: "Lonely Bot" });
    fireEvent.change(within(assistant).getByLabelText("Domanda per Lonely Bot"), { target: { value: "Dove trovo Frame Booster?" } });
    fireEvent.click(within(assistant).getByRole("button", { name: "Invia domanda" }));
    const action = await within(assistant).findByRole("button", { name: "Apri Frame Booster →" });
    fireEvent.click(action);
    expect(navigate).toHaveBeenCalledWith("frameBooster");
  });

  it("verifica un allegato e avvia Frame Booster solo dopo conferma", async () => {
    runtime.warm.mockResolvedValue(false);
    workflows.run.mockImplementation(async ({ onProgress }: { onProgress: (value: { progress: number; message: string }) => void }) => { onProgress({ progress: .5, message: "Interpolazione" }); return [{ name: "clip-boosted.mp4", blob: new Blob(["video"]) }]; });
    const { container } = render(<ApplicationAssistant context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri Lonely Bot" }));
    const assistant = screen.getByRole("region", { name: "Lonely Bot" });
    const input = container.querySelector<HTMLInputElement>('.assistant-chat input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["video"], "clip.mp4", { type: "video/mp4" })] } });
    fireEvent.change(within(assistant).getByLabelText("Domanda per Lonely Bot"), { target: { value: "Avvia Frame Booster" } });
    fireEvent.click(within(assistant).getByRole("button", { name: "Invia domanda" }));
    fireEvent.click(await within(assistant).findByRole("button", { name: "Avvia Frame Booster" }));
    await waitFor(() => expect(within(assistant).getByRole("link", { name: "Scarica clip-boosted.mp4" })).toBeInTheDocument());
    expect(workflows.run).toHaveBeenCalledOnce();
  });
});
