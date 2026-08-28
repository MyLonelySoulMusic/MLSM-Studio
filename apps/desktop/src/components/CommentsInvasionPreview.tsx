import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CommentsInvasionSettings } from "@rbs/project-schema";
import { useCommentsInvasionStore } from "../store/comments-invasion-store";
import { commentsInvasionVisibleIndices, fitCommentsInvasionPreview, renderCommentsInvasionFrame, type CommentsInvasionImage } from "../services/comments-invasion-renderer";
import { useFullscreenPreview } from "../services/use-fullscreen-preview";
import { FullscreenPlaybackDock } from "./FullscreenPlaybackDock";

function useCommentImages(settings: CommentsInvasionSettings, timeSeconds: number): CommentsInvasionImage[] {
  const assets = useCommentsInvasionStore((state) => state.assets);
  const indicesKey = (() => {
    const visible = commentsInvasionVisibleIndices(timeSeconds, assets.length, settings);
    const latest = timeSeconds < settings.initialDelaySeconds ? -1 : Math.floor((timeSeconds - settings.initialDelaySeconds) / Math.max(.15, settings.intervalSeconds));
    const next = Math.max(0, latest + 1);
    return (next < assets.length && !visible.includes(next) ? [...visible, next] : visible).join(",");
  })();
  const indices = useMemo(() => indicesKey ? indicesKey.split(",").map(Number) : [], [indicesKey]);
  const [images, setImages] = useState<CommentsInvasionImage[]>([]);
  useEffect(() => {
    let active = true; const sources: HTMLImageElement[] = [];
    void Promise.all(indices.map((index) => new Promise<CommentsInvasionImage | null>((resolve) => {
      const asset = assets[index]; if (!asset) { resolve(null); return; }
      const image = new Image(); sources.push(image); image.onload = () => resolve({ id: asset.id, index, width: asset.width, height: asset.height, image }); image.onerror = () => resolve(null); image.src = asset.url;
    }))).then((loaded) => { if (active) setImages(loaded.filter((item): item is CommentsInvasionImage => item !== null)); });
    return () => { active = false; for (const source of sources) source.src = ""; };
  }, [assets, indices]);
  return images;
}

