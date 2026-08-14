import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";

vi.mock("../services/background-auto-renderer", async () => {
  const actual = await vi.importActual<typeof import("../services/background-auto-renderer")>("../services/background-auto-renderer");
  return { ...actual, renderBackgroundAutoFrame: vi.fn() };
});

import { BackgroundAutoPreview } from "./BackgroundAutoPreview";

describe("BackgroundAutoPreview", () => {
  const images: Array<{ naturalWidth: number; naturalHeight: number; onload: (() => void) | null; onerror: (() => void) | null; src: string }> = [];
  beforeEach(() => {
    images.length = 0;
    vi.stubGlobal("Image", class {
      naturalWidth = 0; naturalHeight = 0; onload: (() => void) | null = null; onerror: (() => void) | null = null; src = "";
      constructor() { images.push(this); }
    });
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { void callback; } observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, toJSON: () => ({}) });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("usa il rapporto sorgente nel frame e ignora il caricamento stale", () => {
    const project = createProject(); const settings = { ...project.animation.backgroundAuto, imageUrl: "old", sourceWidth: 1080, sourceHeight: 1920 };
    const onSourceDimensions = vi.fn(); const view = render(<BackgroundAutoPreview settings={settings} timeSeconds={0} durationSeconds={10} playing={false} spectrumBands={[]} audioPulse={0} projectSeed={1} onSourceDimensions={onSourceDimensions} />);
    const frame = screen.getByLabelText("Circular Spectrum Auto Detector preview").querySelector(".preview-frame");
    expect(frame).toHaveStyle({ aspectRatio: "1080 / 1920" });
    view.rerender(<BackgroundAutoPreview settings={{ ...settings, imageUrl: "new", sourceWidth: 0, sourceHeight: 0 }} timeSeconds={0} durationSeconds={10} playing={false} spectrumBands={[]} audioPulse={0} projectSeed={1} onSourceDimensions={onSourceDimensions} />);
    act(() => { images[0]!.naturalWidth = 1920; images[0]!.naturalHeight = 1080; images[0]!.onload?.(); });
    expect(onSourceDimensions).not.toHaveBeenCalled();
    act(() => { images[1]!.naturalWidth = 300; images[1]!.naturalHeight = 400; images[1]!.onload?.(); });
    expect(onSourceDimensions).toHaveBeenCalledWith({ width: 300, height: 400 });
  });

  it("renders selectable editor overlays with contain letterboxing and detection metadata", () => {
    const project = createProject();
    const settings = {
      ...project.animation.backgroundAuto,
      sourceWidth: 1080,
      sourceHeight: 1920,
      detections: [{ id: "person-a", label: "person", alias: "Lead", score: .875, isPerson: true, bbox: { x: .1, y: .2, width: .2, height: .4 } }]
    };
    render(<BackgroundAutoPreview settings={settings} timeSeconds={0} durationSeconds={10} playing={false} spectrumBands={[]} audioPulse={0} projectSeed={1} />);
    const overlay = screen.getByRole("button", { name: "Select Lead" });
    expect(overlay).toHaveStyle({ left: "16.25%", top: "20%", width: "16.875%", height: "40%" });
    expect(overlay).toHaveTextContent("Lead");
    expect(overlay).toHaveTextContent("person");
    expect(overlay).toHaveTextContent("88%");
    expect(overlay).not.toHaveClass("is-selected");
    fireEvent.click(overlay);
    expect(overlay).toHaveClass("is-selected");
  });

  it("toggles detected areas without changing the animation canvas", () => {
    const project = createProject();
    const settings = {
      ...project.animation.backgroundAuto,
      sourceWidth: 1080,
      sourceHeight: 1920,
      detections: [{ id: "person-a", label: "person", alias: "Lead", score: .875, isPerson: true, bbox: { x: .1, y: .2, width: .2, height: .4 } }]
    };
    render(<BackgroundAutoPreview settings={settings} timeSeconds={0} durationSeconds={10} playing={false} spectrumBands={[]} audioPulse={0} projectSeed={1} />);
    const toggle = screen.getByRole("button", { name: "Toggle detected areas" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Select Lead" })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Select Lead" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Select Lead" })).toBeInTheDocument();
  });
});
