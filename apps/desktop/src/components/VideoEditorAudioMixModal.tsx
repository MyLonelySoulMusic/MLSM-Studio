import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useProjectStore } from "../store/project-store";
import { requestVideoEditorTransport, useVideoEditorPlayback } from "../store/video-editor-playback-store";
import { videoEditorFrameToSeconds, videoEditorSecondsToFrame } from "../services/video-editor";
import { resolveVideoEditorAutomationValue, type VideoEditorKeyframe } from "../services/video-editor-automation";
import {
  defaultVideoEditorAudioMix,
  videoEditorAudioAutomationProperties,
  videoEditorAudioMix,
  videoEditorAudioMixValue,
  videoEditorAudioMixWithValue,
  videoEditorAutomaticAudioFadeSeconds,
  type VideoEditorAudioAutomationProperty
} from "../services/video-editor-audio-mix";

interface Props { clipId: string; onClose: () => void }

function displayValue(property: VideoEditorAudioAutomationProperty, value: number): string {
  if (property.key === "volume") return `${Math.round(value * 100)}%`;
  if (property.key === "audioMix.pan") return Math.abs(value) < .005 ? "C" : `${value < 0 ? "L" : "R"} ${Math.round(Math.abs(value) * 100)}`;
  return `${Number(value.toFixed(property.step < 1 ? 1 : 0))}${property.unit ? ` ${property.unit}` : ""}`;
}

