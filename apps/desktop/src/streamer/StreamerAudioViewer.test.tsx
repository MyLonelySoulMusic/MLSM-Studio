import { readFileSync } from "node:fs";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  providerPlay: vi.fn(),
  providerState: null as null | ((state: import("./ProviderPlayer").PlaybackState) => void),
  loadQueue: vi.fn<() => Promise<unknown>>(),
  saveQueue: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
  startCapture: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("../services/ui-preferences", () => ({ useUiPreferences: () => ({ language: "it" }) }));
vi.mock("../components/StudioSettings", () => ({ SettingsButton: () => null }));
vi.mock("../components/ApplicationAssistant", () => ({ OPEN_LONELY_BOT_EVENT: "mlsm:open-lonely-bot" }));
vi.mock("./AnalyzerGrid", () => ({ AnalyzerGrid: () => <div aria-label="Analysis grid" /> }));
vi.mock("./AnalyzerCanvas", () => ({ AnalyzerCanvas: () => null }));
vi.mock("./WaterSurface", () => ({ WaterSurface: () => <canvas aria-label="Shared water" /> }));
vi.mock("./VinylTurntable", () => ({ VinylTurntable: () => null }));
vi.mock("./ProviderPlayer", async () => {
  const { useImperativeHandle } = await import("react");
  return { ProviderPlayer: ({ ref, track, onState }: import("./ProviderPlayer").ProviderPlayerProps & { ref: import("react").Ref<import("./ProviderPlayer").PlayerHandle> }) => {
    testState.providerState = onState;
    useImperativeHandle(ref, () => ({ play: testState.providerPlay, pause: vi.fn(), stop: vi.fn(), seek: vi.fn(), setVolume: vi.fn() }), []);
    return <div aria-label="Provider player" data-provider={track.provider} />;
  } };
});
vi.mock("./streamer-providers", () => ({ loadProviderMetadata: vi.fn() }));
vi.mock("./streamer-audio", () => ({
  captureCapabilities: async () => ({ platform: "browser", systemAudio: false, applicationCapture: false, outputDevices: [], applications: [], permission: "unavailable" }),
  StreamerAudioRuntime: class {
    audio = document.createElement("audio");
    frame = null;
    receivedAt = 0;
    configure() {}
    subscribePcm() { return () => undefined; }
    pause() {}
    reset() {}
    stopLocal() {}
    dispose = testState.dispose;
    startCapture = testState.startCapture;
    stopCapture = vi.fn(async () => undefined);
  },
}));
vi.mock("./streamer-store", async importOriginal => {
  const original = await importOriginal<typeof import("./streamer-store")>();
  return { ...original, loadQueue: testState.loadQueue, saveQueue: testState.saveQueue };
});

import { StreamerAudioViewer } from "./StreamerAudioViewer";

