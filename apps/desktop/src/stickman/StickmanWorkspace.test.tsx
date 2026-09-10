import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderer = vi.hoisted(() => ({
  renderBivioFrame: vi.fn(),
  ensureBivioFont: vi.fn(() => Promise.resolve()),
}));
const exporter = vi.hoisted(() => ({ exportBivioVideo: vi.fn() }));
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

vi.mock("./renderer", () => renderer);
vi.mock("./exporter", () => exporter);
vi.mock("../components/StudioSettings", () => ({ SettingsButton: () => <button type="button">Settings</button> }));
vi.mock("../components/MemoryStudio", () => ({ MemoryButton: () => <button type="button">Memory</button> }));
vi.mock("../components/ArtistSupport", () => ({ SupportArtistButton: () => <button type="button">Support</button> }));

import { StickmanWorkspace } from "./StickmanWorkspace";

function markAudioReady(container: HTMLElement, duration = 12) {
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("Audio element missing");
  Object.defineProperty(audio, "duration", { configurable: true, value: duration });
  fireEvent.loadedMetadata(audio);
  return audio;
}

describe("StickmanWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
    renderer.renderBivioFrame.mockClear();
    renderer.ensureBivioFont.mockClear();
    exporter.exportBivioVideo.mockReset();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:stickman-audio") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn(() => undefined) });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("shows the Bivio poster before upload and keeps the gallery extensible", async () => {
    render(<StickmanWorkspace onHome={vi.fn()} />);
    expect(screen.getByLabelText("Stickman Animations")).toBeInTheDocument();

    expect(screen.getByRole("region", { name: "Anteprima verticale" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Bivio Anteprima verticale" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bivio.*Selezionata/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue(/AUTOTUNE/)).toBeInTheDocument();
    await waitFor(() => expect(renderer.renderBivioFrame).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), expect.objectContaining({ timeSeconds: 0, durationSeconds: 1 })));
    expect(renderer.ensureBivioFont).toHaveBeenCalledTimes(1);
  });

  it("shows the filename immediately, validates metadata and drives transport from the audio element", async () => {
    render(<StickmanWorkspace onHome={vi.fn()} />);
    const file = new File(["audio"], "walk-song.mp3", { type: "audio/mpeg" });
    const input = screen.getByLabelText("Carica audio");

    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("walk-song.mp3")).toBeInTheDocument();
    expect(screen.getByText(/Lettura dei metadati audio/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Esporta video" })[0]).toBeDisabled();

    const audio = markAudioReady(input.closest(".skm-workspace") as HTMLElement);
    await waitFor(() => expect(screen.getByText(/Audio pronto/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Esporta video" })[0]).toBeEnabled());

    const play = screen.getByRole("button", { name: "Riproduci" });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    fireEvent.click(play);
    fireEvent.play(audio);
    expect(screen.getByRole("button", { name: "Pausa" })).toBeInTheDocument();
    fireEvent.timeUpdate(audio);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(audio.currentTime).toBe(0);
  });

  it("passes the validated audio and selected output settings to the offline exporter", async () => {
    exporter.exportBivioVideo.mockImplementation(async (_options: unknown, _signal: AbortSignal, onProgress: (progress: unknown) => void) => {
      onProgress({ currentFrame: 1, totalFrames: 10, progress: .1, stageProgress: .1, elapsedMs: 1, estimatedRemainingMs: 9, phase: "rendering" });
      return { fileName: "bivio-1080p.mp4", formatLabel: "MP4", encodedFrameCount: 10, audioPacketCount: 10, width: 1080, height: 1920, fps: 30 };
    });
    const { container } = render(<StickmanWorkspace onHome={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Carica audio"), { target: { files: [new File(["audio"], "song.wav", { type: "audio/wav" })] } });
    markAudioReady(container, 8);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Esporta video" })[0]).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Risoluzione"), { target: { value: "720" } });
    fireEvent.change(screen.getByLabelText("Frame rate"), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText("Folla a sinistra"), { target: { value: "#3366ff" } });
    fireEvent.change(screen.getByLabelText("Personaggio a destra"), { target: { value: "#ffcc00" } });
    expect(renderer.renderBivioFrame).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), expect.objectContaining({ settings: expect.objectContaining({ colors: expect.objectContaining({ crowd: "#3366ff", solo: "#ffcc00" }) }) }));
    fireEvent.click(screen.getAllByRole("button", { name: "Esporta video" })[0]!);

    await waitFor(() => expect(exporter.exportBivioVideo).toHaveBeenCalledTimes(1));
    expect(exporter.exportBivioVideo.mock.calls[0]?.[0]).toMatchObject({ sourceUrl: "blob:stickman-audio", durationSeconds: 8, resolution: 720, fps: 24 });
    expect(exporter.exportBivioVideo.mock.calls[0]?.[0].settings).toMatchObject({ leftText: expect.stringContaining("AUTOTUNE") });
    expect(exporter.exportBivioVideo.mock.calls[0]?.[0].settings.colors).toMatchObject({ crowd: "#3366ff", solo: "#ffcc00", leftText: "#141316" });
    expect(screen.getByText("Export completato")).toBeInTheDocument();
    expect(screen.getByText("bivio-1080p.mp4")).toBeInTheDocument();
    expect(localStorage.getItem("mlsm-studio.stickman.bivio-settings.v1")).toContain("AUTOTUNE");
    cleanup();
    render(<StickmanWorkspace onHome={vi.fn()} />);
    expect(screen.getByLabelText("Folla a sinistra")).toHaveValue("#3366ff");
    expect(screen.getByLabelText("Personaggio a destra")).toHaveValue("#ffcc00");
    fireEvent.click(screen.getByRole("button", { name: "Ripristina colori" }));
    expect(screen.getByLabelText("Folla a sinistra")).toHaveValue("#ed0869");
    expect(screen.getByDisplayValue(/AUTOTUNE/)).toBeInTheDocument();
  });
});
