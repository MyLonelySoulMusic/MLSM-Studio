import { useMemo, useState } from "react";
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
import { videoEditorSecondsToFrame } from "../services/video-editor";
import { videoEditorSpeedAtFrame, videoEditorSpeedWithPointBezier, videoEditorSpeedWithPointCurve } from "../services/video-editor-speed";
import { useVideoEditorPlayback } from "../store/video-editor-playback-store";
import { defaultVideoEditorImageShadow, videoEditorImageShadowStyles, type VideoEditorImageShadow } from "../services/video-editor-image-shadow";

interface AdjustmentControl { key: keyof VideoEditorAdjustments; label: string; minimum: number; maximum: number; step: number; unit?: string }
interface NormalizedBezier { x1: number; y1: number; x2: number; y2: number }

const defaultBezier: NormalizedBezier = { x1: .33, y1: .33, x2: .67, y2: .67 };
const automationCurveOptions = [
  ["hold", "Mantieni"], ["linear", "Lineare"], ["exponential", "Esponenziale"],
  ["logarithmic", "Logaritmica"], ["custom", "Custom Bézier"]
] as const;

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
const imageShadowLabels = { drop: "Ombra morbida", glow: "Bagliore", long: "Ombra lunga" } as const;

function effectNumericParameter(value: number | string | boolean | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatEffectParameter(value: number, step = 1, unit = ""): string {
  const decimals = step < .01 ? 3 : step < 1 ? 2 : 0;
  return `${value.toFixed(decimals)}${unit}`;
}

function NormalizedBezierControls({ value, label, disabled, onChange }: { value: NormalizedBezier; label: string; disabled?: boolean; onChange: (value: NormalizedBezier) => void }) {
  return <fieldset className="video-editor-custom-curve"><legend>{label}</legend>{(["x1", "y1", "x2", "y2"] as const).map((key) => <label key={key}>{key}<input aria-label={`${label} ${key}`} type="number" min="0" max="1" step=".01" value={value[key]} disabled={disabled} onChange={(event) => {
    const nextValue = Math.max(0, Math.min(1, Number(event.target.value)));
    onChange({ ...value, [key]: nextValue, ...(key === "x1" && nextValue > value.x2 ? { x2: nextValue } : {}), ...(key === "x2" && nextValue < value.x1 ? { x1: nextValue } : {}) });
  }} /></label>)}</fieldset>;
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
  const upsertKeyframe = useProjectStore((state) => state.upsertVideoEditorKeyframe);

  const duration = useMemo(() => videoEditorTimelineDuration(settings), [settings]);
  const currentTime = useVideoEditorPlayback((state) => state.currentTime);
  const [automationCurve, setAutomationCurve] = useState<"linear" | "exponential" | "logarithmic" | "custom">("linear");
  const [customCurve, setCustomCurve] = useState<NormalizedBezier>(defaultBezier);
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
  const isImage = asset?.kind === "image";
  const isVideo = asset?.kind === "video";
  const hasAudio = asset ? asset.kind === "audio" || asset.hasAudio : false;
  const maximumDuration = clip && asset ? videoEditorClipMaximumDuration(clip, asset, settings.timebase) : 0;
  const transform = clip?.transform ?? { x: 0, y: 0, scale: 1, rotation: 0 };
  const imageShadow: VideoEditorImageShadow = clip?.imageShadow ?? defaultVideoEditorImageShadow;
  const clipEffects = clip ? settings.effectClips.filter((item) => item.target.kind === "clip" && item.target.clipId === clip.id) : [];
  const compatibleTracks = asset ? settings.tracks.filter((item) => item.kind === (asset.kind === "audio" ? "audio" : "video") && (!item.locked || item.id === clip?.trackId)) : [];
  const selectedAutomationLanes = settings.automationLanes.filter((lane) => effect
    ? lane.target.kind === "effect" && lane.target.effectId === effect.id
    : clip ? lane.target.kind === "clip" && lane.target.clipId === clip.id : false);
  const keyframeBezier = automationCurve === "custom" ? { bezier: customCurve } : {};
  const addKeyframe = (property: string, value: number) => {
    if (!clip) return;
    const frame = videoEditorSecondsToFrame(currentTime, settings.timebase);
    upsertKeyframe({ kind: "clip", clipId: clip.id, property }, { id: `keyframe-${crypto.randomUUID()}`, frame, value, curve: automationCurve, ...keyframeBezier });
  };
  const addEffectKeyframe = (property: string, value: number) => {
    if (!effect) return;
    const frame = videoEditorSecondsToFrame(currentTime, settings.timebase);
    upsertKeyframe({ kind: "effect", effectId: effect.id, property }, { id: `keyframe-${crypto.randomUUID()}`, frame, value, curve: automationCurve, ...keyframeBezier });
  };
  const addSpeedPoint = () => {
    if (!clip) return;
    const frame = Math.max(0, videoEditorSecondsToFrame(currentTime - clip.startSeconds, settings.timebase));
    const current = clip.speed ?? { mode: "constant" as const, constant: 1, points: [], preservePitch: false };
    const speed = videoEditorSpeedAtFrame(current, frame);
    updateClip(clip.id, { speed: { ...current, mode: "ramp", points: [...current.points.filter((point) => point.frame !== frame), { id: `speed-${crypto.randomUUID()}`, frame, speed, curve: automationCurve, ...keyframeBezier }].sort((left, right) => left.frame - right.frame) } });
  };

  return <aside className="panel inspector video-editor-inspector" aria-label="Inspector Video Editor">
    <h2>Progetto</h2>
    <label>Nome<input value={name} onChange={(event) => rename(event.target.value)} /></label>
    <div className="property"><span>Durata montaggio</span><output>{duration.toFixed(2)} s</output></div>
    <div className="property"><span>Composizione</span><output>{settings.outputWidth} × {settings.outputHeight}</output></div>
    <label>Curva nuovo punto<select aria-label="Curva automazione" value={automationCurve} onChange={(event) => setAutomationCurve(event.target.value as typeof automationCurve)}>{automationCurveOptions.filter(([value]) => value !== "hold").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {automationCurve === "custom" ? <NormalizedBezierControls label="Curva Bézier nuovo segmento" value={customCurve} onChange={setCustomCurve} /> : null}
    {selectedAutomationLanes.some((lane) => lane.keyframes.length > 1) ? <><h2>Segmenti automazione</h2>{selectedAutomationLanes.map((lane) => {
      const points = [...lane.keyframes].sort((left, right) => left.frame - right.frame);
      return points.slice(1).map((right, index) => <fieldset key={`${lane.id}-${right.id}`}><legend>{lane.target.property} · {points[index]!.frame} → {right.frame}</legend><label>Curva<select aria-label={`Curva ${lane.target.property} segmento ${points[index]!.frame}-${right.frame}`} value={right.curve} disabled={effect ? effectLocked : clipLocked} onChange={(event) => upsertKeyframe(lane.target, { ...right, curve: event.target.value as typeof right.curve, ...(event.target.value === "custom" ? { bezier: right.bezier ?? defaultBezier } : {}) })}>{automationCurveOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{right.curve === "custom" || right.curve === "bezier" ? <NormalizedBezierControls label={`Bézier ${lane.target.property} ${points[index]!.frame}-${right.frame}`} value={right.bezier ?? defaultBezier} disabled={effect ? effectLocked : clipLocked} onChange={(bezier) => upsertKeyframe(lane.target, { ...right, bezier })} /> : null}</fieldset>);
    })}</> : null}

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
          <span className="video-editor-automation-control"><input aria-label="Intensità effetto" type="range" min="0" max="1" step=".01" value={effect.mix} disabled={effectLocked} onChange={(event) => updateEffect(effect.id, { mix: Number(event.target.value) })} /><button type="button" className="video-editor-keyframe" aria-label="Aggiungi keyframe intensità effetto" disabled={effectLocked} onClick={() => addEffectKeyframe("mix", effect.mix)}>◆</button></span>
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
            <span className="video-editor-automation-control"><input
              aria-label={`${control.label} effetto`}
              type="range"
              min={control.minimum}
              max={control.maximum}
              step={control.step}
              value={value}
              disabled={effectLocked}
              onChange={(event) => updateEffect(effect.id, { parameters: { ...effect.parameters, [control.key]: Number(event.target.value) } })}
            /><button type="button" className="video-editor-keyframe" aria-label={`Aggiungi keyframe ${control.label} effetto`} disabled={effectLocked} onClick={() => addEffectKeyframe(`parameters.${control.key}`, value)}>◆</button></span>
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
        {isImage ? <p className="muted video-editor-image-duration-hint">Fermo immagine · trascina il bordo destro nella timeline per estenderlo fino a 1 ora.</p> : null}
        {isVideo ? <>
          <h2>Velocità</h2>
          <label>Velocità costante: {(clip.speed?.constant ?? 1).toFixed(2)}×
            <input aria-label="Velocità clip" type="range" min=".1" max="8" step=".05" value={clip.speed?.constant ?? 1} disabled={clipLocked} onChange={(event) => { const constant = Number(event.target.value); updateClip(clip.id, { speed: { ...(clip.speed ?? { mode: "constant", constant: 1, points: [], preservePitch: false }), mode: "constant", constant, preservePitch: constant === 1 ? (clip.speed?.preservePitch ?? false) : false } }); }} />
          </label>
          <button type="button" disabled={clipLocked} onClick={addSpeedPoint}>Aggiungi punto rampa</button>
          <div className="property"><span>Modalità velocità</span><output>{clip.speed?.mode === "ramp" ? `Rampa · ${clip.speed.points.length} punti` : "Costante"}</output></div>
          <label className="teddy-dance-toggle"><span>Preserva altezza audio</span><input aria-label="Preserva altezza audio" type="checkbox" checked={clip.speed?.preservePitch ?? false} disabled={clipLocked || clip.speed?.mode === "ramp" || Math.abs((clip.speed?.constant ?? 1) - 1) > 1e-6} onChange={(event) => updateClip(clip.id, { speed: { ...(clip.speed ?? { mode: "constant", constant: 1, points: [], preservePitch: false }), preservePitch: event.target.checked } })} /></label>
          <p className="muted">A velocità diversa da 1× il pitch segue la velocità in preview ed export. La preservazione dell’altezza è disabilitata perché questa build non include un time-stretch DSP.</p>
          {clip.speed?.mode === "ramp" ? <div className="video-editor-speed-points" aria-label="Punti rampa velocità">{[...clip.speed.points].sort((left, right) => left.frame - right.frame).map((point, index, points) => <div key={point.id}><label>Frame {point.frame}<input aria-label={`Velocità punto ${point.frame}`} type="number" min=".1" max="8" step=".05" value={point.speed} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { speed: { ...clip.speed!, points: clip.speed!.points.map((candidate) => candidate.id === point.id ? { ...candidate, speed: Math.max(.1, Math.min(8, Number(event.target.value))) } : candidate) } })} /><button type="button" aria-label={`Elimina punto velocità ${point.frame}`} disabled={clipLocked} onClick={() => updateClip(clip.id, { speed: { ...clip.speed!, points: clip.speed!.points.filter((candidate) => candidate.id !== point.id) } })}>×</button></label>{index > 0 ? <fieldset><legend>Segmento {points[index - 1]!.frame} → {point.frame}</legend><label>Curva<select aria-label={`Curva velocità segmento ${points[index - 1]!.frame}-${point.frame}`} value={point.curve} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { speed: videoEditorSpeedWithPointCurve(clip.speed!, point.id, event.target.value as typeof point.curve, defaultBezier) })}>{automationCurveOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{point.curve === "custom" || point.curve === "bezier" ? <NormalizedBezierControls label={`Bézier velocità ${points[index - 1]!.frame}-${point.frame}`} value={point.bezier ?? defaultBezier} disabled={clipLocked} onChange={(bezier) => updateClip(clip.id, { speed: videoEditorSpeedWithPointBezier(clip.speed!, point.id, bezier) })} /> : null}</fieldset> : null}</div>)}</div> : null}
        </> : null}
        {isVideo && asset.durationSeconds > 0
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
                <span className="video-editor-automation-control"><input aria-label="Posizione orizzontale clip" type="range" min="-1" max="1" step=".01" value={transform.x} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { transform: { ...transform, x: Number(event.target.value) } })} /><button type="button" className="video-editor-keyframe" aria-label="Aggiungi keyframe posizione X" disabled={clipLocked} onClick={() => addKeyframe("transform.x", transform.x)}>◆</button></span>
              </label>
              <label>Posizione Y: {Math.round(transform.y * 100)}%
                <span className="video-editor-automation-control"><input aria-label="Posizione verticale clip" type="range" min="-1" max="1" step=".01" value={transform.y} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { transform: { ...transform, y: Number(event.target.value) } })} /><button type="button" className="video-editor-keyframe" aria-label="Aggiungi keyframe posizione Y" disabled={clipLocked} onClick={() => addKeyframe("transform.y", transform.y)}>◆</button></span>
              </label>
              <label>Scala: {Math.round(transform.scale * 100)}%
                <span className="video-editor-automation-control"><input aria-label="Scala clip" type="range" min=".05" max="3" step=".01" value={transform.scale} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { transform: { ...transform, scale: Number(event.target.value) } })} /><button type="button" className="video-editor-keyframe" aria-label="Aggiungi keyframe scala" disabled={clipLocked} onClick={() => addKeyframe("transform.scale", transform.scale)}>◆</button></span>
              </label>
              <label>Rotazione: {Math.round(transform.rotation)}°
                <span className="video-editor-automation-control"><input aria-label="Rotazione clip" type="range" min="-180" max="180" step="1" value={transform.rotation} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { transform: { ...transform, rotation: Number(event.target.value) } })} /><button type="button" className="video-editor-keyframe" aria-label="Aggiungi keyframe rotazione" disabled={clipLocked} onClick={() => addKeyframe("transform.rotation", transform.rotation)}>◆</button></span>
              </label>
            </div>
            <button type="button" disabled={clipLocked || (transform.x === 0 && transform.y === 0 && transform.scale === 1 && transform.rotation === 0)} onClick={() => updateClip(clip.id, { transform: { x: 0, y: 0, scale: 1, rotation: 0 } })}>Ripristina trasformazione</button>

            {isImage ? <>
              <h2>Ombra immagine</h2>
              <label className="teddy-dance-toggle"><span>Attiva ombra PNG</span><input aria-label="Attiva ombra immagine" type="checkbox" checked={imageShadow.enabled} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { imageShadow: { ...imageShadow, enabled: event.target.checked } })} /></label>
              {imageShadow.enabled ? <>
                <label>Tipo ombra
                  <select aria-label="Tipo ombra immagine" value={imageShadow.style} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { imageShadow: { ...imageShadow, style: event.target.value as VideoEditorImageShadow["style"] } })}>
                    {videoEditorImageShadowStyles.map((style) => <option key={style} value={style}>{imageShadowLabels[style]}</option>)}
                  </select>
                </label>
                <label>Colore ombra<input aria-label="Colore ombra immagine" type="color" value={/^#[0-9a-f]{6}$/i.test(imageShadow.color) ? imageShadow.color : "#000000"} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { imageShadow: { ...imageShadow, color: event.target.value } })} /></label>
                <label>Intensità: {Math.round(imageShadow.opacity * 100)}%
                  <input aria-label="Intensità ombra immagine" type="range" min="0" max="1" step=".01" value={imageShadow.opacity} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { imageShadow: { ...imageShadow, opacity: Number(event.target.value) } })} />
                </label>
                <label>Diffusione: {Math.round(imageShadow.blur * 100)}%
                  <input aria-label="Diffusione ombra immagine" type="range" min="0" max=".4" step=".005" value={imageShadow.blur} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { imageShadow: { ...imageShadow, blur: Number(event.target.value) } })} />
                </label>
                {imageShadow.style !== "glow" ? <label>Distanza: {Math.round(imageShadow.distance * 100)}%
                  <input aria-label="Distanza ombra immagine" type="range" min="0" max=".5" step=".005" value={imageShadow.distance} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { imageShadow: { ...imageShadow, distance: Number(event.target.value) } })} />
                </label> : null}
                {imageShadow.style !== "glow" ? <label>Direzione: {Math.round(imageShadow.angle)}°
                  <input aria-label="Direzione ombra immagine" type="range" min="-180" max="180" step="1" value={imageShadow.angle} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { imageShadow: { ...imageShadow, angle: Number(event.target.value) } })} />
                </label> : null}
              </> : <p className="muted">Disattivata. L’ombra usa l’alpha originale e può uscire dai bordi dell’immagine.</p>}
            </> : null}

            <h2>Fusione</h2>
            <label>Modalità
              <select aria-label="Modalità di fusione" value={clip.blendMode} disabled={clipLocked} onChange={(event) => updateClip(clip.id, { blendMode: event.target.value as typeof clip.blendMode })}>
                {videoEditorBlendModes.map((mode) => <option key={mode} value={mode}>{videoEditorBlendModeLabel(mode)}</option>)}
              </select>
            </label>
            <label>Intensità fusione: {Math.round(clip.blendIntensity * 100)}%
              <span className="video-editor-automation-control"><input aria-label="Intensità fusione" type="range" min="0" max="1" step=".01" value={clip.blendIntensity} disabled={clipLocked || clip.blendMode === "normal"} onChange={(event) => updateClip(clip.id, { blendIntensity: Number(event.target.value) })} /><button type="button" className="video-editor-keyframe" aria-label="Aggiungi keyframe intensità fusione" disabled={clipLocked} onClick={() => addKeyframe("blendIntensity", clip.blendIntensity)}>◆</button></span>
            </label>
            <label>Opacità: {Math.round(clip.adjustments.opacity * 100)}%
              <span className="video-editor-automation-control"><input aria-label="Opacità clip" type="range" min="0" max="1" step=".01" value={clip.adjustments.opacity} disabled={clipLocked} onChange={(event) => updateAdjustments(clip.id, { opacity: Number(event.target.value) })} /><button type="button" className="video-editor-keyframe" aria-label="Aggiungi keyframe opacità" disabled={clipLocked} onClick={() => addKeyframe("adjustments.opacity", clip.adjustments.opacity)}>◆</button></span>
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
                <span className="video-editor-automation-control"><input aria-label={`${control.label} clip`} type="range" min={control.minimum} max={control.maximum} step={control.step} value={clip.adjustments[control.key]} disabled={clipLocked} onChange={(event) => updateAdjustments(clip.id, { [control.key]: Number(event.target.value) })} /><button type="button" className="video-editor-keyframe" aria-label={`Aggiungi keyframe ${control.label}`} disabled={clipLocked} onClick={() => addKeyframe(`adjustments.${String(control.key)}`, Number(clip.adjustments[control.key]))}>◆</button></span>
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
              <span className="video-editor-automation-control"><input aria-label="Volume clip" type="range" min="0" max="2" step=".01" value={clip.volume} disabled={clipLocked || clip.muted} onChange={(event) => updateClip(clip.id, { volume: Number(event.target.value) })} /><button type="button" className="video-editor-keyframe" aria-label="Aggiungi keyframe volume" disabled={clipLocked || clip.muted} onClick={() => addKeyframe("volume", clip.volume)}>◆</button></span>
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
