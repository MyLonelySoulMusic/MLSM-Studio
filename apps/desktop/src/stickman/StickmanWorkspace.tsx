import { useCallback, useEffect, useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import type { ExportProgress } from "@rbs/export-engine";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { SupportArtistButton } from "../components/ArtistSupport";
import { MemoryButton } from "../components/MemoryStudio";
import { SettingsButton } from "../components/StudioSettings";
import { defaultBivioColors, defaultBivioSettings, normalizeBivioSettings, stickmanAnimations, type BivioSettings, type BivioColorKey } from "./settings";
import { ensureBivioFont, renderBivioFrame } from "./renderer";
import { exportBivioVideo } from "./exporter";
import "./stickman.css";

const STICKMAN_SETTINGS_STORAGE_KEY = "mlsm-studio.stickman.bivio-settings.v1";
const PREVIEW_WIDTH = 540;
const PREVIEW_HEIGHT = 960;
const PREVIEW_FPS = 30;

const copy = {
  it: {
    home: "Home",
    eyebrow: "STICKMAN ANIMATIONS",
    areaTitle: "Stickman Animations",
    title: "Bivio",
    description: "Un poster verticale disegnato a mano, messo in cammino dalla tua canzone.",
    gallery: "Galleria animazioni",
    posterMotion: "Poster motion",
    selected: "Selezionata",
    galleryHint: "La galleria resta essenziale: nuove animazioni compariranno qui quando saranno pronte.",
    preview: "Anteprima verticale",
    previewPaused: "Anteprima in pausa",
    previewPlaying: "Anteprima in riproduzione",
    previewHint: "Il primo frame resta visibile anche prima di caricare l’audio.",
    gaitNote: "Le figure seguono un passo in avanti e rientrano fuori inquadratura.",
    cycleNote: "Inizio e fine del ciclo sulla durata della canzone coincidono.",
    previewError: "Anteprima non disponibile: impossibile disegnare il frame.",
    soundtrack: "Colonna sonora",
    controls: "Controlli Bivio",
    chooseAudio: "Carica audio",
    replaceAudio: "Sostituisci audio",
    noAudio: "Nessun audio caricato",
    loadingAudio: "Lettura dei metadati audio…",
    audioReady: "Audio pronto",
    audioError: "Impossibile leggere questo file audio.",
    play: "Riproduci",
    pause: "Pausa",
    stop: "Stop",
    seek: "Posizione audio",
    loop: "Ripeti audio",
    text: "Testo del poster",
    leftText: "Colonna sinistra",
    rightText: "Colonna destra",
    rightCaption: "Didascalia destra",
    motion: "Movimento",
    crowd: "Persone a sinistra",
    pace: "Passo",
    grain: "Grana carta",
    colors: "Colori degli elementi",
    colorsHint: "Personalizza ogni elemento. I colori vengono salvati e usati anche nel video esportato.",
    resetColors: "Ripristina colori",
    colorLabels: {
      crowd: "Folla a sinistra", solo: "Personaggio a destra", leftText: "Testo a sinistra", rightText: "Testo a destra", rightCaption: "Didascalia", underlines: "Sottolineature",
      paper: "Sfondo carta", road: "Strada", roadEdges: "Bordi della strada", signpost: "Palo del cartello", leftArrow: "Freccia sinistra", rightArrow: "Freccia destra",
      cross: "Simbolo croce", arrowHeart: "Cuore sulla freccia", heart: "Cuore sotto il testo", ink: "Tratti decorativi", accentInk: "Accenti decorativi", shadows: "Ombre",
    },
    exportVideo: "Esporta video",
    exportSettings: "Impostazioni export",
    resolution: "Risoluzione",
    frameRate: "Frame rate",
    fontLoading: "Caricamento font brush…",
    fontReady: "Font brush gratuito pronto",
    fontError: "Font brush non disponibile",
    fontNote: "Stile brush gratuito OFL: richiama un’insegna dipinta, non è il font originale.",
    needAudio: "Carica un audio valido per abilitare l’export.",
    needFont: "Attendi il caricamento del font brush.",
    exportPreparing: "Preparazione export…",
    exportReady: "Export completato",
    exportCancelled: "Export annullato",
    exportFailed: "Export non riuscito",
    cancelExport: "Annulla export",
    seconds: "s",
    language: uiCopy.it.language,
    appearance: uiCopy.it.appearance,
    day: uiCopy.it.day,
    night: uiCopy.it.night,
  },
  en: {
    home: "Home",
    eyebrow: "STICKMAN ANIMATIONS",
    areaTitle: "Stickman Animations",
    title: "Bivio",
    description: "A hand-drawn vertical poster set in motion by your song.",
    gallery: "Animation gallery",
    posterMotion: "Poster motion",
    selected: "Selected",
    galleryHint: "The gallery stays focused: new animations will appear here when they are ready.",
    preview: "Vertical preview",
    previewPaused: "Preview paused",
    previewPlaying: "Preview playing",
    previewHint: "The first frame is visible even before you load audio.",
    gaitNote: "Figures keep a forward gait and return outside the frame.",
    cycleNote: "The cycle starts and ends identically across the song duration.",
    previewError: "Preview unavailable: the frame could not be drawn.",
    soundtrack: "Soundtrack",
    controls: "Bivio controls",
    chooseAudio: "Load audio",
    replaceAudio: "Replace audio",
    noAudio: "No audio loaded",
    loadingAudio: "Reading audio metadata…",
    audioReady: "Audio ready",
    audioError: "This audio file could not be read.",
    play: "Play",
    pause: "Pause",
    stop: "Stop",
    seek: "Audio position",
    loop: "Loop audio",
    text: "Poster text",
    leftText: "Left column",
    rightText: "Right column",
    rightCaption: "Right caption",
    motion: "Motion",
    crowd: "People on the left",
    pace: "Walking pace",
    grain: "Paper grain",
    colors: "Element colors",
    colorsHint: "Customize each element. Colors are saved and included in your exported video.",
    resetColors: "Reset colors",
    colorLabels: {
      crowd: "Left crowd", solo: "Right character", leftText: "Left text", rightText: "Right text", rightCaption: "Caption", underlines: "Underlines",
      paper: "Paper background", road: "Road", roadEdges: "Road edges", signpost: "Signpost", leftArrow: "Left arrow", rightArrow: "Right arrow",
      cross: "Cross symbol", arrowHeart: "Arrow heart", heart: "Heart below text", ink: "Decorative strokes", accentInk: "Decorative accents", shadows: "Shadows",
    },
    exportVideo: "Export video",
    exportSettings: "Export settings",
    resolution: "Resolution",
    frameRate: "Frame rate",
    fontLoading: "Loading brush font…",
    fontReady: "Free brush font ready",
    fontError: "Brush font unavailable",
    fontNote: "Free OFL brush style: it evokes a painted sign, not the original font.",
    needAudio: "Load a valid audio file to enable export.",
    needFont: "Wait for the brush font to finish loading.",
    exportPreparing: "Preparing export…",
    exportReady: "Export complete",
    exportCancelled: "Export cancelled",
    exportFailed: "Export failed",
    cancelExport: "Cancel export",
    seconds: "s",
    language: uiCopy.en.language,
    appearance: uiCopy.en.appearance,
    day: uiCopy.en.day,
    night: uiCopy.en.night,
  },
} as const;

type FontState = "loading" | "ready" | "error";
type AudioState = "idle" | "loading" | "ready" | "error";
type ExportState = "idle" | "running" | "success" | "cancelled" | "error";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remaining = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError"
    || typeof reason === "object" && reason !== null && "name" in reason && reason.name === "AbortError";
}

