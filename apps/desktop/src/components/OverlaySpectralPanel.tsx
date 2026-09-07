import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { extractPaletteFromImage, extractPaletteFromVideo } from "../services/image-palette";
import { clearOverlaySpectralBackground, registerOverlaySpectralBackground, releaseOverlaySpectralBackground } from "../services/overlay-spectral-background-runtime";
import { overlaySpectralBackgroundMediaType, overlaySpectralCatalog, overlaySpectralPreset, type OverlaySpectralPresetId } from "../services/overlay-spectral-catalog";
import { useProjectStore } from "../store/project-store";

function dataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("File di sfondo non leggibile.")); reader.onerror = () => reject(reader.error ?? new Error("File di sfondo non leggibile.")); reader.readAsDataURL(file); }); }
export function OverlaySpectralPanel({ onImportAudio }: { onImportAudio: () => void }) {
  const projectId = useProjectStore((state) => state.project.project.id); const settings = useProjectStore((state) => state.project.animation.overlaySpectral); const update = useProjectStore((state) => state.updateOverlaySpectral); const applyPalette = useProjectStore((state) => state.applyOverlaySpectralExtractedPalette); const [error, setError] = useState(""); const operation = useRef(0);
  useEffect(() => { operation.current += 1; setError(""); return () => { operation.current += 1; }; }, [projectId]);
  const isCurrent = (token: number) => token === operation.current && useProjectStore.getState().project.project.id === projectId;
  const extractMediaPalette = (url: string, type: "image" | "video") => type === "video" ? extractPaletteFromVideo(url) : extractPaletteFromImage(url);
  const loadBackground = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    const token = ++operation.current; const backgroundMediaType = overlaySpectralBackgroundMediaType(file); setError("");
    try {
      const runtimeOwner = backgroundMediaType === "video" ? registerOverlaySpectralBackground(projectId, file) : null;
      const url = runtimeOwner?.url ?? await dataUrl(file);
      if (!isCurrent(token)) { if (runtimeOwner) releaseOverlaySpectralBackground(runtimeOwner); return; }
      if (!runtimeOwner) clearOverlaySpectralBackground();
      update({ backgroundImageUrl: url, backgroundMediaType, backgroundDim: 0 });
      try {
        const colors = await extractMediaPalette(url, backgroundMediaType);
        if (isCurrent(token)) applyPalette(colors);
      } catch {
        if (isCurrent(token)) setError(`${backgroundMediaType === "video" ? "Video" : "Immagine"} caricato; palette non rilevata.`);
      }
    } catch (reason) { if (isCurrent(token)) setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const setAutomaticPalette = async (enabled: boolean) => { update({ autoPalette: enabled }); if (!enabled || !settings.backgroundImageUrl) return; const token = ++operation.current; const colors = await extractMediaPalette(settings.backgroundImageUrl, settings.backgroundMediaType).catch(() => []); if (isCurrent(token) && colors.length) applyPalette(colors); };
  const selectedPreset = overlaySpectralPreset(settings.presetId);
  return <section className="overlay-spectral-panel">
    <h2>Overlay Spectral</h2><p className="muted">Adattamento nativo del concetto Winamp/MilkDrop: usa le 48 bande FFT reali di MLSM, resta sincronizzato durante seek ed export e non richiede projectM o componenti Windows.</p>
    <button type="button" onClick={onImportAudio}>Carica brano</button>
    <label className="flyer-upload">Carica immagine o video di sfondo<input aria-label="Carica sfondo Overlay Spectral" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime" onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => void loadBackground(event)} /></label>
    {settings.backgroundImageUrl ? <>{settings.backgroundMediaType === "video" ? <video className="overlay-spectral-thumbnail" src={settings.backgroundImageUrl} muted preload="metadata" playsInline controls={false} aria-label="Video di sfondo Overlay Spectral" /> : <div className="overlay-spectral-thumbnail" style={{ backgroundImage: `url(${settings.backgroundImageUrl})` }} />}<button type="button" onClick={() => { operation.current += 1; clearOverlaySpectralBackground(); update({ backgroundImageUrl: null, backgroundMediaType: "image" }); }}>Rimuovi sfondo</button></> : null}{error ? <p role="alert">{error}</p> : null}
    <label>Adattamento immagine<select value={settings.backgroundFit} onChange={(event) => update({ backgroundFit: event.target.value as typeof settings.backgroundFit })}><option value="cover">Riempi</option><option value="contain">Mostra intera</option></select></label>
    <label>Oscuramento opzionale: {Math.round(settings.backgroundDim * 100)}%<input aria-label="Oscuramento opzionale sfondo Overlay Spectral" type="range" min="0" max="1" step=".01" value={settings.backgroundDim} onChange={(event) => update({ backgroundDim: Number(event.target.value) })} /></label>
    <h2>Catalogo MilkDrop adattato</h2><label>Effetto<select value={settings.presetId} onChange={(event) => update({ presetId: event.target.value as OverlaySpectralPresetId })}>{(["spectrum", "waveform", "geometry", "particles", "atmosphere"] as const).map((category) => <optgroup key={category} label={category}>{overlaySpectralCatalog.filter((preset) => preset.category === category).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup>)}</select></label><div className="overlay-spectral-preset-card"><strong>{selectedPreset.name}</strong><span>{selectedPreset.description}</span><small>Renderer TypeScript/Canvas nativo · nessun host C++ o repository incorporato</small></div>
    <label>Intensità: {settings.intensity.toFixed(2)}×<input type="range" min=".1" max="3" step=".05" value={settings.intensity} onChange={(event) => update({ intensity: Number(event.target.value) })} /></label>
    <label>Sensibilità audio: {settings.sensitivity.toFixed(2)}×<input type="range" min=".25" max="3" step=".05" value={settings.sensitivity} onChange={(event) => update({ sensitivity: Number(event.target.value) })} /></label>
    <label>Opacità overlay: {Math.round(settings.overlayOpacity * 100)}%<input type="range" min=".1" max="1" step=".01" value={settings.overlayOpacity} onChange={(event) => update({ overlayOpacity: Number(event.target.value) })} /></label>
    <label>Velocità movimento: {settings.motionSpeed.toFixed(2)}×<input type="range" min="0" max="3" step=".05" value={settings.motionSpeed} onChange={(event) => update({ motionSpeed: Number(event.target.value) })} /></label>
    <label>Scia: {Math.round(settings.trail * 100)}%<input type="range" min="0" max=".95" step=".01" value={settings.trail} onChange={(event) => update({ trail: Number(event.target.value) })} /></label>
    <label>Simmetria<select value={settings.symmetry} onChange={(event) => update({ symmetry: Number(event.target.value) as typeof settings.symmetry })}><option value="4">4</option><option value="6">6</option><option value="8">8</option><option value="12">12</option></select></label>
    <label>Fusione<select value={settings.blendMode} onChange={(event) => update({ blendMode: event.target.value as typeof settings.blendMode })}><option value="screen">Screen</option><option value="lighter">Additiva</option><option value="source-over">Normale</option></select></label>
    <h2>Palette</h2><label className="teddy-dance-toggle"><span>Automatica da immagine o video</span><input type="checkbox" checked={settings.autoPalette} onChange={(event) => void setAutomaticPalette(event.target.checked)} /></label><label>Influenza palette MLSM: {Math.round(settings.paletteInfluence * 100)}%<input type="range" min="0" max="1" step=".01" value={settings.paletteInfluence} onChange={(event) => update({ paletteInfluence: Number(event.target.value) })} /></label><p className="muted">0% usa i colori originari dell’effetto; 100% usa completamente la palette estratta o impostata a mano.</p><div className="teddy-palette">{settings.palette.map((color, index) => <label key={index}>Colore {index + 1}<input type="color" value={color} onChange={(event) => { operation.current += 1; const palette = [...settings.palette] as [string, string, string]; palette[index] = event.target.value; update({ palette, autoPalette: false }); }} /></label>)}</div>
    <h2>Testi</h2><label>Titolo<input value={settings.title} maxLength={160} onChange={(event) => update({ title: event.target.value })} /></label><label>Artista<input value={settings.artist} maxLength={160} onChange={(event) => update({ artist: event.target.value })} /></label><label className="teddy-dance-toggle"><span>Mostra titolo e artista</span><input type="checkbox" checked={settings.showMetadata} onChange={(event) => update({ showMetadata: event.target.checked })} /></label>
  </section>;
}
