import { useEffect, useMemo, useState } from "react";
import {
  videoEditorInterpolationCommand,
  videoEditorInterpolationHealth,
  type VideoEditorInterpolationHealth,
  type VideoEditorInterpolationMethod
} from "../services/video-editor-interpolation-client";
import type { UiLanguage } from "../services/ui-preferences";

export interface VideoEditorInterpolationSelection {
  enabled: boolean;
  targetFps: number;
  method: VideoEditorInterpolationMethod;
}

interface Props {
  language: UiLanguage;
  baseFps: number;
  disabled: boolean;
  value: VideoEditorInterpolationSelection;
  onChange: (next: VideoEditorInterpolationSelection) => void;
}

const interpolationTargets = [48, 50, 60, 90, 100, 120, 144, 240] as const;

const methodLabels = {
  it: {
    motion: "Stima del movimento · ffmpeg · consigliata",
    blend: "Fusione fotogrammi · veloce",
    rife: "RIFE su GPU · qualità massima"
  },
  en: {
    motion: "Motion estimation · ffmpeg · recommended",
    blend: "Frame blend · fast",
    rife: "RIFE on GPU · highest quality"
  }
} as const;

const copy = {
  it: {
    title: "Interpolazione fotogrammi",
    optional: "facoltativa",
    base: (fps: number) => `Render base: ${fps} fps · l’aumento viene applicato dopo la verifica.`,
    toggle: "Aumenta i fotogrammi dopo la codifica",
    off: "Disattivata",
    ready: "Pronto",
    checking: "Verifica…",
    unavailable: "Servizio non disponibile",
    methodUnavailable: "Metodo non disponibile",
    noTarget: (fps: number) => `Nessun target sopra ${fps} fps`,
    target: "Target",
    targetOption: (target: number, fps: number) => `${target} fps · da ${fps} fps`,
    method: "Metodo",
    unavailableBody: (fps: number) => `L’export resta disponibile a ${fps} fps senza interpolazione.`,
    methodUnavailableBody: (method: VideoEditorInterpolationMethod, fps: number) => method === "rife"
      ? `Pesi RIFE assenti: l’export resta disponibile a ${fps} fps.`
      : `ffmpeg non disponibile: l’export resta disponibile a ${fps} fps.`,
    readyBody: (fps: number) => `File a ${fps} fps verificato; l’aumento viene applicato dopo la codifica.`,
    setup: "Setup del servizio",
    setupBody: "Apri un secondo terminale nella cartella del progetto, avvia il servizio e riapri Export."
  },
  en: {
    title: "Frame interpolation",
    optional: "optional",
    base: (fps: number) => `Base render: ${fps} fps · any increase is applied after verification.`,
    toggle: "Increase frames after encoding",
    off: "Off",
    ready: "Ready",
    checking: "Checking…",
    unavailable: "Service unavailable",
    methodUnavailable: "Method unavailable",
    noTarget: (fps: number) => `No target above ${fps} fps`,
    target: "Target",
    targetOption: (target: number, fps: number) => `${target} fps · from ${fps} fps`,
    method: "Method",
    unavailableBody: (fps: number) => `Export remains available at ${fps} fps without interpolation.`,
    methodUnavailableBody: (method: VideoEditorInterpolationMethod, fps: number) => method === "rife"
      ? `RIFE weights are missing: export remains available at ${fps} fps.`
      : `ffmpeg is unavailable: export remains available at ${fps} fps.`,
    readyBody: (fps: number) => `The ${fps} fps file is verified; the increase is applied after encoding.`,
    setup: "Service setup",
    setupBody: "Open a second terminal in the project folder, start the service, then reopen Export."
  }
} as const;

