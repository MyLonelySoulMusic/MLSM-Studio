import { useMemo } from "react";
import { videoEditorBlendModes } from "@rbs/project-schema";
import { useProjectStore } from "../store/project-store";
import {
  videoEditorAsset,
  videoEditorBlendModeLabel,
  videoEditorClip,
  videoEditorClipEnd,
  videoEditorClipMaximumDuration,
  videoEditorTimelineDuration,
  type VideoEditorAdjustments
} from "../services/video-editor";
import { videoEditorEffectCatalog, videoEditorEffectClipEnd, videoEditorEffectDefinition } from "../services/video-editor-effects";
import { videoEditorAdjustmentsAreNeutral } from "../services/video-editor-renderer";

interface AdjustmentControl { key: keyof VideoEditorAdjustments; label: string; minimum: number; maximum: number; step: number; unit?: string }

/**
 * Le regolazioni seguono l’ordine di una correzione colore professionale: prima
 * esposizione e tonalità, poi colore, infine dettaglio. È lo stesso ordine in cui
 * il compositor le applica, così il risultato corrisponde a ciò che si legge qui.
 */
const adjustmentControls: readonly AdjustmentControl[] = [
  { key: "exposure", label: "Esposizione", minimum: -2, maximum: 2, step: .01, unit: " EV" },
  { key: "contrast", label: "Contrasto", minimum: -100, maximum: 100, step: 1 },
  { key: "highlights", label: "Luci", minimum: -100, maximum: 100, step: 1 },
  { key: "shadows", label: "Ombre", minimum: -100, maximum: 100, step: 1 },
  { key: "whites", label: "Bianchi", minimum: -100, maximum: 100, step: 1 },
  { key: "blacks", label: "Neri", minimum: -100, maximum: 100, step: 1 },
  { key: "saturation", label: "Saturazione", minimum: -100, maximum: 100, step: 1 },
  { key: "vibrance", label: "Vividezza", minimum: -100, maximum: 100, step: 1 },
  { key: "temperature", label: "Temperatura", minimum: -100, maximum: 100, step: 1 },
  { key: "tint", label: "Tinta", minimum: -100, maximum: 100, step: 1 },
  { key: "hue", label: "Tonalità", minimum: -180, maximum: 180, step: 1, unit: "°" },
  { key: "sharpness", label: "Nitidezza", minimum: 0, maximum: 100, step: 1 },
  { key: "denoise", label: "Riduzione rumore", minimum: 0, maximum: 100, step: 1 }
];

const neutralAdjustments: VideoEditorAdjustments = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, opacity: 1
};

const fitLabels = { cover: "Riempi il fotogramma", contain: "Contieni tutto", fill: "Deforma ai bordi" } as const;

