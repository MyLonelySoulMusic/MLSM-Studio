import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useProjectStore } from "../store/project-store";
import { getFrameBoosterSourceFile } from "../services/frame-booster-source-file";
import { frameInterpolationJob, normalizeFrameInterpolationMethod, resolveFrameInterpolationTarget, type FrameInterpolationJobStatus } from "../services/frame-interpolation-client";
import { assertInterpolationIntegrity } from "../services/frame-interpolation-audit";
import { chooseUpscalerVideoSaveTarget, saveUpscalerVideoArtifact, type UpscalerVideoSaveTarget } from "../services/upscaler-video-artifact";

interface FrameBoosterArtifact {
  key: string;
  blob: Blob;
  url: string;
  fileName: string;
  resultPath?: string;
}

interface FrameBoosterOperation {
  key: string;
  controller: AbortController;
  promise: Promise<FrameBoosterArtifact | null>;
}

function outputKey(settings: ReturnType<typeof useProjectStore.getState>["project"]["animation"]["frameBooster"]): string {
  return JSON.stringify({
    sourceUrl: settings.sourceUrl,
    method: normalizeFrameInterpolationMethod(settings.method),
    targetMode: settings.targetMode,
    targetMultiplier: settings.targetMultiplier,
    targetFps: settings.targetFps
  });
}

function outputName(sourceName: string): string {
  return `${sourceName.replace(/\.[^.]+$/, "") || "video"}-boosted.mp4`;
}

function initialStatus(phase: FrameInterpolationJobStatus["phase"] = "uploading"): FrameInterpolationJobStatus {
  return { id: "local", phase, progress: 0, stageProgress: 0, currentFrame: 0, totalFrames: 0, indeterminate: false };
}

