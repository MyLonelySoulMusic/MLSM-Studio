import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import type { RhythmBallProject } from "@rbs/project-schema";
import { createUpscalerFrameRenderer, resolveUpscalerPreviewSize, resolveUpscalerTarget } from "../services/upscaler-renderer";
import { generateAiUpscalerPreview, type ModelLoadProgress } from "../services/upscaler-ai";
import { shouldGenerateUpscalerAi, usesRemoteUpscaler } from "../services/remote-upscaler-client";
import { upscalerModels } from "../services/upscaler-runtime";
import { exportUpscaledVideo, type UpscalerVideoExportProgress, type UpscalerVideoExportResult } from "../services/upscaler-video-exporter";
import { chooseUpscalerVideoSaveTarget, prepareUpscalerVideoSaveTarget, saveUpscalerVideoArtifact } from "../services/upscaler-video-artifact";
import { getUpscalerSourceFile } from "../services/upscaler-source-file";
import { reportUpscalerDiagnostic, UPSCALER_REMOTE_CACHE_CLEARED_EVENT, type RemoteVideoCheckpointPolicy } from "../services/upscaler-python-client";
import { exportUpscalerImage } from "../services/upscaler-image-exporter";
import { useProjectStore } from "../store/project-store";
import { useUpscalerBatchStore } from "../store/upscaler-batch-store";
import { UPSCALER_PROJECT_REPLACED_EVENT } from "../services/upscaler-batch-lifecycle";

type Settings = RhythmBallProject["animation"]["upscaler"];

function loadImage(url: string): Promise<HTMLImageElement> { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("Immagine non leggibile")); image.src = url; }); }

function formatRemaining(milliseconds: number | undefined): string {
  if (!milliseconds || !Number.isFinite(milliseconds) || milliseconds <= 0) return "Calcolo tempo residuo…";
  const seconds = Math.ceil(milliseconds / 1_000);
  if (seconds < 60) return `Circa ${seconds} s rimanenti`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `Circa ${minutes} min rimanenti`;
  const hours = Math.floor(minutes / 60); const remainingMinutes = minutes % 60;
  return `Circa ${hours} h ${remainingMinutes} min rimanenti`;
}

function aiPreviewKey(settings: Settings): string {
  const remote = settings.remote;
  return [settings.sourceUrl, settings.model, settings.backend, settings.tileSize, settings.tta, settings.finalWidth, settings.finalHeight,
    JSON.stringify(settings.adjustments), remote.enabled, remote.model, remote.frameRetries, ...remote.endpoints.map((item) => `${item.id}:${item.enabled}:${item.url}`)].join(":");
}

function videoOutputKey(settings: Settings): string {
  return [settings.sourceUrl, settings.model, settings.backend, settings.tileSize, settings.tta, settings.finalWidth, settings.finalHeight,
    settings.lockAspectRatio, JSON.stringify(settings.adjustments), settings.remote.enabled, settings.remote.model,
    settings.remote.frameRetries, ...settings.remote.endpoints.map((item) => `${item.id}:${item.enabled}:${item.url}`)].join(":");
}

interface UpscalerVideoArtifact extends UpscalerVideoExportResult {
  key: string;
  url: string;
  blob: Blob;
  remote: boolean;
}

interface UpscalerExportOperation {
  key: string;
  controller: AbortController | null;
  promise: Promise<void>;
}

interface RemoteCheckpointPrompt {
  outputKey: string;
  saveWhenReady: boolean;
  sourceName: string;
}

