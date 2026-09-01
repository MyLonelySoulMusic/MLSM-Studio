import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useProjectStore } from "../store/project-store";
import { backendLabel, detectUpscalerHardware, effectiveUpscalerBackend, upscalerModels, type UpscalerHardware } from "../services/upscaler-runtime";
import { fitUpscalerPreset, resolveUpscalerTarget, resolvedUpscalerDimensions } from "../services/upscaler-renderer";
import { registerUpscalerSourceFile } from "../services/upscaler-source-file";
import { classifyUpscalerMediaFile, readUpscalerMediaMetadata, type SupportedUpscalerMediaFile } from "../services/upscaler-media-file";
import { UpscalerBatchPanel } from "./UpscalerBatchPanel";
import { useUpscalerBatchStore, type UpscalerImportOwner } from "../store/upscaler-batch-store";
import { RemoteUpscalerPanel } from "./RemoteUpscalerPanel";

const adjustmentLabels = { exposure: "Esposizione", contrast: "Contrasto", highlights: "Luci", shadows: "Ombre", whites: "Bianchi", blacks: "Neri", saturation: "Saturazione", vibrance: "Vividezza", temperature: "Temperatura", tint: "Tinta", sharpness: "Nitidezza", denoise: "Riduzione rumore" } as const;
type AdjustmentKey = keyof typeof adjustmentLabels;

const adjustmentRanges: Record<AdjustmentKey, { min: number; max: number; step: number }> = {
  exposure: { min: -2, max: 2, step: 0.05 },
  contrast: { min: -100, max: 100, step: 1 },
  highlights: { min: -100, max: 100, step: 1 },
  shadows: { min: -100, max: 100, step: 1 },
  whites: { min: -100, max: 100, step: 1 },
  blacks: { min: -100, max: 100, step: 1 },
  saturation: { min: -100, max: 100, step: 1 },
  vibrance: { min: -100, max: 100, step: 1 },
  temperature: { min: -100, max: 100, step: 1 },
  tint: { min: -100, max: 100, step: 1 },
  sharpness: { min: 0, max: 100, step: 1 },
  denoise: { min: 0, max: 100, step: 1 },
};

interface UpscalerRangeControlProps {
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}

