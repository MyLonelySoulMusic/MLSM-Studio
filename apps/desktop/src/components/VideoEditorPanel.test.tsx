import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../store/project-store";
import { useVideoEditorPlayback } from "../store/video-editor-playback-store";
import { videoEditorAssetDragType, videoEditorAssetKindDragType } from "../services/video-editor-import";
import { VideoEditorPanel } from "./VideoEditorPanel";

const asset = {
  id: "media-bin-video", name: "ripresa.mp4", kind: "video" as const, url: "blob:media-bin-video",
  durationSeconds: 6, width: 1080, height: 1920, hasAudio: true, bpm: null,
  beats: [] as number[], downbeats: [] as number[], waveform: [] as number[]
};

describe("VideoEditorPanel · media bin", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useProjectStore.getState().addVideoEditorAssets([asset]);
    useVideoEditorPlayback.getState().setCurrentTime(2.5);
  });
  afterEach(cleanup);

  it("mostra solo importazione e tile trascinabili, senza catalogo effetti o controlli per-card", () => {
    render(<VideoEditorPanel />);
    expect(screen.getByRole("region", { name: "Media Video Editor" })).toBeInTheDocument();
    expect(screen.getByText("ripresa.mp4")).toBeInTheDocument();
    expect(screen.queryByText("Calamita attiva")).not.toBeInTheDocument();
    expect(screen.queryByText("Fade In")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Inserisci|Aggiungi in coda|Rimuovi/ })).not.toBeInTheDocument();
  });

  it("inserisce Invio al playhead sulla prima traccia compatibile sbloccata", () => {
    render(<VideoEditorPanel />);
    fireEvent.keyDown(screen.getByRole("button", { name: /ripresa\.mp4/ }), { key: "Enter" });
    expect(useProjectStore.getState().project.animation.videoEditor.clips[0]).toMatchObject({
      startSeconds: 2.5,
      trackId: "video-editor-track-overlay"
    });
  });

  it("trasporta nel payload sia l'id sia il tipo del media", () => {
    render(<VideoEditorPanel />);
    const payload = new Map<string, string>();
    fireEvent.dragStart(screen.getByRole("button", { name: /ripresa\.mp4/ }), {
      dataTransfer: {
        effectAllowed: "none",
        setData: (type: string, value: string) => payload.set(type, value)
      }
    });
    expect(payload.get(videoEditorAssetDragType)).toBe(asset.id);
    expect(payload.get(videoEditorAssetKindDragType)).toBe(asset.kind);
  });

  it("non esegue operazioni distruttive con Delete, Backspace o menu contestuale", () => {
    render(<VideoEditorPanel />);
    const tile = screen.getByRole("button", { name: /ripresa\.mp4/ });
    fireEvent.keyDown(tile, { key: "Delete" });
    fireEvent.keyDown(tile, { key: "Backspace" });
    fireEvent.contextMenu(tile);
    expect(useProjectStore.getState().project.animation.videoEditor.assets).toHaveLength(1);
    expect(useProjectStore.getState().project.animation.videoEditor.clips).toHaveLength(0);
  });
});
