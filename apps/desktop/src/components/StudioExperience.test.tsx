import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioExperience } from "./StudioExperience";
import { useAudioStore } from "../store/audio-store";
import { useAnalysisStore } from "../store/analysis-store";
import { useProjectStore } from "../store/project-store";

vi.mock("../App", () => ({
  App: ({ onHome }: { onHome?: () => void }) => <main aria-label="Editor MLSM"><button type="button" onClick={onHome}>Home editor</button></main>
}));

describe("StudioExperience", () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("naviga da intro ad aree, editor e di nuovo home", () => {
    render(<StudioExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Entra in MLSM Studio" }));
    act(() => vi.advanceTimersByTime(850));
    expect(screen.getByRole("region", { name: "Aree creative disponibili" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sound Animation/ }));
    expect(screen.getByRole("main", { name: "Editor MLSM" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Home editor" }));
    expect(screen.getByRole("region", { name: "Aree creative disponibili" })).toBeInTheDocument();
  });

  it("avvia una nuova sessione senza il brano rimasto dal processo frontend precedente", () => {
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    useAudioStore.getState().setImported({ url: "blob:stale-song", waveform: [0, 1], metadata: { path: "stale.mp3", fileName: "stale.mp3", hash: "a".repeat(64), durationSeconds: 30, sampleRate: 48_000, channels: 2, codec: "audio/mpeg", fileSize: 1024 } });
    useAudioStore.getState().setPlaying(true); useAudioStore.getState().setCurrentTime(12);
    useProjectStore.getState().attachAudio(useAudioStore.getState().imported!.metadata, [0, 1]);
    useAnalysisStore.getState().start();
    render(<StudioExperience />);
    expect(useAudioStore.getState()).toMatchObject({ imported: null, currentTime: 0, playing: false });
    expect(useAnalysisStore.getState()).toMatchObject({ result: null, running: false });
    expect(useProjectStore.getState().project.audio).toMatchObject({ sourcePath: "", durationSeconds: 0 });
    expect(revoke).toHaveBeenCalledWith("blob:stale-song");
  });

  it("nasconde Lonely Bot nella splash e lo anima dalla Home in poi", () => {
    render(<StudioExperience />);
    expect(screen.queryByRole("button", { name: "Apri Lonely Bot" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Entra in MLSM Studio" }));
    expect(screen.queryByRole("button", { name: "Apri Lonely Bot" })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(850));
    fireEvent.click(screen.getByRole("button", { name: "Apri Lonely Bot" }));
    expect(screen.getByRole("region", { name: "Lonely Bot" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chiudi Lonely Bot" }));
    expect(screen.getByRole("button", { name: "Apri Lonely Bot" })).toBeInTheDocument();
  });
});
