import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../store/project-store";
import { videoEditorSampledSpeedAtFrame, videoEditorSpeedAtFrame, videoEditorSplitSpeed } from "../services/video-editor-speed";
import { VideoEditorInspector } from "./VideoEditorInspector";

const asset = {
  id: "inspector-lock-video", name: "protetta.mp4", kind: "video" as const, url: "blob:inspector-lock-video",
  durationSeconds: 8, width: 1080, height: 1920, hasAudio: true, bpm: null,
  beats: [] as number[], downbeats: [] as number[], waveform: [] as number[]
};

describe("VideoEditorInspector · tracce bloccate", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useProjectStore.getState().addVideoEditorAssets([asset]);
  });
  afterEach(cleanup);

  it("mostra lo stato protetto e disabilita tutti i controlli che mutano la clip o la traccia", () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(asset.id, { trackId: "video-editor-track-main" })!;
    useProjectStore.getState().selectVideoEditorClip(clipId);
    useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { locked: true });
    render(<VideoEditorInspector />);

    expect(screen.getByText("Traccia bloccata · sbloccala per modificare la clip.")).toBeInTheDocument();
    for (const control of [
      screen.getByLabelText("Livello clip"),
      screen.getByLabelText("Durata clip"),
      screen.getByLabelText("Attacco nella sorgente"),
      screen.getByLabelText("Posizione orizzontale clip"),
      screen.getByLabelText("Opacità clip"),
      screen.getByLabelText("Adattamento clip"),
      screen.getByLabelText("Disattiva audio clip"),
      screen.getByLabelText("Volume clip")
    ]) expect(control).toBeDisabled();
    expect(screen.getByRole("button", { name: "＋ Fade In" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clean boost" })).toBeDisabled();

    const lockedRow = screen.getByLabelText("Nome traccia Livello video 1").closest("li")!;
    expect(within(lockedRow).getByLabelText("Nome traccia Livello video 1")).toBeEnabled();
    expect(within(lockedRow).getByLabelText("Volume traccia Livello video 1")).toBeEnabled();
    expect(within(lockedRow).getByRole("button", { name: "Chiudi i vuoti" })).toBeDisabled();
    expect(within(lockedRow).getByRole("button", { name: "Elimina traccia" })).toBeDisabled();
    // Il comando di sblocco deve restare disponibile, altrimenti la protezione
    // diventerebbe irreversibile dall’interfaccia.
    expect(within(lockedRow).getByRole("button", { name: "Bloccata" })).toBeEnabled();
  });

  it("disabilita parametri e cancellazione di un effetto applicato a una clip protetta", () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(asset.id, { trackId: "video-editor-track-main" })!;
    const effectId = useProjectStore.getState().addVideoEditorEffectClip("fade-in", { targetClipId: clipId })!;
    useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { locked: true });
    useProjectStore.getState().selectVideoEditorEffectClip(effectId);
    render(<VideoEditorInspector />);

    expect(screen.getByText("Traccia bloccata · sbloccala per modificare questo effetto.")).toBeInTheDocument();
    expect(screen.getByLabelText("Effetto video attivo")).toBeDisabled();
    expect(screen.getByLabelText("Posizione effetto")).toBeDisabled();
    expect(screen.getByLabelText("Durata effetto")).toBeDisabled();
    expect(screen.getByLabelText("Intensità effetto")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Elimina effetto dalla timeline" })).toBeDisabled();
  });

  it("edita e persiste la Bézier normalizzata del segmento sinistra-destra", () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(asset.id, { trackId: "video-editor-track-main" })!;
    useProjectStore.getState().selectVideoEditorClip(clipId);
    const target = { kind: "clip" as const, clipId, property: "adjustments.exposure" };
    useProjectStore.getState().upsertVideoEditorKeyframe(target, { id: "left", frame: 0, value: 0, curve: "linear" });
    useProjectStore.getState().upsertVideoEditorKeyframe(target, { id: "right", frame: 60, value: 1, curve: "custom", bezier: { x1: .1, y1: .2, x2: .8, y2: .9 } });
    render(<VideoEditorInspector />);

    expect(screen.getByLabelText("Curva adjustments.exposure segmento 0-60")).toHaveValue("custom");
    fireEvent.change(screen.getByLabelText("Bézier adjustments.exposure 0-60 x1"), { target: { value: ".25" } });
    const lane = useProjectStore.getState().project.animation.videoEditor.automationLanes.find((candidate) => candidate.id);
    expect(lane?.keyframes.find((point) => point.id === "right")?.bezier).toEqual({ x1: .25, y1: .2, x2: .8, y2: .9 });
  });

  it("rende lineare un segmento speed suddiviso senza lasciare attiva la vecchia esponenziale", () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(asset.id, { trackId: "video-editor-track-main" })!;
    const exponential = { mode: "ramp" as const, constant: 1, preservePitch: false, points: [
      { id: "left", frame: 0, speed: 1, curve: "linear" as const },
      { id: "right", frame: 60, speed: 3, curve: "exponential" as const }
    ] };
    const [, splitRight] = videoEditorSplitSpeed(exponential, 30.8);
    useProjectStore.getState().updateVideoEditorClip(clipId, { speed: splitRight });
    useProjectStore.getState().selectVideoEditorClip(clipId);
    render(<VideoEditorInspector />);

    const rightFrame = splitRight!.points[1]!.frame;
    const selector = screen.getByLabelText(`Curva velocità segmento 0-${rightFrame}`);
    expect(selector).toHaveValue("exponential");
    expect(splitRight?.points[1]?.segment).toBeDefined();
    expect(splitRight?.leadingRate).toBeDefined();
    fireEvent.change(selector, { target: { value: "linear" } });

    const clip = useProjectStore.getState().project.animation.videoEditor.clips.find((candidate) => candidate.id === clipId)!;
    const point = clip.speed?.points.find((candidate) => candidate.id === "right");
    expect(point).toEqual({ id: "right", frame: rightFrame, speed: 3, curve: "linear" });
    expect(clip.speed?.sampleOriginFrame).toBeCloseTo(30.8, 12);
    expect(clip.speed).not.toHaveProperty("leadingRate");
    const first = clip.speed!.points.find((candidate) => candidate.frame === 0)!;
    expect(videoEditorSpeedAtFrame(clip.speed, rightFrame / 2)).toBeCloseTo((first.speed + point!.speed) / 2, 12);
    expect(videoEditorSpeedAtFrame(clip.speed, rightFrame / 2)).not.toBeCloseTo(videoEditorSpeedAtFrame(splitRight, rightFrame / 2), 6);
    expect(videoEditorSampledSpeedAtFrame(clip.speed, 0)).toBeCloseTo(first.speed, 12);
  });

  it("mostra i controlli immagine senza velocità o attacco sorgente", () => {
    useProjectStore.getState().newProject();
    const image = { ...asset, id: "inspector-still", name: "overlay.webp", kind: "image" as const, durationSeconds: 0, hasAudio: false };
    useProjectStore.getState().addVideoEditorAssets([image]);
    const clipId = useProjectStore.getState().addVideoEditorClip(image.id, { trackId: "video-editor-track-main" })!;
    useProjectStore.getState().selectVideoEditorClip(clipId);
    render(<VideoEditorInspector />);

    expect(screen.getByLabelText("Durata clip")).toHaveValue("4");
    expect(screen.getByText(/Fermo immagine/)).toBeInTheDocument();
    expect(screen.getByLabelText("Adattamento clip")).toHaveValue("contain");
    expect(screen.getByLabelText("Posizione orizzontale clip")).toBeInTheDocument();
    expect(screen.getByLabelText("Scala clip")).toBeInTheDocument();
    expect(screen.getByLabelText("Rotazione clip")).toBeInTheDocument();
    expect(screen.queryByLabelText("Velocità clip")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Preserva altezza audio")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Attacco nella sorgente")).not.toBeInTheDocument();
  });

  it("offre le regolazioni avanzate con barre uniformi e trascinamento fluido", () => {
    const clipId = useProjectStore.getState().addVideoEditorClip(asset.id, { trackId: "video-editor-track-main" })!;
    useProjectStore.getState().selectVideoEditorClip(clipId);
    render(<VideoEditorInspector />);

    const names = [
      "Esposizione", "Luminosità", "Contrasto", "Luci", "Ombre", "Bianchi", "Neri", "Chiarezza",
      "Saturazione", "Vividezza", "Temperatura", "Tinta", "Tonalità", "Nitidezza", "Riduzione rumore",
      "Sfocatura", "Scala di grigi", "Seppia", "Neri sbiaditi", "Vignettatura"
    ];
    const controls = names.map((name) => screen.getByLabelText(`${name} clip`) as HTMLInputElement);
    expect(controls).toHaveLength(20);
    controls.forEach((control) => expect(control.closest("label")).toHaveClass("video-editor-adjustment-control"));

    const brightness = screen.getByLabelText("Luminosità clip") as HTMLInputElement;
    fireEvent.pointerDown(brightness);
    fireEvent.change(brightness, { target: { value: "18" } });
    fireEvent.change(brightness, { target: { value: "37" } });
    expect(brightness.value).toBe("37");
    expect(brightness.closest("label")?.querySelector("output")).toHaveTextContent("+37");
    fireEvent.pointerUp(brightness);

    const clip = useProjectStore.getState().project.animation.videoEditor.clips.find((candidate) => candidate.id === clipId)!;
    expect(clip.adjustments.brightness).toBe(37);
  });
});
