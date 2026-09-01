import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { useProjectStore } from "../store/project-store";
import type { VideoEditorToolArtifact } from "../services/video-editor-tools";
import { DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH, MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH, VIDEO_EDITOR_WORKSPACE_LAYOUT_KEY } from "../services/video-editor-workspace-layout";
import { VideoEditorWorkspace } from "./VideoEditorWorkspace";

const asset = {
  id: "workspace-video", name: "workspace.mp4", kind: "video" as const, url: "blob:workspace-source",
  durationSeconds: 4, width: 1920, height: 1080, hasAudio: true, bpm: null,
  beats: [] as number[], downbeats: [] as number[], waveform: [] as number[]
};

describe("VideoEditorWorkspace · artifact tools", () => {
  beforeEach(() => {
    window.localStorage.removeItem(VIDEO_EDITOR_WORKSPACE_LAYOUT_KEY);
    useProjectStore.getState().newProject();
    useProjectStore.getState().addVideoEditorAssets([asset]);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("keeps the modal open, reports the locked race and revokes the rejected blob", async () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(asset.id, { trackId: "video-editor-track-main" })!;
    useProjectStore.getState().selectVideoEditorClip(clipId);
    let finish!: (artifact: VideoEditorToolArtifact) => void;
    const runTool = vi.fn(() => new Promise<VideoEditorToolArtifact>((resolve) => { finish = resolve; }));
    const revoke = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    render(<VideoEditorWorkspace preview={<div />} inspector={<div />} timeline={<div />} runTool={runTool} />);
    fireEvent.click(screen.getByRole("button", { name: "AI Tools" }));
    fireEvent.click(screen.getByRole("button", { name: /Upscaler/ }));
    fireEvent.click(screen.getByRole("button", { name: "Esegui sul frammento" }));
    useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { locked: true });
    finish({ id: "artifact", toolId: "upscaler", url: "blob:result", name: "result.mp4", kind: "video", sourceClipId: clipId, sourceFrameCount: 240, sourceRate: { numerator: 60, denominator: 1 }, provenance: { toolId: "upscaler", createdAt: new Date().toISOString(), inputAssetId: asset.id } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/rimossa o bloccata/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith("blob:result");
    expect(useProjectStore.getState().project.animation.videoEditor.assets.some((item) => item.url === "blob:result")).toBe(false);
    await waitFor(() => expect(runTool).toHaveBeenCalledOnce());
  });

  it("preflights incompatible tool inputs before opening a workflow", () => {
    const audio = { ...asset, id: "audio", kind: "audio" as const, width: 0, height: 0 };
    useProjectStore.getState().addVideoEditorAssets([audio]);
    const clipId = useProjectStore.getState().addVideoEditorClip(audio.id)!;
    useProjectStore.getState().selectVideoEditorClip(clipId);
    render(<VideoEditorWorkspace preview={<div />} inspector={<div />} timeline={<div />} runTool={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "AI Tools" }));
    expect(screen.getByRole("button", { name: /Upscaler/ })).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows only actionable transitions and never substitutes the generic effects catalog", () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(asset.id, { trackId: "video-editor-track-main" })!;
    useProjectStore.getState().selectVideoEditorClip(clipId);
    render(<VideoEditorWorkspace preview={<div />} inspector={<div />} timeline={<div />} />);
    fireEvent.click(screen.getByRole("button", { name: "Transitions" }));
    expect(screen.getByRole("region", { name: "Transizioni Video Editor" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Fade In/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Camera Shake/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Fade In/ }));
    expect(useProjectStore.getState().project.animation.videoEditor.effectClips).toHaveLength(1);
  });

  it("espone nel tab Adjust lo stesso catalogo completo e fluido dell'Inspector", () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(asset.id, { trackId: "video-editor-track-main" })!;
    useProjectStore.getState().selectVideoEditorClip(clipId);
    render(<VideoEditorWorkspace preview={<div />} inspector={<div />} timeline={<div />} />);
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));

    const names = [
      "Esposizione", "Luminosità", "Contrasto", "Luci", "Ombre", "Bianchi", "Neri", "Chiarezza",
      "Saturazione", "Vividezza", "Temperatura", "Tinta", "Tonalità", "Nitidezza", "Riduzione rumore",
      "Sfocatura", "Scala di grigi", "Seppia", "Neri sbiaditi", "Vignettatura"
    ];
    const controls = names.map((name) => screen.getByLabelText(`${name} nel dock Adjust`) as HTMLInputElement);
    expect(controls).toHaveLength(20);
    controls.forEach((control) => expect(control.closest("label")).toHaveClass("video-editor-adjustment-control"));

    const vignette = screen.getByLabelText("Vignettatura nel dock Adjust") as HTMLInputElement;
    fireEvent.pointerDown(vignette);
    fireEvent.change(vignette, { target: { value: "28" } });
    fireEvent.change(vignette, { target: { value: "64" } });
    expect(vignette.value).toBe("64");
    fireEvent.pointerUp(vignette);
    expect(useProjectStore.getState().project.animation.videoEditor.clips.find((clip) => clip.id === clipId)?.adjustments.vignette).toBe(64);
  });

  it("preserves unsaved effect control edits while switching through Transitions", () => {
    render(<VideoEditorWorkspace preview={<div />} inspector={<div />} timeline={<div />} />);
    fireEvent.click(screen.getByRole("button", { name: "Effects" }));
    const duration = screen.getByRole("slider", { name: "Durata Fade In" });
    fireEvent.change(duration, { target: { value: "1.37" } });
    fireEvent.click(screen.getByRole("button", { name: "Transitions" }));
    fireEvent.click(screen.getByRole("button", { name: "Effects" }));
    expect(screen.getByRole("slider", { name: "Durata Fade In" })).toHaveValue("1.37");
  });

  it("starts wider, supports keyboard/drag resizing, persists it and never remounts the preview", async () => {
    let mounts = 0;
    let unmounts = 0;
    function PreviewProbe() {
      useEffect(() => { mounts += 1; return () => { unmounts += 1; }; }, []);
      return <div data-testid="video-editor-preview-probe" />;
    }
    render(<VideoEditorWorkspace preview={<PreviewProbe />} inspector={<div />} timeline={<div />} />);
    const separator = screen.getByRole("separator", { name: "Ridimensiona dock sinistro Video Editor" });
    expect(separator).toHaveAttribute("aria-valuenow", String(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH));
    expect(Number(separator.getAttribute("aria-valuemax"))).toBeGreaterThan(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH);

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", String(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH + 16));
    const pointerDown = createEvent.pointerDown(separator, { clientX: 100, pointerId: 1 });
    Object.defineProperty(pointerDown, "clientX", { configurable: true, value: 100 });
    fireEvent(separator, pointerDown);
    const pointerMove = new Event("pointermove");
    Object.defineProperty(pointerMove, "clientX", { configurable: true, value: 136 });
    window.dispatchEvent(pointerMove);
    window.dispatchEvent(new Event("pointerup"));
    await waitFor(() => expect(Number(separator.getAttribute("aria-valuenow"))).toBe(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH + 52));
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", String(MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH));
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute("aria-valuenow", String(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(VIDEO_EDITOR_WORKSPACE_LAYOUT_KEY) ?? "{}").left).toBe(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH));

    fireEvent.click(screen.getByRole("button", { name: "Dock" }));
    expect(screen.queryByRole("separator", { name: "Ridimensiona dock sinistro Video Editor" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dock" }));
    expect(screen.getByRole("separator", { name: "Ridimensiona dock sinistro Video Editor" })).toHaveAttribute("aria-valuenow", String(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH));
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it("keeps the drawer handle reachable above the inspector on narrow windows", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 700 });
    try {
      const clipId = useProjectStore.getState().addVideoEditorClip(asset.id, { trackId: "video-editor-track-main" })!;
      useProjectStore.getState().selectVideoEditorClip(clipId);
      render(<VideoEditorWorkspace preview={<div data-testid="preview-layer" />} inspector={<div />} timeline={<div />} />);
      const dock = screen.getByLabelText("Libreria Video Editor").parentElement!;
      const main = dock.parentElement!;
      expect(main).toHaveClass("has-left-drawer", "has-inspector-overlay");
      expect(dock).toHaveClass("video-editor-left-dock-shell");
      const separator = screen.getByRole("separator", { name: "Ridimensiona dock sinistro Video Editor" });
      expect(separator).toBeVisible();
      fireEvent.keyDown(separator, { key: "ArrowRight" });
      expect(separator).toHaveAttribute("aria-valuenow", String(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH + 16));
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    }
  });
});
