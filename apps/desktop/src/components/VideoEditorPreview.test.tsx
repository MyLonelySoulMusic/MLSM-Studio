import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../store/project-store";
import { useVideoEditorPlayback } from "../store/video-editor-playback-store";
import type { VideoEditorAsset } from "../services/video-editor";

vi.mock("../services/video-editor-renderer", async () => {
  const actual = await vi.importActual<typeof import("../services/video-editor-renderer")>("../services/video-editor-renderer");
  return { ...actual, createVideoEditorFrameRenderer: () => vi.fn() };
});

import { VideoEditorPreview } from "./VideoEditorPreview";

describe("VideoEditorPreview · lifecycle decoder", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useVideoEditorPlayback.setState({ currentTime: 0, playing: false, looping: false, zoom: 1 });
    vi.stubGlobal("ResizeObserver", class {
      observe() { /* il resize iniziale viene eseguito direttamente */ }
      disconnect() { /* nessuna risorsa nativa in JSDOM */ }
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect(this: HTMLElement) {
      const width = this.classList.contains("three-stage") ? 900 : 0;
      const height = this.classList.contains("three-stage") ? 600 : 0;
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
    });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("rimonta e ripresenta il video dopo il doppio cleanup/setup di React StrictMode", () => {
    const asset: VideoEditorAsset = {
      id: "strict-video", name: "verticale.mp4", kind: "video", url: "blob:strict-video",
      durationSeconds: 5, width: 1080, height: 1920, thumbnailUrl: null, hasAudio: false,
      bpm: null, beats: [], downbeats: [], waveform: []
    };
    useProjectStore.getState().addVideoEditorAssets([asset]);
    expect(useProjectStore.getState().addVideoEditorClip(asset.id, { trackId: "video-editor-track-main" })).toBeTruthy();

    const { container } = render(<StrictMode><VideoEditorPreview /></StrictMode>);
    const rack = container.querySelector(".video-editor-media-rack");
    const videos = rack?.querySelectorAll("video") ?? [];
    expect(videos).toHaveLength(1);
    expect(videos[0]).toHaveClass("video-editor-presented-video");
    expect((videos[0] as HTMLVideoElement).style.filter).toBe("none");
    expect((videos[0] as HTMLVideoElement).style.transform).toBe("none");
  });

  it("riflette overlap, gap, seek e cancellazione senza lasciare il vecchio video nel monitor", () => {
    const assets: VideoEditorAsset[] = ["base", "top"].map((id) => ({
      id, name: `${id}.mp4`, kind: "video", url: `blob:${id}`,
      durationSeconds: 5, width: 1920, height: 1080, thumbnailUrl: null, hasAudio: false,
      bpm: null, beats: [], downbeats: [], waveform: []
    }));
    useProjectStore.getState().addVideoEditorAssets(assets);
    const baseClip = useProjectStore.getState().addVideoEditorClip("base", { trackId: "video-editor-track-main" })!;
    const topClip = useProjectStore.getState().addVideoEditorClip("top", { trackId: "video-editor-track-overlay" })!;

    const { container } = render(<VideoEditorPreview />);
    const rack = container.querySelector(".video-editor-media-rack")!;
    expect(rack.querySelectorAll(".video-editor-presented-media")).toHaveLength(2);
    expect(rack.querySelector<HTMLVideoElement>(`[data-clip-id="${baseClip}"]`)?.style.zIndex).toBe("1");
    expect(rack.querySelector<HTMLVideoElement>(`[data-clip-id="${topClip}"]`)?.style.zIndex).toBe("4");

    act(() => useProjectStore.getState().updateVideoEditorClip(topClip, { startSeconds: 6 }));
    expect(rack.querySelectorAll(".video-editor-presented-media")).toHaveLength(1);
    expect(rack.querySelector<HTMLVideoElement>(`[src="blob:top"]`)).toHaveClass("video-editor-decoder-media");

    act(() => useVideoEditorPlayback.getState().setCurrentTime(6.25));
    expect(rack.querySelectorAll(".video-editor-presented-media")).toHaveLength(1);
    expect(rack.querySelector<HTMLVideoElement>(`[data-clip-id="${topClip}"]`)).toHaveClass("video-editor-presented-video");

    act(() => useProjectStore.getState().deleteVideoEditorClips([topClip]));
    expect(rack.querySelectorAll("video")).toHaveLength(1);
    expect(rack.querySelector(`[src="blob:top"]`)).toBeNull();
    expect(rack.querySelectorAll(".video-editor-presented-media")).toHaveLength(0);
  });
});
