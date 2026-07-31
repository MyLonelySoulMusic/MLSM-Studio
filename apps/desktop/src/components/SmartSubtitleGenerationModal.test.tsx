import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmartSubtitleGenerationController } from "../hooks/use-smart-subtitle-generation";
import { SmartSubtitleGenerationModal } from "./SmartSubtitleGenerationModal";

const timestamp = Date.now();
const baseController: SmartSubtitleGenerationController = {
  open: true,
  running: true,
  outcome: "idle",
  events: [
    { id: "setup", createdAt: timestamp, event: { type: "stage", stage: "setup", progress: 8, message: "Preparazione modello", indeterminate: true } },
    {
      id: "whisper",
      createdAt: timestamp + 100,
      event: {
        type: "whisper-output",
        stage: "whisper",
        progress: 48,
        document: {
          schemaVersion: 1,
          engine: "Whisper",
          model: "whisper-base_timestamped",
          durationSeconds: 2,
          transcript: "Hello from Whisper",
          words: [
            { text: "Hello", start: 0, end: .3, confidence: .9 },
            { text: "from", start: .31, end: .5, confidence: .88 },
            { text: "Whisper", start: .51, end: .9, confidence: .91 }
          ],
          phrases: [{ start: 0, end: .9, text: "Hello from Whisper", confidence: .9 }]
        }
      }
    },
    { id: "agent-thinking", createdAt: timestamp + 200, event: { type: "agent", stage: "agents", progress: 65, agentId: "transcript-editor", agentName: "Agent 1 · Transcript Editor", specialty: "Testo Suno e parole Whisper", turn: 1, totalTurns: 5, state: "thinking", message: "Confronto parole e testo." } },
    { id: "agent-answer", createdAt: timestamp + 300, event: { type: "agent", stage: "agents", progress: 72, agentId: "transcript-editor", agentName: "Agent 1 · Transcript Editor", specialty: "Testo Suno e parole Whisper", turn: 1, totalTurns: 5, state: "answered", message: "Testo ripulito e allineato." } }
  ],
  begin: vi.fn(),
  receive: vi.fn(),
  finish: vi.fn(),
  fail: vi.fn(),
  beginInteraction: vi.fn(),
  finishInteraction: vi.fn(),
  failInteraction: vi.fn(),
  reopen: vi.fn(),
  close: vi.fn()
};

describe("SmartSubtitleGenerationModal", () => {
  afterEach(cleanup);

  it("mostra output Whisper, avanzamento reale e conversazione degli agenti", () => {
    render(<SmartSubtitleGenerationModal controller={baseController} />);
    const dialog = screen.getByRole("dialog", { name: "Smart Subtitles generation" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Hello from Whisper")).toBeInTheDocument();
    expect(screen.getByText("3 parole · 1 frasi")).toBeInTheDocument();
    expect(screen.getAllByText("Agent 1 · Transcript Editor")).toHaveLength(2);
    expect(screen.getAllByText("Testo ripulito e allineato.")).toHaveLength(2);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "72");
    expect(screen.getByRole("button", { name: "Chiudi log generazione" })).toBeDisabled();
  });

  it("può essere ridotta, spostata e chiusa soltanto al termine", () => {
    const { rerender } = render(<SmartSubtitleGenerationModal controller={baseController} />);
    const dialog = screen.getByRole("dialog", { name: "Smart Subtitles generation" });
    const dragBar = screen.getByText("Smart Subtitles generation").closest("header");
    expect(dragBar).not.toBeNull();
    expect(dragBar).toHaveClass("smart-subtitle-drag");
    expect(screen.getByText("Trascina la barra superiore", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Riduci log generazione" }));
    expect(dialog).toHaveClass("collapsed");
    rerender(<SmartSubtitleGenerationModal controller={{ ...baseController, running: false, outcome: "success" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Chiudi log generazione" }));
    expect(baseController.close).toHaveBeenCalled();
  });

  it("permette di parlare con un agente e applicare il risultato alla timeline", async () => {
    const onAgentInstruction = vi.fn().mockResolvedValue({ cueCount: 3, changedCount: 2 });
    render(<SmartSubtitleGenerationModal
      controller={{ ...baseController, running: false, outcome: "success" }}
      canInteract
      onAgentInstruction={onAgentInstruction}
    />);
    fireEvent.change(screen.getByLabelText("Agente destinatario"), { target: { value: "timing-director" } });
    fireEvent.change(screen.getByLabelText("Istruzione per gli agenti"), { target: { value: "Dividi il blocco 2 sulla pausa." } });
    fireEvent.click(screen.getByRole("button", { name: "Invia e correggi" }));
    expect(baseController.beginInteraction).toHaveBeenCalledWith("timing-director", "Dividi il blocco 2 sulla pausa.");
    expect(onAgentInstruction).toHaveBeenCalledWith("Dividi il blocco 2 sulla pausa.", "timing-director");
    await waitFor(() => expect(baseController.finishInteraction).toHaveBeenCalledWith(3, 2));
  });
});
