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

  it("non ritraduce il risultato di una sostituzione", () => {
    expect(localizeUiText("Traccia", "it")).toBe("Traccia");
    expect(localizeUiText("Già elaborato", "en")).toBe("Already processed");
    expect(localizeUiText("Already processed", "it")).toBe("Già elaborato");
    expect(localizeUiText("Aggiungi in timeline · Traccia audio", "en")).toBe("Add to timeline · Audio track");
    expect(localizeUiText("Vai a destra", "it")).toBe("Vai a destra");
  });

  it("conserva i nomi dei file e i percorsi contenenti spazi", () => {
    expect(localizeUiText("Final track.mp4", "it")).toBe("Final track.mp4");
    expect(localizeUiText("Video saved · Final track.mp4 · 21.9 MB", "it")).toBe("Video salvato · Final track.mp4 · 21.9 MB");
    expect(localizeUiText("/Users/Artist/My Music/Final track.wav", "it")).toBe("/Users/Artist/My Music/Final track.wav");
    expect(localizeUiText("OpenAI · NVIDIA · Lonely Bot", "it")).toBe("OpenAI · NVIDIA · Lonely Bot");
  });

  it("traduce gli stati di elaborazione e le etichette della cache", () => {
    expect(localizeUiText("Upscaler / Frame Booster temporary video", "it")).toBe("Video temporanei di Upscaler / Frame Booster");
    expect(localizeUiText("Interpolazione completata", "en")).toBe("Interpolation complete");
    expect(localizeUiText("Boost frames", "it")).toBe("Interpola fotogrammi");
  });

  it("copre le label inglesi dei pannelli legacy senza lasciare testo ibrido", () => {
    expect(localizeUiText("Detection sensitivity", "it")).toBe("Sensibilità rilevamento");
    expect(localizeUiText("Upload an image. The detector keeps every supported COCO category, and each circle can be detected or positioned manually.", "it"))
      .toBe("Carica un’immagine. Il rilevatore mantiene tutte le categorie COCO supportate e ogni cerchio può essere rilevato o posizionato manualmente.");
    expect(localizeUiText("Transitions · Audio mixer · AI Tools", "it")).toBe("Transizioni · Mixer audio · Strumenti AI");
    expect(localizeUiText("Play/Pause (Space)", "it")).toBe("Riproduci/Pausa (Spazio)");
  });
});