function remoteEndpointLabel(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function UpscalerPreview({ settings, fullscreen = false }: { settings: Settings; fullscreen?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null); const scrollHost = useRef<HTMLDivElement>(null); const video = useRef<HTMLVideoElement>(null); const image = useRef<HTMLImageElement | null>(null);
  const panStart = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const sourceToken = useRef(""); const latestSettings = useRef(settings);
  latestSettings.current = settings;
  const aiPreview = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null); const previewController = useRef<AbortController | null>(null); const previewOperation = useRef<{ key: string; promise: Promise<boolean> } | null>(null); const exportController = useRef<AbortController | null>(null); const exportOperation = useRef<UpscalerExportOperation | null>(null); const exportAction = useRef<() => void>(() => undefined); const videoArtifactRef = useRef<UpscalerVideoArtifact | null>(null); const projectName = useProjectStore((state) => state.project.project.name); const update = useProjectStore((state) => state.updateUpscaler); const batchRunning = useUpscalerBatchStore((state) => state.running); const beginSingleOperation = useUpscalerBatchStore((state) => state.beginSingleOperation); const endSingleOperation = useUpscalerBatchStore((state) => state.endSingleOperation);
  const [ready, setReady] = useState(false); const [playing, setPlaying] = useState(false); const [time, setTime] = useState(0); const [exporting, setExporting] = useState(false); const [videoProgress, setVideoProgress] = useState<UpscalerVideoExportProgress | null>(null); const [videoArtifact, setVideoArtifact] = useState<UpscalerVideoArtifact | null>(null); const [checkpointPrompt, setCheckpointPrompt] = useState<RemoteCheckpointPrompt | null>(null); const [savedDestination, setSavedDestination] = useState(""); const [error, setError] = useState(""); const [previewGenerated, setPreviewGenerated] = useState(false); const [generatingPreview, setGeneratingPreview] = useState(false); const [modelProgress, setModelProgress] = useState<ModelLoadProgress | null>(null); const [previewRevision, setPreviewRevision] = useState(0); const [detailZoom, setDetailZoom] = useState(1); const [panning, setPanning] = useState(false);
  const outputKey = useMemo(() => videoOutputKey(settings), [settings]);
  const displaySourceUrl = settings.sourceKind === "video" && videoArtifact?.key === outputKey ? videoArtifact.url : settings.sourceUrl;
  const previewSize = useMemo(() => resolveUpscalerPreviewSize(settings.finalWidth, settings.finalHeight), [settings.finalHeight, settings.finalWidth]);
  const clearVideoArtifact = useCallback(() => {
    const current = videoArtifactRef.current;
    videoArtifactRef.current = null;
    if (current) URL.revokeObjectURL(current.url);
    setVideoArtifact(null);
    setSavedDestination("");
  }, []);
  useEffect(() => { if (videoArtifactRef.current && videoArtifactRef.current.key !== outputKey) clearVideoArtifact(); }, [clearVideoArtifact, outputKey]);
  useEffect(() => () => { const current = videoArtifactRef.current; videoArtifactRef.current = null; if (current) URL.revokeObjectURL(current.url); }, []);
  useEffect(() => {
    const handleCacheCleared = () => { if (videoArtifactRef.current?.remote) { clearVideoArtifact(); setVideoProgress(null); setError(""); } };
    window.addEventListener(UPSCALER_REMOTE_CACHE_CLEARED_EVENT, handleCacheCleared);
    return () => window.removeEventListener(UPSCALER_REMOTE_CACHE_CLEARED_EVENT, handleCacheCleared);
  }, [clearVideoArtifact]);
  useEffect(() => {
    // A source/settings replacement is a hard export boundary. Detach first so
    // a late finally/progress callback from A cannot mutate the UI for B.
    const active = exportOperation.current;
    if (active && active.key !== `video:${outputKey}` && active.key !== `image:${aiPreviewKey(settings)}`) {
      active.controller?.abort();
      exportOperation.current = null;
      if (exportController.current === active.controller) exportController.current = null;
      setExporting(false);
      setVideoProgress(null);
    }
    setCheckpointPrompt((current) => current?.outputKey === outputKey ? current : null);
  }, [outputKey, settings]);
  const handleVideoMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const item = event.currentTarget; const current = latestSettings.current;
    const expectedSource = sourceToken.current;
    const loadedSource = item.currentSrc || item.src;
    // A video element can dispatch a late metadata event for the previous blob
    // after React has already switched to a new source. Never let that event
    // overwrite the dimensions belonging to the current source.
    if (item !== video.current || !expectedSource || !loadedSource || (loadedSource !== expectedSource && loadedSource !== new URL(expectedSource, document.baseURI).href)) return;
    if (videoArtifactRef.current?.url === expectedSource) { setReady(true); return; }
    const sourceWidth = Math.round(item.videoWidth); const sourceHeight = Math.round(item.videoHeight);
    const durationSeconds = Number.isFinite(item.duration) && item.duration > 0 ? item.duration : 0;
    const patch: Partial<Settings> = { durationSeconds };
    if (sourceWidth > 0 && sourceHeight > 0) {
      patch.sourceWidth = sourceWidth; patch.sourceHeight = sourceHeight;
      if (current.lockAspectRatio) {
        // Keep the user-selected width as the authoritative axis. If an older
        // project has no usable source metadata, fall back to its explicit scale.
        const preferredWidth = current.finalWidth > 0 ? current.finalWidth : sourceWidth * current.scale;
        const preferredScale = preferredWidth > 0 && sourceWidth > 0 ? preferredWidth / sourceWidth : current.scale;
        const target = resolveUpscalerTarget(sourceWidth, sourceHeight, preferredScale);
        patch.finalWidth = target.width; patch.finalHeight = target.height; patch.scale = target.width / sourceWidth;
      }
    }
    const changed = patch.sourceWidth !== current.sourceWidth || patch.sourceHeight !== current.sourceHeight || patch.durationSeconds !== current.durationSeconds || patch.finalWidth !== current.finalWidth || patch.finalHeight !== current.finalHeight || patch.scale !== current.scale;
    if (changed) update(patch);
    setReady(true);
  }, [update]);
  useEffect(() => {
    sourceToken.current = displaySourceUrl ?? "";
    previewController.current?.abort(); previewOperation.current = null; aiPreview.current = null; setReady(false); setPlaying(false); setPreviewGenerated(false); setGeneratingPreview(false); setModelProgress(null); setError(""); image.current = null; const item = video.current; const surface = canvas.current;
    if (surface) { surface.width = 0; surface.height = 0; }
    if (!displaySourceUrl) return;
    if (settings.sourceKind === "image") { let active = true; let loadedImage: HTMLImageElement | null = null; void loadImage(displaySourceUrl).then((loaded) => { loadedImage = loaded; if (active) { image.current = loaded; setReady(true); } else loaded.src = ""; }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }); return () => { active = false; if (loadedImage) loadedImage.src = ""; }; }
    if (item) { item.src = displaySourceUrl; item.load(); }
  }, [displaySourceUrl, settings.sourceKind, settings.sourceUrl]);
  const generatePreview = useCallback(async () => {
    const source = settings.sourceKind === "video" ? video.current : image.current; if (!settings.sourceUrl || !source || batchRunning) return false;
    const key = aiPreviewKey(settings); const existing = previewOperation.current;
    if (existing?.key === key) return existing.promise;
    const owner = beginSingleOperation(); if (!owner) return false;
    previewController.current?.abort(); const controller = new AbortController(); previewController.current = controller; setGeneratingPreview(true); setError(""); setModelProgress(null);
    const isCurrent = () => previewController.current === controller && !controller.signal.aborted && aiPreviewKey(latestSettings.current) === key;
    const operation = Promise.resolve().then(async () => {
      try {
        const generated = shouldGenerateUpscalerAi(settings) ? await generateAiUpscalerPreview(source, settings, (progress) => { if (isCurrent()) setModelProgress(progress); }, controller.signal) : null;
        if (!isCurrent()) return false;
        aiPreview.current = generated ? { key, canvas: generated } : null;
        setPreviewGenerated(true); setPreviewRevision((value) => value + 1);
        return true;
      } catch (reason) { if (isCurrent() && !(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : String(reason)); return false; }
      finally {
        if (previewController.current === controller) { previewController.current = null; previewOperation.current = null; setGeneratingPreview(false); }
        endSingleOperation(owner);
      }
    });
    previewOperation.current = { key, promise: operation };
    return operation;
  }, [batchRunning, beginSingleOperation, endSingleOperation, settings]);
  useEffect(() => { const handle = () => generatePreview(); window.addEventListener("upscaler:generate-preview", handle); return () => window.removeEventListener("upscaler:generate-preview", handle); }, [generatePreview]);
  useEffect(() => { if (batchRunning) { previewController.current?.abort(); exportController.current?.abort(); } }, [batchRunning]);
  useEffect(() => { previewController.current?.abort(); previewOperation.current = null; aiPreview.current = null; setPreviewGenerated(false); setGeneratingPreview(false); setModelProgress(null); }, [settings.backend, settings.finalHeight, settings.finalWidth, settings.model, settings.remote, settings.sourceUrl, settings.tileSize, settings.tta]);
  useEffect(() => {
    const surface = canvas.current; if (!surface || !ready) return; surface.width = previewSize.width; surface.height = previewSize.height;
    const context = surface.getContext("2d", { alpha: false }); if (!context) return; const render = createUpscalerFrameRenderer(surface.width, surface.height); let frame = 0;
    const draw = () => { const source = settings.sourceKind === "video" ? video.current : image.current; const enhanced = aiPreview.current?.key === aiPreviewKey(settings) ? aiPreview.current.canvas : null; if (source) { if (videoArtifact?.key === outputKey) context.drawImage(source, 0, 0, surface.width, surface.height); else render(context, source, previewGenerated ? settings : { ...settings, comparisonMode: "original", originalBlend: 0 }, true, enhanced); } if (settings.sourceKind === "video" && playing) frame = requestAnimationFrame(draw); };
    draw(); return () => cancelAnimationFrame(frame);
  }, [outputKey, playing, previewGenerated, previewRevision, previewSize, ready, settings, videoArtifact]);
  const toggleVideo = () => { const item = video.current; if (!item) return; if (item.paused) void item.play().then(() => setPlaying(true)).catch(() => undefined); else { item.pause(); setPlaying(false); } };
  const exportImage = (): Promise<void> => {
    if (!image.current || batchRunning) return Promise.resolve();
    const key = aiPreviewKey(settings); const operationKey = `image:${key}`;
    const existing = exportOperation.current;
    if (existing?.key === operationKey) return existing.promise;
    if (existing) { existing.controller?.abort(); exportOperation.current = null; }
    const owner = beginSingleOperation(); if (!owner) return Promise.resolve();
    const source = image.current; const controller = new AbortController(); exportController.current = controller;
    const operationOwner: UpscalerExportOperation = { key: operationKey, controller, promise: Promise.resolve() };
    const isCurrent = () => exportOperation.current === operationOwner && exportController.current === controller && !controller.signal.aborted && aiPreviewKey(latestSettings.current) === key;
    const operation = Promise.resolve().then(async () => {
      if (!isCurrent()) return;
      setExporting(true); setError("");
      try {
        const pendingPreview = previewOperation.current;
        if (shouldGenerateUpscalerAi(settings) && aiPreview.current?.key !== key && pendingPreview?.key === key) await pendingPreview.promise;
        if (!isCurrent()) return;
        const currentPreview = aiPreview.current?.key === key ? aiPreview.current.canvas : null;
        const generated = await exportUpscalerImage({ source, settings, aiEnhancedSource: shouldGenerateUpscalerAi(settings) ? currentPreview : null, onModelProgress: (progress) => { if (isCurrent()) setModelProgress(progress); }, signal: controller.signal });
        if (!isCurrent()) return;
        if (shouldGenerateUpscalerAi(settings) && !currentPreview && generated.aiEnhancedSource) { aiPreview.current = { key, canvas: generated.aiEnhancedSource as HTMLCanvasElement }; setPreviewGenerated(true); setPreviewRevision((value) => value + 1); }
        const url = URL.createObjectURL(generated.blob); const link = document.createElement("a"); link.href = url; link.download = generated.fileName; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } catch (reason) { if (isCurrent() && !(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { if (exportOperation.current === operationOwner) { exportOperation.current = null; if (exportController.current === controller) exportController.current = null; setExporting(false); } endSingleOperation(owner); }
    });
    operationOwner.promise = operation; exportOperation.current = operationOwner;
    return operation;
  };
  const saveCompletedVideo = async (artifact: UpscalerVideoArtifact, preparedTarget?: Awaited<ReturnType<typeof chooseUpscalerVideoSaveTarget>>, isCurrent: () => boolean = () => true): Promise<boolean> => {
    const target = preparedTarget === undefined ? await chooseUpscalerVideoSaveTarget(artifact.fileName) : preparedTarget;
    if (!target || !isCurrent()) return false;
    const receipt = await saveUpscalerVideoArtifact(target, artifact);
    if (!isCurrent()) return false;
    setSavedDestination(target.kind === "download" ? `Download avviato · ${receipt.destination} · ${receipt.bytes.toLocaleString("it-IT")} byte` : `Salvato e verificato · ${receipt.destination} · ${receipt.bytes.toLocaleString("it-IT")} byte`);
    return true;
  };
  const exportVideo = (saveWhenReady = false, checkpointPolicy?: RemoteVideoCheckpointPolicy): Promise<void> => {
    if (!settings.sourceUrl || batchRunning) return Promise.resolve();
    const operationKey = `video:${outputKey}`;
    const existing = exportOperation.current;
    if (existing?.key === operationKey) return existing.promise;
    if (existing) {
      existing.controller?.abort();
      exportOperation.current = null;
      if (exportController.current === existing.controller) exportController.current = null;
    }
    const completed = videoArtifactRef.current;
    if (completed?.key === outputKey) {
      const singleOwner = beginSingleOperation(); if (!singleOwner) return Promise.resolve();
      // Open the picker before crossing a microtask so browser transient user
      // activation is preserved for an already completed artifact as well.
      const saveTargetPromise = chooseUpscalerVideoSaveTarget(completed.fileName);
      const operationOwner: UpscalerExportOperation = { key: operationKey, controller: null, promise: Promise.resolve() };
      const isCurrent = () => exportOperation.current === operationOwner && videoOutputKey(latestSettings.current) === outputKey;
      const operation = Promise.resolve().then(async () => {
        if (!isCurrent()) return;
        setExporting(true); setError("");
        try { await saveCompletedVideo(completed, await saveTargetPromise, isCurrent); }
        catch (reason) { if (isCurrent()) setError(`Il video è pronto in anteprima, ma il salvataggio non è riuscito: ${reason instanceof Error ? reason.message : String(reason)}`); }
        finally { if (exportOperation.current === operationOwner) { exportOperation.current = null; setExporting(false); } endSingleOperation(singleOwner); }
      });
      operationOwner.promise = operation; exportOperation.current = operationOwner;
      return operation;
    }
    if (usesRemoteUpscaler(settings) && checkpointPolicy === undefined) {
      // The choice is per operation and deliberately not persisted: automatic
      // cache reuse made two different source-selection intents indistinguishable.
      setCheckpointPrompt({ outputKey, saveWhenReady, sourceName: settings.sourceName });
      return Promise.resolve();
    }
    // This call happens before the first await, preserving transient activation
    // when the toolbar asks to process and export in one operation.
    const saveTargetPromise = saveWhenReady
      ? prepareUpscalerVideoSaveTarget(`${projectName.replace(/[^a-zA-Z0-9-_]+/g, "-") || "mlsm-studio"}-upscaled.mp4`)
      : null;
    const owner = beginSingleOperation(); if (!owner) return Promise.resolve();
    video.current?.pause(); setPlaying(false); setExporting(true); setVideoProgress(null); setError(""); const controller = new AbortController(); exportController.current = controller;
    const sourceUrl = settings.sourceUrl; const sourceFile = getUpscalerSourceFile(sourceUrl);
    const operationOwner: UpscalerExportOperation = { key: operationKey, controller, promise: Promise.resolve() };
    const isCurrent = () => exportOperation.current === operationOwner && exportController.current === controller && !controller.signal.aborted && videoOutputKey(latestSettings.current) === outputKey;
    const operation = Promise.resolve().then(async () => {
      if (!isCurrent()) return;
      reportUpscalerDiagnostic("ui-export-action", { sourceName: settings.sourceName, sourceKind: settings.sourceKind, sourceBytes: sourceFile?.size, hasRuntimeFile: Boolean(sourceFile), checkpointPolicy: checkpointPolicy ?? "restart" });
      try {
        const preparedTarget = saveTargetPromise ? await saveTargetPromise : undefined;
        if ((saveWhenReady && !preparedTarget) || !isCurrent()) return;
        const result = await exportUpscaledVideo({ projectName, quality: "maximum", sourceVideoUrl: sourceUrl, sourceVideoFile: sourceFile, upscalerSettings: settings, suppressDownload: true, ...(checkpointPolicy ? { remoteCheckpointPolicy: checkpointPolicy } : {}) }, controller.signal, (progress) => { if (isCurrent()) setVideoProgress(progress); });
        if (!isCurrent() || !result?.blob) return;
        clearVideoArtifact();
        const artifact: UpscalerVideoArtifact = { ...result, key: outputKey, url: URL.createObjectURL(result.blob), blob: result.blob, remote: usesRemoteUpscaler(settings) };
        videoArtifactRef.current = artifact; setVideoArtifact(artifact); setVideoProgress(null); setSavedDestination("");
        reportUpscalerDiagnostic("ui-video-artifact-ready", { fileName: artifact.fileName, bytes: artifact.blob.size, resultPath: artifact.resultPath });
        if (preparedTarget) await saveCompletedVideo(artifact, preparedTarget, isCurrent);
      }
      catch (reason) { if (isCurrent() && !(reason instanceof DOMException && reason.name === "AbortError")) { const message = reason instanceof Error ? reason.message : String(reason); reportUpscalerDiagnostic("video-export-error", { message }); setError(message); } }
      finally { if (exportOperation.current === operationOwner) { exportOperation.current = null; if (exportController.current === controller) exportController.current = null; setExporting(false); } endSingleOperation(owner); }
    });
    operationOwner.promise = operation; exportOperation.current = operationOwner;
    return operation;
  };
  exportAction.current = () => { if (settings.sourceKind === "image") void exportImage(); else void exportVideo(true); };
  useEffect(() => { const handleExport = () => exportAction.current(); window.addEventListener("upscaler:export", handleExport); return () => window.removeEventListener("upscaler:export", handleExport); }, []);
  useEffect(() => {
    const cancelActiveOperations = () => { previewController.current?.abort(); exportController.current?.abort(); };
    window.addEventListener("pagehide", cancelActiveOperations);
    window.addEventListener("beforeunload", cancelActiveOperations);
    window.addEventListener(UPSCALER_PROJECT_REPLACED_EVENT, cancelActiveOperations);
    return () => { window.removeEventListener("pagehide", cancelActiveOperations); window.removeEventListener("beforeunload", cancelActiveOperations); window.removeEventListener(UPSCALER_PROJECT_REPLACED_EVENT, cancelActiveOperations); cancelActiveOperations(); };
  }, []);
  const changeZoom = (next: number) => {
    const host = scrollHost.current; const centerX = host ? (host.scrollLeft + host.clientWidth / 2) / Math.max(1, host.scrollWidth) : .5; const centerY = host ? (host.scrollTop + host.clientHeight / 2) / Math.max(1, host.scrollHeight) : .5;
    setDetailZoom(next);
    if (host) requestAnimationFrame(() => { host.scrollLeft = Math.max(0, centerX * host.scrollWidth - host.clientWidth / 2); host.scrollTop = Math.max(0, centerY * host.scrollHeight - host.clientHeight / 2); });
  };
  const resetZoom = () => { setDetailZoom(1); const host = scrollHost.current; if (host) { host.scrollLeft = 0; host.scrollTop = 0; } };
  const endPan = (element: HTMLDivElement, pointerId: number) => { if (typeof element.hasPointerCapture === "function" && element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId); panStart.current = null; setPanning(false); };
  return <div className="upscaler-preview">
    <video key={displaySourceUrl ?? "empty"} ref={video} playsInline preload="metadata" onLoadedData={(event) => { const source = event.currentTarget.currentSrc || event.currentTarget.src; if (event.currentTarget === video.current && sourceToken.current && (source === sourceToken.current || source === new URL(sourceToken.current, document.baseURI).href)) setReady(true); }} onLoadedMetadata={handleVideoMetadata} onError={() => { if (videoArtifactRef.current?.url === sourceToken.current) setError("Il video finale è pronto e può essere esportato, ma questo player non riesce a decodificarne l’anteprima."); }} onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)} />
    {checkpointPrompt?.outputKey === outputKey ? <div className="video-editor-tool-modal-backdrop upscaler-checkpoint-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCheckpointPrompt(null); }}>
      <section className="video-editor-tool-modal upscaler-checkpoint-dialog" role="dialog" aria-modal="true" aria-labelledby="upscaler-checkpoint-title">
        <strong id="upscaler-checkpoint-title">Come vuoi gestire la cache?</strong>
        <p><b>{checkpointPrompt.sourceName}</b></p>
        <p>Il backend confronterà SHA-256 e modello. “Riprendi” usa i frame solo se appartengono esattamente allo stesso video; “Riparti da zero” crea sempre un job nuovo.</p>
        <div className="upscaler-checkpoint-actions">
          <button className="upscaler-video-primary-action" type="button" onClick={() => { const request = checkpointPrompt; setCheckpointPrompt(null); void exportVideo(request.saveWhenReady, "resume"); }}>Riprendi cache compatibile</button>
          <button type="button" onClick={() => { const request = checkpointPrompt; setCheckpointPrompt(null); void exportVideo(request.saveWhenReady, "restart"); }}>Riparti da zero</button>
          <button type="button" onClick={() => setCheckpointPrompt(null)}>Annulla</button>
        </div>
      </section>
    </div> : null}
    {settings.sourceUrl ? <div ref={scrollHost} className={`upscaler-canvas-scroll${detailZoom > 1 ? " is-zoomed" : ""}${panning ? " is-panning" : ""}`} title={detailZoom > 1 ? "Trascina l’immagine per esplorare i dettagli" : undefined} onPointerDown={(event) => { if (detailZoom <= 1 || event.button !== 0) return; if (typeof event.currentTarget.setPointerCapture === "function") event.currentTarget.setPointerCapture(event.pointerId); panStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; setPanning(true); }} onPointerMove={(event) => { const start = panStart.current; if (!start || start.pointerId !== event.pointerId) return; event.currentTarget.scrollLeft = start.left - (event.clientX - start.x); event.currentTarget.scrollTop = start.top - (event.clientY - start.y); }} onPointerUp={(event) => endPan(event.currentTarget, event.pointerId)} onPointerCancel={(event) => endPan(event.currentTarget, event.pointerId)}><canvas ref={canvas} aria-label="Preview Upscaler" draggable={false} style={detailZoom > 1 ? { width: `${previewSize.width * detailZoom}px`, height: "auto" } : { width: "auto", height: "auto", maxWidth: "100%", maxHeight: "100%" }} /></div> : <div className="static-watermark-empty"><strong>Carica una foto o un video</strong><span>La preview mostrerà originale e versione migliorata alla stessa risoluzione finale.</span></div>}
    {ready || videoArtifact?.key === outputKey ? <div className="upscaler-preview-badges"><span>{videoArtifact?.key === outputKey ? "RISULTATO UPSCALATO · PRONTO" : previewGenerated ? (settings.comparisonMode === "split" ? "ORIGINALE  |  MIGLIORATO" : settings.comparisonMode.toUpperCase()) : "ORIGINALE · ANTEPRIMA NON GENERATA"}</span><span>Originale {settings.sourceWidth || "—"} × {settings.sourceHeight || "—"}</span><span>Output {videoArtifact?.width ?? settings.finalWidth} × {videoArtifact?.height ?? settings.finalHeight}</span></div> : null}
    {(ready || videoArtifact?.key === outputKey) && settings.sourceKind === "video" && !exporting && !generatingPreview ? <div className={`upscaler-video-actions${videoArtifact?.key === outputKey ? " has-result" : ""}`} role="group" aria-label="Azioni upscaling video">
      <div className="upscaler-video-actions-copy"><strong>{videoArtifact?.key === outputKey ? "Video upscalato pronto" : "Upscaling video"}</strong><span>{videoArtifact?.key === outputKey ? `${videoArtifact.encodedFrameCount} frame ricomposti · audio ${videoArtifact.audioPacketCount > 0 ? "incluso" : "sorgente senza traccia"}. La preview mostra ora l’MP4 finale.` : "Elabora tutto il filmato oppure controlla prima il frame corrente."}</span></div>
      {videoArtifact?.key === outputKey ? <><button className="upscaler-video-primary-action" type="button" disabled={batchRunning} onClick={() => void exportVideo()}>Esporta / salva MP4</button><button className="upscaler-video-test-action" type="button" onClick={clearVideoArtifact}>Torna all’originale</button></> : <><button className="upscaler-video-primary-action" type="button" disabled={batchRunning} onClick={() => void exportVideo()}>Avvia upscaling video completo</button><button className="upscaler-video-test-action" type="button" disabled={batchRunning} onClick={() => void generatePreview()}>Prova il frame corrente</button></>}
    </div> : null}
    {savedDestination ? <div className="upscaler-video-save-confirmation" role="status">{savedDestination}</div> : null}
    {ready && !previewGenerated && settings.sourceKind === "image" ? <button className="upscaler-preview-generate" type="button" disabled={generatingPreview || batchRunning} onClick={generatePreview}>{generatingPreview ? "Generazione anteprima…" : "Genera anteprima upscaling"}</button> : null}
    {generatingPreview ? <div className="upscaler-model-progress"><strong>{!modelProgress ? "Preparazione upscaling…" : modelProgress.phase === "download" ? "Download modello" : modelProgress.phase === "initializing" ? "Inizializzazione modello" : modelProgress.phase === "inference" ? "Upscaling AI a tile" : modelProgress.phase === "cache" ? "Modello trovato in cache" : "Completamento"}</strong><progress max="1" value={modelProgress?.progress || undefined} /><span>{modelProgress ? `${Math.round(modelProgress.progress * 100)}%${modelProgress.loadedBytes ? ` · ${(modelProgress.loadedBytes / 1024 / 1024).toFixed(1)} MB${modelProgress.totalBytes ? ` / ${(modelProgress.totalBytes / 1024 / 1024).toFixed(1)} MB` : ""}` : ""}` : "Caricamento runtime e preparazione immagine"}</span></div> : null}
    {ready ? <div className="upscaler-preview-controls-stack">
      <div className="upscaler-detail-controls"><label>Zoom dettaglio: {Math.round(detailZoom * 100)}%<input aria-label="Zoom dettaglio Upscaler" type="range" min="1" max="4" step=".25" value={detailZoom} onChange={(event) => changeZoom(Number(event.target.value))} /></label><button type="button" onClick={resetZoom}>Adatta</button>{videoArtifact?.key === outputKey ? <span>Riproduzione del file finale ricostruito</span> : <><label>Confronto<select aria-label="Confronto dettagliato Upscaler" value={settings.comparisonMode} onChange={(event) => update({ comparisonMode: event.target.value as Settings["comparisonMode"] })}><option value="split">Separatore prima/dopo</option><option value="enhanced">Solo migliorato</option><option value="original">Solo originale</option><option value="blend">Fusione</option></select></label>{settings.comparisonMode === "split" ? <label>Separatore {Math.round(settings.comparisonPosition * 100)}%<input type="range" min="0" max="1" step=".01" value={settings.comparisonPosition} onChange={(event) => update({ comparisonPosition: Number(event.target.value) })} /></label> : <label>Mix originale {Math.round(settings.originalBlend * 100)}%<input type="range" min="0" max="1" step=".01" value={settings.originalBlend} onChange={(event) => update({ originalBlend: Number(event.target.value) })} /></label>}</>}</div>
      {settings.sourceKind === "video" ? <div className="upscaler-video-transport"><button type="button" onClick={toggleVideo}>{playing ? "Pausa" : "Play"}</button><input aria-label="Posizione video Upscaler" type="range" min="0" max={Math.max(.01, settings.durationSeconds)} step=".01" value={time} onChange={(event) => { const next = Number(event.target.value); if (video.current) video.current.currentTime = next; setTime(next); }} /><span>{time.toFixed(1)} / {settings.durationSeconds.toFixed(1)} s</span></div> : null}
    </div> : null}
    {fullscreen ? <div className="upscaler-fullscreen-controls"><label>Modello<select value={settings.model} onChange={(event) => update({ model: event.target.value as Settings["model"] })}>{upscalerModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label><label>Vista<select value={settings.comparisonMode} onChange={(event) => update({ comparisonMode: event.target.value as Settings["comparisonMode"] })}><option value="split">Prima / dopo</option><option value="enhanced">Migliorato</option><option value="original">Originale</option><option value="blend">Fusione</option></select></label><label>Separatore<input type="range" min="0" max="1" step=".01" value={settings.comparisonPosition} onChange={(event) => update({ comparisonPosition: Number(event.target.value) })} /></label><label>Originale {Math.round(settings.originalBlend * 100)}%<input type="range" min="0" max="1" step=".01" value={settings.originalBlend} onChange={(event) => update({ originalBlend: Number(event.target.value) })} /></label><label>Contrasto {settings.adjustments.contrast}<input type="range" min="-100" max="100" value={settings.adjustments.contrast} onChange={(event) => update({ adjustments: { ...settings.adjustments, contrast: Number(event.target.value) } })} /></label><label>Saturazione {settings.adjustments.saturation}<input type="range" min="-100" max="100" value={settings.adjustments.saturation} onChange={(event) => update({ adjustments: { ...settings.adjustments, saturation: Number(event.target.value) } })} /></label><label>Nitidezza {settings.adjustments.sharpness}<input type="range" min="0" max="100" value={settings.adjustments.sharpness} onChange={(event) => update({ adjustments: { ...settings.adjustments, sharpness: Number(event.target.value) } })} /></label><button type="button" disabled={generatingPreview || batchRunning} onClick={generatePreview}>Rigenera</button></div> : null}
    {ready && settings.sourceKind === "image" ? <button className="upscaler-export-image" type="button" disabled={exporting || batchRunning} onClick={() => void exportImage()}>{exporting ? "Generazione ed esportazione…" : generatingPreview ? "Attendi anteprima e scarica PNG" : shouldGenerateUpscalerAi(settings) && !previewGenerated ? "Genera upscaling e scarica PNG" : "Scarica PNG alla risoluzione finale"}</button> : null}
    {exporting ? <div className="upscaler-video-frame-progress" role="status" aria-live="polite">
      <header><strong>{videoProgress?.phaseLabel ?? "Preparazione job video locale"}</strong><span>{Math.round((videoProgress?.progress ?? 0) * 100)}%</span><button type="button" onClick={() => exportController.current?.abort()}>Annulla</button></header>
      <progress max="1" value={videoProgress?.progress ?? 0} />
      <div className="upscaler-frame-counters"><span>Frame completati <b>{videoProgress?.currentFrame ?? 0}</b> / <b>{videoProgress?.totalFrames || "—"}</b></span><span>{videoProgress?.width && videoProgress?.height ? `Output ${videoProgress.width} × ${videoProgress.height} · ` : ""}{formatRemaining(videoProgress?.estimatedRemainingMs)}</span></div>
      {videoProgress?.endpointActivity?.length ? <div className="upscaler-remote-workers" aria-label="Attività endpoint remoti">
        <div className="upscaler-remote-workers-summary"><strong>{videoProgress.endpointActivity.length} endpoint configurati</strong><span>{videoProgress.activeEndpoints?.length ?? 0} richieste contemporaneamente in volo</span></div>
        <div className="upscaler-remote-workers-list">{videoProgress.endpointActivity.map((endpoint) => <div className={`upscaler-remote-worker is-${endpoint.state}`} key={endpoint.url} title={endpoint.url}>
          <i aria-hidden="true" /><div><strong>{remoteEndpointLabel(endpoint.url)}</strong><span>{endpoint.state === "busy" ? `Elabora ${endpoint.activeFrame ?? "un frame"}` : endpoint.state === "error" ? "Tentativo fallito · riassegnazione" : "Pronto per il prossimo frame"}</span></div><output>{endpoint.completed} completati{endpoint.failures ? ` · ${endpoint.failures} retry` : ""}</output>
        </div>)}</div>
      </div> : null}
      {videoProgress?.originalFramesDirectory ? <p><strong>Frame originali:</strong><code>{videoProgress.originalFramesDirectory}</code></p> : videoProgress?.tempDirectory ? <p><strong>Cartella temp:</strong><code>{videoProgress.tempDirectory}</code></p> : null}
      <small>Ogni frame originale viene salvato prima dell’upscaling; il video viene ricomposto soltanto al termine del conteggio completo.</small>
    </div> : null}
    {error ? <div className="upscaler-preview-error">{error}</div> : null}
  </div>;
}
