import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../store/project-store";
import { registerVideoEditorTransport, useVideoEditorPlayback } from "../store/video-editor-playback-store";
import { videoEditorAspectLabel, videoEditorTimelineDuration, videoEditorVisibleLayers } from "../services/video-editor";
import { createVideoEditorFrameRenderer } from "../services/video-editor-renderer";
import { VideoEditorMediaPool } from "../services/video-editor-media-pool";
import { useFullscreenPreview } from "../services/use-fullscreen-preview";
import { FullscreenPlaybackDock } from "./FullscreenPlaybackDock";

/** Tetto di risoluzione della preview: la composizione finale resta quella dell’export. */
const previewMaximumDimension = 1280;

export function VideoEditorPreview() {
  const settings = useProjectStore((state) => state.project.animation.videoEditor);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const mediaRack = useRef<HTMLDivElement>(null);
  const presentedClipIds = useRef<ReadonlySet<string>>(new Set());
  const playbackAttempt = useRef(0);
  const backingRatio = useRef<number | null>(null);
  const [sizeRevision, setSizeRevision] = useState(0);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [starting, setStarting] = useState(false);
  const { fullscreenPreview, toggleFullscreenPreview } = useFullscreenPreview();
  const currentTime = useVideoEditorPlayback((state) => state.currentTime);
  const playing = useVideoEditorPlayback((state) => state.playing);
  const looping = useVideoEditorPlayback((state) => state.looping);
  const setCurrentTime = useVideoEditorPlayback((state) => state.setCurrentTime);
  const setPlaying = useVideoEditorPlayback((state) => state.setPlaying);
  const setLooping = useVideoEditorPlayback((state) => state.setLooping);
  const stop = useVideoEditorPlayback((state) => state.stop);

  const duration = useMemo(() => videoEditorTimelineDuration(settings), [settings]);
  const render = useRef(createVideoEditorFrameRenderer());
  // Il rerender del pool è volutamente disaccoppiato dal render React: un fotogramma
  // decodificato non deve ricostruire l’albero, deve solo ridisegnare la tela.
  const notifySourceReady = useCallback(() => setSourceRevision((value) => value + 1), []);
  // Un'istanza di stato resta definita anche durante il ciclo setup -> cleanup ->
  // setup che React StrictMode esegue in sviluppo. Il precedente ref veniva azzerato
  // dal primo cleanup e il secondo setup rimaneva senza pool: nessun video e, dopo
  // la regressione, nemmeno il fotogramma in pausa.
  const [mediaPool] = useState(() => new VideoEditorMediaPool(notifySourceReady));
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useLayoutEffect(() => {
    if (mediaRack.current) mediaPool.attach(mediaRack.current);
    // Il secondo setup di StrictMode deve ricreare subito i decoder appena liberati
    // dal cleanup precedente, senza attendere una modifica del progetto.
    mediaPool.sync(settingsRef.current);
    return () => { playbackAttempt.current += 1; mediaPool.dispose(); };
  }, [mediaPool]);
  // Sync, seek e presentazione avvengono nello stesso layout pass: React non puo
  // dipingere per un frame il media della timeline precedente dopo import o drag.
  useLayoutEffect(() => {
    mediaPool.sync(settings);
    mediaPool.update(settings, currentTime, playing);
    presentedClipIds.current = mediaPool.present(settings, currentTime);
  }, [currentTime, mediaPool, playing, settings]);

  const togglePlay = useCallback(() => {
    if (duration <= 0) return;
    if (starting) return;
    if (playing) { playbackAttempt.current += 1; setPlaying(false); mediaPool.pauseAll(); return; }
    // Il contesto audio va aperto dentro il gesto dell’utente: è il solo momento in cui
    // il browser lo autorizza a suonare senza restare sospeso.
    mediaPool.enableAudio();
    const startTime = currentTime >= duration - .01 ? 0 : currentTime;
    const attempt = ++playbackAttempt.current;
    setStarting(true);
    // `start` invoca play() nello stesso gesto, ma risolve soltanto quando il browser
    // conferma che tutti i decoder attivi sono partiti. Fino ad allora il clock resta
    // immobile: niente audio che corre sopra un fotogramma nero.
    void mediaPool.start(settings, startTime)
      .then(() => {
        if (playbackAttempt.current !== attempt) { mediaPool.pauseAll(); return; }
        setCurrentTime(startTime);
        setPlaying(true);
      })
      .catch(() => {
        if (playbackAttempt.current === attempt) setPlaying(false);
      })
      .finally(() => {
        if (playbackAttempt.current === attempt) setStarting(false);
      });
  }, [currentTime, duration, mediaPool, playing, setCurrentTime, setPlaying, settings, starting]);

  const stopPlayback = useCallback(() => { playbackAttempt.current += 1; setStarting(false); mediaPool.pauseAll(); stop(); }, [mediaPool, stop]);

  useEffect(() => registerVideoEditorTransport((action) => {
    if (action === "stop") stopPlayback();
    else togglePlay();
  }), [stopPlayback, togglePlay]);

  /** Trasporto proprio del montaggio: avanza in tempo reale col clock dell’animazione. */
  useEffect(() => {
    if (!playing) return;
    if (duration <= 0) { setPlaying(false); return; }
    let handle = 0;
    let previous = performance.now();
    const step = (now: number) => {
      const delta = Math.min(.25, Math.max(0, (now - previous) / 1000));
      previous = now;
      const next = useVideoEditorPlayback.getState().currentTime + delta;
      if (next >= duration) {
        if (looping) setCurrentTime(0);
        else { setCurrentTime(duration); setPlaying(false); mediaPool.pauseAll(); return; }
      } else setCurrentTime(next);
      handle = window.requestAnimationFrame(step);
    };
    handle = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(handle);
  }, [duration, looping, mediaPool, playing, setCurrentTime, setPlaying]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))) return;
      event.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay]);

  useLayoutEffect(() => {
    const element = stage.current;
    const frameElement = frame.current;
    if (!element || !frameElement) return;
    let resizeFrame: number | null = null;
    const resize = () => {
      const target = canvas.current;
      if (!target) return;
      const computed = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      const available = {
        width: bounds.width - parseFloat(computed.paddingLeft || "0") - parseFloat(computed.paddingRight || "0") - 2,
        height: bounds.height - parseFloat(computed.paddingTop || "0") - parseFloat(computed.paddingBottom || "0") - 2
      };
      const ratio = settingsRef.current.outputWidth / Math.max(1, settingsRef.current.outputHeight);
      const width = Math.min(available.width, available.height * ratio);
      const height = width / ratio;
      if (width <= 0 || height <= 0) return;
      frameElement.style.width = `${Math.floor(width)}px`;
      frameElement.style.height = `${Math.floor(height)}px`;
      frameElement.style.aspectRatio = `${settingsRef.current.outputWidth} / ${settingsRef.current.outputHeight}`;
      // Keep the backing store stable while the dock is resized. CSS scales the
      // composition without reallocating the canvas, preventing a one-frame flash.
      const nextRatio = settingsRef.current.outputWidth / Math.max(1, settingsRef.current.outputHeight);
      if (target.width === 0 || target.height === 0 || backingRatio.current === null || Math.abs(backingRatio.current - nextRatio) > 1e-6) {
        const density = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
        const renderScale = Math.min(density, previewMaximumDimension / Math.max(width, height));
        const backingWidth = Math.max(2, Math.round(width * renderScale));
        const backingHeight = Math.max(2, Math.round(height * renderScale));
        target.width = backingWidth;
        target.height = backingHeight;
        backingRatio.current = nextRatio;
        setSizeRevision((value) => value + 1);
      }
    };
    const scheduleResize = () => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => { resizeFrame = null; resize(); });
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    resize();
    window.addEventListener("resize", scheduleResize);
    return () => { observer.disconnect(); window.removeEventListener("resize", scheduleResize); if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame); };
  }, [fullscreenPreview, settings.outputHeight, settings.outputWidth]);

  useLayoutEffect(() => {
    const target = canvas.current;
    if (!target) return;
    // Il frame callback del decoder ha già certificato che il frame è pronto:
    // disegnare qui direttamente evita una seconda RAF che veniva cancellata dal
    // tick successivo della timeline prima di arrivare a schermo.
    render.current(target, settings, currentTime, (clip) => presentedClipIds.current.has(clip.id) ? null : mediaPool.frame(clip));
  }, [currentTime, mediaPool, settings, sizeRevision, sourceRevision]);

  const layers = videoEditorVisibleLayers(settings, currentTime).length;
  const mediaStatus = mediaPool.status(settings, currentTime);
  return <main className={`viewport video-editor-viewport${fullscreenPreview ? " viewport-fullscreen has-fullscreen-transport" : ""}`} aria-label="Vista Video Editor">
    <div className="viewport-tools">
      <button className="active-control">Video Editor</button>
      <button type="button" onClick={togglePlay} disabled={duration <= 0 || starting} aria-keyshortcuts="Space">{starting ? "… Avvio" : playing ? "❚❚ Pausa" : "▶ Play"}</button>
      <button type="button" onClick={stopPlayback} disabled={duration <= 0}>■ Stop</button>
      <button type="button" className={looping ? "active-control" : ""} aria-pressed={looping} onClick={() => setLooping(!looping)}>⟲ Loop</button>
      <span />
      <span className="viewport-quality"><strong>{videoEditorAspectLabel(settings.outputWidth, settings.outputHeight)}</strong> · {settings.outputWidth} × {settings.outputHeight} · {layers} livelli attivi</span>
      <button type="button" className="viewport-fullscreen-toggle" aria-label={fullscreenPreview ? "Esci da tutto schermo" : "Anteprima a tutto schermo"} aria-pressed={fullscreenPreview} onClick={toggleFullscreenPreview}>{fullscreenPreview ? "↙ Torna all’editor" : "⛶ Tutto schermo"}</button>
    </div>
    <div ref={stage} className="three-stage"><div ref={frame} className={`preview-frame video-editor-frame ${settings.outputHeight > settings.outputWidth ? "is-portrait" : "is-landscape"}`}>
      <canvas ref={canvas} aria-label="Composizione Video Editor" />
      <div ref={mediaRack} className="video-editor-media-rack" aria-hidden="true" />
      {duration <= 0 ? <p className="video-editor-empty">Carica i media nel pool e trascinali in timeline per iniziare il montaggio.</p> : null}
      {duration > 0 && mediaStatus.expectedVisuals > 0 && mediaStatus.readyVisuals === 0 ? <p className="video-editor-decoding" role="status">Decodifica video…<small>{mediaStatus.pendingNames.join(", ")}</small></p> : null}
      {mediaStatus.errors.length ? <p className="video-editor-playback-error" role="alert">Riproduzione video non disponibile<small>{mediaStatus.errors.join(" · ")}</small></p> : null}
    </div></div>
    {fullscreenPreview ? <FullscreenPlaybackDock currentTime={currentTime} duration={duration} playing={playing} onPlayPause={togglePlay} onStop={stopPlayback} onSeek={setCurrentTime} /> : null}
    <div className="viewport-footer">
      <span>● {currentTime.toFixed(2)} s / {duration.toFixed(2)} s</span>
      <span>{settings.clips.length} clip su {settings.tracks.length} tracce · {mediaStatus.readyVisuals}/{mediaStatus.expectedVisuals} livelli video pronti · ordine timeline sincronizzato · export offline qualità piena</span>
    </div>
  </main>;
}
