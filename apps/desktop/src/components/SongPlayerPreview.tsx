import { useEffect, useRef } from "react";
import type { SongPlayerSettings } from "@rbs/project-schema";
import type { SongPlayerAnalysis } from "../services/song-player-types";
import { SongPlayerRenderer } from "../services/song-player-renderer";
import type { SongPlayerPlaybackRange } from "../services/song-player-playback";
import type { RhythmBallProject } from "@rbs/project-schema";
import { fitSongPlayerPreviewFrame } from "../services/song-player-preview-size";

type SongPlayerAspectRatio = RhythmBallProject["canvas"]["aspectRatio"];

export function SongPlayerPreview({ settings, analysis, playbackRange, currentTime, aspectRatio, customWidth, customHeight, analysisError, onRendererReady }: { settings: SongPlayerSettings; analysis?: SongPlayerAnalysis | null; playbackRange: SongPlayerPlaybackRange; currentTime: number; aspectRatio: SongPlayerAspectRatio; customWidth: number; customHeight: number; analysisError?: string | null; onRendererReady?: (renderer: SongPlayerRenderer | null) => void }) {
  const hostRef = useRef<HTMLDivElement>(null); const frameRef = useRef<HTMLDivElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null); const rendererRef = useRef<SongPlayerRenderer | null>(null); const callbackRef = useRef(onRendererReady); const formatRef = useRef({ aspectRatio, customWidth, customHeight }); const resizeRef = useRef<() => void>(() => undefined); callbackRef.current = onRendererReady; formatRef.current = { aspectRatio, customWidth, customHeight };
  useEffect(() => { const host = hostRef.current; const frame = frameRef.current; const canvas = canvasRef.current; if (!host || !frame || !canvas) return; const renderer = new SongPlayerRenderer(canvas); rendererRef.current = renderer; const resize = () => { const format = formatRef.current; const fitted = fitSongPlayerPreviewFrame(host.clientWidth, host.clientHeight, format.aspectRatio, format.customWidth, format.customHeight, window.devicePixelRatio || 1); frame.style.width = `${fitted.cssWidth}px`; frame.style.height = `${fitted.cssHeight}px`; frame.style.aspectRatio = `${fitted.sourceWidth} / ${fitted.sourceHeight}`; renderer.setExportSize(fitted.pixelWidth, fitted.pixelHeight); renderer.renderNow(); }; resizeRef.current = resize; resize(); const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize); observer?.observe(host); window.addEventListener("resize", resize); callbackRef.current?.(renderer); return () => { observer?.disconnect(); window.removeEventListener("resize", resize); resizeRef.current = () => undefined; callbackRef.current?.(null); renderer.dispose(); rendererRef.current = null; }; }, []);
  useEffect(() => { resizeRef.current(); }, [aspectRatio, customHeight, customWidth]);
  useEffect(() => { const input = { settings, playbackRange, localTimeSeconds: currentTime, ...(analysis === undefined ? {} : { analysis }) }; rendererRef.current?.update(input); }, [analysis, currentTime, playbackRange, settings]);
  return <div ref={hostRef} className="song-player-preview"><div ref={frameRef} className="song-player-preview-frame" data-aspect-ratio={aspectRatio}><canvas ref={canvasRef} aria-label="Anteprima Song Player" />{analysisError ? <p className="song-player-analysis-error" role="alert">{analysisError}</p> : null}</div></div>;
}
