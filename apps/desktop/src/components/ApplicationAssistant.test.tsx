import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ warm: vi.fn() }));

vi.mock("../services/local-model-runtime", () => ({
  isLocalTextGeneratorReady: () => false,
  warmLocalTextGenerator: runtime.warm,
  getLocalTextGenerator: vi.fn(),
  localGeneratedAnswer: vi.fn()
}));

import { ApplicationAssistant } from "./ApplicationAssistant";

const context = { modeId: "walkingCube", modeLabel: "Cube Animation", aspectRatio: "9:16", hasAudio: true, analysisReady: true };

describe("ApplicationAssistant", () => {
  afterEach(() => { cleanup(); localStorage.clear(); runtime.warm.mockReset(); });

  it("sblocca subito la chat e persiste il riepilogo della conversazione", async () => {
    const { unmount } = render(<ApplicationAssistant context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri assistente applicazione" }));
    const assistant = screen.getByRole("region", { name: "Assistente applicazione" });
    fireEvent.change(within(assistant).getByLabelText("Domanda per l’assistente"), { target: { value: "Come cambio lo sfondo del cubo?" } });
    fireEvent.click(within(assistant).getByRole("button", { name: "Invia domanda" }));

    await waitFor(() => expect(within(assistant).getByText("Risposta dalla knowledge base locale")).toBeInTheDocument());
    expect(assistant.querySelector(".assistant.thinking")).toBeNull();
    expect(within(assistant).getByText("Elaborazione locale · memoria: 1 richieste")).toBeInTheDocument();
    expect(localStorage.getItem("dynamic-sound-animation-studio.assistant-memory.v1")).toContain("Come cambio lo sfondo del cubo?");
    expect(runtime.warm).toHaveBeenCalledOnce();

    unmount();
    render(<ApplicationAssistant context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri assistente applicazione" }));
    expect(screen.getByText("Elaborazione locale · memoria: 1 richieste")).toBeInTheDocument();
  });
});
