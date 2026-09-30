import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
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
vi.mock("./VinylTurntable", () => ({ VinylTurntable: () => null }));
vi.mock("./ProviderPlayer", () => ({ ProviderPlayer: () => null }));
vi.mock("./streamer-providers", () => ({ loadProviderMetadata: vi.fn() }));
vi.mock("./streamer-audio", () => ({
  captureCapabilities: async () => ({ platform: "browser", systemAudio: false, applicationCapture: false, outputDevices: [], applications: [], permission: "unavailable" }),
  StreamerAudioRuntime: class {
    audio = document.createElement("audio");
    frame = null;
    receivedAt = 0;
    configure() {}
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

  it("moves the analyzer grid into a separate tab and leaves a status in the main view", async () => {
    testState.loadQueue.mockResolvedValue({ tracks: [], currentId: null, autoAdvance: false, favorites: [] });
    const detachedDocument = document.implementation.createHTMLDocument("detached");
    const detachedWindow = { document: detachedDocument, closed: false, focus: vi.fn(), close: vi.fn(), addEventListener: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(detachedWindow);
    render(<StreamerAudioViewer onHome={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Espandi widget in un’altra scheda/ }));
    expect(screen.getByText("Esecuzione spostata in un’altra scheda")).toBeInTheDocument();
    expect(within(detachedDocument.body).getByLabelText("Analysis grid")).not.toBeNull();
  });
});