/** Keeps the thumb responsive while expensive preview updates are coalesced. */
function UpscalerRangeControl({ label, ariaLabel, value, min, max, step, formatValue, onChange }: UpscalerRangeControlProps) {
  const [draftValue, setDraftValue] = useState(value);
  const draggingRef = useRef(false);
  const pendingValueRef = useRef<number | null>(null);
  const updateTimerRef = useRef<number | null>(null);

  const publishPendingValue = useCallback(() => {
    if (updateTimerRef.current !== null) {
      window.clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    const pendingValue = pendingValueRef.current;
    pendingValueRef.current = null;
    if (pendingValue !== null) onChange(pendingValue);
  }, [onChange]);

  const scheduleValue = (nextValue: number) => {
    setDraftValue(nextValue);
    pendingValueRef.current = nextValue;
    if (updateTimerRef.current === null) {
      // Roughly 30 preview updates per second are enough for visual feedback
      // and avoid saturating React/canvas with every native pointer event.
      updateTimerRef.current = window.setTimeout(publishPendingValue, 32);
    }
  };

  useEffect(() => {
    if (!draggingRef.current) setDraftValue(value);
  }, [value]);

  useEffect(() => () => {
    if (updateTimerRef.current !== null) window.clearTimeout(updateTimerRef.current);
  }, []);

  const finishDrag = () => {
    draggingRef.current = false;
    publishPendingValue();
  };

  return <label className="upscaler-range-control">
    <span><span>{label}</span><output>{formatValue(draftValue)}</output></span>
    <input
      aria-label={ariaLabel}
      type="range"
      min={min}
      max={max}
      step={step}
      value={draftValue}
      onPointerDown={() => { draggingRef.current = true; }}
      onChange={(event) => scheduleValue(Number(event.currentTarget.value))}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onBlur={finishDrag}
    />
  </label>;
}

function formatSignedAdjustment(key: AdjustmentKey, value: number) {
  const formatted = key === "exposure" ? value.toFixed(2) : Math.round(value).toString();
  return value > 0 ? `+${formatted}` : formatted;
}

export function UpscalerPanel() {
  const settings = useProjectStore((state) => state.project.animation.upscaler); const update = useProjectStore((state) => state.updateUpscaler);
  const batchRunning = useUpscalerBatchStore((state) => state.running);
  const batchImporting = useUpscalerBatchStore((state) => state.importing);
  const beginBatchImport = useUpscalerBatchStore((state) => state.beginImport);
  const isBatchImportActive = useUpscalerBatchStore((state) => state.isImportActive);
  const endBatchImport = useUpscalerBatchStore((state) => state.endImport);
  const addBatchFiles = useUpscalerBatchStore((state) => state.addFiles);
  const setPreviewItem = useUpscalerBatchStore((state) => state.setPreviewItem);
  const [hardware, setHardware] = useState<UpscalerHardware | null>(null); const [hardwareError, setHardwareError] = useState(""); const [importError, setImportError] = useState("");
  useEffect(() => { let active = true; void detectUpscalerHardware().then((result) => { if (active) setHardware(result); }).catch((error: unknown) => { if (active) setHardwareError(error instanceof Error ? error.message : String(error)); }); return () => { active = false; }; }, []);
  const selectedModel = useMemo(() => upscalerModels.find((model) => model.id === settings.model) ?? upscalerModels[0]!, [settings.model]);
  const importSingleMedia = async (file: File, classification: SupportedUpscalerMediaFile, owner: UpscalerImportOwner): Promise<boolean> => {
    const url = URL.createObjectURL(file);
    let ownsUrl = true;
    try {
      const metadata = await readUpscalerMediaMetadata(file, url, classification, owner.controller.signal);
      if (!isBatchImportActive(owner)) return false;
      // In remote mode the selected Gradio catalog model owns the scale.  Do
      // not let the hidden local model reset an x4 remote target while a new
      // source is being imported.
      const scale = settings.remote.enabled ? settings.scale : selectedModel.nativeScale;
      const dimensions = resolveUpscalerTarget(metadata.width, metadata.height, scale);
      const { width, height } = dimensions;
      const previousUrl = useProjectStore.getState().project.animation.upscaler.sourceUrl;
      registerUpscalerSourceFile(url, file);
      update({ sourceUrl: url, sourceName: file.name, sourceKind: metadata.kind, sourceWidth: metadata.width, sourceHeight: metadata.height, durationSeconds: metadata.duration, scale, finalWidth: width, finalHeight: height });
      // Single sources (including video in mixed transactions) use the
      // project-backed preview; batch cards opt in explicitly below.
      setPreviewItem(null);
      ownsUrl = false;
      if (previousUrl?.startsWith("blob:") && previousUrl !== url) URL.revokeObjectURL(previousUrl);
      return true;
    } catch (error) {
      if (!isBatchImportActive(owner)) return false;
      throw error;
    } finally {
      if (ownsUrl) URL.revokeObjectURL(url);
    }
  };
  const importMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]; event.target.value = ""; if (!files.length) return; setImportError("");
    const videos: Array<{ file: File; classification: SupportedUpscalerMediaFile }> = []; const images: Array<{ file: File; classification: SupportedUpscalerMediaFile }> = []; const rejected: string[] = [];
    for (const file of files) {
      const classification = classifyUpscalerMediaFile(file);
      if (!classification.supported) rejected.push(`${file.name}: ${classification.message}`);
      else if (classification.kind === "video") videos.push({ file, classification });
      else images.push({ file, classification });
    }
    const classificationFeedback = rejected.length ? `File non supportati: ${rejected.join(" ")}` : "";
    setImportError(classificationFeedback);
    if (!videos.length && !images.length) return;
    const owner = beginBatchImport(true);
    if (owner === null) { setImportError(classificationFeedback ? `${classificationFeedback} Importazione non disponibile.` : "Importazione non disponibile."); return; }
    try {
      if (videos.length && images.length) {
        let videoFailure: unknown; let batchFailure: unknown;
        // A multi-file picker always routes every photograph to the batch.
        // Videos remain single-source and, deterministically, the first video
        // in picker order becomes the preview source.
        try { await importSingleMedia(videos[0]!.file, videos[0]!.classification, owner); } catch (error) { videoFailure = error; }
        if (isBatchImportActive(owner)) {
          try { await addBatchFiles(images.map(({ file }) => file), settings, owner); } catch (error) { batchFailure = error; }
        }
        if (videoFailure) throw videoFailure;
        if (batchFailure) throw batchFailure;
      } else if (videos.length) await importSingleMedia(videos[0]!.file, videos[0]!.classification, owner);
      else if (images.length && files.length > 1) {
        const importedIds = await addBatchFiles(images.map(({ file }) => file), settings, owner);
        setPreviewItem(importedIds[0] ?? null);
      }
      else if (images.length) await importSingleMedia(images[0]!.file, images[0]!.classification, owner);
    } catch (error) {
      if (isBatchImportActive(owner)) {
        const operationFeedback = error instanceof Error ? error.message : String(error);
        setImportError(classificationFeedback ? `${classificationFeedback} ${operationFeedback}` : operationFeedback);
      }
    } finally { endBatchImport(owner); }
  };
  const setResolution = (key: "width" | "height", value: number) => {
    const dimensions = resolvedUpscalerDimensions({ ...settings, finalWidth: key === "width" ? value : settings.finalWidth, finalHeight: key === "height" ? value : settings.finalHeight }, key);
    update({ finalWidth: dimensions.width, finalHeight: dimensions.height, scale: settings.sourceWidth ? dimensions.width / settings.sourceWidth : settings.scale });
  };
  const selectModel = (modelId: typeof settings.model) => {
    const model = upscalerModels.find((item) => item.id === modelId) ?? selectedModel;
    const dimensions = settings.sourceWidth && settings.sourceHeight ? (() => { const target = resolveUpscalerTarget(settings.sourceWidth, settings.sourceHeight, model.nativeScale); return { finalWidth: target.width, finalHeight: target.height }; })() : {};
    update({ model: model.id, scale: model.nativeScale, ...dimensions });
  };
  const selectPreset = (landscapeWidth: number, landscapeHeight: number) => {
    const dimensions = fitUpscalerPreset(settings.sourceWidth || landscapeWidth, settings.sourceHeight || landscapeHeight, landscapeWidth, landscapeHeight);
    update({ finalWidth: dimensions.width, finalHeight: dimensions.height, lockAspectRatio: true, scale: settings.sourceWidth ? dimensions.width / settings.sourceWidth : 1 });
  };
  const updateAdjustment = useCallback((key: AdjustmentKey, value: number) => {
    const current = useProjectStore.getState().project.animation.upscaler.adjustments;
    if (current[key] === value) return;
    update({ adjustments: { ...current, [key]: value } });
  }, [update]);
  const effective = hardware ? effectiveUpscalerBackend(settings.backend, hardware) : null;
  const outputMegapixels = settings.finalWidth * settings.finalHeight / 1_000_000;
  const demandingVideoProfile = settings.sourceKind === "video" && Boolean(settings.sourceUrl) && (selectedModel.speed === "slow" || settings.tta || outputMegapixels > 8.4);
  return <section className="upscaler-settings">
    <h2>Sorgente</h2><label className="flyer-upload">Carica foto o video<input aria-label="Carica sorgente Upscaler" type="file" accept="image/png,image/jpeg,image/webp,image/avif,video/mp4,video/webm,video/quicktime,.m4v" multiple disabled={batchRunning} onChange={(event) => void importMedia(event)} /></label>{importError ? <p className="upscaler-preview-error">{importError}</p> : null}
    {settings.sourceUrl ? <div className="subtitle-video-loaded"><strong>{settings.sourceName}</strong><span>{settings.sourceWidth} × {settings.sourceHeight}{settings.sourceKind === "video" ? ` · ${settings.durationSeconds.toFixed(1)} s` : " · immagine"}</span></div> : <p className="muted">Foto e video condividono la stessa pipeline, la stessa correzione colore e la stessa risoluzione finale.</p>}
    <fieldset className="upscaler-global-settings" disabled={batchRunning || batchImporting}>
    <h2>Modalità elaborazione</h2><div className="segmented" role="group" aria-label="Modalità elaborazione Upscaler"><button type="button" className={!settings.remote.enabled ? "active" : ""} aria-pressed={!settings.remote.enabled} onClick={() => update({ remote: { ...settings.remote, enabled: false } })}>Locale</button><button type="button" className={settings.remote.enabled ? "active" : ""} aria-pressed={settings.remote.enabled} onClick={() => update({ remote: { ...settings.remote, enabled: true } })}>Gradio / Colab</button></div>
    <p className="muted">{settings.remote.enabled ? "Elaborazione esclusivamente remota: configura almeno un endpoint attivo. I motori locali non vengono usati." : "Elaborazione esclusivamente sul computer: Canvas o modello AI locale, senza collegamenti Gradio."}</p>
    {!settings.remote.enabled ? <>
      <h2>Modello locale</h2><label>Modello<select aria-label="Modello Upscaler" value={settings.model} onChange={(event) => selectModel(event.target.value as typeof settings.model)}>{upscalerModels.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.nativeScale}×</option>)}</select></label>
      <div className="upscaler-model-card"><strong>{selectedModel.label}</strong><span><b>Ideale:</b> {selectedModel.bestFor}</span><span className="model-pro"><b>Pro:</b> {selectedModel.pros}</span><span className="model-con"><b>Contro:</b> {selectedModel.cons}</span><small>{selectedModel.speed === "fast" ? "Veloce" : selectedModel.speed === "balanced" ? "Bilanciato" : "Qualità massima · più lento"}{selectedModel.videoOptimized ? " · ottimizzato video" : ""}{selectedModel.id === "canvas" ? " · nessun download" : ` · ${selectedModel.modelSizeMb} MB`}{selectedModel.id === "canvas" ? "" : selectedModel.webExecutable ? " · ONNX locale" : " · server PyTorch locale"}</small></div>
      <h2>Accelerazione locale</h2><div className="upscaler-hardware-card"><strong>{hardware ? `Rilevato: ${hardware.gpuName ?? `${hardware.platform} ${hardware.architecture}`}` : hardwareError || "Rilevamento hardware…"}</strong><span>{effective ? `Motore selezionato: ${backendLabel(effective)}` : "Scelta automatica in preparazione"}</span></div>
      <label>Motore<select aria-label="Acceleratore Upscaler" value={settings.backend} onChange={(event) => update({ backend: event.target.value as typeof settings.backend })}><option value="auto">Automatico · consigliato</option><option value="cuda">NVIDIA CUDA</option><option value="metal">Apple Silicon · Metal</option><option value="webgpu">WebGPU</option><option value="cpu">CPU · compatibilità</option></select></label>
      <div className="upscaler-optimization-grid"><label>Tile<select aria-label="Dimensione tile Upscaler" value={settings.tileSize} onChange={(event) => update({ tileSize: Number(event.target.value) })}><option value="128">128 · poca memoria</option><option value="256">256 · automatico</option><option value="512">512 · GPU potente</option><option value="1024">1024 · memoria elevata</option></select></label><label className="teddy-dance-toggle"><span>TTA · qualità massima</span><input aria-label="TTA Upscaler" type="checkbox" checked={settings.tta} onChange={(event) => update({ tta: event.target.checked })} /></label></div>
      {demandingVideoProfile ? <div className="upscaler-performance-warning"><strong>Elaborazione video molto pesante</strong><span>{selectedModel.label} · {outputMegapixels.toFixed(1)} MP per frame{settings.tta ? " · doppio passaggio TTA" : ""}. Su video reali può richiedere decine di secondi per fotogramma. L’avanzamento mostrerà una stima attendibile dopo il primo frame.</span><button type="button" onClick={() => { const model = upscalerModels.find((item) => item.id === "realesr-general-x4v3")!; update({ model: model.id, scale: model.nativeScale, tta: false, tileSize: 256 }); }}>Usa profilo video veloce · General x4v3 senza TTA</button></div> : null}
    </> : <RemoteUpscalerPanel settings={settings} update={update} />}
    <h2>Risoluzione finale</h2><label className="teddy-dance-toggle"><span>Mantieni proporzioni</span><input aria-label="Mantieni proporzioni Upscaler" type="checkbox" checked={settings.lockAspectRatio} onChange={(event) => update({ lockAspectRatio: event.target.checked })} /></label><div className="upscaler-resolution"><label>Larghezza<input aria-label="Larghezza finale Upscaler" type="number" min="64" max="16384" value={settings.finalWidth} onChange={(event) => setResolution("width", Number(event.target.value))} /></label><span>×</span><label>Altezza<input aria-label="Altezza finale Upscaler" type="number" min="64" max="16384" value={settings.finalHeight} onChange={(event) => setResolution("height", Number(event.target.value))} /></label></div><div className="upscaler-presets">{[[1920,1080,"Full HD"],[2560,1440,"QHD"],[3840,2160,"4K"],[7680,4320,"8K"]].map(([width,height,label]) => <button type="button" key={label} onClick={() => selectPreset(width as number, height as number)}>{label}</button>)}</div><p className="muted">I preset ruotano automaticamente per sorgenti verticali e adattano i lati senza deformare o tagliare l’immagine.</p>
    <h2>Confronto e fusione</h2><label>Vista<select aria-label="Modalità confronto Upscaler" value={settings.comparisonMode} onChange={(event) => update({ comparisonMode: event.target.value as typeof settings.comparisonMode })}><option value="split">Prima / dopo</option><option value="enhanced">Solo migliorato</option><option value="original">Solo originale</option><option value="blend">Fusione</option></select></label><div className="upscaler-comparison-ranges">{settings.comparisonMode === "split" ? <UpscalerRangeControl label="Separatore" ariaLabel="Separatore confronto Upscaler" min={0} max={1} step={0.01} value={settings.comparisonPosition} formatValue={(value) => `${Math.round(value * 100)}%`} onChange={(value) => update({ comparisonPosition: value })} /> : null}<UpscalerRangeControl label="Originale sovrapposto" ariaLabel="Fusione originale Upscaler" min={0} max={1} step={0.01} value={settings.originalBlend} formatValue={(value) => `${Math.round(value * 100)}%`} onChange={(value) => update({ originalBlend: value })} /></div>
    <h2>Regolazioni immagine</h2><div className="upscaler-adjustments">{(Object.keys(adjustmentLabels) as AdjustmentKey[]).map((key) => <UpscalerRangeControl key={key} label={adjustmentLabels[key]} ariaLabel={`${adjustmentLabels[key]} Upscaler`} {...adjustmentRanges[key]} value={settings.adjustments[key]} formatValue={(value) => formatSignedAdjustment(key, value)} onChange={(value) => updateAdjustment(key, value)} />)}</div><button type="button" onClick={() => update({ adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, sharpness: 12, denoise: 0 } })}>Ripristina regolazioni</button>
    </fieldset><UpscalerBatchPanel settings={settings} /></section>;
}
