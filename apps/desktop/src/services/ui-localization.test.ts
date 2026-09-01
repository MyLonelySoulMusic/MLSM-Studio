import { describe, expect, it } from "vitest";
import { localizeUiText } from "./ui-localization";

describe("localizeUiText", () => {
  it("traduce in inglese controlli italiani anche dentro testi dinamici", () => {
    expect(localizeUiText("Carica video · Durata 12 s · Annulla", "en")).toBe("Upload video · Duration 12 s · Cancel");
    expect(localizeUiText("Aggiungi endpoint", "en")).toBe("Add endpoint");
  });

  it("traduce in italiano i pannelli storicamente scritti in inglese", () => {
    expect(localizeUiText("Detection sensitivity", "it")).toBe("Sensibilità rilevamento");
    expect(localizeUiText("Remove · Rotation speed · Opacity", "it")).toBe("Rimuovi · Velocità rotazione · Opacità");
    expect(localizeUiText("Independent left/right pulses mirror automatically when the source is mono.", "it"))
      .toBe("Gli impulsi sinistro e destro indipendenti vengono specchiati automaticamente con sorgenti mono.");
  });

  it("non altera nomi tecnici, percorsi o valori numerici", () => {
    expect(localizeUiText("Circular Spectrum · FFmpeg · /tmp/video.mp4 · 60 FPS", "it")).toBe("Circular Spectrum · FFmpeg · /tmp/video.mp4 · 60 FPS");
  });

  it("non lascia frasi ibride nei pannelli aggiunti di recente", () => {
    expect(localizeUiText("Completo · nessun taglio", "en")).toBe("Full · no cropping");
    expect(localizeUiText("Separatore prima/dopo", "en")).toBe("Before/after separator");
    expect(localizeUiText("Nessun effetto attivo.", "en")).toBe("No active effects.");
    expect(localizeUiText(
      "MLSM usa H.264 quando supportato e, per sorgenti oltre 4K, passa automaticamente a H.265/HEVC senza ridurre la risoluzione.",
      "en"
    )).toBe("MLSM uses H.264 when supported and, for sources above 4K, automatically switches to H.265/HEVC without reducing resolution.");
  });
});
