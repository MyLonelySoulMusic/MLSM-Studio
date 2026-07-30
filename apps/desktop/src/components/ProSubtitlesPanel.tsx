import { useState, type ChangeEvent } from "react";
import type { RhythmBallProject } from "@rbs/project-schema";
import { useProjectStore } from "../store/project-store";
import { extractPaletteFromImage } from "../services/image-palette";
import { subtitleFontOptions } from "../services/subtitle-fonts";
import {
  assignProSubtitleCueStyles,
  parseProSubtitleFile,
  proSubtitleAnimationOptions,
  resolveProSubtitlePaletteColor,
  retargetProSubtitleAutomaticAnimations
} from "../services/pro-subtitles";

type ProSubtitleAnimation = RhythmBallProject["animation"]["proSubtitles"]["defaultAnimation"];
const fullFrameAnimationIds = new Set<ProSubtitleAnimation>(["fullFrameOrbit", "editorialGrid", "focusCarousel"]);

const positionPresets = [
  { x: 15, y: 15, label: "Alto a sinistra" },
  { x: 50, y: 15, label: "In alto al centro" },
  { x: 85, y: 15, label: "Alto a destra" },
  { x: 15, y: 50, label: "Al centro a sinistra" },
  { x: 50, y: 50, label: "Centro" },
  { x: 85, y: 50, label: "Al centro a destra" },
  { x: 15, y: 85, label: "Basso a sinistra" },
  { x: 50, y: 85, label: "In basso al centro" },
  { x: 85, y: 85, label: "Basso a destra" }
] as const;

interface PositionPadProps {
  x: number;
  y: number;
  disabled?: boolean;
  label: string;
  onChange: (x: number, y: number) => void;
}

function PositionPad({ x, y, disabled = false, label, onChange }: PositionPadProps) {
  return <div className="pro-position-pad" role="group" aria-label={label}>
    {positionPresets.map((preset) => {
      const selected = Math.abs(x - preset.x) < 1 && Math.abs(y - preset.y) < 1;
      return <button
        key={`${preset.x}-${preset.y}`}
        type="button"
        aria-label={preset.label}
        aria-pressed={selected}
        disabled={disabled}
        className={selected ? "selected" : ""}
        onClick={() => onChange(preset.x, preset.y)}
      ><span aria-hidden="true" /></button>;
    })}
  </div>;
}

function ProSubtitleAnimationOptions() {
  const standard = proSubtitleAnimationOptions.filter((animation) => !fullFrameAnimationIds.has(animation.id));
  const fullFrame = proSubtitleAnimationOptions.filter((animation) => fullFrameAnimationIds.has(animation.id));
  return <>
    <optgroup label="Kinetic typography">{standard.map((animation) => <option key={animation.id} value={animation.id}>{animation.label}</option>)}</optgroup>
    <optgroup label="Full-frame · tutta la pagina">{fullFrame.map((animation) => <option key={animation.id} value={animation.id}>{animation.label}</option>)}</optgroup>
  </>;
}

function imageDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export interface ProSubtitlesPanelProps {
  duration: number;
  selectedSubtitleId: string | null;
  onSelectSubtitle: (id: string | null) => void;
  onImportVideo: (file: File) => Promise<void>;
}

