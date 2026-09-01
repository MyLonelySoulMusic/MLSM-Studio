import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportedAudio } from "../services/audio-import";

const playback = vi.hoisted(() => vi.fn(async (media: HTMLMediaElement) => { media.dispatchEvent(new Event("playing")); return true; }));
vi.mock("../services/media-playback", () => ({ requestMediaPlayback: playback }));
import { MlsmAudioTrimModal } from "./MlsmAudioTrimModal";

const audio: ImportedAudio = {
  metadata: { path: "/music/master.wav", fileName: "master.wav", hash: "a".repeat(64), durationSeconds: 120, sampleRate: 48_000, channels: 2, codec: "wav", fileSize: 42 },
  waveform: Array.from({ length: 360 }, (_, index) => Math.sin(index / 8) * .8),
  url: "blob:master"
};

describe("MlsmAudioTrimModal", () => {
  beforeEach(() => { playback.mockClear(); vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("fa ascoltare la selezione e applica soltanto i limiti scelti", async () => {
    const apply = vi.fn();
    render(<MlsmAudioTrimModal open audio={audio} range={{ startSeconds: 0, endSeconds: 120 }} language="it" onClose={vi.fn()} onApply={apply} />);
    const dialog = screen.getByRole("dialog", { name: "Ascolta e taglia il master" });
    expect(dialog).toBeInTheDocument(); expect(screen.getByLabelText("Forma d’onda del master audio")).toBeInTheDocument();
    const start = screen.getByRole("slider", { name: "Inizio selezione" }); const end = screen.getByRole("slider", { name: "Fine selezione" });
    fireEvent.change(start, { target: { value: "30" } }); fireEvent.change(end, { target: { value: "42.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Ascolta selezione/u }));
    await waitFor(() => expect(playback).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Usa questa porzione" }));
    expect(apply).toHaveBeenCalledWith({ startSeconds: 30, endSeconds: 42.5 });
  });

  it("ferma l’audio al limite finale invece di continuare nel resto del master", () => {
    render(<MlsmAudioTrimModal open audio={audio} range={{ startSeconds: 30, endSeconds: 42.5 }} language="it" onClose={vi.fn()} onApply={vi.fn()} />);
    const media = document.querySelector("audio")!; Object.defineProperty(media, "currentTime", { configurable: true, writable: true, value: 42.5 });
    fireEvent.timeUpdate(media);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(screen.getByText(/0:42\.500 \/ 2:00\.000/u)).toBeInTheDocument();
  });
});