export function VideoEditorAudioMixModal({ clipId, onClose }: Props) {
  const settings = useProjectStore((state) => state.project.animation.videoEditor);
  const updateClip = useProjectStore((state) => state.updateVideoEditorClip);
  const updateSettings = useProjectStore((state) => state.updateVideoEditor);
  const upsertKeyframe = useProjectStore((state) => state.upsertVideoEditorKeyframe);
  const removeKeyframe = useProjectStore((state) => state.removeVideoEditorKeyframe);
  const currentTime = useVideoEditorPlayback((state) => state.currentTime);
  const playing = useVideoEditorPlayback((state) => state.playing);
  const setCurrentTime = useVideoEditorPlayback((state) => state.setCurrentTime);
  const clip = settings.clips.find((candidate) => candidate.id === clipId) ?? null;
  const asset = clip ? settings.assets.find((candidate) => candidate.id === clip.assetId) ?? null : null;
  const [envelopeProperty, setEnvelopeProperty] = useState("volume");
  const [curve, setCurve] = useState<"linear" | "easeIn" | "easeOut" | "easeInOut" | "hold">("easeInOut");
  const dialogRef = useRef<HTMLElement>(null);
  const property = videoEditorAudioAutomationProperties.find((candidate) => candidate.key === envelopeProperty) ?? videoEditorAudioAutomationProperties[0]!;
  const target = clip ? { kind: "clip" as const, clipId: clip.id, property: property.key } : null;
  const lane = target ? settings.automationLanes.find((candidate) => candidate.target.kind === "clip" && candidate.target.clipId === clipId && candidate.target.property === property.key) : null;
  const points = useMemo(() => [...(lane?.keyframes ?? [])].sort((left, right) => left.frame - right.frame), [lane]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [clipId]);

  if (!clip) return null;
  const mix = videoEditorAudioMix(clip);
  const clipStartFrame = videoEditorSecondsToFrame(clip.startSeconds, settings.timebase);
  const clipEndFrame = videoEditorSecondsToFrame(clip.startSeconds + clip.durationSeconds, settings.timebase);
  const clipFrameSpan = Math.max(1, clipEndFrame - clipStartFrame);
  const valueSpan = Math.max(1e-6, property.maximum - property.minimum);
  const pointX = (frame: number) => Math.min(100, Math.max(0, (frame - clipStartFrame) / clipFrameSpan * 100));
  const pointY = (value: number) => 100 - Math.min(100, Math.max(0, (value - property.minimum) / valueSpan * 100));
  const line = Array.from({ length: 201 }, (_, index) => {
    const frame = clipStartFrame + index / 200 * clipFrameSpan;
    const value = target ? resolveVideoEditorAutomationValue(settings.automationLanes, target, frame, videoEditorAudioMixValue(clip, property.key)) : 0;
    return `${index / 2},${pointY(value)}`;
  }).join(" ");

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    // Keep timeline shortcuts (Delete, Space, arrows) out of this editing dialog.
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']") ?? [])];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const setProperty = (key: string, value: number) => updateClip(clip.id, videoEditorAudioMixWithValue(clip, key, value));
  const togglePreview = () => {
    if (!playing && (currentTime < clip.startSeconds || currentTime >= clip.startSeconds + clip.durationSeconds)) setCurrentTime(clip.startSeconds);
    requestVideoEditorTransport("toggle");
  };
  const addEnvelopePoint = (frame: number, value: number, key = envelopeProperty) => {
    const definition = videoEditorAudioAutomationProperties.find((candidate) => candidate.key === key) ?? property;
    const clampedFrame = Math.round(Math.min(clipEndFrame, Math.max(clipStartFrame, frame)));
    const clampedValue = Math.min(definition.maximum, Math.max(definition.minimum, value));
    upsertKeyframe({ kind: "clip", clipId: clip.id, property: definition.key }, {
      id: `audio-keyframe-${crypto.randomUUID()}`,
      frame: clampedFrame,
      value: clampedValue,
      curve
    });
  };
  const editPoint = (point: VideoEditorKeyframe, patch: Partial<VideoEditorKeyframe>) => {
    if (!target) return;
    const next = { ...point, ...patch };
    if (!Number.isFinite(next.frame) || !Number.isFinite(next.value)) return;
    next.frame = Math.round(Math.min(clipEndFrame, Math.max(clipStartFrame, next.frame)));
    next.value = Math.min(property.maximum, Math.max(property.minimum, next.value));
    if (next.frame !== point.frame) removeKeyframe(target, point.frame);
    upsertKeyframe(target, next);
  };
  const addAtPlayhead = () => addEnvelopePoint(
    videoEditorSecondsToFrame(Math.min(clip.startSeconds + clip.durationSeconds, Math.max(clip.startSeconds, currentTime)), settings.timebase),
    videoEditorAudioMixValue(clip, envelopeProperty)
  );
  const editEnvelope = (event: ReactMouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / Math.max(1, bounds.height)));
    addEnvelopePoint(clipStartFrame + x * clipFrameSpan, property.maximum - y * valueSpan);
  };
  const changeFadeMode = (mode: typeof mix.fadeMode) => {
    if (mode === mix.fadeMode) return;
    if (mix.fadeMode === "envelope" && mode !== "envelope") {
      // Only remove the preset's own points; preserve manually authored volume automation.
      const volumeLane = settings.automationLanes.find((candidate) => candidate.target.kind === "clip" && candidate.target.clipId === clip.id && candidate.target.property === "volume");
      for (const point of volumeLane?.keyframes ?? []) if (point.id.startsWith("audio-fade-")) removeKeyframe(volumeLane!.target, point.frame);
    }
    if (mode === "automatic") {
      const seconds = videoEditorAutomaticAudioFadeSeconds(clip.durationSeconds);
      updateClip(clip.id, { audioMix: { ...mix, fadeMode: mode }, audioFadeInSeconds: seconds, audioFadeOutSeconds: seconds });
      return;
    }
    if (mode === "envelope") {
      updateClip(clip.id, { audioMix: { ...mix, fadeMode: mode }, audioFadeInSeconds: 0, audioFadeOutSeconds: 0 });
      const existingVolume = settings.automationLanes.find((candidate) => candidate.target.kind === "clip" && candidate.target.clipId === clip.id && candidate.target.property === "volume");
      if (existingVolume?.keyframes.length) { setEnvelopeProperty("volume"); return; }
      const edge = Math.min(.5, clip.durationSeconds / 4);
      const values: [number, number][] = [
        [clip.startSeconds, 0], [clip.startSeconds + edge, clip.volume],
        [clip.startSeconds + clip.durationSeconds - edge, clip.volume], [clip.startSeconds + clip.durationSeconds, 0]
      ];
      for (const [seconds, value] of values) upsertKeyframe({ kind: "clip", clipId: clip.id, property: "volume" }, {
        id: `audio-fade-${crypto.randomUUID()}`,
        frame: videoEditorSecondsToFrame(seconds, settings.timebase), value, curve: "easeInOut"
      });
      setEnvelopeProperty("volume");
      return;
    }
    updateClip(clip.id, { audioMix: { ...mix, fadeMode: mode } });
  };
  const slider = (definition: VideoEditorAudioAutomationProperty) => {
    const value = videoEditorAudioMixValue(clip, definition.key);
    return <label className="video-editor-audio-control" key={definition.key}>
      <span><b>{definition.label}</b><output>{displayValue(definition, value)}</output></span>
      <span className="video-editor-audio-slider-row">
        <input type="range" aria-label={definition.label} min={definition.minimum} max={definition.maximum} step={definition.step} value={value} onChange={(event) => setProperty(definition.key, Number(event.target.value))} />
        <button type="button" aria-label={`Aggiungi keyframe ${definition.label}`} title={`Aggiungi ${definition.label} all’inviluppo sul playhead`} onClick={() => { setEnvelopeProperty(definition.key); addEnvelopePoint(videoEditorSecondsToFrame(currentTime, settings.timebase), value, definition.key); }}>◆</button>
      </span>
    </label>;
  };
  const sectionProperties = (section: VideoEditorAudioAutomationProperty["section"]) => videoEditorAudioAutomationProperties.filter((candidate) => candidate.section === section);

  return <div className="video-editor-audio-mix-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="video-editor-audio-mix-modal" role="dialog" aria-modal="true" aria-labelledby="video-editor-audio-mix-title" onKeyDown={handleKeyDown}>
      <header>
        <div><small>MIX AUDIO · {asset?.kind === "video" ? "VIDEO" : "TRACCIA AUDIO"}</small><h2 id="video-editor-audio-mix-title">{asset?.name ?? "Clip"}</h2><p>Regola il suono e anima ogni parametro con inviluppi a keyframe.</p></div>
        <button type="button" className="video-editor-audio-mix-close" aria-label="Chiudi Mix audio" onClick={onClose}>×</button>
      </header>
      <div className="video-editor-audio-mix-body">
        <div className="video-editor-audio-mix-controls">
          <fieldset><legend>Livello e panorama</legend>{sectionProperties("Livello").map(slider)}</fieldset>
          <fieldset>
            <legend><span>Equalizzatore a 3 bande</span><label className="video-editor-audio-switch"><input type="checkbox" aria-label="Attiva equalizzatore" checked={mix.eq.enabled} onChange={(event) => updateClip(clip.id, { audioMix: { ...mix, eq: { ...mix.eq, enabled: event.target.checked } } })} /><i /></label></legend>
            <fieldset className={mix.eq.enabled ? "audio-effect-parameters" : "audio-effect-parameters is-disabled"} disabled={!mix.eq.enabled}>{sectionProperties("Equalizzatore").map(slider)}</fieldset>
          </fieldset>
          <fieldset>
            <legend><span>Compressore</span><label className="video-editor-audio-switch"><input type="checkbox" aria-label="Attiva compressore" checked={mix.compressor.enabled} onChange={(event) => updateClip(clip.id, { audioMix: { ...mix, compressor: { ...mix.compressor, enabled: event.target.checked } } })} /><i /></label></legend>
            <fieldset className={mix.compressor.enabled ? "audio-effect-parameters" : "audio-effect-parameters is-disabled"} disabled={!mix.compressor.enabled}>{sectionProperties("Compressore").map(slider)}</fieldset>
          </fieldset>
          <fieldset className="video-editor-audio-fades"><legend>Dissolvenza</legend>
            <div className="video-editor-audio-segmented" role="group" aria-label="Modalità dissolvenza">
              <button type="button" aria-pressed={mix.fadeMode === "automatic"} onClick={() => changeFadeMode("automatic")}>Automatica</button>
              <button type="button" aria-pressed={mix.fadeMode === "manual"} onClick={() => changeFadeMode("manual")}>Fade in / out</button>
              <button type="button" aria-pressed={mix.fadeMode === "envelope"} onClick={() => changeFadeMode("envelope")}>Inviluppo</button>
            </div>
            {mix.fadeMode === "automatic" ? <p>Fade morbido calcolato sulla durata della clip: {videoEditorAutomaticAudioFadeSeconds(clip.durationSeconds).toFixed(2)} s.</p> : null}
            {mix.fadeMode === "manual" ? <div className="video-editor-audio-fade-fields">
              <label>Fade in <input type="number" min="0" max={clip.durationSeconds} step=".05" value={clip.audioFadeInSeconds} onChange={(event) => updateClip(clip.id, { audioFadeInSeconds: Number(event.target.value) })} /></label>
              <label>Fade out <input type="number" min="0" max={clip.durationSeconds} step=".05" value={clip.audioFadeOutSeconds} onChange={(event) => updateClip(clip.id, { audioFadeOutSeconds: Number(event.target.value) })} /></label>
            </div> : null}
            {mix.fadeMode === "envelope" ? <p>Modifica l’inviluppo del volume nell’editor a destra. Gli eventuali punti già creati vengono mantenuti.</p> : null}
          </fieldset>
        </div>
        <aside className="video-editor-audio-envelope">
          <header><div><small>LINEE DI INVILUPPO</small><h3>{property.label}</h3></div><output>{points.length} keyframe</output></header>
          <div className="video-editor-audio-envelope-toolbar">
            <label>Parametro<select value={envelopeProperty} onChange={(event) => setEnvelopeProperty(event.target.value)}>{videoEditorAudioAutomationProperties.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.section} · {candidate.label}</option>)}</select></label>
            <label>Transizione<select value={curve} onChange={(event) => setCurve(event.target.value as typeof curve)}><option value="easeInOut">Morbida</option><option value="linear">Lineare</option><option value="easeIn">Accelera</option><option value="easeOut">Rallenta</option><option value="hold">A scatto</option></select></label>
          </div>
          <div className="video-editor-audio-envelope-chart">
            <span>{displayValue(property, property.maximum)}</span><span>{displayValue(property, property.minimum)}</span>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Inviluppo ${property.label}. Clicca per aggiungere un punto.`} onClick={editEnvelope}>
              <defs><linearGradient id="audio-envelope-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff4f9a" stopOpacity=".34"/><stop offset="1" stopColor="#ff4f9a" stopOpacity="0"/></linearGradient></defs>
              <path className="grid" d="M0 25H100M0 50H100M0 75H100M25 0V100M50 0V100M75 0V100" />
              <polygon points={`0,100 ${line} 100,100`} fill="url(#audio-envelope-fill)" />
              <polyline points={line} />
              {points.map((point) => <circle key={point.id} cx={pointX(point.frame)} cy={pointY(point.value)} r="2.2" />)}
            </svg>
            <i className="video-editor-audio-envelope-playhead" style={{ left: `${pointX(videoEditorSecondsToFrame(currentTime, settings.timebase))}%` }} />
          </div>
          <div className="video-editor-audio-envelope-actions"><button type="button" aria-label={playing ? "Pausa anteprima audio" : "Ascolta mix audio"} onClick={togglePreview}>{playing ? "❚❚ Pausa" : "▶ Ascolta"}</button><button type="button" className="primary" onClick={addAtPlayhead}>◆ Punto sul playhead</button><span>Clicca sul grafico per disegnare l’inviluppo.</span></div>
          <div className="video-editor-audio-keyframes">
            {points.map((point) => <div key={point.id}>
              <button type="button" onClick={() => setCurrentTime(videoEditorFrameToSeconds(point.frame, settings.timebase))} title="Vai al keyframe"><span>{videoEditorFrameToSeconds(point.frame, settings.timebase).toFixed(2)} s</span><b>{displayValue(property, point.value)}</b></button>
              <button type="button" aria-label={`Elimina keyframe a ${videoEditorFrameToSeconds(point.frame, settings.timebase).toFixed(2)} secondi`} onClick={() => { if (target) removeKeyframe(target, point.frame); }}>×</button>
              <label>Valore<input aria-label={`Valore keyframe ${point.id}`} type="number" min={property.minimum} max={property.maximum} step={property.step} value={point.value} onChange={(event) => editPoint(point, { value: event.target.valueAsNumber })} /></label>
              <label>Tempo (s)<input aria-label={`Tempo keyframe ${point.id}`} type="number" min={clip.startSeconds} max={clip.startSeconds + clip.durationSeconds} step={videoEditorFrameToSeconds(1, settings.timebase)} value={Number(videoEditorFrameToSeconds(point.frame, settings.timebase).toFixed(4))} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) editPoint(point, { frame: videoEditorSecondsToFrame(event.target.valueAsNumber, settings.timebase) }); }} /></label>
              <label>Transizione<select aria-label={`Transizione keyframe ${point.id}`} value={point.curve} onChange={(event) => editPoint(point, { curve: event.target.value as VideoEditorKeyframe["curve"] })}><option value="easeInOut">Morbida</option><option value="linear">Lineare</option><option value="easeIn">Accelera</option><option value="easeOut">Rallenta</option><option value="hold">A scatto</option>{!["easeInOut", "linear", "easeIn", "easeOut", "hold"].includes(point.curve) ? <option value={point.curve}>{point.curve}</option> : null}</select></label>
            </div>)}
            {!points.length ? <p>Nessun punto: il parametro resta costante. Aggiungi il primo punto sul playhead o direttamente sul grafico.</p> : null}
          </div>
        </aside>
      </div>
      <footer><button type="button" onClick={() => {
        updateSettings({ automationLanes: settings.automationLanes.filter((candidate) => !(candidate.target.kind === "clip" && candidate.target.clipId === clip.id && videoEditorAudioAutomationProperties.some((definition) => definition.key === candidate.target.property))) });
        updateClip(clip.id, { audioMix: defaultVideoEditorAudioMix, volume: 1, audioFadeInSeconds: 0, audioFadeOutSeconds: 0 });
      }}>Ripristina mix</button><span>Le modifiche sono salvate nel progetto e applicate anche all’export.</span><button type="button" className="primary" onClick={onClose}>Fine</button></footer>
    </section>
  </div>;
}