export function CommentsInvasionPreview({ settings, timeSeconds, durationSeconds, playing, aspectRatio, customWidth, customHeight, projectSeed, onPlayPause, onStop, onSeek }: { settings: CommentsInvasionSettings; timeSeconds: number; durationSeconds: number; playing: boolean; aspectRatio: "9:16" | "16:9" | "1:1" | "4:5" | "custom"; customWidth: number; customHeight: number; projectSeed: number; onPlayPause: () => void; onStop: () => void; onSeek: (seconds: number) => void }) {
  const assets = useCommentsInvasionStore((state) => state.assets); const comments = useCommentImages(settings, timeSeconds); const canvas = useRef<HTMLCanvasElement>(null); const stage = useRef<HTMLDivElement>(null); const frame = useRef<HTMLDivElement>(null); const video = useRef<HTMLVideoElement>(null); const [revision, setRevision] = useState(0); const { fullscreenPreview, toggleFullscreenPreview } = useFullscreenPreview();
  const ratioDimensions = useMemo(() => aspectRatio === "16:9" ? [16, 9] : aspectRatio === "1:1" ? [1, 1] : aspectRatio === "4:5" ? [4, 5] : aspectRatio === "custom" ? [customWidth, customHeight] : [9, 16], [aspectRatio, customHeight, customWidth]);
  useEffect(() => {
    const element = video.current; if (!element || !settings.videoUrl) return; const target = Math.max(0, Math.min(Math.max(0, durationSeconds - .001), timeSeconds));
    if (element.readyState >= 1 && Math.abs(element.currentTime - target) > (playing ? .12 : .015)) element.currentTime = target;
    if (playing) void element.play().catch(() => undefined); else element.pause();
  }, [durationSeconds, playing, settings.videoUrl, timeSeconds]);
  useLayoutEffect(() => {
    const host = stage.current; const frameElement = frame.current; if (!host || !frameElement) return; let pending: number | null = null;
    const resize = () => { const target = canvas.current; if (!target) return; const bounds = host.getBoundingClientRect(); const fitted = fitCommentsInvasionPreview(bounds.width - 2, bounds.height - 2, ratioDimensions[0]!, ratioDimensions[1]!); if (fitted.width <= 0 || fitted.height <= 0) return; frameElement.style.width = `${Math.floor(fitted.width)}px`; frameElement.style.height = `${Math.floor(fitted.height)}px`; const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1)); const maxEdge = fullscreenPreview ? 1600 : 1200; const rawWidth = Math.max(1, Math.round(fitted.width * density)); const rawHeight = Math.max(1, Math.round(fitted.height * density)); const edgeScale = Math.min(1, maxEdge / Math.max(rawWidth, rawHeight)); const width = Math.max(1, Math.round(rawWidth * edgeScale)); const height = Math.max(1, Math.round(rawHeight * edgeScale)); if (target.width !== width || target.height !== height) { target.width = width; target.height = height; setRevision((value) => value + 1); } };
    const schedule = () => { if (pending !== null) cancelAnimationFrame(pending); pending = requestAnimationFrame(() => { pending = null; resize(); }); }; const observer = new ResizeObserver(schedule); observer.observe(host); resize(); return () => { observer.disconnect(); if (pending !== null) cancelAnimationFrame(pending); };
  }, [fullscreenPreview, ratioDimensions]);
  useEffect(() => {
    const target = canvas.current; if (!target) return; let request = 0;
    const draw = () => {
      const source = video.current; const sourceReady = Boolean(source?.readyState && source.readyState >= 2);
      const renderTime = playing && sourceReady ? source!.currentTime : timeSeconds;
      renderCommentsInvasionFrame(target, { timeSeconds: renderTime, videoFrame: sourceReady ? source : null, comments, totalComments: assets.length, settings, seed: projectSeed });
      if (playing) request = requestAnimationFrame(draw);
    };
    // Il primo frame è sincrono: un aggiornamento React non può annullarlo prima
    // che il browser esegua requestAnimationFrame. Durante play il canvas segue
    // il clock del video decodificato, come le altre preview video dell'app.
    draw(); return () => cancelAnimationFrame(request);
  }, [assets.length, comments, playing, projectSeed, revision, settings, timeSeconds]);
  return <main className={`viewport comments-invasion-viewport${fullscreenPreview ? " viewport-fullscreen has-fullscreen-transport" : ""}`} aria-label="Vista Comments Invasion">
    <div className="viewport-tools"><button className="active-control">Comments Invasion</button><span /><span className="viewport-quality">Timbri frame-accurate · audio originale</span><button type="button" className="viewport-fullscreen-toggle" aria-label={fullscreenPreview ? "Esci da tutto schermo" : "Animazione a tutto schermo"} aria-pressed={fullscreenPreview} onClick={toggleFullscreenPreview}>{fullscreenPreview ? "↙ Torna all’editor" : "⛶ Tutto schermo"}</button></div>
    <div ref={stage} className="three-stage"><div ref={frame} className="preview-frame comments-invasion-frame">{settings.videoUrl ? <video key={settings.videoUrl} ref={video} className="comments-invasion-source" src={settings.videoUrl} muted playsInline preload="auto" onLoadedData={() => setRevision((value) => value + 1)} onSeeked={() => setRevision((value) => value + 1)} /> : null}<canvas ref={canvas} aria-label="Composizione Comments Invasion" />{!settings.videoUrl ? <div className="comments-invasion-empty"><strong>Carica il video</strong><span>Il rapporto sorgente verrà adottato automaticamente.</span></div> : !assets.length ? <div className="comments-invasion-empty"><strong>Carica la cartella dei commenti</strong><span>Gli screenshot entreranno uno alla volta come timbri.</span></div> : null}</div></div>
    {fullscreenPreview ? <FullscreenPlaybackDock currentTime={timeSeconds} duration={durationSeconds} playing={playing} onPlayPause={onPlayPause} onStop={onStop} onSeek={onSeek} /> : null}
    <div className="viewport-footer"><span>● Preview ed export condividono tempi e posizioni</span><span>{assets.length} commenti · massimo {settings.maxVisible} visibili</span></div>
  </main>;
}
