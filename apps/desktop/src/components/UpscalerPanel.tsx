import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useProjectStore } from "../store/project-store";
import { backendLabel, detectUpscalerHardware, effectiveUpscalerBackend, upscalerModels, type UpscalerHardware } from "../services/upscaler-runtime";
import { fitUpscalerPreset, resolvedUpscalerDimensions } from "../services/upscaler-renderer";
import { registerUpscalerSourceFile } from "../services/upscaler-source-file";

function mediaMetadata(file: File, url: string): Promise<{ kind: "image" | "video"; width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    if (file.type.startsWith("video/")) {
      const video = document.createElement("video"); video.preload = "metadata"; video.onloadedmetadata = () => resolve({ kind: "video", width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : 0 }); video.onerror = () => reject(new Error("Video non leggibile.")); video.src = url;
    } else {
      const image = new Image(); image.onload = () => resolve({ kind: "image", width: image.naturalWidth, height: image.naturalHeight, duration: 0 }); image.onerror = () => reject(new Error("Immagine non leggibile.")); image.src = url;
    }
  });
}

const adjustmentLabels = { exposure: "Esposizione", contrast: "Contrasto", highlights: "Luci", shadows: "Ombre", whites: "Bianchi", blacks: "Neri", saturation: "Saturazione", vibrance: "Vividezza", temperature: "Temperatura", tint: "Tinta", sharpness: "Nitidezza", denoise: "Riduzione rumore" } as const;

