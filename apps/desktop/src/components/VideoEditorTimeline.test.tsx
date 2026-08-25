import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../store/project-store";
import { useVideoEditorPlayback } from "../store/video-editor-playback-store";
import { VideoEditorTimeline } from "./VideoEditorTimeline";

function dispatchPointer(type: "pointermove" | "pointerup" | "pointercancel", clientX: number): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { clientX: { value: clientX }, pointerId: { value: 0 } });
  window.dispatchEvent(event);
}

const image = {
  id: "timeline-still", name: "overlay.png", kind: "image" as const, url: "blob:timeline-still",
  durationSeconds: 0, width: 800, height: 600, hasAudio: false, bpm: null,
  beats: [] as number[], downbeats: [] as number[], waveform: [] as number[]
};
const video = {
  ...image, id: "timeline-video", name: "ripresa.mp4", kind: "video" as const,
  url: "blob:timeline-video", durationSeconds: 8, hasAudio: true
};

describe("VideoEditorTimeline · trim dei fermi immagine", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useProjectStore.getState().addVideoEditorAssets([image, video]);
    useVideoEditorPlayback.getState().setCurrentTime(0);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("video-editor-context-menu")) return { left: 0, top: 0, width: 260, height: 420, right: 260, bottom: 420, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      if (this.classList.contains("video-editor-lanes")) return { left: 0, top: 0, width: 1_200, height: 500, right: 1_200, bottom: 500, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      return { left: 0, top: 0, width: 1_200, height: 500, right: 1_200, bottom: 500, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("anteprima e commit usano il trim puro e allungano il bordo destro", () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(image.id, { trackId: "video-editor-track-main" })!;
    render(<VideoEditorTimeline timelineHeight={300} />);
    const handle = screen.getByRole("button", { name: "Estendi o accorcia la fine di overlay.png" });
    fireEvent.pointerDown(handle, { clientX: 240 });
    dispatchPointer("pointermove", 600);
    expect(screen.getByRole("button", { name: /Clip overlay\.png da 0\.00 a/ })).toHaveAttribute("aria-pressed", "true");
    dispatchPointer("pointerup", 600);
    const clip = useProjectStore.getState().project.animation.videoEditor.clips.find((candidate) => candidate.id === clipId);
    expect(clip?.durationSeconds).toBeGreaterThan(4);
    expect(clip?.durationSeconds).toBeLessThanOrEqual(3_600);
  });

  it("annulla il gesto senza mutare la durata persistita", () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(image.id, { trackId: "video-editor-track-main" })!;
    render(<VideoEditorTimeline timelineHeight={300} />);
    const handle = screen.getByRole("button", { name: "Estendi o accorcia la fine di overlay.png" });
    fireEvent.pointerDown(handle, { clientX: 240 });
    dispatchPointer("pointermove", 900);
    dispatchPointer("pointercancel", 900);
    expect(useProjectStore.getState().project.animation.videoEditor.clips.find((candidate) => candidate.id === clipId)?.durationSeconds).toBe(4);
  });

  it("segnala sulla timeline una clip riprodotta al contrario", () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(video.id, { trackId: "video-editor-track-main" })!;
    render(<VideoEditorTimeline timelineHeight={300} />);

    const reverse = screen.getByRole("button", { name: "Riproduci clip selezionata al contrario" });
    expect(reverse).toBeEnabled();
    expect(reverse.closest(".transport")).not.toBeNull();
    expect(reverse).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(reverse);
    expect(useProjectStore.getState().project.animation.videoEditor.clips.find((clip) => clip.id === clipId)?.reversed).toBe(true);
    expect(reverse).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Riproduzione inversa")).toHaveTextContent("↶");
    expect(screen.getByRole("button", { name: /Clip ripresa\.mp4/ }).closest(".video-editor-clip")).toHaveAttribute("title", expect.stringContaining("riproduzione inversa"));
  });

  it("abilita Reverse soltanto per una clip video selezionata su traccia sbloccata", () => {
    render(<VideoEditorTimeline timelineHeight={300} />);
    const reverse = screen.getByRole("button", { name: "Riproduci clip selezionata al contrario" });
    expect(reverse).toBeDisabled();

    act(() => { useProjectStore.getState().addVideoEditorClip(image.id, { trackId: "video-editor-track-main" }); });
    expect(reverse).toBeDisabled();
    act(() => { useProjectStore.getState().addVideoEditorClip(video.id, { trackId: "video-editor-track-main" }); });
    expect(reverse).toBeEnabled();
    act(() => { useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { locked: true }); });
    expect(reverse).toBeDisabled();
  });

  it("mantiene il menu contestuale interamente dentro la viewport vicino al bordo inferiore", () => {
    useProjectStore.getState().addVideoEditorClip(video.id, { trackId: "video-editor-track-main" });
    render(<VideoEditorTimeline timelineHeight={300} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Clip ripresa\.mp4/ }), { clientX: window.innerWidth - 1, clientY: window.innerHeight - 1 });

    const menu = screen.getByRole("menu", { name: "Azioni clip" });
    expect(menu).toHaveStyle({
      left: `${window.innerWidth - 260 - 8}px`,
      top: `${window.innerHeight - 420 - 8}px`
    });
    expect(screen.getByRole("menuitem", { name: "Elimina clip" })).toBeInTheDocument();
  });
});
