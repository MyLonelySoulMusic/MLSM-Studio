import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoEditorPlayback } from "../store/video-editor-playback-store";
import { getOverlaySpectralBackground, registerOverlaySpectralBackground } from "./overlay-spectral-background-runtime";
import { resetWorkspaceForAreaEntry } from "./workspace-area-lifecycle";

describe("workspace area lifecycle", () => {
  beforeEach(() => resetWorkspaceForAreaEntry());

  it("azzera anche il trasporto Video Editor quando cambia area", () => {
    const playback = useVideoEditorPlayback.getState(); playback.setCurrentTime(18); playback.setPlaying(true); playback.setLooping(true); playback.setZoom(8);
    resetWorkspaceForAreaEntry();
    expect(useVideoEditorPlayback.getState()).toMatchObject({ currentTime: 0, playing: false, looping: false, zoom: 1 });
  });

  it("rilascia il video runtime di Overlay Spectral quando cambia area", () => {
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:overlay-area") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    registerOverlaySpectralBackground("project", new File(["video"], "background.mp4", { type: "video/mp4" }));
    resetWorkspaceForAreaEntry();
    expect(getOverlaySpectralBackground()).toBeNull();
    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:overlay-area");
  });
});