function effectNumericParameter(value: number | string | boolean | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatEffectParameter(value: number, step = 1, unit = ""): string {
  const decimals = step < .01 ? 3 : step < 1 ? 2 : 0;
  return `${value.toFixed(decimals)}${unit}`;
}

export function VideoEditorInspector() {
  const name = useProjectStore((state) => state.project.project.name);
  const rename = useProjectStore((state) => state.renameProject);
  const settings = useProjectStore((state) => state.project.animation.videoEditor);
  const updateClip = useProjectStore((state) => state.updateVideoEditorClip);
  const moveClipToTrack = useProjectStore((state) => state.moveVideoEditorClipToTrack);
  const updateAdjustments = useProjectStore((state) => state.updateVideoEditorClipAdjustments);
  const addEffect = useProjectStore((state) => state.addVideoEditorEffectClip);
  const updateEffect = useProjectStore((state) => state.updateVideoEditorEffectClip);
  const deleteEffects = useProjectStore((state) => state.deleteVideoEditorEffectClips);
  const selectEffect = useProjectStore((state) => state.selectVideoEditorEffectClip);
  const updateTrack = useProjectStore((state) => state.updateVideoEditorTrack);
  const reorderTrack = useProjectStore((state) => state.reorderVideoEditorTrack);
  const removeTrack = useProjectStore((state) => state.removeVideoEditorTrack);
  const closeGaps = useProjectStore((state) => state.closeVideoEditorGaps);

  const duration = useMemo(() => videoEditorTimelineDuration(settings), [settings]);
  // Con più clip selezionate si mostra l’ultima toccata: è la clip su cui agiscono
  // anche il taglio e la sincronizzazione, quindi l’inspector resta coerente col gesto.
  const selectedId = settings.selectedClipIds[settings.selectedClipIds.length - 1] ?? null;
  const clip = selectedId ? videoEditorClip(settings, selectedId) : null;
  const selectedEffectId = settings.selectedEffectClipIds[settings.selectedEffectClipIds.length - 1] ?? null;
  const effect = selectedEffectId ? settings.effectClips.find((item) => item.id === selectedEffectId) ?? null : null;
  const effectDefinition = effect ? videoEditorEffectDefinition(effect.effectId) : null;
  const effectTarget = effect?.target.kind === "clip" ? videoEditorClip(settings, effect.target.clipId) : null;
  const effectTargetAsset = effectTarget ? videoEditorAsset(settings, effectTarget.assetId) : null;
  const effectTargetTrack = effectTarget ? settings.tracks.find((item) => item.id === effectTarget.trackId) ?? null : null;
  const effectLocked = effectTargetTrack?.locked === true;
  const asset = clip ? videoEditorAsset(settings, clip.assetId) : null;
  const track = clip ? settings.tracks.find((item) => item.id === clip.trackId) ?? null : null;
  const clipLocked = track?.locked === true;
  const isVisual = asset ? asset.kind !== "audio" : false;
  const hasAudio = asset ? asset.kind === "audio" || asset.hasAudio : false;
  const maximumDuration = clip && asset ? videoEditorClipMaximumDuration(clip, asset) : 0;
  const transform = clip?.transform ?? { x: 0, y: 0, scale: 1, rotation: 0 };
  const clipEffects = clip ? settings.effectClips.filter((item) => item.target.kind === "clip" && item.target.clipId === clip.id) : [];
  const compatibleTracks = asset ? settings.tracks.filter((item) => item.kind === (asset.kind === "audio" ? "audio" : "video") && (!item.locked || item.id === clip?.trackId)) : [];

  return <aside className="panel inspector video-editor-inspector" aria-label="Inspector Video Editor">
    <h2>Progetto</h2>
    <label>Nome<input value={name} onChange={(event) => rename(event.target.value)} /></label>
    <div className="property"><span>Durata montaggio</span><output>{duration.toFixed(2)} s</output></div>
    <div className="property"><span>Composizione</span><output>{settings.outputWidth} × {settings.outputHeight}</output></div>

    {effect && effectDefinition
      ? <>
        <h2>Effetto selezionato</h2>
        <div className="watermark-pixel-readout video-editor-effect-readout">
          <strong>{effectDefinition.label}</strong>
          <span>{effect.startSeconds.toFixed(2)} → {videoEditorEffectClipEnd(effect).toFixed(2)} s · {effect.durationSeconds.toFixed(2)} s</span>
        </div>
        <div className="property"><span>Applicato a</span><output title={effectTargetAsset?.name}>{effectTargetAsset?.name ?? "Composizione"}</output></div>
        {effectLocked ? <p className="muted" role="status">Traccia bloccata · sbloccala per modificare questo effetto.</p> : null}
        <label className="teddy-dance-toggle"><span>Effetto attivo</span><input aria-label="Effetto video attivo" type="checkbox" checked={effect.enabled} disabled={effectLocked} onChange={(event) => updateEffect(effect.id, { enabled: event.target.checked })} /></label>
        {effectTarget ? <label>Posizione: {effect.startSeconds.toFixed(2)} s
          <input aria-label="Posizione effetto" type="range" min={effectTarget.startSeconds} max={Math.max(effectTarget.startSeconds, videoEditorClipEnd(effectTarget) - effect.durationSeconds)} step=".01" value={effect.startSeconds} disabled={effectLocked} onChange={(event) => updateEffect(effect.id, { startSeconds: Number(event.target.value) })} />
        </label> : null}
        <label>Durata: {effect.durationSeconds.toFixed(2)} s
          <input aria-label="Durata effetto" type="range" min={effectDefinition.minimumDurationSeconds} max={Math.max(effectDefinition.minimumDurationSeconds, Math.min(effectDefinition.maximumDurationSeconds, effectTarget ? videoEditorClipEnd(effectTarget) - effect.startSeconds : effectDefinition.maximumDurationSeconds))} step=".01" value={effect.durationSeconds} disabled={effectLocked} onChange={(event) => updateEffect(effect.id, { durationSeconds: Number(event.target.value) })} />
        </label>
        <label>Intensità: {Math.round(effect.mix * 100)}%
          <input aria-label="Intensità effetto" type="range" min="0" max="1" step=".01" value={effect.mix} disabled={effectLocked} onChange={(event) => updateEffect(effect.id, { mix: Number(event.target.value) })} />
        </label>
        {effectDefinition.parameterControls.map((control) => {
          const fallback = effectDefinition.defaultParameters[control.key];
          if (control.kind === "select") {
            return <label key={control.key}>{control.label}
              <select
                aria-label={`${control.label} effetto`}
                value={String(effect.parameters[control.key] ?? fallback ?? "")}
                disabled={effectLocked}
                onChange={(event) => updateEffect(effect.id, { parameters: { ...effect.parameters, [control.key]: event.target.value } })}
              >
                {control.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>;
          }
          const value = effectNumericParameter(effect.parameters[control.key], Number(fallback ?? 0));
          return <label key={control.key}>{control.label}: {formatEffectParameter(value, control.step, control.unit)}
            <input
              aria-label={`${control.label} effetto`}
              type="range"
              min={control.minimum}
              max={control.maximum}
              step={control.step}
              value={value}
              disabled={effectLocked}
              onChange={(event) => updateEffect(effect.id, { parameters: { ...effect.parameters, [control.key]: Number(event.target.value) } })}
            />
          </label>;
        })}
        <p className="muted">Trascina il blocco rosa nella corsia Effetti; usa i bordi per modificarne la durata.</p>
        <button type="button" className="delete-selection" disabled={effectLocked} onClick={() => deleteEffects([effect.id])}>Elimina effetto dalla timeline</button>
      </>
      : clip && asset
      ? <>
        <h2>Clip selezionata</h2>
        <div className="watermark-pixel-readout">
          <strong title={asset.name}>{asset.name}</strong>
          <span>{clip.startSeconds.toFixed(2)} → {videoEditorClipEnd(clip).toFixed(2)} s · {clip.durationSeconds.toFixed(2)} s</span>
        </div>
        {clipLocked ? <p className="muted" role="status">Traccia bloccata · sbloccala per modificare la clip.</p> : null}
        <label>Livello in timeline
          <select aria-label="Livello clip" value={clip.trackId} disabled={clipLocked} onChange={(event) => moveClipToTrack(clip.id, event.target.value)}>
            {compatibleTracks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Durata: {clip.durationSeconds.toFixed(2)} s
          <input aria-label="Durata clip" type="range" min=".05" max={Math.max(.05, maximumDuration)} step=".01" value={clip.durationSeconds} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { durationSeconds: Number(event.target.value) })} />
        </label>
        {asset.durationSeconds > 0
          ? <label>Attacco nella sorgente: {clip.sourceInSeconds.toFixed(2)} s
            <input aria-label="Attacco nella sorgente" type="range" min="0" max={Math.max(0, asset.durationSeconds - .05)} step=".01" value={clip.sourceInSeconds} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { sourceInSeconds: Number(event.target.value) })} />
          </label>
          : null}

        {isVisual ? <>
          <h2>Effetti della clip</h2>
          <div className="video-editor-effect-actions" aria-label="Aggiungi effetti alla clip">
            {videoEditorEffectCatalog.map((definition) => <button key={definition.id} type="button" disabled={clipLocked} onClick={() => addEffect(definition.id, { targetClipId: clip.id })}>＋ {definition.label}</button>)}
          </div>
          {clipEffects.length ? <div className="video-editor-clip-effects">{clipEffects.map((item) => <button key={item.id} type="button" onClick={() => selectEffect(item.id)}><span>{videoEditorEffectDefinition(item.effectId)?.label ?? item.effectId}</span><small>{item.durationSeconds.toFixed(2)} s</small></button>)}</div> : <p className="muted">Nessun effetto. Aggiungilo qui o trascinalo dalla libreria nella corsia Effetti.</p>}
        </> : null}

        {isVisual
          ? <>
            <h2>Trasforma il livello</h2>
            <div className="video-editor-transform-controls">
              <label>Posizione X: {Math.round(transform.x * 100)}%
                <input aria-label="Posizione orizzontale clip" type="range" min="-1" max="1" step=".01" value={transform.x} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { transform: { ...transform, x: Number(event.target.value) } })} />
              </label>
              <label>Posizione Y: {Math.round(transform.y * 100)}%
                <input aria-label="Posizione verticale clip" type="range" min="-1" max="1" step=".01" value={transform.y} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { transform: { ...transform, y: Number(event.target.value) } })} />
              </label>
              <label>Scala: {Math.round(transform.scale * 100)}%
                <input aria-label="Scala clip" type="range" min=".05" max="3" step=".01" value={transform.scale} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { transform: { ...transform, scale: Number(event.target.value) } })} />
              </label>
              <label>Rotazione: {Math.round(transform.rotation)}°
                <input aria-label="Rotazione clip" type="range" min="-180" max="180" step="1" value={transform.rotation} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { transform: { ...transform, rotation: Number(event.target.value) } })} />
              </label>
            </div>
            <button type="button" disabled={clipLocked || (transform.x === 0 && transform.y === 0 && transform.scale === 1 && transform.rotation === 0)} onClick={() => updateClip(clip.id, { transform: { x: 0, y: 0, scale: 1, rotation: 0 } })}>Ripristina trasformazione</button>

            <h2>Fusione</h2>
            <label>Modalità
              <select aria-label="Modalità di fusione" value={clip.blendMode} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { blendMode: event.target.value as typeof clip.blendMode })}>
                {videoEditorBlendModes.map((mode) => <option key={mode} value={mode}>{videoEditorBlendModeLabel(mode)}</option>)}
              </select>
            </label>
            <label>Intensità fusione: {Math.round(clip.blendIntensity * 100)}%
              <input aria-label="Intensità fusione" type="range" min="0" max="1" step=".01" value={clip.blendIntensity} disabled={clipLocked || clip.blendMode === "normal"} onChange={(event) => updateClip(clip.id, { blendIntensity: Number(event.target.value) })} />
            </label>
            <label>Opacità: {Math.round(clip.adjustments.opacity * 100)}%
              <input aria-label="Opacità clip" type="range" min="0" max="1" step=".01" value={clip.adjustments.opacity} disabled={clipLocked} onChange={(event) => updateAdjustments(clip.id, { opacity: Number(event.target.value) })} />
            </label>
            <label>Adattamento
              <select aria-label="Adattamento clip" value={clip.fit} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { fit: event.target.value as typeof clip.fit })}>
                {(Object.keys(fitLabels) as Array<keyof typeof fitLabels>).map((fit) => <option key={fit} value={fit}>{fitLabels[fit]}</option>)}
              </select>
            </label>

            <h2>Regolazioni immagine</h2>
            <div className="video-editor-look-presets" aria-label="Preset immagine">
              <button type="button" disabled={clipLocked} onClick={() => updateAdjustments(clip.id, { exposure: .06, contrast: 8, saturation: 5, vibrance: 7, sharpness: 8 })}>Clean boost</button>
              <button type="button" disabled={clipLocked} onClick={() => updateAdjustments(clip.id, { exposure: 0, contrast: 10, highlights: -14, shadows: 9, saturation: -5, temperature: 5, sharpness: 5 })}>Soft film</button>
              <button type="button" disabled={clipLocked} onClick={() => updateAdjustments(clip.id, { exposure: .03, contrast: 18, highlights: -6, shadows: -4, vibrance: 14, sharpness: 16 })}>Punch</button>
            </div>
            <div className="video-editor-adjustments">
              {adjustmentControls.map((control) => <label key={control.key}>{control.label}: {control.step < 1 ? clip.adjustments[control.key].toFixed(2) : clip.adjustments[control.key]}{control.unit ?? ""}
                <input aria-label={`${control.label} clip`} type="range" min={control.minimum} max={control.maximum} step={control.step} value={clip.adjustments[control.key]} disabled={clipLocked} onChange={(event) => updateAdjustments(clip.id, { [control.key]: Number(event.target.value) })} />
              </label>)}
            </div>
            <button type="button" disabled={clipLocked || (videoEditorAdjustmentsAreNeutral(clip.adjustments) && clip.adjustments.opacity === 1)} onClick={() => updateAdjustments(clip.id, neutralAdjustments)}>Ripristina regolazioni</button>
          </>
          : null}

        {hasAudio
          ? <>
            <h2>Audio della clip</h2>
            <label className="teddy-dance-toggle"><span>Audio disattivato</span><input aria-label="Disattiva audio clip" type="checkbox" checked={clip.muted} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { muted: event.target.checked })} /></label>
            <label>Volume: {Math.round(clip.volume * 100)}%
              <input aria-label="Volume clip" type="range" min="0" max="2" step=".01" value={clip.volume} disabled={clipLocked || clip.muted} onChange={(event) => updateClip(clip.id, { volume: Number(event.target.value) })} />
            </label>
            {asset.bpm ? <div className="property"><span>Ritmo rilevato</span><output>{asset.bpm.toFixed(1)} BPM · {asset.beats.length} battute</output></div> : <p className="muted">Analizza le battute nel pool media per sincronizzare e agganciare al ritmo.</p>}
          </>
          : null}
        {track ? <div className="property"><span>Livello attivo</span><output>{track.name}</output></div> : null}
      </>
      : <p className="muted">Seleziona una clip in timeline per regolare dissolvenze, fusione, colore e audio.</p>}

    <h2>Livelli e tracce</h2>
    <p className="muted">Riordina i livelli: quello più in alto viene composto sopra gli altri. Nessun livello video ha un ruolo principale o overlay.</p>
    <ul className="video-editor-track-list">
      {settings.tracks.map((item, index) => <li key={item.id} className="video-editor-track-row">
        <input aria-label={`Nome traccia ${item.name}`} value={item.name} onChange={(event) => updateTrack(item.id, { name: event.target.value })} />
        <div className="track-row-toggles">
          {item.kind === "video" ? <button type="button" className={item.hidden ? "toggle-off" : "toggle-on"} title="Mostra o nascondi la traccia" onClick={() => updateTrack(item.id, { hidden: !item.hidden })}>{item.hidden ? "Nascosta" : "Visibile"}</button> : null}
          <button type="button" className={item.muted ? "toggle-off" : "toggle-on"} title="Attiva o disattiva l’audio della traccia" onClick={() => updateTrack(item.id, { muted: !item.muted })}>{item.muted ? "Muta" : "Audio"}</button>
          <button type="button" className={item.locked ? "toggle-off" : "toggle-on"} title="Blocca la traccia contro le modifiche" onClick={() => updateTrack(item.id, { locked: !item.locked })}>{item.locked ? "Bloccata" : "Libera"}</button>
        </div>
        <label>Volume: {Math.round(item.volume * 100)}%
          <input aria-label={`Volume traccia ${item.name}`} type="range" min="0" max="2" step=".01" value={item.volume} onChange={(event) => updateTrack(item.id, { volume: Number(event.target.value) })} />
        </label>
        <div className="track-row-actions">
          <button type="button" aria-label={`Sposta su ${item.name}`} disabled={item.locked || index === 0 || settings.tracks[index - 1]?.locked} onClick={() => reorderTrack(item.id, index - 1)}>↑ Porta su</button>
          <button type="button" aria-label={`Sposta giù ${item.name}`} disabled={item.locked || index === settings.tracks.length - 1 || settings.tracks[index + 1]?.locked} onClick={() => reorderTrack(item.id, index + 1)}>↓ Porta giù</button>
          <button type="button" disabled={item.locked} onClick={() => closeGaps(item.id)}>Chiudi i vuoti</button>
          <button type="button" disabled={item.locked || settings.tracks.length <= 1} onClick={() => removeTrack(item.id)}>Elimina traccia</button>
        </div>
      </li>)}
    </ul>
  </aside>;
}
