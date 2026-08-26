import { useEffect, useMemo, useRef, useState } from "react";
import { estimateExportResources, type ExportProgressPhase } from "@rbs/export-engine";
import { recordingBitrate, type ExportQuality } from "../services/offline-video-exporter";
import type { ProSubtitleExportFormatId } from "../services/pro-subtitle-exporter";
import { backgroundAutoOutputDimensions, backgroundAutoRatioLabel, backgroundAutoResolutionOptions } from "../services/background-auto-renderer";
import type { VideoEditorInterpolationMethod } from "../services/video-editor-interpolation-client";
import { useUiPreferences } from "../services/ui-preferences";
import { VideoEditorFrameInterpolationSection } from "./VideoEditorFrameInterpolationSection";

export interface ProSubtitleDialogSettings {
  backgroundMode: "transparent" | "solid";
  backgroundColor: string;
  exportFormat: "webmVp9Alpha" | "movProRes4444";
  hasSourceVideo: boolean;
}

/** Il montaggio esporta alla proporzione della propria composizione, non a un rapporto imposto dallo studio. */
export interface VideoEditorDialogSettings {
  compositionWidth: number;
  compositionHeight: number;
}

export interface BackgroundAutoDialogSettings {
  sourceWidth: number;
  sourceHeight: number;
}

export interface ExportDialogStartSettings {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  quality: ExportQuality;
  cassetteDesk?: { audioMode:"songAndEffects"|"effectsOnly" };
  proSubtitles?: {
    outputMode: "subtitleLayer" | "completeVideo";
    backgroundMode: "transparent" | "solid";
    backgroundColor: string;
    format: ProSubtitleExportFormatId;
    allowOpaqueWebmFallback: boolean;
  };
  videoEditor?: {
    interpolationEnabled: boolean;
    interpolationTargetFps: number;
    interpolationMethod: VideoEditorInterpolationMethod;
  };
}

/** Scale di consegna del montaggio: proxy di controllo, master e ingrandimento, sempre nella proporzione della composizione. */
const videoEditorScales = [.5, .75, 1, 1.5, 2] as const;
/** Frame rate raggiungibili con l’interpolazione: solo valori superiori a quello reso vengono proposti. */
const interpolationTargets = [48, 50, 60, 90, 100, 120, 144, 240] as const;
const portraitResolutions = [
  { value: "540x960", label: "540 × 960 (9:16 · preview)" },
  { value: "1080x1920", label: "1080 × 1920 (9:16 · Full HD)" },
  { value: "2160x3840", label: "2160 × 3840 (9:16 · 4K verticale)" }
] as const;
const landscapeResolutions = [
  { value: "1920x1080", label: "1920 × 1080 (16:9 · Full HD)" },
  { value: "3840x2160", label: "3840 × 2160 (16:9 · 4K orizzontale)" }
] as const;
const squareResolutions = [{ value: "720x720", label: "720 × 720 (1:1 · preview)" }, { value: "1080x1080", label: "1080 × 1080 (1:1 · Full HD)" }, { value: "2160x2160", label: "2160 × 2160 (1:1 · 4K)" }] as const;
const fourFiveResolutions = [{ value: "648x810", label: "648 × 810 (4:5 · preview)" }, { value: "1080x1350", label: "1080 × 1350 (4:5 · Full HD)" }, { value: "2160x2700", label: "2160 × 2700 (4:5 · 4K)" }] as const;
type ProjectAspectRatio = "9:16" | "16:9" | "1:1" | "4:5" | "custom";

function projectResolutionOptions(aspectRatio: ProjectAspectRatio, customDimensions?: { width: number; height: number }) {
  if (aspectRatio === "9:16") return [...portraitResolutions]; if (aspectRatio === "16:9") return [...landscapeResolutions]; if (aspectRatio === "1:1") return [...squareResolutions]; if (aspectRatio === "4:5") return [...fourFiveResolutions];
  const width = evenDimension(customDimensions?.width ?? 1080); const height = evenDimension(customDimensions?.height ?? 1920); return [{ value: `${width}x${height}`, label: `${width} × ${height} (custom)` }];
}