export function ProSubtitlesPanel({ duration, selectedSubtitleId, onSelectSubtitle, onImportVideo }: ProSubtitlesPanelProps) {
  const settings = useProjectStore((state) => state.project.animation.proSubtitles);
  const cues = useProjectStore((state) => state.project.subtitles.cues);
  const aspectRatio = useProjectStore((state) => state.project.canvas.aspectRatio);
  const updateSettings = useProjectStore((state) => state.updateProSubtitles);
  const setPalette = useProjectStore((state) => state.setProSubtitlesPalette);
  const setCues = useProjectStore((state) => state.setSubtitleCues);
  const updateCue = useProjectStore((state) => state.updateSubtitleCue);
  const updateCueStyle = useProjectStore((state) => state.updateProSubtitleCueStyle);
  const updateWordStyle = useProjectStore((state) => state.updateProSubtitleWordStyle);
  const deleteCue = useProjectStore((state) => state.deleteSubtitleCue);
  const splitCue = useProjectStore((state) => state.splitSubtitleCue);
  const setAspectRatio = useProjectStore((state) => state.setAspectRatio);
  const [status, setStatus] = useState("Carica video, sottotitoli e immagine palette. Il video resta una guida e non entra nel layer esportato.");

  const selectedCue = selectedSubtitleId ? cues.find((cue) => cue.id === selectedSubtitleId) ?? null : null;
  const selectedCueIndex = selectedCue ? Math.max(0, cues.findIndex((cue) => cue.id === selectedCue.id)) : 0;
  const selectedStyle = selectedCue ? settings.cueStyles.find((style) => style.cueId === selectedCue.id) : undefined;
  const words = selectedCue?.text.trim().split(/\s+/).filter(Boolean) ?? [];
  const videoReady = Boolean(settings.videoUrl && Number.isFinite(duration) && duration > 0);
  const defaultAnimationDetail = proSubtitleAnimationOptions.find((animation) => animation.id === settings.defaultAnimation)?.detail;
  const selectedAnimationDetail = proSubtitleAnimationOptions.find((animation) => animation.id === (selectedStyle?.animation ?? settings.defaultAnimation))?.detail;
  const cuePositionAutomatic = selectedStyle?.positionAutomatic ?? true;
  const cuePositionX = cuePositionAutomatic ? settings.positionX : selectedStyle?.positionX ?? settings.positionX;
  const cuePositionY = cuePositionAutomatic ? settings.positionY : selectedStyle?.positionY ?? settings.positionY;
  const cueOpacityAutomatic = selectedStyle?.opacityAutomatic ?? true;
  const cueOpacity = cueOpacityAutomatic ? settings.opacity : selectedStyle?.opacity ?? settings.opacity;
  const cueFontFamilyAutomatic = selectedStyle?.fontFamilyAutomatic ?? true;
  const cueFontSizeAutomatic = selectedStyle?.fontSizeAutomatic ?? true;
  const cueFontFamily = cueFontFamilyAutomatic ? settings.defaultFontFamily : selectedStyle?.fontFamily ?? settings.defaultFontFamily;
  const cueFontSize = cueFontSizeAutomatic ? settings.defaultFontSize : selectedStyle?.fontSize ?? settings.defaultFontSize;

  const importSubtitles = async (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0]; change.target.value = ""; if (!file) return;
    if (!videoReady) { setStatus("Carica prima un video guida valido: serve la sua durata per importare e posizionare i sottotitoli."); return; }
    try {
      const imported = parseProSubtitleFile(await file.text(), duration);
      const cueStyles = assignProSubtitleCueStyles(imported, settings);
      setCues(imported); updateSettings({ cueStyles }); onSelectSubtitle(imported[0]?.id ?? null);
      setStatus(`${imported.length} blocchi importati da ${file.name} · regia assegnata in base a durata, densità, enfasi e pause.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };

  const importPalette = async (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0]; change.target.value = ""; if (!file) return;
    const url = await imageDataUrl(file); if (!url) { setStatus("Impossibile leggere l’immagine palette."); return; }
    try {
      const colors = await extractPaletteFromImage(url, 3);
      setPalette(colors); updateSettings({ paletteImageUrl: url });
      setStatus("Palette professionale a 3 colori estratta e applicata alle parole.");
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };

  const updatePaletteSlot = (index: number, color: string) => {
    const palette = [...settings.palette] as [string, string, string]; palette[index] = color; setPalette(palette);
  };
  const updateShadowSlot = (index: number, patch: { enabled?: boolean; color?: string }) => {
    const paletteShadowEnabled = [...settings.paletteShadowEnabled] as [boolean, boolean, boolean];
    const paletteShadowColors = [...settings.paletteShadowColors] as [string, string, string];
    if (patch.enabled !== undefined) paletteShadowEnabled[index] = patch.enabled;
    if (patch.color !== undefined) paletteShadowColors[index] = patch.color;
    updateSettings({ paletteShadowEnabled, paletteShadowColors });
  };

  return <section className="pro-subtitles-settings">
    <div className="pro-workflow">
      <h2>1 · Video guida</h2>
      <label className="flyer-upload">Carica video<input aria-label="Carica video ProSubtitles" type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportVideo(file); event.target.value = ""; }} /></label>
      {settings.videoUrl ? <div className="subtitle-video-loaded"><strong>{settings.videoName}</strong><span>{duration.toFixed(2)} s · sorgente di tempo e preview, esclusa dall’export overlay</span></div> : <p className="muted">Il video fornisce durata, audio e riferimento visivo.</p>}
      <div className="pro-ratio-switch" role="group" aria-label="Rapporto ProSubtitles"><button type="button" aria-pressed={aspectRatio === "9:16"} className={aspectRatio === "9:16" ? "active-control" : ""} onClick={() => setAspectRatio("9:16")}>9:16 verticale</button><button type="button" aria-pressed={aspectRatio === "16:9"} className={aspectRatio === "16:9" ? "active-control" : ""} onClick={() => setAspectRatio("16:9")}>16:9 orizzontale</button></div>
      <label>Adattamento video guida<select value={settings.fit} onChange={(event) => updateSettings({ fit: event.target.value as typeof settings.fit })}><option value="contain">Intero video · contain</option><option value="cover">Riempi preview · cover</option></select></label>
      <label>Oscuramento guida: {Math.round(settings.dimming * 100)}%<input type="range" min="0" max=".8" step=".01" value={settings.dimming} onChange={(event) => updateSettings({ dimming: Number(event.target.value) })} /></label>
    </div>

    <div className="pro-workflow">
      <h2>2 · File sottotitoli</h2>
      <label className={`flyer-upload${videoReady ? "" : " disabled-upload"}`}>Importa SRT o WebVTT<input aria-label="Importa sottotitoli ProSubtitles" aria-describedby="pro-subtitle-import-help" type="file" accept=".srt,.vtt,application/x-subrip,text/vtt,text/plain" disabled={!videoReady} onChange={(event) => void importSubtitles(event)} /></label>
      <p className="muted" id="pro-subtitle-import-help">{videoReady ? "I blocchi compaiono nella timeline: trascina per spostarli, usa le maniglie per accorciarli e doppio clic per dividerli." : "Carica prima il video guida: la sua durata impedisce timestamp fuori scena e blocchi invisibili."}</p>
    </div>

    <div className="pro-workflow">
      <h2>3 · Palette e ombre</h2>
      <label className="flyer-upload">Immagine per palette automatica<input aria-label="Carica immagine palette ProSubtitles" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importPalette(event)} /></label>
      {settings.paletteImageUrl ? <div className="pro-palette-source" role="img" aria-label="Anteprima immagine usata per estrarre la palette" style={{ backgroundImage: `url(${settings.paletteImageUrl})` }} /> : null}
      <div className="pro-palette-grid">{settings.palette.map((color, index) => <article key={index}>
        <header><strong>Colore {index + 1}</strong><input aria-label={`Colore palette ${index + 1}`} type="color" value={color} onChange={(event) => updatePaletteSlot(index, event.target.value)} /></header>
        <label className="teddy-dance-toggle"><span>Ombra</span><input aria-label={`Ombra palette ${index + 1}`} type="checkbox" checked={settings.paletteShadowEnabled[index]} onChange={(event) => updateShadowSlot(index, { enabled: event.target.checked })} /></label>
        {settings.paletteShadowEnabled[index] ? <label>Colore ombra<input aria-label={`Colore ombra palette ${index + 1}`} type="color" value={settings.paletteShadowColors[index]} onChange={(event) => updateShadowSlot(index, { color: event.target.value })} /></label> : null}
      </article>)}</div>
    </div>

    <div className="pro-workflow">
      <h2>4 · Regia automatica</h2>
      <label className="teddy-dance-toggle"><span>Regia intelligente per frase</span><input type="checkbox" checked={settings.autoVaryAnimations} onChange={(event) => {
        const autoVaryAnimations = event.target.checked;
        updateSettings({ autoVaryAnimations, cueStyles: retargetProSubtitleAutomaticAnimations(cues, settings, autoVaryAnimations) });
      }} /></label>
      <p className="muted">Analizza durata, velocità di lettura, punteggiatura, righe ed enfasi; evita ripetizioni meccaniche e mette in risalto la parola chiave.</p>
      <label>Animazione predefinita<select aria-label="Animazione predefinita ProSubtitles" value={settings.defaultAnimation} onChange={(event) => {
        const defaultAnimation = event.target.value as ProSubtitleAnimation;
        const nextSettings = { ...settings, defaultAnimation };
        updateSettings({
          defaultAnimation,
          cueStyles: retargetProSubtitleAutomaticAnimations(cues, nextSettings, settings.autoVaryAnimations)
        });
      }}><ProSubtitleAnimationOptions /></select></label>
      {defaultAnimationDetail ? <p className="muted">{defaultAnimationDetail}</p> : null}
      <div className="pro-global-controls" role="group" aria-label="Stile globale ProSubtitles">
        <header><strong>Tipografia globale</strong><span>Si applica a tutte le frasi che usano lo stile globale.</span></header>
        <label>Font globale<select aria-label="Font globale ProSubtitles" value={settings.defaultFontFamily} onChange={(event) => updateSettings({ defaultFontFamily: event.target.value })}>{subtitleFontOptions.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
        <label>Dimensione globale: {settings.defaultFontSize} · lato corto 1080<input aria-label="Dimensione globale ProSubtitles" type="range" min="36" max="220" step="1" value={settings.defaultFontSize} onChange={(event) => updateSettings({ defaultFontSize: Number(event.target.value) })} /></label>
      </div>
      <div className="pro-global-controls" role="group" aria-label="Posizione globale sottotitoli">
        <header><strong>Composizione globale</strong><span>La griglia offre preset rapidi; gli slider consentono il posizionamento preciso.</span></header>
        <PositionPad x={settings.positionX} y={settings.positionY} label="Preset posizione globale" onChange={(positionX, positionY) => updateSettings({ positionX, positionY })} />
        <label>Posizione orizzontale globale: {Math.round(settings.positionX)}%<input aria-label="Posizione orizzontale globale" type="range" min="0" max="100" step="1" value={settings.positionX} onChange={(event) => updateSettings({ positionX: Number(event.target.value) })} /></label>
        <label>Posizione verticale globale: {Math.round(settings.positionY)}%<input aria-label="Posizione verticale globale" type="range" min="0" max="100" step="1" value={settings.positionY} onChange={(event) => updateSettings({ positionY: Number(event.target.value) })} /></label>
        <label>Opacità globale: {Math.round(settings.opacity * 100)}%<input aria-label="Opacità globale ProSubtitles" type="range" min="0" max="1" step=".01" value={settings.opacity} onChange={(event) => updateSettings({ opacity: Number(event.target.value) })} /></label>
      </div>
      <label>Margine title-safe: {Math.round(settings.titleSafe * 100)}%<input type="range" min=".05" max=".2" step=".005" value={settings.titleSafe} onChange={(event) => updateSettings({ titleSafe: Number(event.target.value) })} /></label>
    </div>

    {selectedCue ? <div className="pro-workflow pro-cue-inspector">
      <h2>Frase selezionata</h2>
      <label>Testo<textarea aria-label="Testo frase ProSubtitles" rows={3} value={selectedCue.text} onChange={(event) => updateCue(selectedCue.id, { text: event.target.value || " " })} /></label>
      <div className="pro-time-fields"><label>Inizio<input aria-label="Inizio frase ProSubtitles" type="number" min="0" step=".01" value={selectedCue.startSeconds} onChange={(event) => updateCue(selectedCue.id, { startSeconds: Number(event.target.value) })} /></label><label>Fine<input aria-label="Fine frase ProSubtitles" type="number" min=".01" step=".01" value={selectedCue.endSeconds} onChange={(event) => updateCue(selectedCue.id, { endSeconds: Number(event.target.value) })} /></label></div>
      <label>Animazione<select aria-label="Animazione frase ProSubtitles" value={selectedStyle?.animation ?? settings.defaultAnimation} onChange={(event) => updateCueStyle(selectedCue.id, { animation: event.target.value as ProSubtitleAnimation })}><ProSubtitleAnimationOptions /></select></label>
      {selectedAnimationDetail ? <p className="muted">{selectedAnimationDetail}</p> : null}
      <div className="pro-cue-style-card">
        <div className="pro-inheritance-row"><strong>Font della frase</strong><button type="button" aria-pressed={cueFontFamilyAutomatic} className={cueFontFamilyAutomatic ? "active-control" : ""} onClick={() => updateCueStyle(selectedCue.id, { fontFamilyAutomatic: !cueFontFamilyAutomatic })}>{cueFontFamilyAutomatic ? "✓ Usa font globale" : "Usa font globale"}</button></div>
        <label>Font frase<select aria-label="Font frase ProSubtitles" disabled={cueFontFamilyAutomatic} value={cueFontFamily} onChange={(event) => updateCueStyle(selectedCue.id, { fontFamily: event.target.value, fontFamilyAutomatic: false })}>{subtitleFontOptions.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
        <div className="pro-inheritance-row"><strong>Dimensione della frase</strong><button type="button" aria-pressed={cueFontSizeAutomatic} className={cueFontSizeAutomatic ? "active-control" : ""} onClick={() => updateCueStyle(selectedCue.id, { fontSizeAutomatic: !cueFontSizeAutomatic })}>{cueFontSizeAutomatic ? "✓ Usa dimensione globale" : "Usa dimensione globale"}</button></div>
        <label>Dimensione frase: {cueFontSize} · lato corto 1080<input aria-label="Dimensione frase ProSubtitles" type="range" min="24" max="260" disabled={cueFontSizeAutomatic} value={cueFontSize} onChange={(event) => updateCueStyle(selectedCue.id, { fontSize: Number(event.target.value), fontSizeAutomatic: false })} /></label>
      </div>
      <div className="pro-cue-style-card" role="group" aria-label="Posizione frase selezionata">
        <div className="pro-inheritance-row"><strong>Posizione della frase</strong><button type="button" aria-pressed={cuePositionAutomatic} className={cuePositionAutomatic ? "active-control" : ""} onClick={() => updateCueStyle(selectedCue.id, { positionAutomatic: !cuePositionAutomatic })}>{cuePositionAutomatic ? "✓ Eredita posizione globale" : "Eredita posizione globale"}</button></div>
        <PositionPad x={cuePositionX} y={cuePositionY} disabled={cuePositionAutomatic} label="Preset posizione frase" onChange={(positionX, positionY) => updateCueStyle(selectedCue.id, { positionX, positionY, positionAutomatic: false })} />
        <label>Posizione orizzontale frase: {Math.round(cuePositionX)}%<input aria-label="Posizione orizzontale frase" type="range" min="0" max="100" step="1" disabled={cuePositionAutomatic} value={cuePositionX} onChange={(event) => updateCueStyle(selectedCue.id, { positionX: Number(event.target.value), positionAutomatic: false })} /></label>
        <label>Posizione verticale frase: {Math.round(cuePositionY)}%<input aria-label="Posizione verticale frase" type="range" min="0" max="100" step="1" disabled={cuePositionAutomatic} value={cuePositionY} onChange={(event) => updateCueStyle(selectedCue.id, { positionY: Number(event.target.value), positionAutomatic: false })} /></label>
      </div>
      <div className="pro-cue-style-card" role="group" aria-label="Opacità frase selezionata">
        <div className="pro-inheritance-row"><strong>Opacità della frase</strong><button type="button" aria-pressed={cueOpacityAutomatic} className={cueOpacityAutomatic ? "active-control" : ""} onClick={() => updateCueStyle(selectedCue.id, { opacityAutomatic: !cueOpacityAutomatic })}>{cueOpacityAutomatic ? "✓ Eredita opacità globale" : "Eredita opacità globale"}</button></div>
        <label>Opacità frase: {Math.round(cueOpacity * 100)}%<input aria-label="Opacità frase ProSubtitles" type="range" min="0" max="1" step=".01" disabled={cueOpacityAutomatic} value={cueOpacity} onChange={(event) => updateCueStyle(selectedCue.id, { opacity: Number(event.target.value), opacityAutomatic: false })} /></label>
      </div>
      <div className="pro-cue-actions"><button onClick={() => splitCue(selectedCue.id, (selectedCue.startSeconds + selectedCue.endSeconds) / 2)}>Dividi frase</button><button className="danger" onClick={() => { deleteCue(selectedCue.id); onSelectSubtitle(null); }}>Elimina</button></div>
      <h3>Stile per parola</h3>
      <div className="pro-word-list">{words.map((word, index) => {
        const wordStyle = selectedStyle?.wordStyles.find((style) => style.index === index); const color = wordStyle?.color ?? resolveProSubtitlePaletteColor(settings.palette, selectedCueIndex, index);
        return <article key={`${index}-${word}`}><header><strong>{word}</strong><span>{index + 1}</span></header><div className="pro-word-swatches">{settings.palette.map((paletteColor, paletteIndex) => <button key={paletteIndex} aria-label={`Applica colore ${paletteIndex + 1} a ${word}`} className={color.toLowerCase() === paletteColor.toLowerCase() ? "selected" : ""} style={{ background: paletteColor }} onClick={() => updateWordStyle(selectedCue.id, index, { color: paletteColor })} />)}<input aria-label={`Colore personalizzato ${word}`} type="color" value={color} onChange={(event) => updateWordStyle(selectedCue.id, index, { color: event.target.value })} /></div><label>Scala: {(wordStyle?.fontSizeScale ?? 1).toFixed(2)}×<input type="range" min=".45" max="2.2" step=".05" value={wordStyle?.fontSizeScale ?? 1} onChange={(event) => updateWordStyle(selectedCue.id, index, { fontSizeScale: Number(event.target.value) })} /></label><label>Movimento<select aria-label={`Movimento parola ${index + 1}: ${word}`} value={wordStyle?.animation ?? ""} onChange={(event) => updateWordStyle(selectedCue.id, index, { animation: event.target.value ? event.target.value as ProSubtitleAnimation : null })}><option value="">Eredita dalla frase</option><ProSubtitleAnimationOptions /></select></label></article>;
      })}</div>
    </div> : <p className="muted">Importa o inserisci un blocco per modificarne animazione, font, dimensione e singole parole.</p>}

    <div className="pro-workflow pro-output-settings">
      <h2>5 · Output per il montaggio</h2>
      <label>Fondo<select value={settings.backgroundMode} onChange={(event) => updateSettings({ backgroundMode: event.target.value as typeof settings.backgroundMode })}><option value="transparent">Trasparente · solo sottotitoli</option><option value="solid">Colore pieno · fallback CapCut</option></select></label>
      {settings.backgroundMode === "solid" ? <label>Colore di fondo<input aria-label="Colore fondo ProSubtitles" type="color" value={settings.backgroundColor} onChange={(event) => updateSettings({ backgroundColor: event.target.value })} /></label> : null}
      {settings.backgroundMode === "transparent" ? <label>Formato trasparente<select value={settings.exportFormat} onChange={(event) => updateSettings({ exportFormat: event.target.value as typeof settings.exportFormat })}><option value="webmVp9Alpha">WebM · VP9 con alpha</option><option value="movProRes4444">MOV · Apple ProRes 4444 con alpha</option></select></label> : null}
      <div className="pro-export-note"><strong>{settings.backgroundMode === "solid" ? "MP4 · H.264 con fondo pieno" : settings.exportFormat === "movProRes4444" ? "Pipeline desktop FFmpeg" : "WebCodecs VP9 alpha"}</strong><span>{settings.backgroundMode === "solid" ? "Il formato alpha non viene applicato: l’export usa il colore scelto come sfondo compatibile con CapCut." : settings.exportFormat === "movProRes4444" ? "ProRes 4444 sarà disponibile nella build desktop con FFmpeg; il browser non lo simulerà con un codec sbagliato." : "La compatibilità viene verificata prima dell’export. Se il browser non conserva l’alpha, l’operazione si ferma e puoi scegliere il fondo pieno."}</span></div>
    </div>
    <p className="pro-status" role="status" aria-live="polite" aria-atomic="true">{status}</p>
  </section>;
}
