import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import type { RhythmBallProject } from "@rbs/project-schema";
import { createUpscalerFrameRenderer, resolveUpscalerPreviewSize, resolveUpscalerTarget } from "../services/upscaler-renderer";
import { generateAiUpscalerPreview, type ModelLoadProgress } from "../services/upscaler-ai";
import { upscalerModels } from "../services/upscaler-runtime";
import { exportUpscaledVideo, type UpscalerVideoExportProgress } from "../services/upscaler-video-exporter";
import { getUpscalerSourceFile } from "../services/upscaler-source-file";
import { reportUpscalerDiagnostic } from "../services/upscaler-python-client";
import { useProjectStore } from "../store/project-store";

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

export function UpscalerPreview({ settings, fullscreen = false }: { settings: Settings; fullscreen?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null); const scrollHost = useRef<HTMLDivElement>(null); const video = useRef<HTMLVideoElement>(null); const image = useRef<HTMLImageElement | null>(null);
  const panStart = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const sourceToken = useRef(""); const latestSettings = useRef(settings);
  latestSettings.current = settings;
  const aiPreview = useRef<HTMLCanvasElement | null>(null); const previewController = useRef<AbortController | null>(null); const exportController = useRef<AbortController | null>(null); const exportAction = useRef<() => void>(() => undefined); const projectName = useProjectStore((state) => state.project.project.name); const update = useProjectStore((state) => state.updateUpscaler);
  const [ready, setReady] = useState(false); const [playing, setPlaying] = useState(false); const [time, setTime] = useState(0); const [exporting, setExporting] = useState(false); const [videoProgress, setVideoProgress] = useState<UpscalerVideoExportProgress | null>(null); const [error, setError] = useState(""); const [previewGenerated, setPreviewGenerated] = useState(false); const [generatingPreview, setGeneratingPreview] = useState(false); const [modelProgress, setModelProgress] = useState<ModelLoadProgress | null>(null); const [previewRevision, setPreviewRevision] = useState(0); const [detailZoom, setDetailZoom] = useState(1); const [panning, setPanning] = useState(false);
  const previewSize = useMemo(() => resolveUpscalerPreviewSize(settings.finalWidth, settings.finalHeight), [settings.finalHeight, settings.finalWidth]);
  const handleVideoMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const item = event.currentTarget; const current = latestSettings.current;
    const expectedSource = sourceToken.current;
    const loadedSource = item.currentSrc || item.src;
    // A video element can dispatch a late metadata event for the previous blob
    // after React has already switched to a new source. Never let that event
    // overwrite the dimensions belonging to the current source.
    if (item !== video.current || !expectedSource || !loadedSource || (loadedSource !== expectedSource && loadedSource !== new URL(expectedSource, document.baseURI).href)) return;
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
    sourceToken.current = settings.sourceUrl ?? "";
    previewController.current?.abort(); aiPreview.current = null; setReady(false); setPlaying(false); setPreviewGenerated(false); setModelProgress(null); image.current = null; const item = video.current;
    if (!settings.sourceUrl) return;
    if (settings.sourceKind === "image") { let active = true; void loadImage(settings.sourceUrl).then((loaded) => { if (active) { image.current = loaded; setReady(true); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }); return () => { active = false; }; }
    if (item) { item.src = settings.sourceUrl; item.load(); }
  }, [settings.sourceKind, settings.sourceUrl]);
  const generatePreview = useCallback(async () => {
    const source = settings.sourceKind === "video" ? video.current : image.current; if (!settings.sourceUrl || !source || generatingPreview) return false;
    previewController.current?.abort(); const controller = new AbortController(); previewController.current = controller; setGeneratingPreview(true); setError(""); setModelProgress(null);
    try {
      aiPreview.current = settings.model === "canvas" ? null : await generateAiUpscalerPreview(source, settings, setModelProgress, controller.signal);
      setPreviewGenerated(true); setPreviewRevision((value) => value + 1);
      return true;
    } catch (reason) { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { if (previewController.current === controller) previewController.current = null; setGeneratingPreview(false); }
  }, [generatingPreview, settings]);
  useEffect(() => { const handle = () => generatePreview(); window.addEventListener("upscaler:generate-preview", handle); return () => window.removeEventListener("upscaler:generate-preview", handle); }, [generatePreview]);
  useEffect(() => { previewController.current?.abort(); aiPreview.current = null; setPreviewGenerated(false); setModelProgress(null); }, [settings.model, settings.sourceUrl, settings.tileSize, settings.tta]);
  useEffect(() => {
    const surface = canvas.current; if (!surface || !ready) return; surface.width = previewSize.width; surface.height = previewSize.height;
    const context = surface.getContext("2d", { alpha: false }); if (!context) return; const render = createUpscalerFrameRenderer(surface.width, surface.height); let frame = 0;
    const draw = () => { const source = settings.sourceKind === "video" ? video.current : image.current; if (source) render(context, source, previewGenerated ? settings : { ...settings, comparisonMode: "original", originalBlend: 0 }, true, aiPreview.current); if (settings.sourceKind === "video" && playing) frame = requestAnimationFrame(draw); };
    draw(); return () => cancelAnimationFrame(frame);
  }, [playing, previewGenerated, previewRevision, previewSize, ready, settings]);
  const toggleVideo = () => { const item = video.current; if (!item) return; if (item.paused) void item.play().then(() => setPlaying(true)).catch(() => undefined); else { item.pause(); setPlaying(false); } };
  const exportImage = async () => {
    if (!image.current) return; setExporting(true); setError("");
    try {
      if (settings.model !== "canvas" && !previewGenerated) {
        const generated = await generatePreview();
        if (!generated || !aiPreview.current) return;
      }
      const output = document.createElement("canvas"); output.width = settings.finalWidth; output.height = settings.finalHeight; const context = output.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas di esportazione non disponibile.");
      createUpscalerFrameRenderer(output.width, output.height)(context, image.current, settings, false, settings.model === "canvas" ? null : aiPreview.current);
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error("Impossibile codificare l’immagine finale.")), "image/png"));
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${settings.sourceName.replace(/\.[^.]+$/, "") || "image"}-upscaled-${settings.finalWidth}x${settings.finalHeight}.png`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setExporting(false); }
  };
  const exportVideo = async () => {
    if (!settings.sourceUrl) return; video.current?.pause(); setPlaying(false); setExporting(true); setVideoProgress(null); setError(""); const controller = new AbortController(); exportController.current = controller;
    reportUpscalerDiagnostic("ui-export-action", { sourceName: settings.sourceName, sourceKind: settings.sourceKind, hasRuntimeFile: Boolean(getUpscalerSourceFile(settings.sourceUrl)) });
    try { await exportUpscaledVideo({ projectName, quality: "maximum", sourceVideoUrl: settings.sourceUrl, sourceVideoFile: getUpscalerSourceFile(settings.sourceUrl), upscalerSettings: settings }, controller.signal, setVideoProgress); }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === "AbortError")) { const message = reason instanceof Error ? reason.message : String(reason); reportUpscalerDiagnostic("video-export-error", { message }); setError(message); } }
    finally { exportController.current = null; setExporting(false); }
  };
  exportAction.current = () => { if (settings.sourceKind === "image") void exportImage(); else void exportVideo(); };
  useEffect(() => { const handleExport = () => exportAction.current(); window.addEventListener("upscaler:export", handleExport); return () => window.removeEventListener("upscaler:export", handleExport); }, []);
  useEffect(() => {
    const cancelActiveExport = () => exportController.current?.abort();
    window.addEventListener("pagehide", cancelActiveExport);
    window.addEventListener("beforeunload", cancelActiveExport);
    return () => { window.removeEventListener("pagehide", cancelActiveExport); window.removeEventListener("beforeunload", cancelActiveExport); cancelActiveExport(); };
  }, []);
  const changeZoom = (next: number) => {
    const host = scrollHost.current; const centerX = host ? (host.scrollLeft + host.clientWidth / 2) / Math.max(1, host.scrollWidth) : .5; const centerY = host ? (host.scrollTop + host.clientHeight / 2) / Math.max(1, host.scrollHeight) : .5;
    setDetailZoom(next);
    if (host) requestAnimationFrame(() => { host.scrollLeft = Math.max(0, centerX * host.scrollWidth - host.clientWidth / 2); host.scrollTop = Math.max(0, centerY * host.scrollHeight - host.clientHeight / 2); });
  };
  const resetZoom = () => { setDetailZoom(1); const host = scrollHost.current; if (host) { host.scrollLeft = 0; host.scrollTop = 0; } };
  const endPan = (element: HTMLDivElement, pointerId: number) => { if (typeof element.hasPointerCapture === "function" && element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId); panStart.current = null; setPanning(false); };
  return <div className="upscaler-preview">
    <video key={settings.sourceUrl ?? "empty"} ref={video} playsInline preload="metadata" onLoadedData={(event) => { const source = event.currentTarget.currentSrc || event.currentTarget.src; if (event.currentTarget === video.current && sourceToken.current && (source === sourceToken.current || source === new URL(sourceToken.current, document.baseURI).href)) setReady(true); }} onLoadedMetadata={handleVideoMetadata} onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)} />
    {settings.sourceUrl ? <div ref={scrollHost} className={`upscaler-canvas-scroll${detailZoom > 1 ? " is-zoomed" : ""}${panning ? " is-panning" : ""}`} title={detailZoom > 1 ? "Trascina l’immagine per esplorare i dettagli" : undefined} onPointerDown={(event) => { if (detailZoom <= 1 || event.button !== 0) return; if (typeof event.currentTarget.setPointerCapture === "function") event.currentTarget.setPointerCapture(event.pointerId); panStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; setPanning(true); }} onPointerMove={(event) => { const start = panStart.current; if (!start || start.pointerId !== event.pointerId) return; event.currentTarget.scrollLeft = start.left - (event.clientX - start.x); event.currentTarget.scrollTop = start.top - (event.clientY - start.y); }} onPointerUp={(event) => endPan(event.currentTarget, event.pointerId)} onPointerCancel={(event) => endPan(event.currentTarget, event.pointerId)}><canvas ref={canvas} aria-label="Preview Upscaler" draggable={false} style={detailZoom > 1 ? { width: `${previewSize.width * detailZoom}px`, height: "auto" } : { width: "auto", height: "auto", maxWidth: "100%", maxHeight: "100%" }} /></div> : <div className="static-watermark-empty"><strong>Carica una foto o un video</strong><span>La preview mostrerà originale e versione migliorata alla stessa risoluzione finale.</span></div>}
    {ready ? <div className="upscaler-preview-badges"><span>{previewGenerated ? (settings.comparisonMode === "split" ? "ORIGINALE  |  MIGLIORATO" : settings.comparisonMode.toUpperCase()) : "ORIGINALE · ANTEPRIMA NON GENERATA"}</span><span>Originale {settings.sourceWidth || "—"} × {settings.sourceHeight || "—"}</span><span>Output {settings.finalWidth} × {settings.finalHeight}</span></div> : null}
    {ready && settings.sourceKind === "video" && !exporting && !generatingPreview ? <div className="upscaler-video-actions" role="group" aria-label="Azioni upscaling video">
      <div className="upscaler-video-actions-copy"><strong>Upscaling video</strong><span>Elabora tutto il filmato oppure controlla prima il frame corrente.</span></div>
      <button className="upscaler-video-primary-action" type="button" onClick={() => void exportVideo()}>Avvia upscaling video completo</button>
      <button className="upscaler-video-test-action" type="button" onClick={() => void generatePreview()}>Prova il frame corrente</button>
    </div> : null}
    {ready && !previewGenerated && settings.sourceKind === "image" ? <button className="upscaler-preview-generate" type="button" disabled={generatingPreview} onClick={generatePreview}>{generatingPreview ? "Generazione anteprima…" : "Genera anteprima upscaling"}</button> : null}
    {generatingPreview ? <div className="upscaler-model-progress"><strong>{!modelProgress ? "Preparazione upscaling…" : modelProgress.phase === "download" ? "Download modello" : modelProgress.phase === "initializing" ? "Inizializzazione modello" : modelProgress.phase === "inference" ? "Upscaling AI a tile" : modelProgress.phase === "cache" ? "Modello trovato in cache" : "Completamento"}</strong><progress max="1" value={modelProgress?.progress || undefined} /><span>{modelProgress ? `${Math.round(modelProgress.progress * 100)}%${modelProgress.loadedBytes ? ` · ${(modelProgress.loadedBytes / 1024 / 1024).toFixed(1)} MB${modelProgress.totalBytes ? ` / ${(modelProgress.totalBytes / 1024 / 1024).toFixed(1)} MB` : ""}` : ""}` : "Caricamento runtime e preparazione immagine"}</span></div> : null}
    {ready ? <div className="upscaler-preview-controls-stack">
      <div className="upscaler-detail-controls"><label>Zoom dettaglio: {Math.round(detailZoom * 100)}%<input aria-label="Zoom dettaglio Upscaler" type="range" min="1" max="4" step=".25" value={detailZoom} onChange={(event) => changeZoom(Number(event.target.value))} /></label><button type="button" onClick={resetZoom}>Adatta</button><label>Confronto<select aria-label="Confronto dettagliato Upscaler" value={settings.comparisonMode} onChange={(event) => update({ comparisonMode: event.target.value as Settings["comparisonMode"] })}><option value="split">Separatore prima/dopo</option><option value="enhanced">Solo migliorato</option><option value="original">Solo originale</option><option value="blend">Fusione</option></select></label>{settings.comparisonMode === "split" ? <label>Separatore {Math.round(settings.comparisonPosition * 100)}%<input type="range" min="0" max="1" step=".01" value={settings.comparisonPosition} onChange={(event) => update({ comparisonPosition: Number(event.target.value) })} /></label> : <label>Mix originale {Math.round(settings.originalBlend * 100)}%<input type="range" min="0" max="1" step=".01" value={settings.originalBlend} onChange={(event) => update({ originalBlend: Number(event.target.value) })} /></label>}</div>
      {settings.sourceKind === "video" ? <div className="upscaler-video-transport"><button type="button" onClick={toggleVideo}>{playing ? "Pausa" : "Play"}</button><input aria-label="Posizione video Upscaler" type="range" min="0" max={Math.max(.01, settings.durationSeconds)} step=".01" value={time} onChange={(event) => { const next = Number(event.target.value); if (video.current) video.current.currentTime = next; setTime(next); }} /><span>{time.toFixed(1)} / {settings.durationSeconds.toFixed(1)} s</span></div> : null}
    </div> : null}
    {fullscreen ? <div className="upscaler-fullscreen-controls"><label>Modello<select value={settings.model} onChange={(event) => update({ model: event.target.value as Settings["model"] })}>{upscalerModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label><label>Vista<select value={settings.comparisonMode} onChange={(event) => update({ comparisonMode: event.target.value as Settings["comparisonMode"] })}><option value="split">Prima / dopo</option><option value="enhanced">Migliorato</option><option value="original">Originale</option><option value="blend">Fusione</option></select></label><label>Separatore<input type="range" min="0" max="1" step=".01" value={settings.comparisonPosition} onChange={(event) => update({ comparisonPosition: Number(event.target.value) })} /></label><label>Originale {Math.round(settings.originalBlend * 100)}%<input type="range" min="0" max="1" step=".01" value={settings.originalBlend} onChange={(event) => update({ originalBlend: Number(event.target.value) })} /></label><label>Contrasto {settings.adjustments.contrast}<input type="range" min="-100" max="100" value={settings.adjustments.contrast} onChange={(event) => update({ adjustments: { ...settings.adjustments, contrast: Number(event.target.value) } })} /></label><label>Saturazione {settings.adjustments.saturation}<input type="range" min="-100" max="100" value={settings.adjustments.saturation} onChange={(event) => update({ adjustments: { ...settings.adjustments, saturation: Number(event.target.value) } })} /></label><label>Nitidezza {settings.adjustments.sharpness}<input type="range" min="0" max="100" value={settings.adjustments.sharpness} onChange={(event) => update({ adjustments: { ...settings.adjustments, sharpness: Number(event.target.value) } })} /></label><button type="button" disabled={generatingPreview} onClick={generatePreview}>Rigenera</button></div> : null}
    {ready && settings.sourceKind === "image" ? <button className="upscaler-export-image" type="button" disabled={exporting || generatingPreview} onClick={() => void exportImage()}>{exporting ? "Generazione ed esportazione…" : generatingPreview ? "Generazione AI in corso…" : settings.model !== "canvas" && !previewGenerated ? "Genera upscaling e scarica PNG" : "Scarica PNG alla risoluzione finale"}</button> : null}
    {exporting ? <div className="upscaler-video-frame-progress" role="status" aria-live="polite">
      <header><strong>{videoProgress?.phaseLabel ?? "Preparazione job video locale"}</strong><span>{Math.round((videoProgress?.progress ?? 0) * 100)}%</span><button type="button" onClick={() => exportController.current?.abort()}>Annulla</button></header>
      <progress max="1" value={videoProgress?.progress ?? 0} />
      <div className="upscaler-frame-counters"><span>Frame completati <b>{videoProgress?.currentFrame ?? 0}</b> / <b>{videoProgress?.totalFrames || "—"}</b></span><span>{videoProgress?.width && videoProgress?.height ? `Output ${videoProgress.width} × ${videoProgress.height} · ` : ""}{formatRemaining(videoProgress?.estimatedRemainingMs)}</span></div>
      {videoProgress?.originalFramesDirectory ? <p><strong>Frame originali:</strong><code>{videoProgress.originalFramesDirectory}</code></p> : videoProgress?.tempDirectory ? <p><strong>Cartella temp:</strong><code>{videoProgress.tempDirectory}</code></p> : null}
      <small>Ogni frame originale viene salvato prima dell’upscaling; il video viene ricomposto soltanto al termine del conteggio completo.</small>
    </div> : null}
    {error ? <div className="upscaler-preview-error">{error}</div> : null}
  </div>;
}
