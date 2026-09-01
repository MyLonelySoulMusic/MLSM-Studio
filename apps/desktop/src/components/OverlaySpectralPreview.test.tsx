import { cleanup, render } from "@testing-library/react";
import { createProject } from "@rbs/project-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderer = { setExportSize: vi.fn(), setExternalBackground: vi.fn(), setPreviewPlaying: vi.fn(), renderNow: vi.fn(), update: vi.fn(), dispose: vi.fn() };
vi.mock("../services/overlay-spectral-renderer", () => ({ OverlaySpectralRenderer: vi.fn(() => renderer) }));
import { OverlaySpectralPreview } from "./OverlaySpectralPreview";

describe("OverlaySpectralPreview", () => {
  beforeEach(() => { Object.values(renderer).forEach((mock) => mock.mockClear()); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("ridisegna a ogni frame usando direttamente il clock audio durante Play", () => {
    const animationFrames: FrameRequestCallback[] = [];
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { animationFrames.push(callback); return 17; });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const view = render(<OverlaySpectralPreview settings={createProject().animation.overlaySpectral} energyFrames={[]} currentTime={1} playing getPlaybackTime={() => 2.75} aspectRatio="9:16" customWidth={540} customHeight={960} />);
    expect(renderer.setExternalBackground).toHaveBeenCalledWith(false);
    expect(renderer.setPreviewPlaying).toHaveBeenCalledWith(true, 2.75);
    renderer.renderNow.mockClear();
    expect(request).toHaveBeenCalled();
    const animationFrame = animationFrames[0]; if (!animationFrame) throw new Error("Loop preview non avviato");
    animationFrame(16);
    expect(renderer.renderNow).toHaveBeenCalledWith(2.75);
    view.rerender(<OverlaySpectralPreview settings={createProject().animation.overlaySpectral} energyFrames={[]} currentTime={2.75} playing={false} getPlaybackTime={() => 2.75} aspectRatio="9:16" customWidth={540} customHeight={960} />);
    expect(renderer.setPreviewPlaying).toHaveBeenLastCalledWith(false, 2.75);
    expect(cancel).toHaveBeenCalledWith(17);
  });
  it("usa il video come livello reale dietro al canvas", () => { const settings = { ...createProject().animation.overlaySpectral, backgroundImageUrl: "data:video/mp4;base64,AAAA", backgroundMediaType: "video" as const }; render(<OverlaySpectralPreview settings={settings} energyFrames={[]} currentTime={0} playing={false} getPlaybackTime={() => 0} aspectRatio="16:9" customWidth={1280} customHeight={720} />); expect(renderer.setExternalBackground).toHaveBeenCalledWith(true); expect(renderer.update).toHaveBeenCalledWith(expect.objectContaining({ settings })); });
});