export function FrameBoosterPreview(): ReactElement {
  const settings = useProjectStore((state) => state.project.animation.frameBooster);
  const update = useProjectStore((state) => state.updateFrameBooster);
  const videoRef = useRef<HTMLVideoElement>(null);
  const operation = useRef<FrameBoosterOperation | null>(null);
  const artifactRef = useRef<FrameBoosterArtifact | null>(null);
  const exportRequest = useRef(false);
  const previousKey = useRef(outputKey(settings));
  const [status, setStatus] = useState<FrameInterpolationJobStatus | null>(null);
  const [artifact, setArtifact] = useState<FrameBoosterArtifact | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const key = outputKey(settings);

  const replaceArtifact = useCallback((next: FrameBoosterArtifact | null) => {
    const previous = artifactRef.current;
    artifactRef.current = next;
    setArtifact(next);
    if (previous && previous.url !== next?.url) URL.revokeObjectURL(previous.url);
  }, []);

  const resetRuntime = useCallback(() => {
    operation.current?.controller.abort();
    operation.current = null;
    replaceArtifact(null);
    setStatus(null);
    setSaving(false);
    exportRequest.current = false;
    setNotice(null);
  }, [replaceArtifact]);

  useEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    resetRuntime();
  }, [key, resetRuntime]);

  useEffect(() => {
    const reset = () => resetRuntime();
    window.addEventListener("frame-booster:reset", reset);
    return () => {
      window.removeEventListener("frame-booster:reset", reset);
      operation.current?.controller.abort();
      operation.current = null;
      const current = artifactRef.current;
      artifactRef.current = null;
      if (current) URL.revokeObjectURL(current.url);
    };
  }, [resetRuntime]);

  useEffect(() => {
    if (videoRef.current && settings.sourceUrl) videoRef.current.load();
  }, [artifact?.url, settings.sourceUrl]);

  const run = useCallback((): Promise<FrameBoosterArtifact | null> => {
    const currentKey = outputKey(settings);
    if (artifactRef.current?.key === currentKey) return Promise.resolve(artifactRef.current);
    if (operation.current?.key === currentKey) return operation.current.promise;
    operation.current?.controller.abort();

    const file = getFrameBoosterSourceFile(settings.sourceUrl);
    if (!file) {
      setStatus({ ...initialStatus("error"), error: "Il file sorgente non è più disponibile: caricalo di nuovo." });
      return Promise.resolve(null);
    }
    const target = resolveFrameInterpolationTarget(settings.sourceFps, settings.targetMode, settings.targetMode === "multiplier" ? settings.targetMultiplier : settings.targetFps);
    const targetFps = settings.targetMode === "fps" ? (target ?? settings.targetFps) : undefined;
    const controller = new AbortController();
    const owner: FrameBoosterOperation = { key: currentKey, controller, promise: Promise.resolve(null) };
    operation.current = owner;
    replaceArtifact(null);
    setNotice(null);
    setStatus(initialStatus());

    owner.promise = (async () => {
      try {
        const result = await frameInterpolationJob({
          blob: file,
          fileName: file.name,
          method: normalizeFrameInterpolationMethod(settings.method),
          ...(targetFps === undefined ? { targetMultiplier: settings.targetMultiplier } : { targetFps, ...(settings.sourceFps ? { sourceFps: settings.sourceFps } : {}) }),
          signal: controller.signal,
          onStatus: (nextStatus) => {
            if (operation.current === owner && outputKey(useProjectStore.getState().project.animation.frameBooster) === currentKey) setStatus(nextStatus);
          }
        });
        if (operation.current !== owner || outputKey(useProjectStore.getState().project.animation.frameBooster) !== currentKey) return null;
        if (!result.blob.size) throw new Error("Il backend ha restituito un video vuoto.");
        const source = result.status.source;
        const output = result.status.output;
        const auditedTargetFps = result.status.targetFps ?? targetFps;
        if (!source || !output || !auditedTargetFps) throw new Error("Il backend non ha restituito l’audit completo del video interpolato.");
        assertInterpolationIntegrity({ source, output, targetFps: auditedTargetFps });
        const fileName = outputName(settings.sourceName);
        const next: FrameBoosterArtifact = {
          key: currentKey,
          blob: result.blob,
          url: URL.createObjectURL(result.blob),
          fileName,
          ...(result.status.resultPath ? { resultPath: result.status.resultPath } : {})
        };
        replaceArtifact(next);
        setStatus(result.status);
        update({
          sourceFps: source.fps,
          sourceFrameCount: source.frameCount,
          sourceWidth: source.width,
          sourceHeight: source.height,
          sourceDurationSeconds: source.durationSeconds,
          sourceHasAudio: source.hasAudio,
          lastOutput: {
            name: fileName,
            fps: output.fps,
            frameCount: output.frameCount,
            durationSeconds: output.durationSeconds,
            width: output.width,
            height: output.height,
            hasAudio: output.hasAudio,
            backend: result.status.backend ?? settings.method
          }
        });
        setNotice("Video interpolato e verificato. Puoi riprodurlo o salvarlo senza ricalcolarlo.");
        return next;
      } catch (error) {
        if (operation.current !== owner) return null;
        if (error instanceof DOMException && error.name === "AbortError") {
          setStatus((current) => {
            const cancelled: FrameInterpolationJobStatus = { ...(current ?? initialStatus("cancelled")), phase: "cancelled", stageProgress: null, indeterminate: false, estimatedRemainingSeconds: null };
            delete cancelled.error;
            return cancelled;
          });
        } else {
          setStatus((current) => ({ ...(current ?? initialStatus("error")), phase: "error", indeterminate: false, error: error instanceof Error ? error.message : String(error) }));
        }
        return null;
      } finally {
        if (operation.current === owner) operation.current = null;
      }
    })();
    return owner.promise;
  }, [replaceArtifact, settings, update]);

  const saveArtifact = useCallback(async (current: FrameBoosterArtifact, target?: UpscalerVideoSaveTarget | null) => {
    const destination = target === undefined ? await chooseUpscalerVideoSaveTarget(current.fileName) : target;
    if (!destination) return;
    setSaving(true);
    setNotice(null);
    try {
      const receipt = await saveUpscalerVideoArtifact(destination, current);
      if (artifactRef.current === current) setNotice(`Video salvato · ${receipt.destination} · ${(receipt.bytes / 1024 / 1024).toFixed(1)} MB`);
    } catch (error) {
      if (artifactRef.current === current) {
        setNotice(null);
        setStatus((currentStatus) => ({ ...(currentStatus ?? initialStatus("error")), phase: "error", error: error instanceof Error ? error.message : String(error) }));
      }
    } finally { if (artifactRef.current === current) setSaving(false); }
  }, []);

  const exportCurrent = useCallback(async () => {
    if (saving || exportRequest.current) return;
    exportRequest.current = true;
    try {
      const current = artifactRef.current?.key === key ? artifactRef.current : null;
      const fileName = current?.fileName ?? outputName(settings.sourceName);
      const target = await chooseUpscalerVideoSaveTarget(fileName);
      if (!target) return;
      const ready = current ?? await run();
      if (ready && ready.key === outputKey(useProjectStore.getState().project.animation.frameBooster)) await saveArtifact(ready, target);
    } finally { exportRequest.current = false; }
  }, [key, run, saveArtifact, saving, settings.sourceName]);

  useEffect(() => {
    const handler = () => { void exportCurrent(); };
    window.addEventListener("frame-booster:export", handler);
    return () => window.removeEventListener("frame-booster:export", handler);
  }, [exportCurrent]);

  const cancel = () => operation.current?.controller.abort();
  const percentage = status?.indeterminate ? null : Math.round((status?.stageProgress ?? status?.progress ?? 0) * 100);
  const busy = Boolean(operation.current) || Boolean(status && !["ready", "error", "cancelled"].includes(status.phase));
  const displayedUrl = artifact?.key === key ? artifact.url : settings.sourceUrl;

  return <section className="frame-booster-preview">
    <div className="frame-booster-canvas">
      {displayedUrl ? <video ref={videoRef} src={displayedUrl} controls playsInline preload="metadata" /> : <div className="frame-booster-empty"><span aria-hidden="true">＋</span><strong>Carica un video per iniziare</strong><small>La preview originale e il risultato verificato appariranno qui.</small></div>}
      {artifact?.key === key ? <span className="frame-booster-result-badge">Risultato verificato</span> : displayedUrl ? <span className="frame-booster-result-badge is-source">Sorgente</span> : null}
    </div>
    <div className="frame-booster-actions">
      <button type="button" className="primary" onClick={() => void run()} disabled={!settings.sourceUrl || busy || saving || artifact?.key === key}>{artifact?.key === key ? "Già elaborato" : "Boost frames"}</button>
      {busy ? <button type="button" onClick={cancel}>Annulla</button> : null}
      {artifact?.key === key ? <button type="button" className="primary" onClick={() => void saveArtifact(artifact)} disabled={saving}>{saving ? "Salvataggio…" : "Salva video"}</button> : null}
    </div>
    {status ? <div className={`frame-booster-progress is-${status.phase}`}>
      <div className="frame-booster-progress__head"><strong>{status.phaseLabel ?? status.phase}</strong><span>{percentage === null ? "Elaborazione in corso…" : `${percentage}%`}</span></div>
      <div className="frame-booster-progress__track"><span className={percentage === null ? "is-indeterminate" : ""} style={percentage === null ? undefined : { width: `${percentage}%` }} /></div>
      {status.currentFrame || status.totalFrames ? <small>{status.currentFrame} / {status.totalFrames} frame{status.estimatedRemainingSeconds ? ` · circa ${Math.ceil(status.estimatedRemainingSeconds)} s` : ""}</small> : null}
      {status.error ? <p className="status-error" role="alert">{status.error}</p> : null}
    </div> : null}
    {notice ? <p className="frame-booster-notice" role="status">{notice}</p> : null}
  </section>;
}
