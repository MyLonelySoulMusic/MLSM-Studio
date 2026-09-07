import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./MemoryStudio", () => ({ MemoryButton: () => <button>Memory</button> }));
vi.mock("./ArtistSupport", () => ({ SupportArtistButton: () => <button>Support</button> }));
vi.mock("../services/audio-tools", () => ({
  correctAudioTranscript: vi.fn(), downloadAudioText: vi.fn(), exportAudioArtifact: vi.fn(),
  selectAudioToolMedia: vi.fn(), transcriptAsSrt: vi.fn(), transcriptAsVtt: vi.fn(), transcribeAudioMedia: vi.fn(),
}));
vi.mock("../services/cassette-desk-vocals", () => ({ separateCassetteDeskVocals: vi.fn() }));

import { AudioWorkspace } from "./AudioWorkspace";

describe("AudioWorkspace", () => {
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
});
