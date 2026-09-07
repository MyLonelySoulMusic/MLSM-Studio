import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlaySpectralPanel } from "./OverlaySpectralPanel";
import { overlaySpectralBackgroundMediaType } from "../services/overlay-spectral-catalog";
import { useProjectStore } from "../store/project-store";
import { clearOverlaySpectralBackground } from "../services/overlay-spectral-background-runtime";

const palette = vi.hoisted(() => ({ image: vi.fn(), video: vi.fn() }));
vi.mock("../services/image-palette", () => ({ extractPaletteFromImage: palette.image, extractPaletteFromVideo: palette.video }));

describe("OverlaySpectralPanel", () => {
  beforeEach(() => { clearOverlaySpectralBackground(); palette.image.mockReset().mockResolvedValue(["#111111", "#222222", "#333333"]); palette.video.mockReset().mockResolvedValue(["#111111", "#222222", "#333333"]); useProjectStore.getState().newProject(); });
  afterEach(() => { cleanup(); clearOverlaySpectralBackground(); });

  it("espone il catalogo completo senza dipendenze native", () => {
    render(<OverlaySpectralPanel onImportAudio={vi.fn()} />);
    const picker = screen.getByLabelText("Effetto");
    expect(within(picker).getAllByRole("option")).toHaveLength(14);
    fireEvent.change(picker, { target: { value: "milkdrop-orbiting-particles" } });
    expect(useProjectStore.getState().project.animation.overlaySpectral.presetId).toBe("milkdrop-orbiting-particles");
    expect(screen.getByText(/nessun host C\+\+/i)).toBeInTheDocument();
  });

  it("accetta immagini e video e mantiene indipendente l'influenza palette", () => {
    render(<OverlaySpectralPanel onImportAudio={vi.fn()} />);
    const input = screen.getByLabelText("Carica sfondo Overlay Spectral") as HTMLInputElement;
    expect(input.accept).toContain("video/mp4");
    expect(input.accept).toContain("image/png");
    fireEvent.change(screen.getByLabelText(/Influenza palette MLSM/), { target: { value: ".35" } });
    expect(useProjectStore.getState().project.animation.overlaySpectral.paletteInfluence).toBe(.35);
    expect(overlaySpectralBackgroundMediaType({ name: "sfondo.MOV", type: "" })).toBe("video");
    expect(overlaySpectralBackgroundMediaType({ name: "cover.webp", type: "image/webp" })).toBe("image");
  });

  it("carica i video tramite URL Blob riproducibili e li revoca alla rimozione", async () => {
    const create = vi.fn(() => "blob:overlay-preview"); const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    useProjectStore.getState().updateOverlaySpectral({ backgroundDim: .6 });
    render(<OverlaySpectralPanel onImportAudio={vi.fn()} />);
    const file = new File(["video"], "background.mp4", { type: "video/mp4" });
    const picker = screen.getByLabelText("Carica sfondo Overlay Spectral") as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [file] } });
    await waitFor(() => expect(useProjectStore.getState().project.animation.overlaySpectral).toMatchObject({ backgroundImageUrl: "blob:overlay-preview", backgroundMediaType: "video", backgroundDim: 0 }));
    expect(create).toHaveBeenCalledWith(file);
    expect(picker.files?.[0]).toBe(file);
    expect(palette.video).toHaveBeenCalledWith("blob:overlay-preview");
    expect(screen.getByLabelText("Video di sfondo Overlay Spectral")).toHaveAttribute("src", "blob:overlay-preview");
    fireEvent.click(screen.getByRole("button", { name: "Rimuovi sfondo" }));
    expect(revoke).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().project.animation.overlaySpectral.backgroundImageUrl).toBeNull();
  });
});
