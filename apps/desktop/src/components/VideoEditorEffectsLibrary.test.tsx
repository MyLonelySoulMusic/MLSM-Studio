import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { videoEditorEffectCatalog, videoEditorEffectDragType } from "../services/video-editor-effects";
import { useProjectStore } from "../store/project-store";
import { VideoEditorEffectsLibrary } from "./VideoEditorEffectsLibrary";

const media = {
  id: "media", name: "verticale.mp4", kind: "video" as const, url: "blob:media", durationSeconds: 8,
  width: 1080, height: 1920, hasAudio: true, bpm: null, beats: [] as number[], downbeats: [] as number[], waveform: [] as number[]
};

describe("VideoEditorEffectsLibrary", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("organizza almeno dieci effetti per categoria e disabilita l’aggiunta senza clip", () => {
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");
    render(<VideoEditorEffectsLibrary />);
    expect(screen.getByLabelText("Libreria effetti Video Editor")).toBeInTheDocument();
    expect(screen.getByText(`${videoEditorEffectCatalog.length} effetti reali · anteprima parametrica; timeline ed export condividono il resolver deterministico.`)).toBeInTheDocument();
    expect(videoEditorEffectCatalog.length).toBeGreaterThanOrEqual(10);
    for (const category of ["Transizioni", "Movimento", "Colore", "Distorsione", "Luce"]) {
      expect(screen.getByRole("region", { name: category })).toBeInTheDocument();
    }
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Seleziona una clip visiva su qualsiasi livello/i })).toBeDisabled();
  });

  it("riproduce anteprime specifiche e mostra durata, intensità e parametri", () => {
    const { container } = render(<VideoEditorEffectsLibrary />);
    const firstPreview = container.querySelector(".effect-preview-media");
    expect(firstPreview).toHaveClass("effect-preview-fade-in");

    fireEvent.click(screen.getByRole("button", { name: "Riproduci anteprima Fade In" }));
    expect(container.querySelector(".effect-preview-media")).not.toBe(firstPreview);

    fireEvent.click(screen.getByRole("button", { name: /^RGB Split .*0\.65 s$/i }));
    expect(container.querySelector(".effect-preview-media")).toHaveClass("effect-preview-rgb-split");
    expect(screen.getByRole("slider", { name: "Durata RGB Split" })).toHaveValue("0.65");
    expect(screen.getByRole("slider", { name: "Intensità RGB Split" })).toHaveValue("1");
    expect(screen.getByRole("slider", { name: "Separazione RGB Split" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Frequenza RGB Split" })).toBeInTheDocument();
  });

  it("collega ampiezza, frequenza e mix alle variabili CSS dell’anteprima", () => {
    const { container } = render(<VideoEditorEffectsLibrary />);
    fireEvent.click(screen.getByRole("button", { name: /^Camera Shake .*0\.60 s$/i }));
    const preview = () => container.querySelector<HTMLElement>(".effect-preview-media")!;
    expect(preview().style.getPropertyValue("--effect-preview-amount")).toBe("1.8%");
    expect(preview().style.getPropertyValue("--effect-preview-frequency")).toBe("8");
    expect(preview().style.getPropertyValue("--effect-preview-mix")).toBe("1");

    fireEvent.change(screen.getByRole("slider", { name: "Ampiezza Camera Shake" }), { target: { value: ".06" } });
    expect(preview().style.getPropertyValue("--effect-preview-amount")).toBe("6%");
    fireEvent.change(screen.getByRole("slider", { name: "Frequenza Camera Shake" }), { target: { value: "14" } });
    expect(preview().style.getPropertyValue("--effect-preview-frequency")).toBe("14");
    fireEvent.change(screen.getByRole("slider", { name: "Intensità Camera Shake" }), { target: { value: ".5" } });
    expect(preview().style.getPropertyValue("--effect-preview-mix")).toBe("0.5");
    expect(preview().style.getPropertyValue("--effect-preview-amount")).toBe("3%");
  });

  it("aggiorna realmente frequenza RGB, blur Bloom e dinamica Film Flicker", () => {
    const { container } = render(<VideoEditorEffectsLibrary />);
    const preview = () => container.querySelector<HTMLElement>(".effect-preview-media")!;

    fireEvent.click(screen.getByRole("button", { name: /^RGB Split .*0\.65 s$/i }));
    fireEvent.change(screen.getByRole("slider", { name: "Frequenza RGB Split" }), { target: { value: "15" } });
    expect(preview()).toHaveClass("effect-preview-rgb-split");
    expect(preview().style.getPropertyValue("--effect-preview-frequency")).toBe("15");

    fireEvent.click(screen.getByRole("button", { name: /^Dream Bloom .*1\.40 s$/i }));
    fireEvent.change(screen.getByRole("slider", { name: "Diffusione Dream Bloom" }), { target: { value: "8" } });
    expect(preview()).toHaveClass("effect-preview-bloom");
    expect(preview().style.getPropertyValue("--effect-preview-blur")).toBe("8px");
    fireEvent.change(screen.getByRole("slider", { name: "Intensità Dream Bloom" }), { target: { value: ".5" } });
    expect(preview().style.getPropertyValue("--effect-preview-blur")).toBe("4px");

    fireEvent.click(screen.getByRole("button", { name: /^Film Flicker .*1\.20 s$/i }));
    fireEvent.change(screen.getByRole("slider", { name: "Sfarfallio Film Flicker" }), { target: { value: ".3" } });
    expect(preview()).toHaveClass("effect-preview-flicker");
    expect(preview().style.getPropertyValue("--effect-preview-flicker-high")).toBe("1.3");
    fireEvent.change(screen.getByRole("slider", { name: "Intensità Film Flicker" }), { target: { value: ".5" } });
    expect(preview().style.getPropertyValue("--effect-preview-flicker-high")).toBe("1.15");
    expect(preview().style.getPropertyValue("--effect-preview-flicker-contrast")).toBe("1.075");
  });

  it("aggiunge parametri e durata alla clip selezionata su qualsiasi livello e supporta il drag", () => {
    useProjectStore.getState().addVideoEditorAssets([media]);
    const clipId = useProjectStore.getState().addVideoEditorClip(media.id)!;
    render(<VideoEditorEffectsLibrary />);

    fireEvent.click(screen.getByRole("button", { name: /^RGB Split .*0\.65 s$/i }));
    fireEvent.change(screen.getByRole("slider", { name: "Durata RGB Split" }), { target: { value: "1.4" } });
    fireEvent.change(screen.getByRole("slider", { name: "Separazione RGB Split" }), { target: { value: "0.031" } });
    fireEvent.click(screen.getByRole("button", { name: /Aggiungi RGB Split/i }));

    expect(useProjectStore.getState().project.animation.videoEditor.effectClips[0]).toMatchObject({
      effectId: "rgb-split", target: { kind: "clip", clipId }, durationSeconds: 1.4, mix: 1,
      parameters: { amount: .031, frequency: 6 }
    });
    // Dopo l’aggiunta viene selezionato il blocco effetto: la libreria conserva
    // comunque il livello target e permette di concatenare altri effetti.
    expect(screen.getByRole("button", { name: /Aggiungi RGB Split a “verticale\.mp4”/i })).toBeEnabled();

    const fadeOut = screen.getByRole("button", { name: /^Fade Out .*0\.65 s$/i });
    const payload = new Map<string, string>();
    fireEvent.dragStart(fadeOut, { dataTransfer: { effectAllowed: "none", setData: (type: string, value: string) => payload.set(type, value) } });
    expect(payload.get(videoEditorEffectDragType)).toBe("fade-out");
  });
});