function progressLabel(progress: ExportProgress | null, fallback: string): string {
  if (!progress) return fallback;
  return progress.phaseLabel ?? progress.phase ?? fallback;
}

export function StickmanWorkspace({ onHome }: { onHome: () => void }) {
  const { language, theme, setLanguage, setTheme } = useUiPreferences();
  const t = copy[language];
  const [settings, setSettings] = useState<BivioSettings>(() => normalizeBivioSettings(defaultBivioSettings));
  const [fontState, setFontState] = useState<FontState>("loading");
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [audioName, setAudioName] = useState("");
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopAudio, setLoopAudio] = useState(true);
  const [audioError, setAudioError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [exportResolution, setExportResolution] = useState<720 | 1080>(1080);
  const [exportFps, setExportFps] = useState<24 | 30>(30);
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportError, setExportError] = useState("");
  const [exportResult, setExportResult] = useState<Awaited<ReturnType<typeof exportBivioVideo>> | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrlRef = useRef<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const isExporting = exportState === "running";
  const canExport = audioState === "ready" && Boolean(audioUrlRef.current) && audioDuration > 0 && fontState === "ready" && !isExporting;

  useEffect(() => {
    mountedRef.current = true;
    const audio = audioRef.current;
    return () => {
      mountedRef.current = false;
      exportAbortRef.current?.abort();
      audio?.pause();
      const ownedUrl = audioUrlRef.current;
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      audioUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    try { window.localStorage.removeItem(STICKMAN_SETTINGS_STORAGE_KEY); } catch { /* Legacy cleanup is best effort. */ }
  }, []);

  useEffect(() => {
    let active = true;
    setFontState("loading");
    void ensureBivioFont().then(() => {
      if (active) setFontState("ready");
    }).catch(() => {
      if (active) setFontState("error");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.loop = loopAudio;
  }, [loopAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioUrl) {
      audio.removeAttribute("src");
      audio.load();
      return;
    }
    audio.src = audioUrl;
    audio.load();
    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [audioUrl]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const updatePosterSize = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (!width || !height) return;
      const posterWidth = Math.max(1, Math.min(540, width, height * 9 / 16));
      const posterHeight = posterWidth * 16 / 9;
      stage.style.setProperty("--skm-poster-width", `${posterWidth}px`);
      stage.style.setProperty("--skm-poster-height", `${posterHeight}px`);
    };
    updatePosterSize();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updatePosterSize);
      observer.observe(stage);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updatePosterSize);
    return () => window.removeEventListener("resize", updatePosterSize);
  }, []);

  const renderPreview = useCallback((timeSeconds: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      renderBivioFrame(canvas, {
        timeSeconds: Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0,
        durationSeconds: audioDuration > 0 && Number.isFinite(audioDuration) ? audioDuration : 1,
        settings,
      });
      setPreviewError((current) => current ? "" : current);
    } catch (reason) {
      const message = reason instanceof Error && reason.message ? reason.message : t.previewError;
      setPreviewError((current) => current === message ? current : message);
    }
  }, [audioDuration, settings, t.previewError]);

  useEffect(() => {
    renderPreview(currentTime);
  }, [currentTime, fontState, renderPreview]);

  useEffect(() => {
    if (!playing) return undefined;
    let requestId = 0;
    let lastRender = -Infinity;
    const tick = (timestamp: number) => {
      const audio = audioRef.current;
      if (audio && timestamp - lastRender >= 1000 / PREVIEW_FPS - 0.5) {
        const nextTime = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
        lastRender = timestamp;
        setCurrentTime(nextTime);
      }
      requestId = window.requestAnimationFrame(tick);
    };
    requestId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(requestId);
  }, [playing, renderPreview]);

  const updateSetting = <Key extends keyof BivioSettings>(key: Key, value: BivioSettings[Key]) => {
    setSettings((current) => normalizeBivioSettings({ ...current, [key]: value }));
  };

  const selectAudio = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || isExporting) return;
    const nextUrl = URL.createObjectURL(file);
    const previousUrl = audioUrlRef.current;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    audioUrlRef.current = nextUrl;
    audioRef.current?.pause();
    if (audioRef.current) {
      try { audioRef.current.currentTime = 0; } catch { /* Metadata may still be pending. */ }
    }
    setPlaying(false);
    setCurrentTime(0);
    setAudioName(file.name);
    setAudioDuration(0);
    setAudioError("");
    setAudioState("loading");
    setAudioUrl(nextUrl);
    setExportState("idle");
    setExportProgress(null);
    setExportResult(null);
    setExportError("");
    // Allow selecting the same file twice and still trigger a new metadata load.
    event.currentTarget.value = "";
  };

  const sourceMatchesCurrentAudio = (audio: HTMLAudioElement): boolean => {
    const ownedUrl = audioUrlRef.current;
    return Boolean(ownedUrl) && (audio.currentSrc === ownedUrl || audio.src === ownedUrl || audio.getAttribute("src") === ownedUrl);
  };

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLAudioElement>) => {
    const audio = event.currentTarget;
    if (!sourceMatchesCurrentAudio(audio)) return;
    const duration = audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      setAudioState("error");
      setAudioError(t.audioError);
      setAudioDuration(0);
      return;
    }
    setAudioDuration(duration);
    setCurrentTime(Math.min(audio.currentTime || 0, duration));
    setAudioState("ready");
    setAudioError("");
  };

  const handleAudioError = (event: SyntheticEvent<HTMLAudioElement>) => {
    if (!sourceMatchesCurrentAudio(event.currentTarget)) return;
    setAudioState("error");
    setAudioDuration(0);
    setCurrentTime(0);
    setAudioError(t.audioError);
  };

  const handleTimeUpdate = (event: SyntheticEvent<HTMLAudioElement>) => {
    const audio = event.currentTarget;
    if (!sourceMatchesCurrentAudio(audio)) return;
    const nextTime = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
    if (!playing) setCurrentTime(nextTime);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio || audioState !== "ready" || isExporting) return;
    if (audio.paused) {
      void audio.play().catch(() => {
        if (mountedRef.current) setAudioError(t.audioError);
      });
    } else {
      audio.pause();
    }
  };

  const stopPlayback = () => {
    const audio = audioRef.current;
    if (!audio || audioState !== "ready" || isExporting) return;
    audio.pause();
    try { audio.currentTime = 0; } catch { /* Ignore a seek while the media element is changing source. */ }
    setCurrentTime(0);
    setPlaying(false);
  };

  const seek = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || audioState !== "ready" || isExporting) return;
    const nextTime = Math.max(0, Math.min(audioDuration, Number(event.target.value)));
    try { audio.currentTime = nextTime; } catch { /* The browser will apply the seek after metadata is ready. */ }
    setCurrentTime(nextTime);
  };

  const runExport = async () => {
    const sourceUrl = audioUrlRef.current;
    if (!sourceUrl || !canExport || exportAbortRef.current) return;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    audioRef.current?.pause();
    setPlaying(false);
    setExportState("running");
    setExportProgress(null);
    setExportResult(null);
    setExportError("");
    try {
      const result = await exportBivioVideo({
        sourceUrl,
        durationSeconds: audioDuration,
        settings,
        resolution: exportResolution,
        fps: exportFps,
      }, controller.signal, (progress: ExportProgress) => {
        if (mountedRef.current) setExportProgress(progress);
      });
      if (!mountedRef.current) return;
      setExportResult(result);
      setExportState("success");
    } catch (reason) {
      if (!mountedRef.current) return;
      if (isAbortError(reason)) {
        setExportState("cancelled");
        setExportError("");
      } else {
        setExportState("error");
        setExportError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (exportAbortRef.current === controller) exportAbortRef.current = null;
    }
  };

  const cancelExport = () => exportAbortRef.current?.abort();
  const exportPercentage = exportProgress?.indeterminate ? null : Math.round((exportProgress?.stageProgress ?? exportProgress?.progress ?? 0) * 100);
  const exportResultName = exportResult && typeof exportResult === "object" && "fileName" in exportResult ? String(exportResult.fileName) : "MP4";
  const audioStatusText = audioState === "loading"
    ? t.loadingAudio
    : audioState === "ready"
      ? `${t.audioReady} · ${formatTime(audioDuration)} ${t.seconds}`
      : audioState === "error"
        ? audioError || t.audioError
        : t.noAudio;
  const exportDisabledReason = audioState !== "ready" ? t.needAudio : fontState !== "ready" ? t.needFont : undefined;

  return <div className="skm-workspace" data-ui-copy aria-label={t.areaTitle}>
    <header className="skm-topbar">
      <button type="button" className="skm-home-button" onClick={onHome} aria-label={t.home}><span aria-hidden="true">⌂</span>{t.home}</button>
      <div className="skm-identity" aria-label="MLSM Studio — My Lonely Soul Music">
        <img className="skm-brand-mark" src="/mlsm-studio-favicon-192.png" alt="" />
        <span className="skm-brand-copy"><strong>MLSM Studio</strong><small>My Lonely Soul Music</small></span>
      </div>
      <div className="skm-topbar-mode"><span>{t.eyebrow}</span><strong>{t.areaTitle}</strong></div>
      <div className="skm-topbar-actions">
        <SettingsButton />
        <MemoryButton compact />
        <SupportArtistButton compact />
        <label className="skm-language-picker"><span>{t.language}</span><select aria-label={t.language} value={language} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "it")} disabled={isExporting}><option value="it">IT</option><option value="en">EN</option></select></label>
        <button type="button" className="skm-theme-toggle" aria-label={`${t.appearance}: ${theme === "day" ? t.day : t.night}`} aria-pressed={theme === "night"} onClick={() => setTheme(theme === "day" ? "night" : "day")}><span aria-hidden="true">{theme === "day" ? "☼" : "◐"}</span>{theme === "day" ? t.day : t.night}</button>
        <button type="button" className="skm-export-button" disabled={!canExport} title={exportDisabledReason} onClick={() => void runExport()}>{t.exportVideo} <span aria-hidden="true">↗</span></button>
      </div>
    </header>

    <main className="skm-main">
      <aside className="skm-gallery-panel" aria-label={t.gallery}>
        <div className="skm-section-heading"><span className="skm-kicker">01 / MOTION</span><h2>{t.gallery}</h2></div>
        <div className="skm-gallery-list">
          {stickmanAnimations.map((animation, index) => <button type="button" key={animation.id} className="skm-gallery-card skm-gallery-card-active" aria-current="true">
            <span className="skm-gallery-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="skm-gallery-art" aria-hidden="true"><i /><i /><i /><b /></span>
            <span className="skm-gallery-copy"><strong>{animation.label}</strong><small>{t.posterMotion}</small></span>
            <span className="skm-gallery-selected">{t.selected}</span>
          </button>)}
        </div>
        <p className="skm-gallery-hint">{t.galleryHint}</p>
        <div className="skm-gallery-footer"><span>9 : 16</span><span>540 × 960 preview</span></div>
      </aside>

      <section className="skm-preview-column" aria-label={t.preview}>
        <div className="skm-preview-header"><div><span className="skm-kicker">02 / PREVIEW</span><h1>{t.title}</h1><p>{t.description}</p></div><span className={`skm-preview-state${playing ? " skm-preview-state-playing" : ""}`}><i />{playing ? t.previewPlaying : t.previewPaused}</span></div>
        <div ref={stageRef} className="skm-stage">
          <div className="skm-poster-frame"><canvas ref={canvasRef} className="skm-preview-canvas" width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} role="img" aria-label={`${t.title} ${t.preview}`} /></div>
          {previewError ? <div className="skm-preview-error" role="alert">{previewError}</div> : null}
        </div>
        <p className="skm-preview-hint">{t.previewHint}</p>
        <p className="skm-behavior-note"><span aria-hidden="true">↻</span>{t.gaitNote} {t.cycleNote}</p>
        <div className="skm-transport" aria-label={t.soundtrack}>
          <div className="skm-transport-buttons"><button type="button" className="skm-transport-play" onClick={togglePlayback} disabled={audioState !== "ready" || isExporting} aria-label={playing ? t.pause : t.play}>{playing ? "Ⅱ" : "▶"}</button><button type="button" onClick={stopPlayback} disabled={audioState !== "ready" || isExporting} aria-label={t.stop}>■</button></div>
          <input className="skm-seek" type="range" min={0} max={audioDuration || 1} step="any" value={Math.min(currentTime, audioDuration || 1)} onChange={seek} disabled={audioState !== "ready" || isExporting} aria-label={t.seek} />
          <time className="skm-timecode">{formatTime(currentTime)} <span>/</span> {formatTime(audioDuration)}</time>
        </div>
      </section>

      <aside className="skm-inspector-panel" aria-label={t.controls}>
        <section className="skm-inspector-section skm-audio-section">
          <div className="skm-section-heading"><span className="skm-kicker">03 / AUDIO</span><h2>{t.soundtrack}</h2></div>
          <label className="skm-file-picker"><span>{audioName || (audioState === "idle" ? t.noAudio : audioName)}</span><b>{audioName ? t.replaceAudio : t.chooseAudio}</b><input type="file" accept="audio/*" onChange={selectAudio} disabled={isExporting} aria-label={audioName ? t.replaceAudio : t.chooseAudio} /></label>
          <div className={`skm-audio-status skm-audio-status-${audioState}`} role="status"><i /><span>{audioStatusText}</span></div>
          <label className="skm-toggle-row"><span>{t.loop}</span><input type="checkbox" checked={loopAudio} onChange={(event) => setLoopAudio(event.target.checked)} disabled={isExporting} /></label>
          <audio key={audioUrl ?? "skm-empty-audio"} ref={audioRef} className="skm-audio-element" preload="metadata" loop={loopAudio} onLoadedMetadata={handleLoadedMetadata} onError={handleAudioError} onTimeUpdate={handleTimeUpdate} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} aria-label={t.soundtrack} />
        </section>

        <section className="skm-inspector-section">
          <div className="skm-section-heading"><span className="skm-kicker">04 / TYPE</span><h2>{t.text}</h2></div>
          <label className="skm-field"><span>{t.leftText}</span><textarea rows={7} value={settings.leftText} onChange={(event) => updateSetting("leftText", event.target.value)} disabled={isExporting} /></label>
          <label className="skm-field"><span>{t.rightText}</span><textarea rows={5} value={settings.rightText} onChange={(event) => updateSetting("rightText", event.target.value)} disabled={isExporting} /></label>
          <label className="skm-field"><span>{t.rightCaption}</span><textarea rows={3} value={settings.rightCaption} onChange={(event) => updateSetting("rightCaption", event.target.value)} disabled={isExporting} /></label>
        </section>

        <section className="skm-inspector-section">
          <div className="skm-section-heading"><h2>{t.colors}</h2></div>
          <p className="skm-color-hint">{t.colorsHint}</p>
          <div className="skm-color-grid">
            {(Object.keys(t.colorLabels) as BivioColorKey[]).map((key) => <label key={key} className="skm-color-field">
              <input type="color" value={settings.colors[key]} disabled={isExporting} onChange={(event) => updateSetting("colors", { ...settings.colors, [key]: event.target.value })} aria-label={t.colorLabels[key]} />
              <span>{t.colorLabels[key]}<small>{settings.colors[key].toUpperCase()}</small></span>
            </label>)}
          </div>
          <button type="button" className="skm-color-reset" disabled={isExporting} onClick={() => updateSetting("colors", { ...defaultBivioColors })}>{t.resetColors}</button>
        </section>

        <section className="skm-inspector-section">
          <div className="skm-section-heading"><span className="skm-kicker">05 / WALK</span><h2>{t.motion}</h2></div>
          <label className="skm-range-field"><span>{t.crowd}<output>{settings.crowdCount}</output></span><input type="range" min={12} max={60} step={1} value={settings.crowdCount} onChange={(event) => updateSetting("crowdCount", Number(event.target.value))} disabled={isExporting} /></label>
          <label className="skm-range-field"><span>{t.pace}<output>{settings.pace.toFixed(2)}×</output></span><input type="range" min={0.5} max={1.5} step={0.05} value={settings.pace} onChange={(event) => updateSetting("pace", Number(event.target.value))} disabled={isExporting} /></label>
          <label className="skm-range-field"><span>{t.grain}<output>{Math.round(settings.grain * 100)}%</output></span><input type="range" min={0} max={1} step={0.01} value={settings.grain} onChange={(event) => updateSetting("grain", Number(event.target.value))} disabled={isExporting} /></label>
        </section>

        <section className="skm-inspector-section skm-export-section">
          <div className="skm-section-heading"><span className="skm-kicker">06 / OUTPUT</span><h2>{t.exportSettings}</h2></div>
          <div className="skm-export-grid"><label><span>{t.resolution}</span><select value={exportResolution} onChange={(event) => setExportResolution(event.target.value === "720" ? 720 : 1080)} disabled={isExporting}><option value="720">720 × 1280</option><option value="1080">1080 × 1920</option></select></label><label><span>{t.frameRate}</span><select value={exportFps} onChange={(event) => setExportFps(event.target.value === "24" ? 24 : 30)} disabled={isExporting}><option value="24">24 fps</option><option value="30">30 fps</option></select></label></div>
          <div className={`skm-font-status skm-font-status-${fontState}`} role="status"><i />{fontState === "loading" ? t.fontLoading : fontState === "ready" ? t.fontReady : t.fontError}</div>
          <p className="skm-font-note">{t.fontNote}</p>
          <button type="button" className="skm-export-inspector-button" disabled={!canExport} title={exportDisabledReason} onClick={() => void runExport()}>{t.exportVideo}</button>
          {isExporting ? <div className="skm-export-progress" role="status" aria-live="polite"><div className="skm-export-progress-head"><strong>{progressLabel(exportProgress, t.exportPreparing)}</strong><span>{exportPercentage === null ? "…" : `${exportPercentage}%`}</span></div><div className="skm-progress-track"><b style={{ width: `${exportPercentage ?? 34}%` }} /></div><button type="button" className="skm-cancel-button" onClick={cancelExport}>{t.cancelExport}</button></div> : null}
          {exportState === "success" ? <div className="skm-export-result skm-export-result-success" role="status"><strong>{t.exportReady}</strong><span>{exportResultName}</span></div> : null}
          {exportState === "cancelled" ? <div className="skm-export-result skm-export-result-cancelled" role="status">{t.exportCancelled}</div> : null}
          {exportState === "error" ? <div className="skm-export-result skm-export-result-error" role="alert"><strong>{t.exportFailed}</strong><span>{exportError}</span></div> : null}
        </section>
      </aside>
    </main>
  </div>;
}
