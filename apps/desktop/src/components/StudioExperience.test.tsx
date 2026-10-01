import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioExperience } from "./StudioExperience";
import { useAudioStore } from "../store/audio-store";
import { useAnalysisStore } from "../store/analysis-store";
import { useProjectStore } from "../store/project-store";
import * as applicationAssistant from "../services/application-assistant";

vi.mock("../App", () => ({
  App: ({ onHome }: { onHome?: () => void }) => <main aria-label="Editor MLSM"><button type="button" onClick={onHome}>Home editor</button></main>
}));
vi.mock("../stickman/StickmanWorkspace", () => ({
  StickmanWorkspace: ({ onHome }: { onHome: () => void }) => <main aria-label="Stickman Animations"><button type="button" onClick={onHome}>Home Stickman Animations</button></main>
}));
vi.mock("../reports/ReportsWorkspace", () => ({
  ReportsWorkspace: ({ onHome, viewDashboardId }: { onHome: () => void; viewDashboardId?: string | null }) => <main aria-label="Reports"><span>{viewDashboardId ? `Viewer ${viewDashboardId}` : "Editor Reports"}</span><button type="button" onClick={onHome}>Home Reports</button></main>
}));
vi.mock("../postit/PostItWorkspace", () => ({
  PostItWorkspace: ({ onHome }: { onHome: () => void }) => <main aria-label="Post-it"><button type="button" onClick={onHome}>Home Post-it</button></main>
}));
vi.mock("../streamer/StreamerAudioViewer", () => ({
  StreamerAudioViewer: ({ onHome }: { onHome: () => void }) => <main aria-label="Streamer Audio Viewer"><button type="button" onClick={onHome}>Home Streamer Audio Viewer</button></main>
}));
vi.mock("../documentation/DocumentationWorkspace", () => ({
  DocumentationWorkspace: ({ onHome }: { onHome: () => void }) => <main aria-label="Documentation"><button type="button" onClick={onHome}>Home Documentation</button></main>
}));

describe("StudioExperience", () => {
  beforeEach(() => { localStorage.clear(); window.history.replaceState(null, "", "/"); vi.useFakeTimers(); });
  afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

  it("apre AutoPost come area separata e torna alla Home aree", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("servizio test non avviato")));
    render(<StudioExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Entra in MLSM Studio" }));
    act(() => vi.advanceTimersByTime(850));
    fireEvent.click(screen.getByRole("button", { name: /AutoPost/ }));
    expect(screen.getByLabelText("MLSM AutoPost")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Torna alle aree" }));
    expect(screen.getByRole("region", { name: "Aree creative disponibili" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("apre Stickman Animations come area separata e torna alla Home aree", () => {
    render(<StudioExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Entra in MLSM Studio" }));
    act(() => vi.advanceTimersByTime(850));
    fireEvent.click(screen.getByRole("button", { name: /Stickman Animations/ }));
    expect(screen.getByRole("main", { name: "Stickman Animations" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Home Stickman Animations" }));
    expect(screen.getByRole("region", { name: "Aree creative disponibili" })).toBeInTheDocument();
  });

  it("apre Post-it come area separata e torna alla Home aree", async () => {
    render(<StudioExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Entra in MLSM Studio" }));
    act(() => vi.advanceTimersByTime(850));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Post-it/ })); });
    expect(screen.getByRole("main", { name: "Post-it" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Home Post-it" }));
    expect(screen.getByRole("region", { name: "Aree creative disponibili" })).toBeInTheDocument();
  });

  it("apre Streamer Audio Viewer come area separata e torna alla Home aree", async () => {
    render(<StudioExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Entra in MLSM Studio" }));
    act(() => vi.advanceTimersByTime(850));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Streamer Audio Viewer/ })); });
    expect(screen.getByRole("main", { name: "Streamer Audio Viewer" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Home Streamer Audio Viewer" }));
    expect(screen.getByRole("region", { name: "Aree creative disponibili" })).toBeInTheDocument();
  });

  it("apre Documentation come area separata e torna alla Home aree", async () => {
    render(<StudioExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Entra in MLSM Studio" }));
    act(() => vi.advanceTimersByTime(850));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Documentation/ })); });
    expect(screen.getByRole("main", { name: "Documentation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Home Documentation" }));
    expect(screen.getByRole("region", { name: "Aree creative disponibili" })).toBeInTheDocument();
  });

  it("apre Reports su richiesta, aggiorna il contesto di Lonely Bot e torna alle aree", async () => {
    const answer = vi.spyOn(applicationAssistant, "answerApplicationQuestion").mockResolvedValue({ content: "Questa è l’area Reports.", source: "built-in" });
    render(<StudioExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Entra in MLSM Studio" }));
    act(() => vi.advanceTimersByTime(850));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Reports/ })); });
    expect(screen.getByRole("main", { name: "Reports" })).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "Editor MLSM" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apri Lonely Bot" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Domanda per Lonely Bot" }), { target: { value: "Dove mi trovo?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Invia domanda" })); });
    expect(answer).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ modeId: "reports", modeLabel: "Reports", aspectRatio: "dashboard", hasAudio: false, analysisReady: false, screen: "editor" }), expect.any(Function), expect.any(Object));
    fireEvent.click(screen.getByRole("button", { name: "Home Reports" }));
    expect(screen.getByRole("region", { name: "Aree creative disponibili" })).toBeInTheDocument();
  });

  it("opens a dashboard URL directly in read-only Reports without editor assistants", async () => {
    vi.useRealTimers();
    window.history.replaceState(null, "", "/#/reports/view/report_123");
    await act(async () => { render(<StudioExperience />); });
    expect(await screen.findByText("Viewer report_123")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apri Lonely Bot" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Entra in MLSM Studio" })).not.toBeInTheDocument();
  });
});
