import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RhythmBallProject } from "@rbs/project-schema";
import { fitPortraitLandscapePreview, portraitLandscapeQualityProfile, renderPortraitLandscapeFrame } from "../services/portrait-landscape-renderer";
import { subtitleFontWeight } from "../services/subtitle-fonts";
import { useFullscreenPreview } from "../services/use-fullscreen-preview";
import { FullscreenPlaybackDock } from "./FullscreenPlaybackDock";

type Settings = RhythmBallProject["animation"]["portraitLandscape"];
type SubtitleTrack = RhythmBallProject["subtitles"];
type ProSubtitlesSettings = RhythmBallProject["animation"]["proSubtitles"];

function useLoadedImage(url: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImage(null); return; }
    let active = true; const source = new Image(); source.onload = () => { if (active) setImage(source); }; source.onerror = () => { if (active) setImage(null); }; source.src = url;
    return () => { active = false; source.src = ""; };
  }, [url]);
  return image;
}

export function PortraitLandscapePreview({ settings, subtitles, proSubtitlesSettings, timeSeconds, durationSeconds, playing, bpm, analysisReady, audioPulse, rhythmPulse, spectrumBands, stereoLeftBands, stereoRightBands, onPlayPause, onStop, onSeek }: { settings: Settings; subtitles: SubtitleTrack; proSubtitlesSettings: ProSubtitlesSettings; timeSeconds: number; durationSeconds: number; playing: boolean; bpm: number; analysisReady: boolean; audioPulse: number; rhythmPulse: number; spectrumBands: readonly number[]; stereoLeftBands: readonly number[]; stereoRightBands: readonly number[]; onPlayPause: () => void; onStop: () => void; onSeek: (seconds: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null); const stage = useRef<HTMLDivElement>(null); const frame = useRef<HTMLDivElement>(null); const video = useRef<HTMLVideoElement>(null); const [frameRevision, setFrameRevision] = useState(0); const [sizeRevision, setSizeRevision] = useState(0); const sideImage = useLoadedImage(settings.sideImageUrl); const coverImage = useLoadedImage(settings.coverImageUrl); const { fullscreenPreview, toggleFullscreenPreview } = useFullscreenPreview();
  const renderTimeSeconds = playing ? Math.floor(timeSeconds * 30) / 30 : timeSeconds;

  useEffect(() => {
    const element = video.current; if (!element || !settings.videoUrl) return;
    const target = Math.max(0, Math.min(Math.max(0, durationSeconds - .001), timeSeconds));
    if (element.readyState >= 1 && Math.abs(element.currentTime - target) > (playing ? .12 : .015)) element.currentTime = target;
    if (playing) void element.play().catch(() => undefined); else element.pause();
  }, [durationSeconds, playing, settings.videoUrl, timeSeconds]);

  useEffect(() => {
    if (!subtitles.enabled || !subtitles.cues.length || !document.fonts?.load) return;
    let active = true;
    const families = new Set([proSubtitlesSettings.defaultFontFamily, ...proSubtitlesSettings.cueStyles.map((style) => style.fontFamily)]);
    void Promise.all([...families].map((family) => document.fonts.load(`${subtitleFontWeight(family)} 64px "${family}"`))).then(() => {
      if (active) setFrameRevision((value) => value + 1);
    });
    return () => { active = false; };
  }, [proSubtitlesSettings.cueStyles, proSubtitlesSettings.defaultFontFamily, subtitles.cues.length, subtitles.enabled]);

  useLayoutEffect(() => {
    const element = stage.current; const frameElement = frame.current; if (!element || !frameElement) return;
    let resizeFrame: number | null = null;
    const resize = () => {
      const target = canvas.current; if (!target) return;
      const computed = window.getComputedStyle(element); const bounds = element.getBoundingClientRect(); const horizontalPadding = parseFloat(computed.paddingLeft || "0") + parseFloat(computed.paddingRight || "0"); const verticalPadding = parseFloat(computed.paddingTop || "0") + parseFloat(computed.paddingBottom || "0");
      const fitted = fitPortraitLandscapePreview(bounds.width - horizontalPadding - 2, bounds.height - verticalPadding - 2); if (fitted.width <= 0 || fitted.height <= 0) return;
      frameElement.style.width = `${Math.floor(fitted.width)}px`; frameElement.style.height = `${Math.floor(fitted.height)}px`;
      const profile = portraitLandscapeQualityProfile("preview"); const limit = fullscreenPreview ? 1280 : profile.canvasMaxWidth; const width = Math.max(480, Math.min(limit, Math.round(fitted.width))); const height = Math.round(width * 9 / 16);
      if (target.width !== width || target.height !== height) { target.width = width; target.height = height; const context = target.getContext("2d"); if (context) { context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "medium"; } setSizeRevision((value) => value + 1); }
    };
    const scheduleResize = () => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => { resizeFrame = null; resize(); });
    };
    const observer = new ResizeObserver(scheduleResize); observer.observe(element); if (element.parentElement) observer.observe(element.parentElement); resize();
    window.addEventListener("resize", scheduleResize);
    return () => { observer.disconnect(); window.removeEventListener("resize", scheduleResize); if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame); };
  }, [fullscreenPreview]);

  useEffect(() => {
    const target = canvas.current; if (!target) return;
    const renderFrame = window.requestAnimationFrame(() => renderPortraitLandscapeFrame(target, { timeSeconds: renderTimeSeconds, durationSeconds, bpm, quality: "preview", analysisReady, audioPulse, rhythmPulse, spectrumBands, stereoLeftBands, stereoRightBands, videoFrame: video.current?.readyState && video.current.readyState >= 2 ? video.current : null, sideImage, coverImage, settings, subtitlesEnabled: subtitles.enabled, subtitleCues: subtitles.cues, subtitleSettings: proSubtitlesSettings }));
    return () => window.cancelAnimationFrame(renderFrame);
  }, [analysisReady, audioPulse, bpm, coverImage, durationSeconds, frameRevision, proSubtitlesSettings, renderTimeSeconds, rhythmPulse, settings, sideImage, sizeRevision, spectrumBands, stereoLeftBands, stereoRightBands, subtitles.cues, subtitles.enabled]);

  return <main className={`viewport portrait-landscape-viewport${fullscreenPreview ? " viewport-fullscreen has-fullscreen-transport" : ""}`} aria-label="Vista From 9:16 to 16:9">
    <div className="viewport-tools"><button className="active-control">From 9:16 to 16:9</button><span /><span className="viewport-quality">Preview ottimizzata 30 fps · export qualità piena</span><button type="button" className="viewport-fullscreen-toggle" aria-label={fullscreenPreview ? "Esci da tutto schermo" : "Animazione a tutto schermo"} aria-pressed={fullscreenPreview} onClick={toggleFullscreenPreview}>{fullscreenPreview ? "↙ Torna all’editor" : "⛶ Tutto schermo"}</button></div>
    <div ref={stage} className="three-stage"><div ref={frame} className="preview-frame ratio-landscape portrait-landscape-frame">
      {settings.videoUrl ? <video key={settings.videoUrl} ref={video} className="portrait-landscape-source" src={settings.videoUrl} muted playsInline preload="auto" onLoadedData={() => setFrameRevision((value) => value + 1)} onSeeked={() => setFrameRevision((value) => value + 1)} /> : null}
      <canvas ref={canvas} aria-label="Composizione From 9:16 to 16:9" />
    </div></div>
    {fullscreenPreview ? <FullscreenPlaybackDock currentTime={timeSeconds} duration={durationSeconds} playing={playing} onPlayPause={onPlayPause} onStop={onStop} onSeek={onSeek} /> : null}
    <div className="viewport-footer"><span>● Preview leggera · export ricostruito alla risoluzione finale</span><span>{settings.videoName || "Carica video 9:16"} · {settings.videoHasAudio ? "spettro stereo analizzato" : "visualizer di sicurezza"}</span></div>
  </main>;
}
