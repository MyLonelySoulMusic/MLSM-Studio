import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useProjectStore } from "../store/project-store";
import { detectBackgroundObjects } from "../services/background-auto-detection";

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid image file."));
    reader.onerror = () => reject(new Error("Unable to read the image file."));
    reader.readAsDataURL(file);
  });
}

export function BackgroundAutoPanel() {
  const settings = useProjectStore((state) => state.project.animation.backgroundAuto);
  const update = useProjectStore((state) => state.updateBackgroundAuto);
  const setPalette = useProjectStore((state) => state.setBackgroundAutoPalette);
  const setDetections = useProjectStore((state) => state.setBackgroundAutoDetections);
  const patchDetection = useProjectStore((state) => state.patchBackgroundAutoDetection);
  const toggleDetectionAnimation = useProjectStore((state) => state.toggleBackgroundAutoDetectionAnimation);
  const addEffect = useProjectStore((state) => state.addBackgroundAutoEffect);
  const removeEffect = useProjectStore((state) => state.removeBackgroundAutoEffect);
  const updateEffect = useProjectStore((state) => state.updateBackgroundAutoEffect);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const runId = useRef(0);
  const detectionAbort = useRef<AbortController | null>(null);

  const beginRun = () => {
    const id = ++runId.current;
    detectionAbort.current?.abort();
    detectionAbort.current = null;
    return id;
  };

  useEffect(() => () => {
    ++runId.current;
    detectionAbort.current?.abort();
    detectionAbort.current = null;
  }, []);

  const detect = async (imageUrl: string) => {
    const id = beginRun();
    const controller = new AbortController();
    detectionAbort.current = controller;
    const isActive = () => id === runId.current && detectionAbort.current === controller && !controller.signal.aborted;
    setError("");
    setStatus("Starting detection…");
    try {
      const threshold = useProjectStore.getState().project.animation.backgroundAuto.detectionThreshold;
      const result = await detectBackgroundObjects(imageUrl, {
        threshold,
        signal: controller.signal,
        onProgress: (message) => { if (isActive()) setStatus(message); },
      });
      if (!isActive()) return;
      update({ sourceWidth: result.sourceWidth, sourceHeight: result.sourceHeight, personAnimationEnabled: false });
      setDetections(result.detections);
      setPalette(result.palette);
      setStatus(`${result.detections.length} object${result.detections.length === 1 ? "" : "s"} detected${result.personCount ? ` · ${result.personCount} people` : ""}`);
    } catch (cause) {
      if (!isActive()) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("");
    } finally {
      if (detectionAbort.current === controller) detectionAbort.current = null;
    }
  };

  const importImage = async (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    change.target.value = "";
    if (!file) return;
    const id = beginRun();
    setError("");
    setStatus("Reading image…");
    try {
      const url = await readFile(file);
      if (id !== runId.current) return;
      update({ imageUrl: url, sourceWidth: 0, sourceHeight: 0, detections: [], personAnimationEnabled: false });
      await detect(url);
    } catch (cause) {
      if (id !== runId.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("");
    }
  };

  const detectAgain = () => {
    const imageUrl = useProjectStore.getState().project.animation.backgroundAuto.imageUrl;
    if (imageUrl) void detect(imageUrl);
  };

  return <section className="background-auto-panel">
    <h2>Circular Spectrum Auto Detector</h2>
    <p className="muted">Upload an image. The detector keeps every supported COCO category, and each circle can be detected or positioned manually.</p>
    <label className="flyer-upload">Upload image<input aria-label="Upload Auto Detector image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(change) => void importImage(change)} /></label>
    {settings.imageUrl ? <div className="cover-thumbnail" style={{ backgroundImage: `url(${settings.imageUrl})` }} /> : null}
    {status ? <p className="palette-status">{status}</p> : null}
    {error ? <div className="vocal-track-advice"><strong>Detection failed</strong><span>{error}</span><button type="button" onClick={detectAgain}>Retry</button></div> : null}

    <h2>Detection sensitivity</h2>
    <p className="muted">Higher sensitivity lowers the confidence threshold and may include more supported categories. Changing it does not rerun detection automatically.</p>
    <label> Sensitivity: {settings.detectionThreshold <= .12 ? "High" : settings.detectionThreshold >= .5 ? "Precise" : "Balanced"}
      <input aria-label="Detection sensitivity" type="range" min="0" max="1" step=".01" value={1 - settings.detectionThreshold} onChange={(change) => update({ detectionThreshold: Math.max(.05, Math.min(.9, Number((1 - Number(change.target.value)).toFixed(2)))) })} />
    </label>
    <output className="muted">Threshold {settings.detectionThreshold.toFixed(2)}</output>
    {settings.imageUrl ? <button type="button" onClick={detectAgain}>Detect again</button> : null}

    <h2>Palette</h2>
    <div className="teddy-palette">{settings.palette.map((color, index) => <label key={index}>Color {index + 1}<input type="color" value={color} onChange={(change) => { const palette = [...settings.palette] as [string, string, string]; palette[index] = change.target.value; setPalette(palette); }} /></label>)}</div>

    <h2>Detected objects</h2>
    {settings.detections.length ? <div className="background-auto-detection-list">{settings.detections.map((detection) => {
      const animated = settings.effects.some((effect) => effect.enabled && effect.detectionId === detection.id);
      const objectPalette = detection.palette && detection.palette.length === 3 ? detection.palette : settings.palette;
      const paletteMode = detection.paletteMode ?? "auto";
      return <div className="background-auto-detection-item" key={detection.id}>
        <div className="background-auto-detection-heading"><strong>{detection.alias || detection.label}</strong><small>{detection.label} · {Math.round(detection.score * 100)}% · {Math.round(detection.bbox.width * 100)}×{Math.round(detection.bbox.height * 100)}%</small></div>
        <label>Alias<input aria-label={`Alias for ${detection.label}`} value={detection.alias || detection.label} onChange={(change) => patchDetection(detection.id, { alias: change.target.value })} /></label>
        <label className="teddy-dance-toggle"><span>Person</span><input aria-label={`Person: ${detection.alias || detection.label}`} type="checkbox" checked={detection.isPerson} onChange={(change) => patchDetection(detection.id, { isPerson: change.target.checked })} /></label>
        <label>Palette source<select aria-label={`Palette source for ${detection.alias || detection.label}`} value={paletteMode} onChange={(change) => { const mode = change.target.value as "auto" | "manual"; patchDetection(detection.id, { paletteMode: mode, palette: mode === "auto" ? settings.palette : objectPalette }); }}><option value="auto">Auto from image</option><option value="manual">Custom</option></select></label>
        <div className="teddy-palette">{objectPalette.map((color, colorIndex) => <label key={colorIndex}>Color {colorIndex + 1}<input aria-label={`Color ${colorIndex + 1} for ${detection.alias || detection.label}`} type="color" value={color} disabled={paletteMode === "auto"} onChange={(change) => { const palette = [...objectPalette] as [string, string, string]; palette[colorIndex] = change.target.value; patchDetection(detection.id, { palette, paletteMode: "manual" }); }} /></label>)}</div>
        {paletteMode === "manual" ? <button type="button" onClick={() => patchDetection(detection.id, { paletteMode: "auto", palette: settings.palette })}>Reset to image palette</button> : null}
        {animated ? <em>Animated</em> : null}
        <button type="button" onClick={() => toggleDetectionAnimation(detection.id)}>{animated ? "Disable animation" : "Animate"}</button>
      </div>;
    })}</div> : <p className="muted">No objects saved. Upload an image to run detection.</p>}

    <h2>Effects</h2>
    {settings.effects.map((effect, index) => <div className="background-auto-effect-card" key={effect.id}>
      <div className="light-point-heading"><strong>Circular Spectrum {index + 1}</strong>{settings.effects.length > 1 ? <button type="button" onClick={() => removeEffect(effect.id)}>Remove</button> : null}</div>
      <label className="teddy-dance-toggle"><span>Enabled</span><input type="checkbox" checked={effect.enabled} onChange={(change) => updateEffect(effect.id, { enabled: change.target.checked })} /></label>
      <label>Placement<select aria-label={`Placement for Circular Spectrum ${index + 1}`} value={effect.placementMode ?? (effect.detectionId ? "detected" : "manual")} onChange={(change) => { const placementMode = change.target.value as "detected" | "manual"; updateEffect(effect.id, { placementMode, detectionId: placementMode === "manual" ? null : effect.detectionId ?? settings.detections[0]?.id ?? null, enabled: placementMode === "manual" ? effect.enabled : Boolean(effect.detectionId ?? settings.detections[0]?.id) }); }}><option value="detected">Detected object</option><option value="manual">Manual circle</option></select></label>
      {(effect.placementMode ?? (effect.detectionId ? "detected" : "manual")) === "manual" ? <div className="background-auto-manual-circle-controls"><label>Center X<input aria-label={`Center X for Circular Spectrum ${index + 1}`} type="number" min="0" max="1" step=".01" value={(effect.centerX ?? .5).toFixed(2)} onChange={(change) => { const centerX = change.currentTarget.valueAsNumber; if (Number.isFinite(centerX)) updateEffect(effect.id, { centerX }); }} /></label><label>Center Y<input aria-label={`Center Y for Circular Spectrum ${index + 1}`} type="number" min="0" max="1" step=".01" value={(effect.centerY ?? .5).toFixed(2)} onChange={(change) => { const centerY = change.currentTarget.valueAsNumber; if (Number.isFinite(centerY)) updateEffect(effect.id, { centerY }); }} /></label><label>Diameter<input aria-label={`Diameter for Circular Spectrum ${index + 1}`} type="number" min=".05" max="1" step=".01" value={(effect.diameter ?? .42).toFixed(2)} onChange={(change) => { const diameter = change.currentTarget.valueAsNumber; if (Number.isFinite(diameter)) updateEffect(effect.id, { diameter }); }} /></label></div> : null}
      <label>Object<select aria-label={`Object for Circular Spectrum ${index + 1}`} disabled={(effect.placementMode ?? (effect.detectionId ? "detected" : "manual")) === "manual"} value={effect.detectionId ?? ""} onChange={(change) => updateEffect(effect.id, { detectionId: change.target.value || null, placementMode: "detected" })}><option value="" disabled>Select an object</option>{settings.detections.map((detection) => <option key={detection.id} value={detection.id}>{detection.alias || detection.label} · {detection.label} · {Math.round(detection.score * 100)}%</option>)}</select></label>
      <label>Palette<select aria-label={`Palette for Circular Spectrum ${index + 1}`} value={effect.paletteMode} onChange={(change) => updateEffect(effect.id, { paletteMode: change.target.value as "auto" | "manual" })}><option value="auto">Automatic from object</option><option value="manual">Manual per instance</option></select></label>
      {effect.paletteMode === "manual" ? <div className="teddy-palette">{effect.palette.map((color, colorIndex) => <label key={colorIndex}>Color {colorIndex + 1}<input type="color" value={color} onChange={(change) => { const palette = [...effect.palette] as [string, string, string]; palette[colorIndex] = change.target.value; updateEffect(effect.id, { palette, ...(colorIndex === 0 ? { color: change.target.value } : {}) }); }} /></label>)}</div> : <p className="muted">Uses the selected object's palette.</p>}
      <label>Intensity: {effect.intensity.toFixed(1)}×<input type="range" min="0" max="3" step=".05" value={effect.intensity} onChange={(change) => updateEffect(effect.id, { intensity: Number(change.target.value) })} /></label>
      <label>Scale: {effect.scale.toFixed(2)}×<input type="range" min=".25" max="3" step=".05" value={effect.scale} onChange={(change) => updateEffect(effect.id, { scale: Number(change.target.value) })} /></label>
      <label>Rotation speed: {effect.rotationSpeed === 0 ? "Stopped" : `${effect.rotationSpeed.toFixed(2)} rev/s`}<input aria-label={`Rotation speed for Circular Spectrum ${index + 1}`} type="range" min="0" max="1" step=".01" value={effect.rotationSpeed} onChange={(change) => updateEffect(effect.id, { rotationSpeed: Number(change.target.value) })} /></label>
      <label>Opacity: {Math.round((effect.opacity ?? .9) * 100)}%<input aria-label={`Opacity for Circular Spectrum ${index + 1}`} type="range" min="0" max="1" step=".01" value={effect.opacity ?? .9} onChange={(change) => updateEffect(effect.id, { opacity: Number(change.target.value) })} /></label>
      <label className="teddy-dance-toggle"><span>Collision particles</span><input type="checkbox" checked={effect.collisionParticles} onChange={(change) => updateEffect(effect.id, { collisionParticles: change.target.checked })} /></label>
      <div className="background-auto-effect-toggles">
        <label className="teddy-dance-toggle"><span>Radial spectrum</span><input aria-label={`Radial spectrum for Circular Spectrum ${index + 1}`} type="checkbox" checked={effect.radialSpectrumEnabled ?? true} onChange={(change) => updateEffect(effect.id, { radialSpectrumEnabled: change.target.checked })} /></label>
        <label className="teddy-dance-toggle"><span>Center spectrum</span><input aria-label={`Center spectrum for Circular Spectrum ${index + 1}`} type="checkbox" checked={effect.centerSpectrumEnabled ?? true} onChange={(change) => updateEffect(effect.id, { centerSpectrumEnabled: change.target.checked })} /></label>
        <p className="muted">Fixed horizontal bands stay level while the radial ring rotates.</p>
        <label className="teddy-dance-toggle"><span>Stereo sides (L/R)</span><input aria-label={`Stereo sides for Circular Spectrum ${index + 1}`} type="checkbox" checked={effect.stereoSidesEnabled ?? true} onChange={(change) => updateEffect(effect.id, { stereoSidesEnabled: change.target.checked })} /></label>
        <p className="muted">Independent left/right pulses mirror automatically when the source is mono.</p>
        <label className="teddy-dance-toggle"><span>Subtitles</span><input aria-label={`Subtitles for Circular Spectrum ${index + 1}`} type="checkbox" checked={effect.subtitlesEnabled ?? false} onChange={(change) => updateEffect(effect.id, { subtitlesEnabled: change.target.checked })} /></label>
        <p className="muted">Uses the project cue track and Pro Subtitles typography inside this object circle.</p>
      </div>
    </div>)}
    <button type="button" onClick={addEffect} disabled={settings.effects.length >= 16}>+ Circular Spectrum</button>
  </section>;
}
