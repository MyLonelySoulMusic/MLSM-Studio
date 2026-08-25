import { useEffect, useState, type ReactElement } from "react";
import { useProjectStore } from "../store/project-store";
import { registerFrameBoosterSourceFile } from "../services/frame-booster-source-file";
import { frameInterpolationHealth, frameInterpolationMethodAvailable, frameInterpolationPrepareRife, type FrameInterpolationCapabilities } from "../services/frame-interpolation-client";

export function FrameBoosterPanel(): ReactElement {
  const settings = useProjectStore((state) => state.project.animation.frameBooster);
  const update = useProjectStore((state) => state.updateFrameBooster);
  const [capabilities, setCapabilities] = useState<FrameInterpolationCapabilities | null>(null);
  const [checking, setChecking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const check = async () => { setChecking(true); setCapabilities(await frameInterpolationHealth(true)); setChecking(false); };
  useEffect(() => { void check(); }, []);
  const prepare = async () => {
    setPreparing(true); setRuntimeError(null);
    try { setCapabilities(await frameInterpolationPrepareRife()); }
    catch (error) { setRuntimeError(error instanceof Error ? error.message : String(error)); }
    finally { setPreparing(false); }
  };
  const upload = (file: File) => {
    const url = URL.createObjectURL(file); registerFrameBoosterSourceFile(url, file);
    const video = document.createElement("video"); video.preload = "metadata"; video.muted = true; video.onloadedmetadata = () => {
      const fps = Number.isFinite(video.duration) && video.duration > 0 ? null : null;
      update({ sourceUrl: url, sourceName: file.name, sourceWidth: video.videoWidth, sourceHeight: video.videoHeight, sourceDurationSeconds: Number.isFinite(video.duration) ? video.duration : 0, sourceFps: fps, sourceFrameCount: null, sourceHasAudio: false });
    }; video.src = url;
  };
  const effectiveRife = frameInterpolationMethodAvailable("rife", capabilities, settings.device, settings.precision);
  return <section className="frame-booster-panel">
    <h2>Frame Booster</h2>
    <p className="muted">Aumenta i fotogrammi del video preservando risoluzione, rapporto e audio.</p>
    <label className="flyer-upload">Carica video<input aria-label="Carica video Frame Booster" type="file" accept="video/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} /></label>
    {settings.sourceName ? <p className="frame-booster-source"><strong>{settings.sourceName}</strong><span>{settings.sourceWidth} × {settings.sourceHeight} · {settings.sourceDurationSeconds.toFixed(2)} s{settings.sourceFps ? ` · ${settings.sourceFps.toFixed(3)} fps` : " · fps rilevati dal servizio"}</span></p> : null}
    <label>Metodo<select aria-label="Metodo Frame Booster" value={settings.method} onChange={(event) => update({ method: event.target.value as typeof settings.method })}><option value="rife" disabled={!effectiveRife}>RIFE v4.26{effectiveRife ? "" : " · non verificato"}</option><option value="motion">Motion estimation · FFmpeg</option><option value="blend">Frame blend · FFmpeg</option></select></label>
    <label>Target<select aria-label="Target Frame Booster" value={settings.targetMode} onChange={(event) => update({ targetMode: event.target.value as typeof settings.targetMode })}><option value="multiplier">Moltiplicatore</option><option value="fps">FPS diretto</option></select></label>
    {settings.targetMode === "multiplier" ? <label>Moltiplicatore<select aria-label="Moltiplicatore Frame Booster" value={settings.targetMultiplier} onChange={(event) => update({ targetMultiplier: Number(event.target.value) as typeof settings.targetMultiplier })}>{[2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label> : <label>FPS target<input aria-label="FPS target Frame Booster" type="number" min="1" max="480" step=".01" value={settings.targetFps} onChange={(event) => update({ targetFps: Number(event.target.value) })} /></label>}
    <label>Device<select aria-label="Device Frame Booster" value={settings.device} onChange={(event) => update({ device: event.target.value as typeof settings.device })}><option value="auto">Auto</option><option value="mps" disabled={!capabilities?.rife.supportedDevices.includes("mps")}>Apple MPS</option><option value="cuda" disabled={!capabilities?.rife.supportedDevices.includes("cuda")}>CUDA</option><option value="cpu">CPU</option></select></label>
    {settings.method === "rife" ? <label>Precision<select aria-label="Precisione RIFE" value={settings.precision} onChange={(event) => update({ precision: event.target.value as typeof settings.precision })}><option value="auto">Auto</option><option value="fp32">FP32</option><option value="fp16" disabled={settings.device !== "cuda"}>FP16 · CUDA</option></select></label> : null}
    <div className={`frame-booster-capability ${capabilities?.rife.ready && capabilities.rife.verified && capabilities.rife.selfTest ? "is-ready" : "is-warning"}`}><strong>{checking ? "Verifica runtime…" : preparing ? "Download e self-test RIFE…" : capabilities?.rife.ready && capabilities.rife.verified && capabilities.rife.selfTest ? "RIFE verificato" : "RIFE non pronto"}</strong><span>{runtimeError ?? capabilities?.rife.reason ?? "Avvia il servizio locale per verificare FFmpeg e PyTorch."}</span>{!capabilities?.rife.ready || !capabilities.rife.selfTest ? <button type="button" onClick={() => void prepare()} disabled={checking || preparing}>{preparing ? "Preparazione…" : "Prepara RIFE v4.26"}</button> : null}<button type="button" onClick={() => void check()} disabled={checking || preparing}>Ricontrolla runtime</button></div>
  </section>;
}
