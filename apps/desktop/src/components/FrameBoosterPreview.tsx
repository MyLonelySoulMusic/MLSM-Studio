import { useEffect, useRef, useState, type ReactElement } from "react";
import { useProjectStore } from "../store/project-store";
import { getFrameBoosterSourceFile } from "../services/frame-booster-source-file";
import { frameInterpolationJob, resolveFrameInterpolationTarget, type FrameInterpolationJobStatus } from "../services/frame-interpolation-client";

export function FrameBoosterPreview(): ReactElement {
  const settings = useProjectStore((state) => state.project.animation.frameBooster); const update = useProjectStore((state) => state.updateFrameBooster);
  const videoRef = useRef<HTMLVideoElement>(null); const [status, setStatus] = useState<FrameInterpolationJobStatus | null>(null); const [resultUrl, setResultUrl] = useState<string | null>(null); const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);
  useEffect(() => { if (videoRef.current && settings.sourceUrl) videoRef.current.load(); }, [settings.sourceUrl]);
  const run = async () => {
    const file = getFrameBoosterSourceFile(settings.sourceUrl); if (!file) { setStatus({ id: "local", phase: "error", progress: 0, stageProgress: 0, currentFrame: 0, totalFrames: 0, indeterminate: false, error: "Il file sorgente non è più disponibile: ricaricalo." }); return; }
    const target = resolveFrameInterpolationTarget(settings.sourceFps, settings.targetMode, settings.targetMode === "multiplier" ? settings.targetMultiplier : settings.targetFps);
    const targetFps = settings.targetMode === "fps" ? (target ?? settings.targetFps) : undefined; controller.current?.abort(); const nextController = new AbortController(); controller.current = nextController;
    setResultUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return null; }); setStatus(null);
    try {
      const result = await frameInterpolationJob({ blob: file, fileName: file.name, method: settings.method, ...(targetFps === undefined ? { targetMultiplier: settings.targetMultiplier } : { targetFps }), device: settings.device, rifeModel: settings.rifeModel, precision: settings.precision, signal: nextController.signal, onStatus: (nextStatus) => { if (controller.current === nextController) setStatus(nextStatus); } });
      if (controller.current !== nextController) return;
      const url = URL.createObjectURL(result.blob); setResultUrl(url); setStatus(result.status); const output = result.status.output; update({ lastOutput: { name: `${settings.sourceName.replace(/\.[^.]+$/, "")}-boosted.mp4`, fps: output?.fps ?? result.status.targetFps ?? targetFps ?? 0, frameCount: output?.frameCount ?? result.status.totalFrames, durationSeconds: output?.durationSeconds ?? settings.sourceDurationSeconds, width: output?.width ?? settings.sourceWidth, height: output?.height ?? settings.sourceHeight, hasAudio: output?.hasAudio ?? settings.sourceHasAudio, backend: result.status.backend ?? settings.method } });
    } catch (error) {
      if (controller.current !== nextController) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus((current) => {
          const next: FrameInterpolationJobStatus = { ...(current ?? { id: "local", phase: "cancelled", progress: 0, stageProgress: null, currentFrame: 0, totalFrames: 0, indeterminate: false }), phase: "cancelled", stageProgress: null, indeterminate: false, estimatedRemainingSeconds: null };
          delete next.error;
          return next;
        });
      } else setStatus((current) => ({ ...(current ?? { id: "local", phase: "error", progress: 0, stageProgress: 0, currentFrame: 0, totalFrames: 0, indeterminate: false }), phase: "error", error: error instanceof Error ? error.message : String(error) }));
    } finally { if (controller.current === nextController) controller.current = null; }
  };
  useEffect(() => { const handler = () => { void run(); }; window.addEventListener("frame-booster:export", handler); return () => window.removeEventListener("frame-booster:export", handler); });
  const cancel = () => controller.current?.abort(); const percentage = status?.indeterminate ? null : Math.round((status?.stageProgress ?? status?.progress ?? 0) * 100); const busy = Boolean(status && !["ready", "error", "cancelled"].includes(status.phase));
  return <section className="frame-booster-preview"><div className="frame-booster-canvas"><video ref={videoRef} src={resultUrl ?? settings.sourceUrl ?? undefined} controls playsInline preload="metadata" /></div><div className="frame-booster-actions"><button type="button" className="primary" onClick={() => void run()} disabled={!settings.sourceUrl || busy}>Boost frames</button>{busy ? <button type="button" onClick={cancel}>Annulla</button> : null}</div>{status ? <div className="frame-booster-progress"><div className="frame-booster-progress__head"><strong>{status.phase}</strong><span>{percentage === null ? "Elaborazione GPU in corso…" : `${percentage}%`}</span></div><div className="frame-booster-progress__track"><span className={percentage === null ? "is-indeterminate" : ""} style={percentage === null ? undefined : { width: `${percentage}%` }} /></div>{status.currentFrame || status.totalFrames ? <small>{status.currentFrame} / {status.totalFrames} frame{status.estimatedRemainingSeconds ? ` · ~${Math.ceil(status.estimatedRemainingSeconds)} s` : ""}</small> : null}{status.error ? <p className="status-error">{status.error}</p> : null}</div> : null}{resultUrl ? <a className="frame-booster-download" href={resultUrl} download={`${settings.sourceName.replace(/\.[^.]+$/, "")}-boosted.mp4`}>Scarica video interpolato</a> : null}</section>;
}