function defaultProjectResolution(aspectRatio: ProjectAspectRatio, customDimensions?: { width: number; height: number }): string {
  if (aspectRatio === "9:16") return "1080x1920"; if (aspectRatio === "16:9") return "1920x1080"; if (aspectRatio === "1:1") return "1080x1080"; if (aspectRatio === "4:5") return "1080x1350";
  return `${evenDimension(customDimensions?.width ?? 1080)}x${evenDimension(customDimensions?.height ?? 1920)}`;
}

function evenDimension(value: number): number {
  return Math.max(64, Math.min(7680, Math.round(value / 2) * 2));
}

function videoEditorResolutionOptions(width: number, height: number): { value: string; label: string }[] {
  const options = new Map<string, string>();
  for (const scale of videoEditorScales) {
    const scaledWidth = evenDimension(width * scale);
    const scaledHeight = evenDimension(height * scale);
    options.set(`${scaledWidth}x${scaledHeight}`, `${scaledWidth} × ${scaledHeight} · ${Math.round(scale * 100)}% della composizione${scale === 1 ? " · nativa" : ""}`);
  }
  return [...options].map(([value, label]) => ({ value, label }));
}

interface ExportDialogProps {
  duration: number;
  running: boolean;
  progress: number;
  currentFrame: number;
  totalFrames: number;
  phase?: ExportProgressPhase;
  phaseLabel?: string | null;
  stageProgress?: number | null;
  stageCurrentFrame?: number;
  stageTotalFrames?: number;
  processedBytes?: number;
  totalBytes?: number;
  indeterminate?: boolean;
  elapsedMs?: number;
  estimatedRemainingMs?: number;
  error: string | null;
  aspectRatio?: ProjectAspectRatio;
  customDimensions?: { width: number; height: number };
  proSubtitles?: ProSubtitleDialogSettings;
  videoEditor?: VideoEditorDialogSettings | undefined;
  backgroundAuto?: BackgroundAutoDialogSettings | undefined;
  sourceVideoExport?: { label: string } | undefined;
  offlineExportProfile?: { title: string; defaultResolution: string; defaultFps: number; recommendation: string } | undefined;
  cassetteDesk?: boolean;
  onClose: () => void;
  onCancel: () => void;
  onStart: (settings: ExportDialogStartSettings) => void;
}

