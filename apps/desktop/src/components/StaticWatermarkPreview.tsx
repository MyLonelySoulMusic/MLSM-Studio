import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { RhythmBallProject } from "@rbs/project-schema";
import { createStaticWatermarkCompositor, normalizedWatermarkRegion, watermarkContextPixelRect, watermarkPixelRect } from "../services/static-watermark-renderer";
import { createStaticWatermarkReferenceAligner } from "../services/static-watermark-alignment";
import { cleanReferenceTime } from "../services/static-watermark-time";
import { OPEN_STATIC_WATERMARK_DETAIL_PREVIEW } from "../services/static-watermark-detail-preview";
import { useProjectStore } from "../store/project-store";

type Settings = RhythmBallProject["animation"]["staticWatermark"];

function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = url; });
}

function DetailControls({ settings }: { settings: Settings }) {
  const update = useProjectStore((state) => state.updateStaticWatermark);
  return <div className="watermark-detail-controls" aria-label="Controlli anteprima zona rimozione">
    <label>Scala riferimento: {settings.referenceScale.toFixed(2)}×<input aria-label="Scala riferimento anteprima zoom" type="range" min=".5" max="2.5" step=".005" value={settings.referenceScale} onChange={(event) => update({ referenceScale: Number(event.target.value) })} /></label>
    <label>Spostamento X: {Math.round(settings.referenceOffsetX * 100)}%<input aria-label="Spostamento X anteprima zoom" type="range" min="-1" max="1" step=".0025" value={settings.referenceOffsetX} onChange={(event) => update({ referenceOffsetX: Number(event.target.value) })} /></label>
    <label>Spostamento Y: {Math.round(settings.referenceOffsetY * 100)}%<input aria-label="Spostamento Y anteprima zoom" type="range" min="-1" max="1" step=".0025" value={settings.referenceOffsetY} onChange={(event) => update({ referenceOffsetY: Number(event.target.value) })} /></label>
    <label>Sfumatura esterna: {settings.feather} px<input aria-label="Sfumatura esterna anteprima zoom" type="range" min="0" max="24" step="1" value={settings.feather} onChange={(event) => update({ feather: Number(event.target.value) })} /></label>
    <label>Opacità patch: {Math.round(settings.patchOpacity * 100)}%<input aria-label="Opacità patch anteprima zoom" type="range" min="0" max="1" step=".01" value={settings.patchOpacity} onChange={(event) => update({ patchOpacity: Number(event.target.value) })} /></label>
    <label className="teddy-dance-toggle"><span>Uniforma luminosità</span><input aria-label="Uniforma luminosità anteprima zoom" type="checkbox" checked={settings.colorMatch} onChange={(event) => update({ colorMatch: event.target.checked })} /></label>
    {settings.colorMatch ? <label>Intensità correzione: {Math.round(settings.colorMatchStrength * 100)}%<input aria-label="Intensità correzione anteprima zoom" type="range" min="0" max="1" step=".01" value={settings.colorMatchStrength} onChange={(event) => update({ colorMatchStrength: Number(event.target.value) })} /></label> : null}
  </div>;
}

