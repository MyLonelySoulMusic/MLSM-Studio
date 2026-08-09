import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../store/project-store";
import { VideoEditorInspector } from "./VideoEditorInspector";
import { VideoEditorTimeline } from "./VideoEditorTimeline";

const asset = {
  id: "layer-test-video", name: "ripresa.mp4", kind: "video" as const, url: "blob:layer-test-video",
  durationSeconds: 8, width: 1080, height: 1920, hasAudio: true, bpm: null,
  beats: [] as number[], downbeats: [] as number[], waveform: [] as number[]
};

describe("Video Editor · livelli video equivalenti", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useProjectStore.getState().addVideoEditorAssets([asset]);
  });
  afterEach(cleanup);

  it("sposta la stessa clip fra livelli conservando fusione, opacità e trasformazione", () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(asset.id, { trackId: "video-editor-track-main" })!;
    useProjectStore.getState().updateVideoEditorClip(clipId, { blendMode: "multiply", transform: { x: .1, y: .2, scale: .8, rotation: 7 } });
    useProjectStore.getState().updateVideoEditorClipAdjustments(clipId, { opacity: .6 });
    render(<VideoEditorInspector />);

    fireEvent.change(screen.getByLabelText("Livello clip"), { target: { value: "video-editor-track-overlay" } });

    const clip = useProjectStore.getState().project.animation.videoEditor.clips.find((item) => item.id === clipId);
    expect(clip).toMatchObject({
      trackId: "video-editor-track-overlay", blendMode: "multiply",
      transform: { x: .1, y: .2, scale: .8, rotation: 7 }, adjustments: { opacity: .6 }
    });
  });

  it("riordina i livelli dalla UI e non presenta più ruoli principale/overlay", () => {
    render(<><VideoEditorTimeline /><VideoEditorInspector /></>);
    expect(screen.queryByText("Video principale")).not.toBeInTheDocument();
    expect(screen.queryByText("Overlay")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sposta su Livello video 1" }));
    expect(useProjectStore.getState().project.animation.videoEditor.tracks[0]?.id).toBe("video-editor-track-main");
  });
});
