import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { importAudioMock } = vi.hoisted(() => ({ importAudioMock: vi.fn() }));
vi.mock("../services/audio-import", async (importOriginal) => ({ ...(await importOriginal<typeof import("../services/audio-import")>()), importAudio: importAudioMock }));
import { MlsmPostLipsyncWorkspace } from "./MlsmPostLipsyncWorkspace";

describe("MlsmPostLipsyncWorkspace", () => {
  beforeEach(() => { localStorage.clear(); importAudioMock.mockReset(); vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("accetta il contenuto SRT incollato senza richiedere un file e non limita il browser", () => {
    render(<MlsmPostLipsyncWorkspace />);
    const serialized = "1\n00:00:00,000 --> 00:00:02,720\nThe fallen";
    const input = screen.getByLabelText("Oppure incolla qui il contenuto") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: serialized } });
    expect(input.value).toBe(serialized);
    expect(screen.getByText("Testo incollato")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Svuota" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Svuota cache LIP SYNC" })).toBeInTheDocument();
    expect(screen.getByText("Ogni clic esegue una nuova analisi")).toBeInTheDocument();
    expect(screen.queryByText(/richiede l’app desktop/i)).not.toBeInTheDocument();
    const deep = screen.getByRole("checkbox", { name: /Analisi fonema per fonema/u });
    const llmCorrection = screen.getByRole("checkbox", { name: /Correzione sequenza con LLM locale/u });
    const visualSpeech = screen.getByRole("checkbox", { name: /Analisi visiva del labiale/u });
    const exactLyrics = screen.getByLabelText("Parole esatte pronunciate") as HTMLTextAreaElement;
    expect(llmCorrection).toBeChecked();
    expect(visualSpeech).not.toBeChecked();
    expect(screen.getByText(/Disattivata di default/u)).toBeInTheDocument();
    fireEvent.change(exactLyrics, { target: { value: "The Fallen, still loves me" } });
    expect(exactLyrics.value).toBe("The Fallen, still loves me");
    fireEvent.click(llmCorrection);
    expect(llmCorrection).not.toBeChecked();
    expect(exactLyrics).toBeDisabled();
    expect(deep).not.toBeChecked();
    fireEvent.click(deep);
    expect(deep).toBeChecked();
    expect(screen.getByRole("button", { name: /Esporta MP4/u })).toBeDisabled();
  });

  it("rende SRT/VTT opzionale e dichiara la modalità solo Whisper", () => {
    render(<MlsmPostLipsyncWorkspace />);
    expect(screen.getByText("Testo SRT o VTT · opzionale")).toBeInTheDocument();
    expect(screen.getByText("Solo Whisper")).toBeInTheDocument();
    expect(screen.getByText(/Video cantato e master sono obbligatori/u)).toBeInTheDocument();
    expect(screen.getByText(/usa esclusivamente le parole e i tempi misurati da Whisper/u)).toBeInTheDocument();
    expect(screen.queryByText(/Carica i tre file/u)).not.toBeInTheDocument();
  });

  it("mostra e aggiorna il taglio non distruttivo del master", async () => {
    importAudioMock.mockResolvedValue({ metadata: { path: "/music/master.wav", fileName: "master.wav", hash: "a".repeat(64), durationSeconds: 120, sampleRate: 48_000, channels: 2, codec: "wav", fileSize: 1_000 }, waveform: [.2, -.4, .7, -.3], url: "https://local.test/master.wav" });
    render(<MlsmPostLipsyncWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: /Master audio definitivo/u }));
    expect(await screen.findByText("Porzione del master da analizzare")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Ascolta e taglia il master" })).toBeInTheDocument();
    const startRange = screen.getAllByLabelText("Inizio selezione").find((element) => (element as HTMLInputElement).type === "range") as HTMLInputElement;
    const endRange = screen.getAllByLabelText("Fine selezione").find((element) => (element as HTMLInputElement).type === "range") as HTMLInputElement;
    await waitFor(() => { expect(startRange.value).toBe("0"); expect(endRange.value).toBe("120"); });
    fireEvent.change(startRange, { target: { value: "30" } }); fireEvent.change(endRange, { target: { value: "42.5" } });
    expect(startRange.value).toBe("30"); expect(endRange.value).toBe("42.5");
    fireEvent.click(screen.getByRole("button", { name: "Usa questa porzione" }));
    expect(screen.queryByRole("dialog", { name: "Ascolta e taglia il master" })).not.toBeInTheDocument();
    expect(screen.getByText(/0:30\.000 → 0:42\.500/u)).toBeInTheDocument();
    expect(screen.getByText(/solo questa porzione viene separata e trascritta/iu)).toBeInTheDocument();
  });

  it("espande il monitor e lo richiude con Escape", () => {
    const { container } = render(<MlsmPostLipsyncWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Espandi anteprima" }));
    expect(container.querySelector(".lipsync-preview-card.expanded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Riduci anteprima" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".lipsync-preview-card.expanded")).not.toBeInTheDocument();
  });

  it("apre un generatore prompt separato e compila il template dal proprio SRT", () => {
    render(<MlsmPostLipsyncWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Apri generatore prompt" }));
    const dialog = screen.getByRole("dialog", { name: "Generatore prompt performance" });
    const modal = within(dialog);
    fireEvent.change(modal.getByLabelText("Contenuto SRT o VTT"), { target: { value: "1\n00:00:00,000 --> 00:00:02,720\nThe fallen\n\n2\n00:00:04,340 --> 00:00:07,360\nStill loves me" } });
    fireEvent.click(modal.getByRole("button", { name: "Usa prompt predefinito" }));
    const output = modal.getByLabelText("Prompt finale") as HTMLTextAreaElement;
    expect(output.value).toContain("For the first 2.72 seconds");
    expect(output.value).toContain("Still loves me");
    expect(output.value).not.toMatch(/[<>]/u);
    expect(screen.getByText(/Funzione indipendente/u)).toBeInTheDocument();
  });

  it("mostra due prompt separati quando la timeline supera 15 secondi", () => {
    render(<MlsmPostLipsyncWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Apri generatore prompt" }));
    const dialog = screen.getByRole("dialog", { name: "Generatore prompt performance" });
    const modal = within(dialog);
    fireEvent.change(modal.getByLabelText("Contenuto SRT o VTT"), { target: { value: "1\n00:00:00,000 --> 00:00:10,000\nFirst phrase\n\n2\n00:00:16,000 --> 00:00:20,000\nSecond phrase" } });
    fireEvent.click(modal.getByRole("button", { name: "Usa prompt predefinito" }));
    expect(modal.getByRole("button", { name: /Prompt 1.*0–15 s/u })).toBeInTheDocument();
    const second = modal.getByRole("button", { name: /Prompt 2.*15–20 s/u });
    expect((modal.getByLabelText("Prompt finale") as HTMLTextAreaElement).value).toContain("First phrase");
    fireEvent.click(second);
    expect((modal.getByLabelText("Prompt finale") as HTMLTextAreaElement).value).toContain("Second phrase");
    expect((modal.getByLabelText("Prompt finale") as HTMLTextAreaElement).value).toContain("Continue directly and seamlessly");
  });

  it("lascia cliccare Genera con sottotitoli invalidi, mostra l'errore e rimette il focus sull'input", () => {
    render(<MlsmPostLipsyncWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Apri generatore prompt" }));
    const dialog = screen.getByRole("dialog", { name: "Generatore prompt performance" });
    const modal = within(dialog);
    const input = modal.getByLabelText("Contenuto SRT o VTT");
    fireEvent.change(input, { target: { value: "testo privo di timestamp" } });
    const generate = modal.getByRole("button", { name: "Genera con LLM locale" });
    expect(generate).toBeEnabled();
    fireEvent.click(generate);
    expect(input).toHaveFocus();
    expect(modal.getByRole("alert")).toHaveTextContent(/timestamp validi/u);
  });
});