export function StaticWatermarkPreview({ settings, currentTime, playing }: { settings: Settings; currentTime: number; playing: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const detailCanvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const referenceVideo = useRef<HTMLVideoElement>(null);
  const reference = useRef<HTMLImageElement | null>(null);
  const compositor = useRef<ReturnType<typeof createStaticWatermarkCompositor> | null>(null);
  const aligner = useRef<ReturnType<typeof createStaticWatermarkReferenceAligner> | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const update = useProjectStore((state) => state.updateStaticWatermark);
  const [ready, setReady] = useState(false);
  const [referenceVideoReady, setReferenceVideoReady] = useState(false);
  const [referenceRevision, setReferenceRevision] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    const open = () => setDetailOpen(true);
    window.addEventListener(OPEN_STATIC_WATERMARK_DETAIL_PREVIEW, open);
    return () => window.removeEventListener(OPEN_STATIC_WATERMARK_DETAIL_PREVIEW, open);
  }, []);
  useEffect(() => {
    if (!detailOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailOpen]);

  useEffect(() => { let active = true; void loadImage(settings.referenceKind === "image" ? settings.referenceImageUrl : null).then((image) => { if (active) { reference.current = image; setReferenceRevision((value) => value + 1); } }); return () => { active = false; }; }, [settings.referenceImageUrl, settings.referenceKind]);
  useEffect(() => {
    const item = video.current;
    if (!item || !settings.videoUrl) return;
    item.src = settings.videoUrl; item.load(); setReady(false);
  }, [settings.videoUrl]);
  useEffect(() => {
    const item = referenceVideo.current;
    if (!item) return;
    if (settings.referenceKind !== "video" || !settings.referenceVideoUrl) {
      if (item.getAttribute("src")) { item.pause(); item.removeAttribute("src"); item.load(); }
      setReferenceVideoReady(false); return;
    }
    item.src = settings.referenceVideoUrl; item.load(); setReferenceVideoReady(false);
  }, [settings.referenceKind, settings.referenceVideoUrl]);
  useEffect(() => { aligner.current?.reset(); }, [settings.referenceKind, settings.referenceVideoUrl, settings.referenceTimeOffsetSeconds]);
  useEffect(() => {
    const item = video.current;
    if (!item || !ready) return;
    if (Math.abs(item.currentTime - currentTime) > (playing ? .12 : .015)) item.currentTime = Math.max(0, Math.min(item.duration || currentTime, currentTime));
    if (playing) void item.play().catch(() => undefined); else item.pause();
  }, [currentTime, playing, ready]);
  useEffect(() => {
    const item = referenceVideo.current;
    if (!item || !referenceVideoReady || settings.referenceKind !== "video") return;
    const referenceDuration = item.duration || settings.referenceVideoDurationSeconds;
    const wanted = cleanReferenceTime(video.current?.currentTime ?? currentTime, settings.referenceTimeOffsetSeconds, referenceDuration);
    if (wanted === null) { item.pause(); return; }
    if (!item.seeking && Math.abs(item.currentTime - wanted) > .5 / (settings.referenceFrameRate || 30)) item.currentTime = wanted;
    if (playing) void item.play().catch(() => undefined); else item.pause();
  }, [currentTime, playing, referenceVideoReady, settings.referenceKind, settings.referenceTimeOffsetSeconds, settings.referenceVideoDurationSeconds, settings.referenceFrameRate]);
  useEffect(() => {
    const surface = canvas.current; const item = video.current;
    if (!surface || !item || !ready) return;
    let frame = 0;
    const nativeWidth = item.videoWidth || settings.videoWidth || 1080;
    const nativeHeight = item.videoHeight || settings.videoHeight || 1920;
    const previewScale = Math.min(1, 1600 / Math.max(nativeWidth, nativeHeight));
    const width = Math.max(2, Math.round(nativeWidth * previewScale)); const height = Math.max(2, Math.round(nativeHeight * previewScale));
    if (surface.width !== width || surface.height !== height) { surface.width = width; surface.height = height; compositor.current = createStaticWatermarkCompositor(width, height); aligner.current = createStaticWatermarkReferenceAligner(width, height); }
    const context = surface.getContext("2d", { alpha: false });
    if (!context) return;
    const draw = () => {
      if (item.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const videoReference = settings.referenceKind === "video" && referenceVideoReady ? referenceVideo.current : null;
        const wanted = videoReference ? cleanReferenceTime(item.currentTime, settings.referenceTimeOffsetSeconds, videoReference.duration || settings.referenceVideoDurationSeconds) : null;
        // A seek updates currentTime before the decoded image is available.
        // Keep the last complete composite until BOTH images represent the same time.
        if (videoReference && wanted !== null && (item.seeking || videoReference.seeking || videoReference.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || Math.abs(videoReference.currentTime - wanted) > .5 / (settings.referenceFrameRate || 30))) {
          if (!videoReference.seeking && Math.abs(videoReference.currentTime - wanted) > .5 / (settings.referenceFrameRate || 30)) videoReference.currentTime = wanted;
          if (playing) frame = requestAnimationFrame(draw);
          return;
        }
        if (videoReference && wanted !== null) {
          context.drawImage(item, 0, 0, width, height);
          const aligned = aligner.current?.align(item, videoReference, settings);
          if (aligned) compositor.current?.applyPatch(context, aligned.canvas, { ...settings, referenceFit: "stretch", referenceScale: 1, referenceOffsetX: 0, referenceOffsetY: 0 });
        } else if (reference.current) compositor.current?.render(context, item, reference.current, settings);
        else context.drawImage(item, 0, 0, width, height);
        const detail = detailCanvas.current;
        if (detailOpen && detail) {
          const selectedRegion = watermarkPixelRect(width, height, settings);
          const crop = watermarkContextPixelRect(width, height, selectedRegion);
          const outputScale = Math.min(4, 1800 / Math.max(crop.width, crop.height));
          const outputWidth = Math.max(2, Math.round(crop.width * outputScale));
          const outputHeight = Math.max(2, Math.round(crop.height * outputScale));
          if (detail.width !== outputWidth || detail.height !== outputHeight) { detail.width = outputWidth; detail.height = outputHeight; }
          const detailContext = detail.getContext("2d", { alpha: false });
          if (detailContext) {
            detailContext.imageSmoothingEnabled = true; detailContext.imageSmoothingQuality = "high";
            detailContext.drawImage(surface, crop.x, crop.y, crop.width, crop.height, 0, 0, outputWidth, outputHeight);
          }
        }
        if (settings.guideVisible) {
          const region = normalizedWatermarkRegion(settings);
          const x = region.x * width; const y = region.y * height; const w = region.width * width; const h = region.height * height;
          context.save(); context.fillStyle = "rgba(0,0,0,.22)"; context.beginPath(); context.rect(0, 0, width, height); context.rect(x, y, w, h); context.fill("evenodd");
          context.strokeStyle = "#ff4f9a"; context.lineWidth = Math.max(2, width / 500); context.setLineDash([10, 7]); context.strokeRect(x, y, w, h); context.setLineDash([]);
          context.font = `700 ${Math.max(12, width / 60)}px Inter, sans-serif`; context.textBaseline = "bottom"; const label = "WATERMARK AREA"; const metrics = context.measureText(label); context.fillStyle = "rgba(0,0,0,.82)"; context.fillRect(x, Math.max(0, y - width / 35), metrics.width + 14, width / 35); context.fillStyle = "#ffffff"; context.fillText(label, x + 7, Math.max(width / 42, y - 3)); context.restore();
        }
      }
      if (playing) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [currentTime, detailOpen, playing, ready, referenceRevision, referenceVideoReady, settings]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }; };
  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => { dragStart.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragStart.current) return; const cursor = point(event); const start = dragStart.current;
    update({ region: { x: Math.min(start.x, cursor.x), y: Math.min(start.y, cursor.y), width: Math.max(.005, Math.abs(cursor.x - start.x)), height: Math.max(.005, Math.abs(cursor.y - start.y)) } });
  };
  const end = (event: ReactPointerEvent<HTMLCanvasElement>) => { move(event); dragStart.current = null; };

  return <><div className="static-watermark-preview">
    <video ref={video} muted playsInline preload="auto" onLoadedMetadata={() => setReady(true)} onLoadedData={() => { setReady(true); setReferenceRevision(value => value + 1); }} onSeeked={() => { setReady(true); setReferenceRevision(value => value + 1); }} />
    <video ref={referenceVideo} muted playsInline preload="auto" onLoadedMetadata={() => setReferenceVideoReady(true)} onLoadedData={() => { setReferenceVideoReady(true); setReferenceRevision(value => value + 1); }} onSeeked={() => { setReferenceVideoReady(true); setReferenceRevision(value => value + 1); }} />
    {settings.videoUrl ? <canvas ref={canvas} aria-label="Preview rimozione watermark" onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { dragStart.current = null; }} /> : <div className="static-watermark-empty"><strong>Carica il video sorgente</strong><span>Qui potrai trascinare una selezione precisa sul watermark.</span></div>}
    {settings.videoUrl && !(settings.referenceKind === "video" ? settings.referenceVideoUrl : settings.referenceImageUrl) ? <div className="static-watermark-preview-hint">Carica una fotografia o un video pulito per vedere la sostituzione</div> : null}
  </div>
    {detailOpen ? createPortal(<div className="watermark-detail-overlay" role="dialog" aria-modal="true" aria-label="Anteprima zona rimozione">
      <header><div><strong>Anteprima zona rimozione</strong><span>Correzione al centro con il video circostante, senza bordo di selezione</span></div><button type="button" aria-label="Chiudi anteprima zona rimozione" onClick={() => setDetailOpen(false)}>×</button></header>
      <div className="watermark-detail-stage"><canvas ref={detailCanvas} aria-label="Zona rimozione ingrandita" /></div>
      <DetailControls settings={settings} />
    </div>, document.body) : null}
  </>;
}
