import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RhythmBallProject } from "@rbs/project-schema";
import { backgroundAutoContainTransform, mapBackgroundAutoBoxToCanvas, normalizeBackgroundAutoProjectSeed, renderBackgroundAutoFrame } from "../services/background-auto-renderer";
import { FullscreenPlaybackDock } from "./FullscreenPlaybackDock";
import { useFullscreenPreview } from "../services/use-fullscreen-preview";

type Settings = RhythmBallProject["animation"]["backgroundAuto"];
const EMPTY_BANDS: readonly number[] = [];
const EMPTY_CUES: RhythmBallProject["subtitles"]["cues"] = [];
interface BackgroundAutoPreviewProps {
  settings: Settings;
  timeSeconds: number;
  durationSeconds: number;
  playing: boolean;
  spectrumBands: readonly number[];
  audioPulse: number;
  stereoLeftBands?: readonly number[];
  stereoRightBands?: readonly number[];
  stereoLeftPulse?: number;
  stereoRightPulse?: number;
  subtitleCues?: RhythmBallProject["subtitles"]["cues"];
  proSubtitlesSettings?: RhythmBallProject["animation"]["proSubtitles"];
  projectSeed: number;
  onSourceDimensions?: (dimensions: { width: number; height: number }) => void;
  onPlayPause?: () => void;
  onStop?: () => void;
  onSeek?: (seconds: number) => void;
}

export function BackgroundAutoPreview({ settings, timeSeconds, durationSeconds, playing, spectrumBands, audioPulse, stereoLeftBands = EMPTY_BANDS, stereoRightBands = EMPTY_BANDS, stereoLeftPulse = audioPulse, stereoRightPulse = audioPulse, subtitleCues = EMPTY_CUES, proSubtitlesSettings, projectSeed, onSourceDimensions, onPlayPause, onStop, onSeek }: BackgroundAutoPreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });
  const [selectedDetectionId, setSelectedDetectionId] = useState<string | null>(null);
  const [showDetectedAreas, setShowDetectedAreas] = useState(true);
  const loadId = useRef(0);
  const { fullscreenPreview, toggleFullscreenPreview } = useFullscreenPreview();

  useEffect(() => {
    const id = ++loadId.current;
    if (!settings.imageUrl) { setImage(null); return; }
    let active = true;
    const loaded = new Image();
    loaded.onload = () => {
      if (!active || id !== loadId.current) return;
      setImage(loaded);
      if (loaded.naturalWidth > 0 && loaded.naturalHeight > 0 && (settings.sourceWidth <= 0 || settings.sourceHeight <= 0)) onSourceDimensions?.({ width: loaded.naturalWidth, height: loaded.naturalHeight });
    };
    loaded.onerror = () => { if (active && id === loadId.current) setImage(null); };
    loaded.src = settings.imageUrl;
    return () => { active = false; };
  }, [onSourceDimensions, settings.imageUrl, settings.sourceHeight, settings.sourceWidth]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = host.current;
    if (!canvas || !container) return;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      setHostSize({ width, height });
      canvas.width = Math.max(1, Math.floor(width * Math.min(2, window.devicePixelRatio || 1)));
      canvas.height = Math.max(1, Math.floor(height * Math.min(2, window.devicePixelRatio || 1)));
      renderBackgroundAutoFrame({ canvas, image, settings, timeSeconds, spectrumBands, audioPulse, stereoLeftBands, stereoRightBands, stereoLeftPulse, stereoRightPulse, subtitleCues, ...(proSubtitlesSettings ? { proSubtitlesSettings } : {}), seed: normalizeBackgroundAutoProjectSeed(projectSeed) });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [audioPulse, image, proSubtitlesSettings, projectSeed, settings, stereoLeftBands, stereoLeftPulse, stereoRightBands, stereoRightPulse, subtitleCues, spectrumBands, timeSeconds]);

  useEffect(() => {
    if (selectedDetectionId && !settings.detections.some((detection) => detection.id === selectedDetectionId)) setSelectedDetectionId(null);
  }, [selectedDetectionId, settings.detections]);

  // The renderer derives its contain transform from the actual image pixels;
  // use the same dimensions once the image is loaded and only fall back to
  // persisted source metadata while it is still loading.
  const frameWidth = image?.naturalWidth || (settings.sourceWidth > 0 ? settings.sourceWidth : 0);
  const frameHeight = image?.naturalHeight || (settings.sourceHeight > 0 ? settings.sourceHeight : 0);
  const portraitFrame = frameWidth > 0 && frameHeight > 0 && frameWidth < frameHeight;
  const fullscreenTransport = fullscreenPreview && onPlayPause && onStop && onSeek;
  const transform = hostSize.width > 0 && hostSize.height > 0
    ? backgroundAutoContainTransform(frameWidth || 1, frameHeight || 1, hostSize.width, hostSize.height)
    : null;
  const overlays = showDetectedAreas && transform ? settings.detections.map((detection) => {
    const box = mapBackgroundAutoBoxToCanvas(detection.bbox, transform);
    const left = `${box.x / hostSize.width * 100}%`;
    const top = `${box.y / hostSize.height * 100}%`;
    const width = `${box.width / hostSize.width * 100}%`;
    const height = `${box.height / hostSize.height * 100}%`;
    const selected = detection.id === selectedDetectionId;
    return <button key={detection.id} type="button" className={`background-auto-detection-overlay${selected ? " is-selected" : ""}`} style={{ left, top, width, height }} aria-label={`Select ${detection.alias || detection.label}`} aria-pressed={selected} onClick={() => setSelectedDetectionId(detection.id)}>
      <span className="background-auto-detection-overlay-label">{detection.alias || detection.label}</span>
      <span className="background-auto-detection-overlay-meta">{detection.label} · {Math.round(detection.score * 100)}%</span>
    </button>;
  }) : null;

  return <main className={`viewport background-auto-viewport${fullscreenPreview ? " viewport-fullscreen" : ""}`} aria-label="Background Auto Animation preview">
    <div className="viewport-tools"><button className="active-control">Background Auto Animation</button><span /><span className="viewport-quality">Deterministic Canvas2D · contain + object detection</span><button type="button" className={`background-auto-detection-toggle${showDetectedAreas ? " active-control" : ""}`} aria-label="Toggle detected areas" aria-pressed={showDetectedAreas} onClick={() => setShowDetectedAreas((visible) => !visible)}>{showDetectedAreas ? "Hide detected areas" : "Show detected areas"}</button><button type="button" className="viewport-fullscreen-toggle" aria-label={fullscreenPreview ? "Exit full screen" : "Preview full screen"} aria-pressed={fullscreenPreview} onClick={toggleFullscreenPreview}>{fullscreenPreview ? "↙ Back to editor" : "⛶ Full screen"}</button></div>
    <div className="three-stage"><div className={`preview-frame ${portraitFrame ? "ratio-portrait" : "ratio-landscape"}`} style={frameWidth > 0 && frameHeight > 0 ? { aspectRatio: `${frameWidth} / ${frameHeight}` } : undefined}><div ref={host} className="background-auto-canvas-host"><canvas ref={canvasRef} />{overlays}</div></div></div>
    {fullscreenTransport ? <FullscreenPlaybackDock currentTime={timeSeconds} duration={durationSeconds} playing={playing} onPlayPause={onPlayPause} onStop={onStop} onSeek={onSeek} /> : null}
    <div className="viewport-footer"><span>● Canvas2D · shared offline export</span><span>{settings.detections.length} objects · {settings.effects.filter((effect) => effect.enabled).length} Circular Spectrum effects</span></div>
  </main>;
}