export function ExportDialog({ duration, running, progress, currentFrame, totalFrames, phase = "rendering", stageProgress = progress, stageCurrentFrame = currentFrame, stageTotalFrames = totalFrames, processedBytes = 0, totalBytes = 0, indeterminate = false, estimatedRemainingMs = 0, error, aspectRatio = "9:16", customDimensions, proSubtitles, videoEditor, backgroundAuto, sourceVideoExport, offlineExportProfile,cassetteDesk=false, onClose, onCancel, onStart }: ExportDialogProps) {
  const videoEditorResolutions = videoEditor ? videoEditorResolutionOptions(videoEditor.compositionWidth, videoEditor.compositionHeight) : [];
  const backgroundAutoSourceWidth = backgroundAuto?.sourceWidth ?? 0; const backgroundAutoSourceHeight = backgroundAuto?.sourceHeight ?? 0;
  const backgroundAutoResolutions = useMemo(() => backgroundAuto ? backgroundAutoResolutionOptions(backgroundAutoSourceWidth, backgroundAutoSourceHeight) : [], [backgroundAuto, backgroundAutoSourceHeight, backgroundAutoSourceWidth]);
  const backgroundAutoDefaultResolution = useMemo(() => {
    let native = "";
    try {
      const dimensions = backgroundAutoOutputDimensions(backgroundAutoSourceWidth, backgroundAutoSourceHeight, backgroundAutoSourceWidth, backgroundAutoSourceHeight);
      native = `${dimensions.width}x${dimensions.height}`;
    } catch { /* Invalid/incompatible source dimensions fall back to an available preset. */ }
    return backgroundAutoResolutions.find((option) => option.value === native)?.value ?? backgroundAutoResolutions.at(-1)?.value ?? defaultProjectResolution(aspectRatio, customDimensions);
  }, [aspectRatio, backgroundAutoResolutions, backgroundAutoSourceHeight, backgroundAutoSourceWidth, customDimensions]);
  const [resolution, setResolution] = useState(videoEditor ? `${evenDimension(videoEditor.compositionWidth)}x${evenDimension(videoEditor.compositionHeight)}` : backgroundAuto ? backgroundAutoDefaultResolution : offlineExportProfile?.defaultResolution ?? defaultProjectResolution(aspectRatio, customDimensions));
  const [fps, setFps] = useState(offlineExportProfile?.defaultFps ?? 30);
  const [interpolationEnabled, setInterpolationEnabled] = useState(false);
  const [interpolationTargetFps, setInterpolationTargetFps] = useState(60);
  const [interpolationMethod, setInterpolationMethod] = useState<VideoEditorInterpolationMethod>("motion");
  const [quality, setQuality] = useState<ExportQuality>("maximum");
  const [cassetteAudioMode,setCassetteAudioMode]=useState<"songAndEffects"|"effectsOnly">("songAndEffects");
  const [proSubtitleOutputMode, setProSubtitleOutputMode] = useState<
    "subtitleLayer" | "completeVideo"
  >("subtitleLayer");
  const [backgroundMode, setBackgroundMode] = useState(proSubtitles?.backgroundMode ?? "transparent");
  const [backgroundColor, setBackgroundColor] = useState(proSubtitles?.backgroundColor ?? "#00ff00");
  const [alphaFormat, setAlphaFormat] = useState(proSubtitles?.exportFormat ?? "webmVp9Alpha");
  const [allowOpaqueWebmFallback, setAllowOpaqueWebmFallback] = useState(false);
  const [width = 1080, height = 1920] = resolution.split("x").map(Number);
  const estimate = estimateExportResources(width, height, duration, { numerator: fps, denominator: 1 });
  const estimatedBytes = recordingBitrate(width, height, fps, quality) / 8 * duration;
  const megabytes = estimatedBytes / 1024 ** 2;
  const completeVideo = Boolean(proSubtitles && proSubtitleOutputMode === "completeVideo");
  const preservesSourceResolution = completeVideo || Boolean(sourceVideoExport);
  const preservesSourceFrameRate = Boolean(sourceVideoExport);
  const proResUnavailable = Boolean(proSubtitles && !completeVideo && backgroundMode === "transparent" && alphaFormat === "movProRes4444");
  const outputFormat: ProSubtitleExportFormatId = backgroundMode === "solid" ? "mp4H264Solid" : alphaFormat;
  const availableInterpolationTargets = interpolationTargets.filter((value) => value > fps);
  const resolvedInterpolationTargetFps = availableInterpolationTargets.includes(interpolationTargetFps as typeof interpolationTargets[number]) ? interpolationTargetFps : availableInterpolationTargets[0] ?? fps;
  const previousBackgroundSource = useRef<string | null>(null);
  const { language } = useUiPreferences();
  const progressCopy = language === "en" ? {
    rendering: "Rendering edit", extracting: "Extracting frames", upscaling: "Upscaling frames", encoding: "Encoding video", queued: "Queued", ready: "Ready", verifying: "Verifying base render", upload: "Uploading for interpolation", interpolation: "Interpolating frames", download: "Downloading interpolated video", complete: "Export complete", preparing: "Preparing export", cancelled: "Export cancelled", error: "Export error", frame: "Frame", bytes: "Bytes", eta: "ETA"
  } : {
    rendering: "Rendering del montaggio", extracting: "Estrazione frame", upscaling: "Upscaling frame", encoding: "Codifica video", queued: "In coda", ready: "Pronto", verifying: "Verifica del render base", upload: "Caricamento per interpolazione", interpolation: "Interpolazione fotogrammi", download: "Download del video interpolato", complete: "Export completato", preparing: "Preparazione export", cancelled: "Export annullato", error: "Errore export", frame: "Frame", bytes: "Byte", eta: "Tempo stimato"
  };
  // `phaseLabel` is intentionally diagnostic-only.  The server currently emits
  // Italian labels, so primary UI copy must always come from the stable enum.
  const phaseText = phase === "interpolation-upload" ? progressCopy.upload : phase === "interpolation-download" ? progressCopy.download : progressCopy[phase === "interpolation" ? "interpolation" : phase];
  const displayProgress = stageProgress ?? progress;
  const formatBytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
  const formatEta = (value: number) => value > 0 ? `${Math.ceil(value / 1000)} s` : "—";

  // Se il rapporto del progetto cambia mentre la finestra è aperta, non deve
  // sopravvivere una risoluzione appartenente al rapporto precedente.
  useEffect(() => {
    if (videoEditor || offlineExportProfile || sourceVideoExport || backgroundAuto) return;
    const allowed = projectResolutionOptions(aspectRatio, customDimensions).some((option) => option.value === resolution);
    if (!allowed) setResolution(defaultProjectResolution(aspectRatio, customDimensions));
  }, [aspectRatio, backgroundAuto, customDimensions, offlineExportProfile, resolution, sourceVideoExport, videoEditor]);

  useEffect(() => {
    if (!backgroundAuto) return;
    const sourceKey = `${backgroundAuto.sourceWidth}x${backgroundAuto.sourceHeight}`;
    const sourceChanged = previousBackgroundSource.current !== null && previousBackgroundSource.current !== sourceKey;
    previousBackgroundSource.current = sourceKey;
    const allowed = backgroundAutoResolutions.some((option) => option.value === resolution);
    if (sourceChanged || !allowed) setResolution(backgroundAutoDefaultResolution);
  }, [backgroundAuto, backgroundAutoDefaultResolution, backgroundAutoResolutions, resolution]);

  const start = () => onStart({
    width,
    height,
    fps,
    durationSeconds: duration,
    quality,
    ...(cassetteDesk?{cassetteDesk:{audioMode:cassetteAudioMode}}:{}),
    ...(proSubtitles ? {
      proSubtitles: {
        outputMode: proSubtitleOutputMode,
        backgroundMode,
        backgroundColor,
        format: completeVideo ? "mp4H264Solid" : outputFormat,
        allowOpaqueWebmFallback
      }
    } : {}),
    ...(videoEditor ? {
      videoEditor: {
        interpolationEnabled: interpolationEnabled && availableInterpolationTargets.length > 0,
        interpolationTargetFps: resolvedInterpolationTargetFps,
        interpolationMethod
      }
    } : {})
  });

  return <div className="dialog-backdrop" role="presentation"><section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <header><h2 id="export-title">{offlineExportProfile?.title ?? (sourceVideoExport ? `Esporta ${sourceVideoExport.label}` : backgroundAuto ? "Export Circular Spectrum Auto Detector" : proSubtitles ? "Esporta Pro Subtitles" : videoEditor ? "Esporta montaggio" : "Video finale")}</h2><button aria-label={backgroundAuto ? "Close" : "Chiudi"} onClick={onClose} disabled={running}>×</button></header>
    {proSubtitles ? <>
      <label>Contenuto export<select aria-label="Contenuto export ProSubtitles" value={proSubtitleOutputMode} onChange={(event) => setProSubtitleOutputMode(event.target.value as typeof proSubtitleOutputMode)} disabled={running}><option value="subtitleLayer">Solo sottotitoli · layer per il montaggio</option><option value="completeVideo" disabled={!proSubtitles.hasSourceVideo}>Video originale + sottotitoli incorporati</option></select></label>
      {completeVideo
        ? <label>Formato<select aria-label="Formato video completo ProSubtitles" disabled><option>MP4 · H.264 + audio originale</option></select></label>
        : <>
          <label>Tipo di livello<select aria-label="Tipo di livello ProSubtitles" value={backgroundMode} onChange={(event) => setBackgroundMode(event.target.value as typeof backgroundMode)} disabled={running}><option value="transparent">Trasparente · overlay per CapCut</option><option value="solid">Sfondo di un colore · fallback universale</option></select></label>
          {backgroundMode === "transparent" ? <label>Formato<select aria-label="Formato ProSubtitles" value={alphaFormat} onChange={(event) => setAlphaFormat(event.target.value as typeof alphaFormat)} disabled={running}><option value="webmVp9Alpha">WebM · VP9 con canale alpha</option><option value="movProRes4444">MOV · Apple ProRes 4444 con alpha</option></select></label> : <><label>Formato<select disabled><option>MP4 · H.264 su sfondo pieno</option></select></label><label>Colore sfondo<input aria-label="Colore sfondo export ProSubtitles" type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} disabled={running} /></label><label className="export-fallback-toggle"><input type="checkbox" checked={allowOpaqueWebmFallback} onChange={(event) => setAllowOpaqueWebmFallback(event.target.checked)} disabled={running} /> Consenti WebM VP9 opaco solo se H.264 non è disponibile</label></>}
        </>}
      {proResUnavailable ? <p className="export-warning">ProRes 4444 richiede la build desktop con FFmpeg. La versione web non produrrà un MOV finto o privo di alpha: scegli WebM VP9 con alpha.</p> : null}
    </> : <label>{backgroundAuto ? "Format" : "Formato"}<select disabled><option>{sourceVideoExport ? "MP4 · H.264 + audio originale · proprietà sorgente" : backgroundAuto ? `MP4 · verified offline H.264/AAC · ${backgroundAutoRatioLabel(backgroundAuto.sourceWidth, backgroundAuto.sourceHeight)} source` : "MP4 · H.264/AAC offline verificato"}</option></select></label>}
    {cassetteDesk?<label>Audio Cassette Desk<select aria-label="Audio export Cassette Desk" value={cassetteAudioMode} onChange={event=>setCassetteAudioMode(event.target.value as typeof cassetteAudioMode)} disabled={running}><option value="songAndEffects">Brano caricato + effetti meccanici</option><option value="effectsOnly">Solo effetti meccanici · per suono ufficiale TikTok</option></select><small>{cassetteAudioMode==="effectsOnly"?"Il brano non viene incorporato. Inserimento, sportello e pressione PLAY restano nel video.":"Il brano parte dopo l’intro; tutti gli effetti meccanici vengono mantenuti."}</small></label>:null}
    {!preservesSourceResolution ? <label>{backgroundAuto ? "Resolution · format" : "Risoluzione · formato"} {videoEditor ? "composizione" : backgroundAuto ? `${backgroundAutoRatioLabel(backgroundAuto.sourceWidth, backgroundAuto.sourceHeight)} source` : offlineExportProfile ? "16:9" : aspectRatio}<select aria-label={backgroundAuto ? "Resolution" : "Risoluzione"} value={resolution} onChange={(event) => setResolution(event.target.value)} disabled={running}>{videoEditor ? videoEditorResolutions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : backgroundAuto ? backgroundAutoResolutions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : offlineExportProfile ? <><option value="1920x1080">1920 × 1080 (16:9 · Full HD)</option><option value="2560x1440">2560 × 1440 (16:9 · QHD / 2K)</option><option value="3840x2160">3840 × 2160 (16:9 · 4K consigliato)</option><option value="5120x2880">5120 × 2880 (16:9 · 5K)</option><option value="7680x4320">7680 × 4320 (16:9 · 8K)</option></> : projectResolutionOptions(aspectRatio, customDimensions).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> : null}
    {!preservesSourceFrameRate ? <label>Frame rate<select aria-label="Frame rate" value={fps} onChange={(event) => setFps(Number(event.target.value))} disabled={running}>{[24, 25, 30, 50, 60, 120].map((value) => <option key={value}>{value}</option>)}</select></label> : null}
    {videoEditor ? <VideoEditorFrameInterpolationSection language={language} baseFps={fps} disabled={running} value={{ enabled: interpolationEnabled, targetFps: interpolationTargetFps, method: interpolationMethod }} onChange={(next) => { setInterpolationEnabled(next.enabled); setInterpolationTargetFps(next.targetFps); setInterpolationMethod(next.method); }} /> : null}
    <label>{backgroundAuto ? "Encoding quality" : "Qualità codifica"}<select aria-label={backgroundAuto ? "Encoding quality" : "Qualità codifica"} value={quality} onChange={(event) => setQuality(event.target.value as ExportQuality)} disabled={running}><option value="maximum">{backgroundAuto ? "Maximum · high bitrate" : "Massima · bitrate elevato"}</option><option value="high">{backgroundAuto ? "High · smaller file" : "Alta · file più leggero"}</option></select></label>
    {offlineExportProfile ? <p className="export-recommendation"><strong>Scelta consigliata</strong><span>{offlineExportProfile.recommendation}</span></p> : null}
    <p className="muted">{backgroundAuto ? "Each frame is rendered offline at the selected source ratio. Detected and manual circles, stereo layers and regional Pro Subtitles use the same deterministic renderer as preview." : sourceVideoExport ? "Mantiene risoluzione, rapporto, ordine, timestamp e durata di ogni frame del video caricato. La correzione viene composta offline; i pacchetti audio originali vengono copiati senza ricodifica e senza essere riprodotti durante l’export." : proSubtitles ? completeVideo ? "Mantiene risoluzione e rapporto del video originale, ma ricampiona i fotogrammi al frame rate scelto. I sottotitoli vengono composti offline e l’audio originale viene copiato senza essere riprodotto durante l’export." : "Esporta soltanto la tipografia, senza il video guida e senza audio duplicato. Ogni frame viene calcolato offline con gli stessi tempi della preview, senza drop volontari." : videoEditor ? "Ogni clip viene decodificata in sequenza e composta offline con fusione, correzione colore e dissolvenze della timeline. L’audio è un mixdown con i volumi e le dissolvenze del montaggio; il file viene riaperto e verificato prima della consegna." : "Calcola ogni frame offline alla risoluzione scelta. L’encoder attende il frame prima di proseguire, conserva il frame rate richiesto fino a 120 fps e unisce l’audio senza riprodurlo: carico e fluidità della preview non possono causare frame persi."}</p>
    {completeVideo ? <div className="estimate-grid"><span>{estimate.frames.toLocaleString("it-IT")} frame output</span><span>{fps} fps selezionati</span><span>Risoluzione originale</span></div> : preservesSourceFrameRate ? <div className="estimate-grid"><span>{totalFrames ? `${totalFrames.toLocaleString("it-IT")} frame sorgente` : "Conteggio frame sorgente in preflight"}</span><span>Durata originale ≈ {Math.ceil(duration)} s</span><span>Nessuna conversione FPS</span></div> : <div className="estimate-grid"><span>{estimate.frames.toLocaleString(backgroundAuto ? "en-US" : "it-IT")} frames</span><span>{backgroundAuto ? "Duration" : "Tempo"} ≈ {Math.ceil(duration)} s</span><span>{backgroundAuto ? "Estimated video" : "Video stimato"} ≈ {megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes.toFixed(0)} MB`}</span></div>}
    {fps >= 120 || width >= 2160 ? <p className="export-warning">{backgroundAuto ? "The selected preset takes longer to encode. The offline encoder waits for every frame and never reduces resolution or frame rate." : proSubtitles ? "Il preset scelto richiede molta memoria GPU e tempi di codifica maggiori." : "Il preset scelto richiede più tempo. L’encoder offline attende ciascun frame e non riduce volontariamente risoluzione o frame rate."}</p> : null}
    <section className="export-progress-stage" aria-live="polite" aria-label={phaseText}>
      <div className="export-progress-stage__header"><strong>{phaseText}</strong>{indeterminate ? <span>{language === "en" ? "Working…" : "Elaborazione…"}</span> : <span>{Math.round(Math.max(0, Math.min(1, displayProgress)) * 100)}%</span>}</div>
      <progress max="1" {...(indeterminate ? {} : { value: Math.max(0, Math.min(1, displayProgress)) })} aria-label={phaseText} />
      <div className="property"><span>{progressCopy.frame}</span><output>{stageCurrentFrame ?? currentFrame} / {stageTotalFrames ?? (preservesSourceFrameRate ? totalFrames || "…" : totalFrames || estimate.frames)}</output></div>
      {totalBytes > 0 || processedBytes > 0 ? <div className="property"><span>{progressCopy.bytes}</span><output>{formatBytes(processedBytes)}{totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ""}</output></div> : null}
      {running && estimatedRemainingMs > 0 ? <div className="property"><span>{progressCopy.eta}</span><output>{formatEta(estimatedRemainingMs)}</output></div> : null}
    </section>
    {error ? <p className="status-error">{error}</p> : null}
    <footer>{running ? <button onClick={onCancel}>{backgroundAuto ? "Cancel" : "Annulla"}</button> : <><button onClick={onClose}>{backgroundAuto ? "Close" : "Chiudi"}</button><button className="export" onClick={start} disabled={duration <= 0 || proResUnavailable}>{backgroundAuto ? "Choose destination and export" : "Scegli destinazione e crea video"}</button></>}</footer>
  </section></div>;
}
