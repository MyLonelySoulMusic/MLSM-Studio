import { type ChangeEvent } from "react";
import { extractPaletteFromImage } from "../services/image-palette";
import { PIXELS_SUB_FONT_FAMILIES } from "../services/pixels-sub-renderer";
import { parseProSubtitleFile } from "../services/pro-subtitles";
import { useProjectStore } from "../store/project-store";

function imageDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function PixelsSubPanel({ duration, onSelectSubtitle }: { duration: number; onSelectSubtitle: (id: string | null) => void }) {
  const settings = useProjectStore((state) => state.project.animation.pixelsSub);
  const update = useProjectStore((state) => state.updatePixelsSub);
  const setPalette = useProjectStore((state) => state.setPixelsSubPalette);
  const setCues = useProjectStore((state) => state.setSubtitleCues);
  const setStatus = useProjectStore((state) => state.setStatus);

  const loadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const imageUrl = await imageDataUrl(file); if (!imageUrl) return;
    update({ imageUrl });
    if (settings.autoPalette) {
      const colors = await extractPaletteFromImage(imageUrl).catch(() => []);
      if (colors.length) setPalette(colors.slice(0, 3));
    }
  };
  const importSrt = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || duration <= 0) return;
    try { const cues = parseProSubtitleFile(await file.text(), duration); setCues(cues); onSelectSubtitle(cues[0]?.id ?? null); setStatus(`${cues.length} regioni Pixels Subtitles importate da ${file.name}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };
  const toggleAutoPalette = async (enabled: boolean) => {
    update({ autoPalette: enabled }); if (!enabled || !settings.imageUrl) return;
    const colors = await extractPaletteFromImage(settings.imageUrl).catch(() => []); if (colors.length) setPalette(colors.slice(0, 3));
  };

  return <section className="pixels-sub-settings">
    <h2>Cover e cornice audio-reattiva</h2>
    <label className="flyer-upload">Carica immagine principale<input aria-label="Carica immagine PixelsSub" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void loadImage(event)} /></label>
    {settings.imageUrl ? <div className="pixels-sub-thumbnail" style={{ backgroundImage: `url(${settings.imageUrl})` }} /> : <p className="muted">La cover rimane sempre pulita, intera e protetta al centro. L’animazione dei pixel vive esclusivamente nella cornice esterna.</p>}
    <label className="teddy-dance-toggle"><span>Palette automatica dall’immagine</span><input aria-label="Palette automatica PixelsSub" type="checkbox" checked={settings.autoPalette} onChange={(event) => void toggleAutoPalette(event.target.checked)} /></label>
    <div className="pixels-sub-palette" role="group" aria-label="Palette PixelsSub a tre colori">{settings.palette.map((color, index) => <label key={index}>Colore {index + 1}<input aria-label={`Colore ${index + 1} PixelsSub`} type="color" value={color} onChange={(event) => { const palette = [...settings.palette] as [string, string, string]; palette[index] = event.target.value; update({ palette, autoPalette: false }); }} /></label>)}</div>
    <label>Margine della cover: {Math.round(settings.imageInset * 100)}%<input aria-label="Margine cover PixelsSub" type="range" min=".025" max=".16" step=".005" value={settings.imageInset} onChange={(event) => update({ imageInset: Number(event.target.value) })} /></label>
    <label>Dimensione pixel: {settings.pixelSize}px<input aria-label="Dimensione pixel PixelsSub" type="range" min="4" max="32" step="1" value={settings.pixelSize} onChange={(event) => update({ pixelSize: Number(event.target.value) })} /></label>
    <label>Velocità flusso: {settings.flowSpeed.toFixed(2)}×<input aria-label="Velocità flusso PixelsSub" type="range" min=".05" max="3" step=".05" value={settings.flowSpeed} onChange={(event) => update({ flowSpeed: Number(event.target.value) })} /></label>
    <label>Reattività audio: {settings.audioReactivity.toFixed(2)}×<input aria-label="Reattività audio PixelsSub" type="range" min="0" max="2" step=".05" value={settings.audioReactivity} onChange={(event) => update({ audioReactivity: Number(event.target.value) })} /></label>
    <label>Persistenza delle scie: {Math.round(settings.trailStrength * 100)}%<input aria-label="Scie PixelsSub" type="range" min="0" max="1" step=".01" value={settings.trailStrength} onChange={(event) => update({ trailStrength: Number(event.target.value) })} /></label>
    <p className="pixels-sub-workflow-note">Il campo raggiunge sempre il bordo della cover. Le frequenze modificano densità e distribuzione fra tutti e tre i colori, mai l’altezza o l’estensione della cornice. Dopo l’analisi audio, kick e snare fanno scambiare coppie selezionate di pixel usando gli stessi eventi ritmici della fisica della sfera.</p>
    <h2>Tipografia pixel</h2>
    <p className="muted">Il testo viene rasterizzato su una griglia pixel nitida sopra la cover. Il colore usa esattamente uno dei tre valori della palette, senza schiarimenti automatici.</p>
    <label>Font pixel<select aria-label="Font sottotitoli PixelsSub" value={settings.subtitleFontFamily} onChange={(event) => update({ subtitleFontFamily: event.target.value as typeof settings.subtitleFontFamily })}>{PIXELS_SUB_FONT_FAMILIES.map((font) => <option key={font} value={font}>{font}</option>)}</select></label>
    <label>Colore del testo<select aria-label="Colore testo PixelsSub" value={settings.subtitleColorIndex} onChange={(event) => update({ subtitleColorIndex: Number(event.target.value) })}>{settings.palette.map((color, index) => <option key={index} value={index}>Colore {index + 1} · {color.toUpperCase()}</option>)}</select></label>
    <label>Posizione verticale: {Math.round(settings.subtitlePositionY)}%<input aria-label="Posizione sottotitoli PixelsSub" type="range" min="15" max="88" step="1" value={settings.subtitlePositionY} onChange={(event) => update({ subtitlePositionY: Number(event.target.value) })} /></label>
    <label className="teddy-dance-toggle"><span>Ombra pixel per il contrasto</span><input aria-label="Ombra sottotitoli PixelsSub" type="checkbox" checked={settings.subtitleShadowEnabled} onChange={(event) => update({ subtitleShadowEnabled: event.target.checked })} /></label>
    {settings.subtitleShadowEnabled ? <>
      <label>Colore ombra<input aria-label="Colore ombra PixelsSub" type="color" value={settings.subtitleShadowColor} onChange={(event) => update({ subtitleShadowColor: event.target.value })} /></label>
      <label>Distanza ombra: {settings.subtitleShadowOffset}px<input aria-label="Distanza ombra PixelsSub" type="range" min="1" max="10" step="1" value={settings.subtitleShadowOffset} onChange={(event) => update({ subtitleShadowOffset: Number(event.target.value) })} /></label>
    </> : null}
    <label className={`flyer-upload${duration > 0 ? "" : " disabled-upload"}`}>Importa SRT o WebVTT<input aria-label="Importa sottotitoli PixelsSub" type="file" accept=".srt,.vtt,application/x-subrip,text/vtt,text/plain" disabled={duration <= 0} onChange={(event) => void importSrt(event)} /></label>
  </section>;
}
