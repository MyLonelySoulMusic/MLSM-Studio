import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../store/project-store";
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
});