export function VideoEditorFrameInterpolationSection({ language, baseFps, disabled, value, onChange }: Props) {
  const labels = copy[language];
  const [health, setHealth] = useState<VideoEditorInterpolationHealth | null | "checking">("checking");
  const targets = useMemo(() => interpolationTargets.filter((target) => target > baseFps), [baseFps]);
  const targetFps = targets.includes(value.targetFps as typeof interpolationTargets[number]) ? value.targetFps : targets[0] ?? baseFps;
  const methodUnavailable = value.enabled && health !== null && health !== "checking" && (value.method === "rife" ? !health.rife : !health.ffmpeg);

  useEffect(() => {
    let active = true;
    setHealth("checking");
    void videoEditorInterpolationHealth().then((next) => { if (active) setHealth(next); });
    return () => { active = false; };
  }, []);

  const update = (patch: Partial<VideoEditorInterpolationSelection>) => onChange({ ...value, ...patch, targetFps: patch.targetFps ?? targetFps });
  const status = !value.enabled || targets.length === 0
    ? (targets.length === 0 ? labels.noTarget(baseFps) : labels.off)
    : health === "checking" ? labels.checking
      : health === null ? labels.unavailable
        : methodUnavailable ? labels.methodUnavailable : labels.ready;
  const statusTone = value.enabled && (health === null || methodUnavailable) ? "warning" : "neutral";
  return <section className="export-interpolation" aria-labelledby="export-interpolation-title">
    <header className="export-interpolation__header">
      <div>
        <h3 id="export-interpolation-title">{labels.title} <small>({labels.optional})</small></h3>
        <p>{labels.base(baseFps)}</p>
      </div>
      <span
        className={`export-interpolation__status export-interpolation__status--${statusTone}`}
        role="status"
        aria-live="polite"
      >
        {status}
      </span>
    </header>
    <label className="export-interpolation__toggle"><span>{labels.toggle}</span><input aria-label={language === "it" ? "Attiva interpolazione dei fotogrammi" : "Enable frame interpolation"} type="checkbox" checked={value.enabled} onChange={(event) => update({ enabled: event.target.checked })} disabled={disabled || targets.length === 0} /></label>
    {targets.length === 0 ? <p className="export-interpolation__muted">{labels.noTarget(baseFps)}</p> : value.enabled ? <>
      <div className="export-interpolation__grid">
        <label>{labels.target}<select aria-label={language === "it" ? "Frame rate interpolato" : "Interpolated frame rate"} value={targetFps} onChange={(event) => update({ targetFps: Number(event.target.value) })} disabled={disabled}>{targets.map((target) => <option key={target} value={target}>{labels.targetOption(target, baseFps)}</option>)}</select></label>
        <label>{labels.method}<select aria-label={language === "it" ? "Metodo di interpolazione" : "Interpolation method"} value={value.method} onChange={(event) => update({ method: event.target.value as VideoEditorInterpolationMethod })} disabled={disabled}>{(["motion", "blend", "rife"] as const).map((method) => <option key={method} value={method}>{methodLabels[language][method]}</option>)}</select></label>
      </div>
      {health === "checking" ? <p className="export-interpolation__notice">{labels.checking}</p> : null}
      {health === null ? <div className="export-interpolation__notice export-interpolation__notice--warning"><p>{labels.unavailableBody(baseFps)}</p><details className="export-interpolation__setup"><summary>{labels.setup}</summary><p>{labels.setupBody}</p><code>{videoEditorInterpolationCommand}</code><code>brew install ffmpeg</code></details></div> : null}
      {methodUnavailable ? <div className="export-interpolation__notice export-interpolation__notice--warning"><p>{labels.methodUnavailableBody(value.method, baseFps)}</p><details className="export-interpolation__setup"><summary>{labels.setup}</summary><p>{labels.setupBody}</p><code>{videoEditorInterpolationCommand}</code><code>brew install ffmpeg</code></details></div> : null}
      {health !== null && health !== "checking" && !methodUnavailable ? <p className="export-interpolation__notice">{labels.readyBody(baseFps)}</p> : null}
    </> : null}
  </section>;
}