export function UpscalerPanel() {
  const settings = useProjectStore((state) => state.project.animation.upscaler); const update = useProjectStore((state) => state.updateUpscaler);
  const [hardware, setHardware] = useState<UpscalerHardware | null>(null); const [hardwareError, setHardwareError] = useState(""); const [importError, setImportError] = useState("");
  useEffect(() => { let active = true; void detectUpscalerHardware().then((result) => { if (active) setHardware(result); }).catch((error: unknown) => { if (active) setHardwareError(error instanceof Error ? error.message : String(error)); }); return () => { active = false; }; }, []);
  const selectedModel = useMemo(() => upscalerModels.find((model) => model.id === settings.model) ?? upscalerModels[0]!, [settings.model]);
  const importMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setImportError("");
    const url = URL.createObjectURL(file);
    let metadata;
    try { metadata = await mediaMetadata(file, url); } catch (error) { URL.revokeObjectURL(url); throw error; }
    if (settings.sourceUrl?.startsWith("blob:")) URL.revokeObjectURL(settings.sourceUrl);
    registerUpscalerSourceFile(url, file);
    const scale = selectedModel.nativeScale; const width = Math.min(16384, Math.max(64, Math.round(metadata.width * scale))); const height = Math.min(16384, Math.max(64, Math.round(metadata.height * scale)));
    update({ sourceUrl: url, sourceName: file.name, sourceKind: metadata.kind, sourceWidth: metadata.width, sourceHeight: metadata.height, durationSeconds: metadata.duration, scale, finalWidth: width, finalHeight: height });
  };
  const setResolution = (key: "width" | "height", value: number) => {
    const dimensions = resolvedUpscalerDimensions({ ...settings, finalWidth: key === "width" ? value : settings.finalWidth, finalHeight: key === "height" ? value : settings.finalHeight }, key);
    update({ finalWidth: dimensions.width, finalHeight: dimensions.height, scale: settings.sourceWidth ? dimensions.width / settings.sourceWidth : settings.scale });
  };
  const selectModel = (modelId: typeof settings.model) => {
    const model = upscalerModels.find((item) => item.id === modelId) ?? selectedModel;
    const dimensions = settings.sourceWidth && settings.sourceHeight ? { finalWidth: Math.min(16384, settings.sourceWidth * model.nativeScale), finalHeight: Math.min(16384, settings.sourceHeight * model.nativeScale) } : {};
    update({ model: model.id, scale: model.nativeScale, ...dimensions });
  };
  const selectPreset = (landscapeWidth: number, landscapeHeight: number) => {
    const dimensions = fitUpscalerPreset(settings.sourceWidth || landscapeWidth, settings.sourceHeight || landscapeHeight, landscapeWidth, landscapeHeight);
    update({ finalWidth: dimensions.width, finalHeight: dimensions.height, lockAspectRatio: true, scale: settings.sourceWidth ? dimensions.width / settings.sourceWidth : 1 });
  };
  const effective = hardware ? effectiveUpscalerBackend(settings.backend, hardware) : null;
  const outputMegapixels = settings.finalWidth * settings.finalHeight / 1_000_000;
  const demandingVideoProfile = settings.sourceKind === "video" && Boolean(settings.sourceUrl) && (selectedModel.speed === "slow" || settings.tta || outputMegapixels > 8.4);
  return <section className="upscaler-settings">
    <h2>Sorgente</h2><label className="flyer-upload">Carica foto o video<input aria-label="Carica sorgente Upscaler" type="file" accept="image/png,image/jpeg,image/webp,image/avif,video/mp4,video/webm,video/quicktime,.m4v" onChange={(event) => void importMedia(event).catch((error: unknown) => setImportError(error instanceof Error ? error.message : String(error)))} /></label>{importError ? <p className="upscaler-preview-error">{importError}</p> : null}
    {settings.sourceUrl ? <div className="subtitle-video-loaded"><strong>{settings.sourceName}</strong><span>{settings.sourceWidth} × {settings.sourceHeight}{settings.sourceKind === "video" ? ` · ${settings.durationSeconds.toFixed(1)} s` : " · immagine"}</span></div> : <p className="muted">Foto e video condividono la stessa pipeline, la stessa correzione colore e la stessa risoluzione finale.</p>}
    <h2>Modello AI</h2><label>Modello<select aria-label="Modello Upscaler" value={settings.model} onChange={(event) => selectModel(event.target.value as typeof settings.model)}>{upscalerModels.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.nativeScale}×</option>)}</select></label>
    <div className="upscaler-model-card"><strong>{selectedModel.label}</strong><span><b>Ideale:</b> {selectedModel.bestFor}</span><span className="model-pro"><b>Pro:</b> {selectedModel.pros}</span><span className="model-con"><b>Contro:</b> {selectedModel.cons}</span><small>{selectedModel.speed === "fast" ? "Veloce" : selectedModel.speed === "balanced" ? "Bilanciato" : "Qualità massima · più lento"}{selectedModel.videoOptimized ? " · ottimizzato video" : ""}{selectedModel.id === "canvas" ? " · nessun download" : ` · ${selectedModel.modelSizeMb} MB`}{selectedModel.id === "canvas" ? "" : selectedModel.webExecutable ? " · ONNX locale" : " · server PyTorch locale"}</small></div>
    <h2>Accelerazione</h2><div className="upscaler-hardware-card"><strong>{hardware ? `Rilevato: ${hardware.gpuName ?? `${hardware.platform} ${hardware.architecture}`}` : hardwareError || "Rilevamento hardware…"}</strong><span>{effective ? `Motore selezionato: ${backendLabel(effective)}` : "Scelta automatica in preparazione"}</span></div>
    <label>Motore<select aria-label="Acceleratore Upscaler" value={settings.backend} onChange={(event) => update({ backend: event.target.value as typeof settings.backend })}><option value="auto">Automatico · consigliato</option><option value="cuda">NVIDIA CUDA</option><option value="metal">Apple Silicon · Metal</option><option value="webgpu">WebGPU</option><option value="cpu">CPU · compatibilità</option></select></label>
    <div className="upscaler-optimization-grid"><label>Tile<select aria-label="Dimensione tile Upscaler" value={settings.tileSize} onChange={(event) => update({ tileSize: Number(event.target.value) })}><option value="128">128 · poca memoria</option><option value="256">256 · automatico</option><option value="512">512 · GPU potente</option><option value="1024">1024 · memoria elevata</option></select></label><label className="teddy-dance-toggle"><span>TTA · qualità massima</span><input aria-label="TTA Upscaler" type="checkbox" checked={settings.tta} onChange={(event) => update({ tta: event.target.checked })} /></label></div>
    {demandingVideoProfile ? <div className="upscaler-performance-warning"><strong>Elaborazione video molto pesante</strong><span>{selectedModel.label} · {outputMegapixels.toFixed(1)} MP per frame{settings.tta ? " · doppio passaggio TTA" : ""}. Su video reali può richiedere decine di secondi per fotogramma. L’avanzamento mostrerà una stima attendibile dopo il primo frame.</span><button type="button" onClick={() => { const model = upscalerModels.find((item) => item.id === "realesr-general-x4v3")!; update({ model: model.id, scale: model.nativeScale, tta: false, tileSize: 256 }); }}>Usa profilo video veloce · General x4v3 senza TTA</button></div> : null}
    <h2>Risoluzione finale</h2><label className="teddy-dance-toggle"><span>Mantieni proporzioni</span><input aria-label="Mantieni proporzioni Upscaler" type="checkbox" checked={settings.lockAspectRatio} onChange={(event) => update({ lockAspectRatio: event.target.checked })} /></label><div className="upscaler-resolution"><label>Larghezza<input aria-label="Larghezza finale Upscaler" type="number" min="64" max="16384" value={settings.finalWidth} onChange={(event) => setResolution("width", Number(event.target.value))} /></label><span>×</span><label>Altezza<input aria-label="Altezza finale Upscaler" type="number" min="64" max="16384" value={settings.finalHeight} onChange={(event) => setResolution("height", Number(event.target.value))} /></label></div><div className="upscaler-presets">{[[1920,1080,"Full HD"],[2560,1440,"QHD"],[3840,2160,"4K"],[7680,4320,"8K"]].map(([width,height,label]) => <button type="button" key={label} onClick={() => selectPreset(width as number, height as number)}>{label}</button>)}</div><p className="muted">I preset ruotano automaticamente per sorgenti verticali e adattano i lati senza deformare o tagliare l’immagine.</p>
    <h2>Confronto e fusione</h2><label>Vista<select aria-label="Modalità confronto Upscaler" value={settings.comparisonMode} onChange={(event) => update({ comparisonMode: event.target.value as typeof settings.comparisonMode })}><option value="split">Prima / dopo</option><option value="enhanced">Solo migliorato</option><option value="original">Solo originale</option><option value="blend">Fusione</option></select></label>{settings.comparisonMode === "split" ? <label>Separatore: {Math.round(settings.comparisonPosition * 100)}%<input aria-label="Separatore confronto Upscaler" type="range" min="0" max="1" step=".01" value={settings.comparisonPosition} onChange={(event) => update({ comparisonPosition: Number(event.target.value) })} /></label> : null}<label>Originale sovrapposto: {Math.round(settings.originalBlend * 100)}%<input aria-label="Fusione originale Upscaler" type="range" min="0" max="1" step=".01" value={settings.originalBlend} onChange={(event) => update({ originalBlend: Number(event.target.value) })} /></label>
    <h2>Regolazioni immagine</h2><div className="upscaler-adjustments">{(Object.keys(adjustmentLabels) as Array<keyof typeof adjustmentLabels>).map((key) => { const positiveOnly = key === "sharpness" || key === "denoise"; return <label key={key}>{adjustmentLabels[key]}: {settings.adjustments[key]}<input aria-label={`${adjustmentLabels[key]} Upscaler`} type="range" min={positiveOnly ? 0 : key === "exposure" ? -2 : -100} max={key === "exposure" ? 2 : 100} step={key === "exposure" ? .05 : 1} value={settings.adjustments[key]} onChange={(event) => update({ adjustments: { ...settings.adjustments, [key]: Number(event.target.value) } })} /></label>; })}</div><button type="button" onClick={() => update({ adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, sharpness: 12, denoise: 0 } })}>Ripristina regolazioni</button>
  </section>;
}
