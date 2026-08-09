import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../store/project-store";
import { videoEditorEffectDragType } from "../services/video-editor-effects";
import { VideoEditorInspector } from "./VideoEditorInspector";
import { VideoEditorTimeline } from "./VideoEditorTimeline";

const videoAsset = {
  id: "effect-test-video", name: "verticale.mp4", kind: "video" as const, url: "blob:effect-test-video",
  durationSeconds: 12, width: 1080, height: 1920, hasAudio: true, bpm: null,
  beats: [] as number[], downbeats: [] as number[], waveform: [] as number[]
};

function createSelectedClip(): string {
  useProjectStore.getState().addVideoEditorAssets([videoAsset]);
  return useProjectStore.getState().addVideoEditorClip(videoAsset.id, { trackId: "video-editor-track-main" })!;
}

describe("Video Editor · effetti montabili", () => {
  beforeEach(() => useProjectStore.getState().newProject());
  afterEach(cleanup);

  it("mostra Fade In e Fade Out nella corsia Effetti e cancella la selezione con Delete", () => {
    const clipId = createSelectedClip();
    const fadeInId = useProjectStore.getState().addVideoEditorEffectClip("fade-in", { targetClipId: clipId })!;
    useProjectStore.getState().addVideoEditorEffectClip("fade-out", { targetClipId: clipId });
    useProjectStore.getState().selectVideoEditorEffectClip(fadeInId);

    render(<VideoEditorTimeline />);

    expect(screen.getByTitle("Effetti video montabili")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Effetto Fade In" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Effetto Fade Out" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("Timeline Video Editor"), { key: "Delete" });
    expect(useProjectStore.getState().project.animation.videoEditor.effectClips.map((effect) => effect.id)).not.toContain(fadeInId);
    expect(screen.queryByRole("button", { name: "Effetto Fade In" })).not.toBeInTheDocument();
  });

  it("crea gli effetti dall'Inspector e ne espone i controlli come elemento autonomo", () => {
    const clipId = createSelectedClip();
    render(<VideoEditorInspector />);

    fireEvent.click(screen.getByRole("button", { name: "＋ Fade In" }));

    const settings = useProjectStore.getState().project.animation.videoEditor;
    expect(settings.effectClips).toHaveLength(1);
    expect(settings.effectClips[0]).toMatchObject({ effectId: "fade-in", target: { kind: "clip", clipId } });
    expect(settings.selectedClipIds).toEqual([]);
    expect(screen.getByText("Effetto selezionato")).toBeInTheDocument();
    expect(screen.getByLabelText("Durata effetto")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Intensità effetto"), { target: { value: ".42" } });
    expect(useProjectStore.getState().project.animation.videoEditor.effectClips[0]?.mix).toBe(.42);
  });

  it("modifica i parametri specifici di Camera Shake e Dream Bloom dopo l’inserimento", () => {
    const clipId = createSelectedClip();
    render(<VideoEditorInspector />);

    fireEvent.click(screen.getByRole("button", { name: "＋ Camera Shake" }));
    expect(screen.getByLabelText("Ampiezza effetto")).toHaveValue("0.018");
    expect(screen.getByLabelText("Frequenza effetto")).toHaveValue("8");
    fireEvent.change(screen.getByLabelText("Ampiezza effetto"), { target: { value: ".041" } });
    fireEvent.change(screen.getByLabelText("Frequenza effetto"), { target: { value: "13" } });
    expect(useProjectStore.getState().project.animation.videoEditor.effectClips[0]?.parameters).toMatchObject({ amount: .041, frequency: 13 });

    act(() => useProjectStore.getState().selectVideoEditorClip(clipId));
    fireEvent.click(screen.getByRole("button", { name: "＋ Dream Bloom" }));
    expect(screen.getByLabelText("Bagliore effetto")).toHaveValue("0.65");
    expect(screen.getByLabelText("Diffusione effetto")).toHaveValue("3");
    fireEvent.change(screen.getByLabelText("Diffusione effetto"), { target: { value: "7.5" } });
    const bloom = useProjectStore.getState().project.animation.videoEditor.effectClips.find((effect) => effect.effectId === "dream-bloom");
    expect(bloom?.parameters).toMatchObject({ amount: .65, blur: 7.5 });
  });

  it("accetta il drop dalla libreria direttamente nella corsia Effetti", () => {
    const clipId = createSelectedClip();
    const { container } = render(<VideoEditorTimeline />);
    const lane = container.querySelector<HTMLElement>(".video-editor-effect-lane");
    expect(lane).not.toBeNull();

    fireEvent.drop(lane!, {
      clientX: 0,
      dataTransfer: {
        types: [videoEditorEffectDragType],
        dropEffect: "copy",
        getData: (type: string) => type === videoEditorEffectDragType ? "fade-out" : ""
      }
    });

    expect(useProjectStore.getState().project.animation.videoEditor.effectClips).toEqual([
      expect.objectContaining({ effectId: "fade-out", target: { kind: "clip", clipId } })
    ]);
  });

  it("applica il drop alla clip B sotto il cursore anche quando la clip A era selezionata", () => {
    const clipA = createSelectedClip();
    const clipB = useProjectStore.getState().addVideoEditorClip(videoAsset.id, { trackId: "video-editor-track-overlay", startSeconds: 0 })!;
    useProjectStore.getState().selectVideoEditorClip(clipA);
    const { container } = render(<VideoEditorTimeline />);
    const target = container.querySelector<HTMLElement>(`[data-video-editor-clip-id="${clipB}"]`);
    expect(target).not.toBeNull();

    fireEvent.drop(target!, {
      clientX: 0,
      dataTransfer: {
        types: [videoEditorEffectDragType],
        dropEffect: "copy",
        getData: (type: string) => type === videoEditorEffectDragType ? "rgb-split" : ""
      }
    });

    expect(useProjectStore.getState().project.animation.videoEditor.effectClips).toEqual([
      expect.objectContaining({ effectId: "rgb-split", target: { kind: "clip", clipId: clipB } })
    ]);
  });

  it("al taglio esatto tratta la fine di A come esclusiva e applica l’effetto a B", () => {
    useProjectStore.getState().addVideoEditorAssets([videoAsset]);
    const clipA = useProjectStore.getState().addVideoEditorClip(videoAsset.id, { trackId: "video-editor-track-overlay", startSeconds: 0 })!;
    const clipB = useProjectStore.getState().addVideoEditorClip(videoAsset.id, { trackId: "video-editor-track-main", startSeconds: 12 })!;
    useProjectStore.getState().selectVideoEditorClip(clipA);
    const { container } = render(<VideoEditorTimeline />);
    const lanes = container.querySelector<HTMLElement>(".video-editor-lanes")!;
    vi.spyOn(lanes, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 2800, bottom: 220, width: 2800, height: 220,
      toJSON: () => ({})
    });
    const lane = container.querySelector<HTMLElement>(".video-editor-effect-lane")!;
    const drop = new MouseEvent("drop", { bubbles: true, clientX: 1200 });
    Object.defineProperty(drop, "dataTransfer", { value: {
      types: [videoEditorEffectDragType], dropEffect: "copy",
      getData: (type: string) => type === videoEditorEffectDragType ? "light-leak" : ""
    } });
    fireEvent(lane, drop);

    expect(useProjectStore.getState().project.animation.videoEditor.effectClips).toEqual([
      expect.objectContaining({ effectId: "light-leak", target: { kind: "clip", clipId: clipB }, startSeconds: 12 })
    ]);
  });

  it("impila effetti coincidenti in sottocorsie e mantiene drag e trim indipendenti", () => {
    const clipId = createSelectedClip();
    const firstId = useProjectStore.getState().addVideoEditorEffectClip("fade-in", { targetClipId: clipId })!;
    const secondId = useProjectStore.getState().addVideoEditorEffectClip("fade-in", { targetClipId: clipId })!;
    const { container } = render(<VideoEditorTimeline />);
    const lanes = container.querySelector<HTMLElement>(".video-editor-lanes")!;
    vi.spyOn(lanes, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1600, bottom: 220, width: 1600, height: 220,
      toJSON: () => ({})
    });

    const first = container.querySelector<HTMLElement>(`[data-video-editor-effect-id="${firstId}"]`)!;
    const second = container.querySelector<HTMLElement>(`[data-video-editor-effect-id="${secondId}"]`)!;
    expect(first.dataset.effectSublane).toBe("0");
    expect(second.dataset.effectSublane).toBe("1");
    expect(first.style.top).not.toBe(second.style.top);

    const pointer = (target: Element | Window, type: string, clientX: number, pointerId: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX });
      Object.defineProperty(event, "pointerId", { value: pointerId });
      fireEvent(target, event);
    };
    pointer(first.querySelector(".effect-clip-body")!, "pointerdown", 0, 31);
    pointer(window, "pointermove", 200, 31);
    pointer(window, "pointerup", 200, 31);
    expect(useProjectStore.getState().project.animation.videoEditor.effectClips.find((effect) => effect.id === firstId)?.startSeconds).toBe(2);
    expect(useProjectStore.getState().project.animation.videoEditor.effectClips.find((effect) => effect.id === secondId)?.startSeconds).toBe(0);

    const secondAfterDrag = container.querySelector<HTMLElement>(`[data-video-editor-effect-id="${secondId}"]`)!;
    pointer(secondAfterDrag.querySelector(".clip-trim-end")!, "pointerdown", 65, 32);
    pointer(window, "pointermove", 150, 32);
    pointer(window, "pointerup", 150, 32);
    expect(useProjectStore.getState().project.animation.videoEditor.effectClips.find((effect) => effect.id === secondId)?.durationSeconds).toBe(1.5);
  });

  it("usa icone coerenti per le famiglie non-fade e un placeholder generico", () => {
    const clipId = createSelectedClip();
    render(<VideoEditorTimeline />);
    expect(screen.getByText("Trascina qui un effetto dalla libreria")).toBeInTheDocument();

    act(() => {
      useProjectStore.getState().addVideoEditorEffectClip("camera-shake", { targetClipId: clipId });
      useProjectStore.getState().addVideoEditorEffectClip("rgb-split", { targetClipId: clipId, startSeconds: 1 });
    });
    const shake = screen.getByRole("button", { name: "Effetto Camera Shake" });
    const rgb = screen.getByRole("button", { name: "Effetto RGB Split" });
    expect(shake.querySelector("i")).toHaveTextContent("≈");
    expect(rgb.querySelector("i")).toHaveTextContent("RGB");
    expect(shake.querySelector("i")).not.toHaveTextContent("◣");
    expect(screen.queryByText("Trascina qui un effetto dalla libreria")).not.toBeInTheDocument();
  });
});
