import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from "react";
import { useProjectStore } from "../store/project-store";
import { videoEditorAsset, videoEditorClip } from "../services/video-editor";
import {
  videoEditorEffectCatalog,
  videoEditorEffectCategories,
  videoEditorEffectDragType,
  videoEditorEffectPreviewVariables,
  type VideoEditorEffectDefinition
} from "../services/video-editor-effects";

function numberParameter(parameters: Record<string, number | string | boolean>, key: string, fallback: number): number {
  const value = parameters[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatParameter(value: number, step = 1, unit = ""): string {
  const decimals = step < .01 ? 3 : step < 1 ? 2 : 0;
  return `${value.toFixed(decimals)}${unit}`;
}

export function VideoEditorEffectsLibrary() {
  const settings = useProjectStore((state) => state.project.animation.videoEditor);
  const addEffect = useProjectStore((state) => state.addVideoEditorEffectClip);
  const updateEffect = useProjectStore((state) => state.updateVideoEditorEffectClip);
  const [selectedId, setSelectedId] = useState(videoEditorEffectCatalog[0]!.id);
  const [previewRun, setPreviewRun] = useState(0);
  const selected = videoEditorEffectCatalog.find((effect) => effect.id === selectedId) ?? videoEditorEffectCatalog[0]!;
  const [durationSeconds, setDurationSeconds] = useState(selected.defaultDurationSeconds);
  const [mix, setMix] = useState(1);
  const [parameters, setParameters] = useState<Record<string, number | string | boolean>>({ ...selected.defaultParameters });

  const selectedEffect = settings.effectClips.find((effect) => effect.id === settings.selectedEffectClipIds.at(-1)) ?? null;
  const selectedEffectTarget = selectedEffect?.target.kind === "clip" ? selectedEffect.target.clipId : null;
  const targetClip = videoEditorClip(settings, settings.selectedClipIds.at(-1) ?? selectedEffectTarget ?? "");
  const targetAsset = targetClip ? videoEditorAsset(settings, targetClip.assetId) : null;
  const usableTarget = targetClip && targetAsset?.kind !== "audio" ? targetClip : null;
  const image = targetAsset?.thumbnailUrl ?? (targetAsset?.kind === "image" ? targetAsset.url : null);

  const grouped = useMemo(() => videoEditorEffectCategories.map((category) => ({
    ...category,
    effects: videoEditorEffectCatalog.filter((effect) => effect.category === category.id)
  })), []);

  useEffect(() => {
    setDurationSeconds(selected.defaultDurationSeconds);
    setMix(1);
    setParameters({ ...selected.defaultParameters });
  }, [selected]);

  const playPreview = (effectId = selected.id) => {
    setSelectedId(effectId);
    setPreviewRun((run) => run + 1);
  };
  const drag = (event: DragEvent<HTMLElement>, effectId: string) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(videoEditorEffectDragType, effectId);
  };
  const addSelectedEffect = () => {
    if (!usableTarget) return;
    const id = addEffect(selected.id, { targetClipId: usableTarget.id, durationSeconds });
    if (!id) return;
    updateEffect(id, { durationSeconds, mix, parameters: { ...selected.defaultParameters, ...parameters } });
  };

  const previewVariables = videoEditorEffectPreviewVariables(selected, parameters, mix);
  const previewStyle = {
    "--effect-preview-duration": `${Math.max(.35, durationSeconds)}s`,
    "--effect-preview-amount": previewVariables.amountPercent,
    "--effect-preview-frequency": previewVariables.frequency,
    "--effect-preview-mix": mix,
    "--effect-preview-scale": previewVariables.scaleUp,
    "--effect-preview-scale-down": previewVariables.scaleDown,
    "--effect-preview-blur": previewVariables.blurPixels,
    "--effect-preview-flicker-low": previewVariables.flickerLow,
    "--effect-preview-flicker-high": previewVariables.flickerHigh,
    "--effect-preview-flicker-contrast": previewVariables.flickerContrast,
    ...(image ? { backgroundImage: `url(${image})` } : {})
  } as CSSProperties;

  return <section className="video-editor-effects-library" aria-label="Libreria effetti Video Editor">
    <header>
      <span>LIBRERIA EFFETTI</span>
      <strong>Effetti video</strong>
      <small>{videoEditorEffectCatalog.length} effetti reali · anteprima parametrica; timeline ed export condividono il resolver deterministico.</small>
    </header>

    <div className="video-editor-effect-groups">
      {grouped.map((category) => <section key={category.id} className="video-editor-effect-group" aria-labelledby={`effect-category-${category.id}`}>
        <header>
          <div><strong id={`effect-category-${category.id}`}>{category.label}</strong><small>{category.description}</small></div>
          <span>{category.effects.length}</span>
        </header>
        <div className="video-editor-effect-catalog">
          {category.effects.map((effect) => <EffectCard
            key={effect.id}
            effect={effect}
            selected={selected.id === effect.id}
            onPreview={() => playPreview(effect.id)}
            onAdd={() => { if (usableTarget) { playPreview(effect.id); const id = addEffect(effect.id, { targetClipId: usableTarget.id }); if (id) updateEffect(id, { parameters: { ...effect.defaultParameters } }); } }}
            onDrag={(event) => drag(event, effect.id)}
          />)}
        </div>
      </section>)}
    </div>

    <div className="video-editor-effect-preview">
      <div className="effect-preview-stage">
        <div className="effect-preview-checker" />
        <div key={`${selected.id}-${previewRun}`} className={`effect-preview-media effect-preview-${selected.previewStyle}`} style={previewStyle}>
          <span>MLSM</span><strong>VIDEO</strong><small>PREVIEW</small>
        </div>
        <span className="effect-preview-badge">{durationSeconds.toFixed(2)} s</span>
      </div>
      <div className="effect-preview-copy">
        <span>{videoEditorEffectCategories.find((category) => category.id === selected.category)?.label}</span>
        <strong>{selected.label}</strong>
        <p>{selected.description}</p>
        <button type="button" className="effect-preview-replay" onClick={() => playPreview()} aria-label={`Riproduci anteprima ${selected.label}`}>
          ↻ Riproduci anteprima
        </button>
      </div>
    </div>

    <div className="video-editor-effect-controls" aria-label={`Parametri ${selected.label}`}>
      <label><span>Durata</span><output>{durationSeconds.toFixed(2)} s</output>
        <input aria-label={`Durata ${selected.label}`} type="range" min={selected.minimumDurationSeconds} max={selected.maximumDurationSeconds} step=".01" value={durationSeconds} onChange={(event) => { setDurationSeconds(Number(event.target.value)); setPreviewRun((run) => run + 1); }} />
      </label>
      <label><span>Intensità</span><output>{Math.round(mix * 100)}%</output>
        <input aria-label={`Intensità ${selected.label}`} type="range" min="0" max="1" step=".01" value={mix} onChange={(event) => { setMix(Number(event.target.value)); setPreviewRun((run) => run + 1); }} />
      </label>
      {selected.parameterControls.map((control) => control.kind === "select"
        ? <label key={control.key}><span>{control.label}</span>
          <select aria-label={`${control.label} ${selected.label}`} value={String(parameters[control.key] ?? selected.defaultParameters[control.key] ?? "")} onChange={(event) => { setParameters((current) => ({ ...current, [control.key]: event.target.value })); setPreviewRun((run) => run + 1); }}>
            {control.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        : <label key={control.key}><span>{control.label}</span><output>{formatParameter(numberParameter(parameters, control.key, Number(selected.defaultParameters[control.key] ?? 0)), control.step, control.unit)}</output>
          <input aria-label={`${control.label} ${selected.label}`} type="range" min={control.minimum} max={control.maximum} step={control.step} value={numberParameter(parameters, control.key, Number(selected.defaultParameters[control.key] ?? 0))} onChange={(event) => { setParameters((current) => ({ ...current, [control.key]: Number(event.target.value) })); setPreviewRun((run) => run + 1); }} />
        </label>)}
    </div>

    <button type="button" className="video-editor-add-effect" disabled={!usableTarget} onClick={addSelectedEffect}>
      {usableTarget ? `＋ Aggiungi ${selected.label} a “${targetAsset?.name ?? "clip"}”` : "Seleziona una clip visiva su qualsiasi livello"}
    </button>
  </section>;
}

function EffectCard({ effect, selected, onPreview, onAdd, onDrag }: {
  effect: VideoEditorEffectDefinition;
  selected: boolean;
  onPreview: () => void;
  onAdd: () => void;
  onDrag: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  return <button
    type="button"
    className={selected ? "selected" : ""}
    draggable
    aria-pressed={selected}
    onClick={onPreview}
    onFocus={onPreview}
    onDoubleClick={onAdd}
    onDragStart={onDrag}
  >
    <span className={`effect-card-motion ${effect.previewStyle}`}><i /><b /></span>
    <span><strong>{effect.label}</strong><small>{effect.description}</small></span>
    <small>{effect.defaultDurationSeconds.toFixed(2)} s</small>
  </button>;
}
