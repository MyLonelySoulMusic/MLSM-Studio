import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  correctAudioTranscript: vi.fn(), selectAudioToolMedia: vi.fn(), transcribeAudioMedia: vi.fn(),
}));

vi.mock("./MemoryStudio", () => ({ MemoryButton: () => <button>Memory</button> }));
vi.mock("./ArtistSupport", () => ({ SupportArtistButton: () => <button>Support</button> }));
vi.mock("../services/audio-tools", () => ({
  correctAudioTranscript: audioMocks.correctAudioTranscript, downloadAudioText: vi.fn(), exportAudioArtifact: vi.fn(),
  selectAudioToolMedia: audioMocks.selectAudioToolMedia, transcriptAsSrt: vi.fn(), transcriptAsVtt: vi.fn(), transcribeAudioMedia: audioMocks.transcribeAudioMedia,
}));
vi.mock("../services/cassette-desk-vocals", () => ({ separateCassetteDeskVocals: vi.fn() }));
vi.mock("../services/studio-settings", () => ({
  providerLabels: { nvidia: "NVIDIA", openai: "OpenAI", gemini: "Google Gemini", xai: "xAI / Grok" },
  getLlmSettings: vi.fn(async () => ({
    activeProvider: "openai",
    providers: {
      nvidia: { configured: false, enabled: true, model: "kimi", keySource: "none", endpoint: "", provider: "nvidia" },
      openai: { configured: true, enabled: true, model: "gpt-5.6-terra", keySource: "settings", endpoint: "", provider: "openai" },
      gemini: { configured: false, enabled: true, model: "gemini", keySource: "none", endpoint: "", provider: "gemini" },
      xai: { configured: false, enabled: true, model: "grok", keySource: "none", endpoint: "", provider: "xai" },
    },
  })),
}));

import { AudioWorkspace } from "./AudioWorkspace";

describe("AudioWorkspace", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("espone trascrizione ed estrazione voce senza il lento Text to Speech locale", () => {
    render(<AudioWorkspace />);
    expect(screen.getByRole("button", { name: "Da audio a testo / SRT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Estrai voce" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Text to speech/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Chatterbox/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Estrai voce" }));
    expect(screen.getByText(/Demucs htdemucs separa realmente/)).toBeInTheDocument();
  });

  it("consente di scegliere un modello API configurato per la revisione", async () => {
    const document = {
      schemaVersion: 1 as const, engine: "Whisper", model: "whisper-medium_timestamped" as const, durationSeconds: 2,
      transcript: "ciao mondo", words: [{ text: "ciao", start: 0, end: .8, confidence: .9 }],
      phrases: [{ text: "ciao mondo", start: 0, end: 2, confidence: .9 }],
    };
    const media = { name: "voce.wav", path: "/tmp/voce.wav", url: "blob:voce", durationSeconds: 2, imported: { metadata: { durationSeconds: 2 }, waveform: [], url: "data:audio/wav;base64," } };
    audioMocks.selectAudioToolMedia.mockResolvedValue(media);
    audioMocks.transcribeAudioMedia.mockResolvedValue(document);
    audioMocks.correctAudioTranscript.mockResolvedValue(document);
    render(<AudioWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "＋" }));
    expect(await screen.findByRole("button", { name: /Sostituisci file voce\.wav/ })).toBeInTheDocument();
    const reviewer = await screen.findByRole("combobox", { name: "Modello di revisione testo / SRT" });
    expect(reviewer).toHaveValue("openai");
    expect(screen.getByRole("option", { name: "OpenAI · gpt-5.6-terra" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trascrivi" }));

    await waitFor(() => expect(audioMocks.correctAudioTranscript).toHaveBeenCalledWith(document, "", expect.any(Function), expect.objectContaining({ reviewer: "openai", signal: expect.any(AbortSignal) })));
  });

  it("mostra un errore Whisper float16 comprensibile su Windows", async () => {
    const media = { name: "voce.wav", path: "C:\\Audio\\voce.wav", url: "blob:voce", durationSeconds: 2, imported: { metadata: { durationSeconds: 2 }, waveform: [], url: "data:audio/wav;base64," } };
    audioMocks.selectAudioToolMedia.mockResolvedValue(media);
    audioMocks.transcribeAudioMedia.mockRejectedValue(new Error("Requested float16 compute type, but the target device or backend do not support efficient float16 computation."));
    render(<AudioWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "＋" }));
    await screen.findByRole("button", { name: /Sostituisci file voce\.wav/ });
    fireEvent.click(screen.getByRole("button", { name: "Trascrivi" }));
    expect(await screen.findByText(/Questo dispositivo non può eseguire Whisper.*precisione compatibile/)).toBeInTheDocument();
  });
});