describe("StreamerAudioViewer startup", () => {
  beforeEach(() => {
    localStorage.clear();
    testState.loadQueue.mockReset();
    testState.saveQueue.mockClear();
    testState.dispose.mockClear();
    testState.startCapture.mockClear();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("does not overwrite a persisted queue during StrictMode's initial cleanup", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    testState.loadQueue.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
    const mounted = render(<StrictMode><StreamerAudioViewer onHome={() => undefined} /></StrictMode>);
    expect(screen.getByText("Streamer Audio Viewer")).toBeInTheDocument();
    expect(testState.loadQueue).toHaveBeenCalledTimes(2);
    expect(testState.saveQueue).not.toHaveBeenCalled();
    expect(testState.startCapture).not.toHaveBeenCalled();
    await act(async () => { resolvers[0]?.({ tracks: [], currentId: null, autoAdvance: false, favorites: [] }); });
    expect(testState.saveQueue).not.toHaveBeenCalled();
    await act(async () => { resolvers[1]?.({ tracks: [], currentId: null, autoAdvance: false, favorites: [] }); });
    mounted.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(testState.saveQueue).toHaveBeenCalledTimes(1);
    expect(testState.startCapture).not.toHaveBeenCalled();
  });

  it("does not save an empty queue after a storage read failure", async () => {
    testState.loadQueue.mockRejectedValue(new Error("IndexedDB unavailable"));
    const mounted = render(<StreamerAudioViewer onHome={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("IndexedDB unavailable");
    mounted.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(testState.saveQueue).not.toHaveBeenCalled();
  });

  it("keeps Lonely Bot callable from the Streamer top bar", async () => {
    testState.loadQueue.mockResolvedValue({ tracks: [], currentId: null, autoAdvance: false, favorites: [] });
    const opened = vi.fn(); window.addEventListener("mlsm:open-lonely-bot", opened, { once: true });
    render(<StreamerAudioViewer onHome={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "LB · Lonely Bot" }));
    expect(opened).toHaveBeenCalledOnce();
  });

  it("toggles a single shared water layer and remembers the choice, including fullscreen", async () => {
    testState.loadQueue.mockResolvedValue({ tracks: [], currentId: null, autoAdvance: false, favorites: [] });
    const mounted = render(<StreamerAudioViewer onHome={() => undefined} />);
    await screen.findByLabelText("Shared water");
    fireEvent.click(screen.getByRole("button", { name: /Onde reattive/ }));
    expect(screen.queryByLabelText("Shared water")).not.toBeInTheDocument();
    expect(localStorage.getItem("mlsm.streamer.water.v1")).toBe("off");
    fireEvent.click(screen.getByRole("button", { name: /Widget a schermo intero/ }));
    const toggle = screen.getByRole("banner").querySelector<HTMLButtonElement>(".sav-water-toggle")!;
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getAllByLabelText("Shared water")).toHaveLength(1);
    expect(localStorage.getItem("mlsm.streamer.water.v1")).toBe("on");
    fireEvent.click(toggle);
    mounted.unmount();
    render(<StreamerAudioViewer onHome={() => undefined} />);
    expect(screen.getByRole("button", { name: /Onde reattive/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("expands the analyzer grid inside the app and returns with one action", async () => {
    testState.loadQueue.mockResolvedValue({ tracks: [{ id: "web-1", provider: "youtube", title: "Web stereo", url: "https://www.youtube.com/watch?v=test" }], currentId: "web-1", autoAdvance: false, favorites: [] });
    const open = vi.spyOn(window, "open");
    render(<StreamerAudioViewer onHome={() => undefined} />);
    const providerPlayer = await screen.findByLabelText("Provider player");
    fireEvent.click(screen.getByRole("button", { name: /Widget a schermo intero/ }));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole("banner", { name: "Analizzatori a schermo intero" })).toBeInTheDocument();
    expect(screen.getByLabelText("Analysis grid")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider player")).toBe(providerPlayer);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registra" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "← MLSM Studio" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Torna alla visualizzazione classica/ }));
    expect(screen.queryByRole("banner", { name: "Analizzatori a schermo intero" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Provider player")).toBe(providerPlayer);
    expect(screen.getByRole("button", { name: "← MLSM Studio" })).toBeInTheDocument();
  });

  it("starts Spotify after YouTube in fullscreen with a visible dock and preserves it on return", async () => {
    testState.providerPlay.mockClear();
    testState.loadQueue.mockResolvedValue({ tracks: [
      { id: "yt", provider: "youtube", title: "YouTube track", url: "https://www.youtube.com/watch?v=test" },
      { id: "sp", provider: "spotify", title: "Spotify track", url: "https://open.spotify.com/track/test" },
    ], currentId: "yt", autoAdvance: true, favorites: [] });
    const style = document.createElement("style");
    style.textContent = readFileSync("apps/desktop/src/streamer/streamer.css", "utf8");
    document.head.append(style);
    try {
      render(<StreamerAudioViewer onHome={() => undefined} />);
      await screen.findByLabelText("Provider player");
      act(() => testState.providerState?.("PLAYING"));
      fireEvent.click(screen.getByRole("button", { name: /Widget a schermo intero/ }));
      fireEvent.click(screen.getByRole("button", { name: "Successivo" }));
      const spotify = screen.getByLabelText("Provider player");
      expect(spotify).toHaveAttribute("data-provider", "spotify");
      const sidebar = spotify.closest(".sav-sidebar")!;
      expect(getComputedStyle(sidebar).display).toBe("block");
      expect(getComputedStyle(sidebar).position).toBe("absolute");
      expect(getComputedStyle(sidebar).left).toBe("18px");
      expect(getComputedStyle(sidebar).opacity).not.toBe("0");
      expect(getComputedStyle(sidebar).pointerEvents).not.toBe("none");
      act(() => testState.providerState?.("READY"));
      expect(testState.providerPlay).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: /Torna alla visualizzazione classica/ }));
      expect(screen.getByLabelText("Provider player")).toBe(spotify);
      expect(testState.providerPlay).toHaveBeenCalledOnce();
    } finally { style.remove(); }
  });

  it("keeps Record beside Play, off by default, and requires a received audio source for web recordings", async () => {
    testState.loadQueue.mockResolvedValue({ tracks: [{ id: "web-1", provider: "youtube", title: "Web stereo", url: "https://www.youtube.com/watch?v=test" }], currentId: "web-1", autoAdvance: false, favorites: [] });
    render(<StreamerAudioViewer onHome={() => undefined} />);
    await screen.findByLabelText("Provider player");
    const record = screen.getByRole("button", { name: "Registra" }), play = screen.getByRole("button", { name: "Play" });
    expect(record).toHaveAttribute("aria-pressed", "false"); expect(play.nextElementSibling).toBe(record);
    fireEvent.click(record);
    expect(await screen.findByRole("alert")).toHaveTextContent("abilita l’analisi audio di sistema");
    expect(record).toHaveAttribute("aria-pressed", "false"); expect(testState.startCapture).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Provider player")).toBeInTheDocument();
  });
});
