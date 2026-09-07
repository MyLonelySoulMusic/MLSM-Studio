import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { RhythmBallProject } from "@rbs/project-schema";
import { extractPaletteFromImage } from "../services/image-palette";
import { useProjectStore } from "../store/project-store";

type Settings = RhythmBallProject["animation"]["portraitLandscape"];
type EffectKey = keyof Settings["effects"];
const effectLabels: Record<EffectKey, string> = { rain: "Pioggia realistica", lightning: "Fulmini", feathers: "Piume", particles: "Particelle" };

function imageDataUrl(file: File): Promise<string | null> { return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null); reader.onerror = () => resolve(null); reader.readAsDataURL(file); }); }

interface PortraitRangeControlProps {
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

export function PortraitRangeControl({ label, ariaLabel, value, min, max, step, format, onChange }: PortraitRangeControlProps) {
  const [draft, setDraft] = useState(value);
  const latest = useRef(value);
  const dragging = useRef(false);
  const pendingCommit = useRef<number | null>(null);
  const commitRef = useRef(onChange); commitRef.current = onChange;

  useEffect(() => {
    if (!dragging.current) { latest.current = value; setDraft(value); }
  }, [value]);
  useEffect(() => () => { if (pendingCommit.current !== null) window.clearTimeout(pendingCommit.current); }, []);

  const commit = () => {
    if (pendingCommit.current !== null) { window.clearTimeout(pendingCommit.current); pendingCommit.current = null; }
    commitRef.current(latest.current);
  };
  const queueCommit = (next: number) => {
    latest.current = next; setDraft(next);
    if (!dragging.current) { commitRef.current(next); return; }
    if (pendingCommit.current === null) pendingCommit.current = window.setTimeout(() => { pendingCommit.current = null; commitRef.current(latest.current); }, 32);
  };
  const finishInteraction = () => { dragging.current = false; commit(); };

  return <label className="portrait-range-control">
    <span className="portrait-range-heading"><span>{label}</span><output>{format(draft)}</output></span>
    <input aria-label={ariaLabel} type="range" min={min} max={max} step={step} value={draft} onPointerDown={() => { dragging.current = true; }} onPointerUp={finishInteraction} onPointerCancel={finishInteraction} onLostPointerCapture={() => { if (dragging.current) finishInteraction(); }} onBlur={() => { if (pendingCommit.current !== null) finishInteraction(); }} onKeyUp={commit} onChange={(change) => queueCommit(Number(change.target.value))} />
  </label>;
}

export function PortraitLandscapePanel({ onImportVideo }: { onImportVideo: (file: File) => Promise<void> }) {
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const settings = useProjectStore((state) => state.project.animation.portraitLandscape); const update = useProjectStore((state) => state.updatePortraitLandscape); const setPalette = useProjectStore((state) => state.setPortraitLandscapePalette); const setProSubtitlesPalette = useProjectStore((state) => state.setProSubtitlesPalette); const setAspectRatio = useProjectStore((state) => state.setAspectRatio);
  useEffect(() => setAspectRatio("16:9"), [setAspectRatio]);
  const loadImage = async (change: ChangeEvent<HTMLInputElement>, target: "sideImageUrl" | "coverImageUrl") => { const file = change.target.files?.[0]; const url = file ? await imageDataUrl(file) : null; if (url) { update({ [target]: url }); const colors = await extractPaletteFromImage(url, 3).catch(() => []); if (colors.length && target === "coverImageUrl") { update({ autoPalette: true }); setPalette(colors); setProSubtitlesPalette(colors); } else if (colors.length) update({ sideImagePalette: [colors[0]!, colors[1] ?? colors[0]!, colors[2] ?? colors[1] ?? colors[0]!] }); } change.target.value = ""; };
  const updateEffect = (key: EffectKey, patch: { enabled?: boolean; color?: string; opacity?: number }) => update({
    ...(patch.enabled === undefined ? {} : { effects: { ...settings.effects, [key]: patch.enabled } }),
    ...(patch.color === undefined ? {} : { effectColors: { ...settings.effectColors, [key]: patch.color }, autoPalette: false }),
    ...(patch.opacity === undefined ? {} : { effectOpacity: { ...settings.effectOpacity, [key]: patch.opacity } })
  });
  const recommendation = settings.videoHeight >= 1800 ? "3840 × 2160 · 4K consigliato" : settings.videoHeight >= 1300 ? "2560 × 1440 · QHD consigliato" : "1920 × 1080 · Full HD consigliato";
  const activeSpectrumPalette = settings.spectrumPaletteSource === "manual" ? settings.spectrumManualPalette : settings.spectrumPaletteSource === "sideImage" ? settings.sideImagePalette : settings.palette;

  return <section className="portrait-landscape-settings">
    <div className="vocal-track-advice"><strong>Composizione 16:9 deterministica</strong><span>Il video verticale resta intero e centrale. Immagini, cubo, spettro ed effetti vengono calcolati nuovamente per ogni frame dell’export, non registrati dalla preview.</span></div>
    <h2>Video centrale 9:16</h2>
    <label className="flyer-upload">Carica video verticale<input aria-label="Carica video From 9:16 to 16:9" type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" onClick={(change) => { change.currentTarget.value = ""; }} onChange={(change) => { const file = change.target.files?.[0]; if (file) void onImportVideo(file); }} /></label>
    {settings.videoUrl ? <div className="subtitle-video-loaded"><strong>{settings.videoName}</strong><span>{settings.videoWidth} × {settings.videoHeight} · {settings.videoHasAudio ? "audio analizzato · spettro stereo e ritmo attivi" : "visualizer di sicurezza attivo · puoi riprovare Analizza dalla barra superiore"}</span></div> : <p className="muted">Carica il video verticale principale. La modalità imposta automaticamente canvas e preview in 16:9 e avvia l’analisi audio.</p>}
    {settings.videoWidth > 0 && settings.videoHeight > 0 && settings.videoWidth / settings.videoHeight > .68 ? <p className="export-warning">Il video non sembra 9:16. Verrà mostrato interamente con eventuali bande interne, senza tagliarlo.</p> : null}

    <h2>Riempimento laterale specchiato</h2>
    <label className="flyer-upload">Carica immagine 9:16<input aria-label="Carica immagine laterale 9:16" type="file" accept="image/png,image/jpeg,image/webp" onChange={(change) => void loadImage(change, "sideImageUrl")} /></label>
    {settings.sideImageUrl ? <div className="cover-thumbnail portrait-side-thumbnail" style={{ backgroundImage: `url(${settings.sideImageUrl})` }} /> : null}
    <button type="button" className="portrait-open-image-editor" disabled={!settings.sideImageUrl} onClick={() => setImageEditorOpen(true)}>Modifica immagine specchiata</button>
    <label>Lato dell’immagine originale<select aria-label="Lato immagine originale" value={settings.sideImagePlacement} onChange={(change) => update({ sideImagePlacement: change.target.value as Settings["sideImagePlacement"] })}><option value="left">Sinistra · specchio a destra</option><option value="right">Destra · specchio a sinistra</option></select></label>

    <h2>Cover nel cubo di vetro</h2>
    <label className="flyer-upload">Carica copertina<input aria-label="Carica cover From 9:16 to 16:9" type="file" accept="image/png,image/jpeg,image/webp" onChange={(change) => void loadImage(change, "coverImageUrl")} /></label>
    {settings.coverImageUrl ? <div className="cover-thumbnail" style={{ backgroundImage: `url(${settings.coverImageUrl})` }} /> : null}
    <PortraitRangeControl label="Dimensione cubo" ariaLabel="Dimensione cubo 9:16 to 16:9" min={.45} max={1.8} step={.05} value={settings.cubeScale} format={(value) => `${value.toFixed(2)}×`} onChange={(cubeScale) => update({ cubeScale })} />
    <PortraitRangeControl label="Velocità movimento sui bordi" ariaLabel="Velocità movimento cubo 9:16 to 16:9" min={.15} max={1.5} step={.05} value={settings.cubeSpeed} format={(value) => `${value.toFixed(2)}×`} onChange={(cubeSpeed) => update({ cubeSpeed })} />
    <label>Cadenza rotazione<select aria-label="Cadenza rotazione cubo 9:16 to 16:9" value={settings.cubeRotationBeats} onChange={(change) => update({ cubeRotationBeats: Number(change.target.value) })}><option value="4">Ogni 4/4 · una battuta</option><option value="8">Ogni 8/4 · due battute</option><option value="16">Ogni 16/4 · quattro battute</option><option value="32">Ogni 32/4 · otto battute</option></select></label>
    <PortraitRangeControl label="Velocità rotazione" ariaLabel="Velocità rotazione cubo 9:16 to 16:9" min={.25} max={2.5} step={.05} value={settings.cubeRotationSpeed} format={(value) => `${value.toFixed(2)}×`} onChange={(cubeRotationSpeed) => update({ cubeRotationSpeed })} />
    <p className="muted">Il cubo percorre il canvas e rimbalza sui quattro bordi con moto continuo. La musica non lo fa vibrare né saltare: alla cadenza scelta cambia soltanto orientamento.</p>
    <PortraitRangeControl label="Vetro" ariaLabel="Vetro cubo 9:16 to 16:9" min={.08} max={.7} step={.01} value={settings.glassOpacity} format={(value) => `${Math.round(value * 100)}%`} onChange={(glassOpacity) => update({ glassOpacity })} />

    <h2>Palette e spettrogramma stereo</h2>
    <label className="teddy-dance-toggle"><span>Palette automatica dalla cover</span><input aria-label="Palette automatica From 9:16 to 16:9" type="checkbox" checked={settings.autoPalette} onChange={(change) => update({ autoPalette: change.target.checked })} /></label>
    <div className="pixels-sub-palette">{settings.palette.map((color, index) => <label key={index}>Colore {index + 1}<input aria-label={`Colore palette 9:16 to 16:9 ${index + 1}`} type="color" value={color} onChange={(change) => { const palette = [...settings.palette] as [string, string, string]; palette[index] = change.target.value; update({ palette, autoPalette: false }); }} /></label>)}</div>
    <label>Palette barre spettrogramma<select aria-label="Palette barre spettrogramma 9:16 to 16:9" value={settings.spectrumPaletteSource} onChange={(change) => { const source = change.target.value as Settings["spectrumPaletteSource"]; update(source === "manual" && settings.spectrumPaletteSource !== "manual" ? { spectrumPaletteSource: source, spectrumManualPalette: [...activeSpectrumPalette] as [string, string, string] } : { spectrumPaletteSource: source }); }}><option value="cover">Cover del cubo</option><option value="sideImage">Immagine laterale / sfondo</option><option value="manual">Manuale</option></select></label>
    <div className="pixels-sub-palette portrait-spectrum-manual-palette">{activeSpectrumPalette.map((color, index) => <label key={index}>Barra {index + 1}<input aria-label={`Colore manuale barre spettrogramma ${index + 1}`} type="color" value={color} onChange={(change) => { const manualPalette = [...activeSpectrumPalette] as [string, string, string]; manualPalette[index] = change.target.value; update({ spectrumPaletteSource: "manual", spectrumManualPalette: manualPalette }); }} /></label>)}</div>
    <div className="portrait-spectrum-palette-preview" aria-label="Anteprima palette spettrogramma">{activeSpectrumPalette.map((color, index) => <i key={`${color}-${index}`} style={{ backgroundColor: color }} />)}</div>
    <PortraitRangeControl label="Intensità 48 bande" ariaLabel="Intensità spettro 9:16 to 16:9" min={0} max={3} step={.05} value={settings.spectrumIntensity} format={(value) => `${value.toFixed(1)}×`} onChange={(spectrumIntensity) => update({ spectrumIntensity })} />
    <PortraitRangeControl label="Opacità bande" ariaLabel="Opacità spettro 9:16 to 16:9" min={0} max={1} step={.01} value={settings.spectrumOpacity} format={(value) => `${Math.round(value * 100)}%`} onChange={(spectrumOpacity) => update({ spectrumOpacity })} />

    <h2>Effetti</h2>
    <PortraitRangeControl label="Intensità globale" ariaLabel="Intensità effetti 9:16 to 16:9" min={.1} max={2.5} step={.05} value={settings.effectIntensity} format={(value) => `${value.toFixed(1)}×`} onChange={(effectIntensity) => update({ effectIntensity })} />
    <div className="portrait-effect-list">{(Object.keys(effectLabels) as EffectKey[]).map((key) => <div className="portrait-effect-card" key={key}><label className="teddy-dance-toggle"><span>{effectLabels[key]}</span><input aria-label={`${effectLabels[key]} 9:16 to 16:9`} type="checkbox" checked={settings.effects[key]} onChange={(change) => updateEffect(key, { enabled: change.target.checked })} /></label>{settings.effects[key] ? <><label>Colore<input aria-label={`Colore ${effectLabels[key]}`} type="color" value={settings.effectColors[key]} onChange={(change) => updateEffect(key, { color: change.target.value })} /></label><PortraitRangeControl label="Opacità" ariaLabel={`Opacità ${effectLabels[key]}`} min={0} max={1} step={.01} value={settings.effectOpacity[key]} format={(value) => `${Math.round(value * 100)}%`} onChange={(opacity) => updateEffect(key, { opacity })} /></> : null}</div>)}</div>
    <p className="muted">La posizione di ogni effetto si gestisce nella pila Livelli della timeline: più tracce attive vengono composte insieme, dall’alto verso il basso come in un editor video.</p>

    <h2>Export consigliato</h2>
    <div className="portrait-export-recommendation"><strong>{recommendation}</strong><span>Disponibili Full HD, QHD/2K, 4K, 5K e 8K fino a 120 fps. Il 4K è il preset migliore per una sorgente verticale 1080 × 1920 perché conserva quasi integralmente il dettaglio centrale e valorizza i due lati.</span></div>
    {imageEditorOpen && settings.sideImageUrl ? <div className="portrait-image-editor-backdrop" role="presentation"><section className="portrait-image-editor" role="dialog" aria-modal="true" aria-labelledby="portrait-image-editor-title"><header><div><strong id="portrait-image-editor-title">Immagine specchiata</strong><span>Correzione non distruttiva applicata a entrambi i lati</span></div><button type="button" aria-label="Chiudi editor immagine specchiata" onClick={() => setImageEditorOpen(false)}>×</button></header><div className="portrait-image-editor-preview"><div style={{ backgroundImage: `url(${settings.sideImageUrl})`, filter: `brightness(${settings.sideImageAdjustments.brightness * 2 ** settings.sideImageAdjustments.exposure}) contrast(${settings.sideImageAdjustments.contrast}) saturate(${settings.sideImageAdjustments.saturation}) blur(${settings.sideImageAdjustments.blur}px)` }} /><i style={{ background: settings.sideImageAdjustments.temperature >= 0 ? `rgba(255,132,52,${settings.sideImageAdjustments.temperature * .2})` : `rgba(64,142,255,${-settings.sideImageAdjustments.temperature * .2})` }} /></div><div className="portrait-image-editor-controls">
      <PortraitRangeControl label="Luminosità" ariaLabel="Luminosità immagine specchiata" min={.2} max={2} step={.01} value={settings.sideImageAdjustments.brightness} format={(value) => `${Math.round(value * 100)}%`} onChange={(brightness) => update({ sideImageAdjustments: { ...settings.sideImageAdjustments, brightness } })} />
      <PortraitRangeControl label="Esposizione" ariaLabel="Esposizione immagine specchiata" min={-1} max={1} step={.01} value={settings.sideImageAdjustments.exposure} format={(value) => `${value.toFixed(2)} EV`} onChange={(exposure) => update({ sideImageAdjustments: { ...settings.sideImageAdjustments, exposure } })} />
      <PortraitRangeControl label="Contrasto" ariaLabel="Contrasto immagine specchiata" min={.2} max={2} step={.01} value={settings.sideImageAdjustments.contrast} format={(value) => `${Math.round(value * 100)}%`} onChange={(contrast) => update({ sideImageAdjustments: { ...settings.sideImageAdjustments, contrast } })} />
      <PortraitRangeControl label="Saturazione" ariaLabel="Saturazione immagine specchiata" min={0} max={2.5} step={.01} value={settings.sideImageAdjustments.saturation} format={(value) => `${Math.round(value * 100)}%`} onChange={(saturation) => update({ sideImageAdjustments: { ...settings.sideImageAdjustments, saturation } })} />
      <PortraitRangeControl label="Temperatura" ariaLabel="Temperatura immagine specchiata" min={-1} max={1} step={.01} value={settings.sideImageAdjustments.temperature} format={(value) => `${Math.round(value * 100)}`} onChange={(temperature) => update({ sideImageAdjustments: { ...settings.sideImageAdjustments, temperature } })} />
      <PortraitRangeControl label="Sfocatura" ariaLabel="Sfocatura immagine specchiata" min={0} max={12} step={.1} value={settings.sideImageAdjustments.blur} format={(value) => `${value.toFixed(1)} px`} onChange={(blur) => update({ sideImageAdjustments: { ...settings.sideImageAdjustments, blur } })} />
      <button type="button" onClick={() => update({ sideImageAdjustments: { brightness: 1, exposure: 0, contrast: 1, saturation: 1, temperature: 0, blur: 0 } })}>Ripristina</button><button type="button" className="export" onClick={() => setImageEditorOpen(false)}>Applica</button></div></section></div> : null}
  </section>;
}
