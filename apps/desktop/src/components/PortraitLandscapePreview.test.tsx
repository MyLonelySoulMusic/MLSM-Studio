import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { PortraitLandscapePreview } from "./PortraitLandscapePreview";

vi.mock("../services/portrait-landscape-renderer", async () => {
  const actual = await vi.importActual<typeof import("../services/portrait-landscape-renderer")>("../services/portrait-landscape-renderer");
  return { ...actual, renderPortraitLandscapeFrame: vi.fn() };
});

describe("PortraitLandscapePreview", () => {
  let stageWidth = 900;
  let stageHeight = 600;
  let resizeCallback: ResizeObserverCallback | null = null;
  let nextFrameId = 1;
  let animationFrames = new Map<number, FrameRequestCallback>();

  const flushAnimationFrames = () => {
    const pending = [...animationFrames.values()]; animationFrames.clear();
    pending.forEach((callback) => callback(0));
  };

  beforeEach(() => {
    stageWidth = 900; stageHeight = 600; resizeCallback = null; nextFrameId = 1; animationFrames = new Map();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
      observe() { /* Dimensioni pilotate dal test. */ }
      disconnect() { /* Nessuna risorsa nativa in JSDOM. */ }
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = nextFrameId++; animationFrames.set(id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { animationFrames.delete(id); });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect(this: HTMLElement) {
      const isStage = this.classList.contains("three-stage"); const width = isStage ? stageWidth : 0; const height = isStage ? stageHeight : 0;
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ imageSmoothingEnabled: true, imageSmoothingQuality: "medium" } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("rifitta il 16:9 nella riga reale quando la timeline riduce il workspace", () => {
    const settings = createProject().animation.portraitLandscape;
    render(<PortraitLandscapePreview settings={settings} timeSeconds={0} durationSeconds={10} playing={false} bpm={120} analysisReady={false} audioPulse={0} rhythmPulse={0} spectrumBands={[]} stereoLeftBands={[]} stereoRightBands={[]} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} />);
    const frame = screen.getByLabelText("Composizione From 9:16 to 16:9").parentElement;
    expect(frame).toHaveStyle({ width: "898px", height: "505px" });

    stageHeight = 400;
    act(() => { resizeCallback?.([], {} as ResizeObserver); flushAnimationFrames(); });
    expect(frame).toHaveStyle({ width: "707px", height: "398px" });

    stageHeight = 500;
    act(() => { resizeCallback?.([], {} as ResizeObserver); flushAnimationFrames(); });
    expect(frame).toHaveStyle({ width: "885px", height: "498px" });

    stageHeight = 350;
    act(() => { resizeCallback?.([], {} as ResizeObserver); flushAnimationFrames(); });
    expect(frame).toHaveStyle({ width: "618px", height: "348px" });
  });
});
