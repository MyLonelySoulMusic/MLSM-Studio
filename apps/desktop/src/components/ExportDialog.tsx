import { useEffect, useState } from "react";
import { estimateExportResources } from "@rbs/export-engine";
import { recordingBitrate, type ExportQuality } from "../services/offline-video-exporter";
import type { ProSubtitleExportFormatId } from "../services/pro-subtitle-exporter";
import { videoEditorInterpolationCommand, videoEditorInterpolationHealth, videoEditorInterpolationMethodLabel, type VideoEditorInterpolationHealth, type VideoEditorInterpolationMethod } from "../services/video-editor-interpolation-client";

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

export interface ExportDialogStartSettings {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  quality: ExportQuality;
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
  error: string | null;
  aspectRatio?: "9:16" | "16:9";
  proSubtitles?: ProSubtitleDialogSettings;
  videoEditor?: VideoEditorDialogSettings | undefined;
  sourceVideoExport?: { label: string } | undefined;
  offlineExportProfile?: { title: string; defaultResolution: string; defaultFps: number; recommendation: string } | undefined;
  onClose: () => void;
  onCancel: () => void;
  onStart: (settings: ExportDialogStartSettings) => void;
}

export function ExportDialog({ duration, running, progress, currentFrame, totalFrames, error, aspectRatio = "9:16", proSubtitles, videoEditor, sourceVideoExport, offlineExportProfile, onClose, onCancel, onStart }: ExportDialogProps) {
  const videoEditorResolutions = videoEditor ? videoEditorResolutionOptions(videoEditor.compositionWidth, videoEditor.compositionHeight) : [];
  const [resolution, setResolution] = useState(videoEditor ? `${evenDimension(videoEditor.compositionWidth)}x${evenDimension(videoEditor.compositionHeight)}` : offlineExportProfile?.defaultResolution ?? (aspectRatio === "16:9" ? "1920x1080" : "1080x1920"));
  const [fps, setFps] = useState(offlineExportProfile?.defaultFps ?? 30);
  const [interpolationEnabled, setInterpolationEnabled] = useState(false);
  const [interpolationTargetFps, setInterpolationTargetFps] = useState(60);
  const [interpolationMethod, setInterpolationMethod] = useState<VideoEditorInterpolationMethod>("motion");
  const [interpolationHealth, setInterpolationHealth] = useState<VideoEditorInterpolationHealth | null | "checking">(videoEditor ? "checking" : null);
  const [quality, setQuality] = useState<ExportQuality>("maximum");
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
  const preservesSourceVideo = completeVideo || Boolean(sourceVideoExport);
  const proResUnavailable = Boolean(proSubtitles && !completeVideo && backgroundMode === "transparent" && alphaFormat === "movProRes4444");
  const outputFormat: ProSubtitleExportFormatId = backgroundMode === "solid" ? "mp4H264Solid" : alphaFormat;
  const availableInterpolationTargets = interpolationTargets.filter((value) => value > fps);
  const resolvedInterpolationTargetFps = availableInterpolationTargets.includes(interpolationTargetFps as typeof interpolationTargets[number]) ? interpolationTargetFps : availableInterpolationTargets[0] ?? fps;
  const serviceReady = interpolationHealth !== null && interpolationHealth !== "checking";
  const methodUnavailable = interpolationEnabled && serviceReady && (interpolationMethod === "rife" ? !interpolationHealth.rife : !interpolationHealth.ffmpeg);

  // Lo stato del servizio locale va letto all’apertura: l’utente deve sapere prima di
  // avviare se l’aumento reale dei frame è disponibile o se otterrà solo il file reso.
  useEffect(() => {
    if (!videoEditor) return;
    let active = true;
    setInterpolationHealth("checking");
    void videoEditorInterpolationHealth().then((health) => { if (active) setInterpolationHealth(health); });
    return () => { active = false; };
  }, [videoEditor]);

  const start = () => onStart({
    width,
    height,
    fps,
    durationSeconds: duration,
    quality,
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
    <header><h2 id="export-title">{offlineExportProfile?.title ?? (sourceVideoExport ? `Esporta ${sourceVideoExport.label}` : proSubtitles ? "Esporta Pro Subtitles" : videoEditor ? "Esporta montaggio" : "Video finale")}</h2><button aria-label="Chiudi" onClick={onClose} disabled={running}>×</button></header>
    {proSubtitles ? <>
      <label>Contenuto export<select aria-label="Contenuto export ProSubtitles" value={proSubtitleOutputMode} onChange={(event) => setProSubtitleOutputMode(event.target.value as typeof proSubtitleOutputMode)} disabled={running}><option value="subtitleLayer">Solo sottotitoli · layer per il montaggio</option><option value="completeVideo" disabled={!proSubtitles.hasSourceVideo}>Video originale + sottotitoli incorporati</option></select></label>
      {completeVideo
        ? <label>Formato<select aria-label="Formato video completo ProSubtitles" disabled><option>MP4 · H.264 + audio originale</option></select></label>
        : <>
          <label>Tipo di livello<select aria-label="Tipo di livello ProSubtitles" value={backgroundMode} onChange={(event) => setBackgroundMode(event.target.value as typeof backgroundMode)} disabled={running}><option value="transparent">Trasparente · overlay per CapCut</option><option value="solid">Sfondo di un colore · fallback universale</option></select></label>
          {backgroundMode === "transparent" ? <label>Formato<select aria-label="Formato ProSubtitles" value={alphaFormat} onChange={(event) => setAlphaFormat(event.target.value as typeof alphaFormat)} disabled={running}><option value="webmVp9Alpha">WebM · VP9 con canale alpha</option><option value="movProRes4444">MOV · Apple ProRes 4444 con alpha</option></select></label> : <><label>Formato<select disabled><option>MP4 · H.264 su sfondo pieno</option></select></label><label>Colore sfondo<input aria-label="Colore sfondo export ProSubtitles" type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} disabled={running} /></label><label className="export-fallback-toggle"><input type="checkbox" checked={allowOpaqueWebmFallback} onChange={(event) => setAllowOpaqueWebmFallback(event.target.checked)} disabled={running} /> Consenti WebM VP9 opaco solo se H.264 non è disponibile</label></>}
        </>}
      {proResUnavailable ? <p className="export-warning">ProRes 4444 richiede la build desktop con FFmpeg. La versione web non produrrà un MOV finto o privo di alpha: scegli WebM VP9 con alpha.</p> : null}
    </> : <label>Formato<select disabled><option>{sourceVideoExport ? "MP4 · H.264 + audio originale · proprietà sorgente" : "MP4 · H.264/AAC offline verificato"}</option></select></label>}
    {!preservesSourceVideo ? <>
      <label>Risoluzione<select aria-label="Risoluzione" value={resolution} onChange={(event) => setResolution(event.target.value)} disabled={running}>{videoEditor ? videoEditorResolutions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : offlineExportProfile ? <><option value="1920x1080">1920 × 1080 (16:9 · Full HD)</option><option value="2560x1440">2560 × 1440 (16:9 · QHD / 2K)</option><option value="3840x2160">3840 × 2160 (16:9 · 4K consigliato)</option><option value="5120x2880">5120 × 2880 (16:9 · 5K)</option><option value="7680x4320">7680 × 4320 (16:9 · 8K)</option></> : <><option value="540x960">540 × 960 (9:16)</option><option value="1080x1920">1080 × 1920 (9:16)</option><option value="1920x1080">1920 × 1080 (16:9)</option><option value="2160x3840">2160 × 3840 (9:16 · 4K verticale)</option><option value="3840x2160">3840 × 2160 (16:9 · 4K orizzontale)</option></>}</select></label>
      <label>Frame rate<select aria-label="Frame rate" value={fps} onChange={(event) => setFps(Number(event.target.value))} disabled={running}>{[24, 25, 30, 50, 60, 120].map((value) => <option key={value}>{value}</option>)}</select></label>
    </> : null}
    {videoEditor ? <fieldset className="export-interpolation">
      <legend>Frame rate avanzato · interpolazione reale</legend>
      <label className="export-fallback-toggle"><input aria-label="Attiva interpolazione dei fotogrammi" type="checkbox" checked={interpolationEnabled} onChange={(event) => setInterpolationEnabled(event.target.checked)} disabled={running || availableInterpolationTargets.length === 0} /> Aumenta realmente i fotogrammi dopo la codifica</label>
      {availableInterpolationTargets.length === 0
        ? <p className="muted">Nessun frame rate superiore a {fps} fps disponibile: abbassa il frame rate di render per attivare l’interpolazione.</p>
        : interpolationEnabled ? <>
          <label>Frame rate finale<select aria-label="Frame rate interpolato" value={resolvedInterpolationTargetFps} onChange={(event) => setInterpolationTargetFps(Number(event.target.value))} disabled={running}>{availableInterpolationTargets.map((value) => <option key={value} value={value}>{value} fps · da {fps} fps resi</option>)}</select></label>
          <label>Metodo<select aria-label="Metodo di interpolazione" value={interpolationMethod} onChange={(event) => setInterpolationMethod(event.target.value as VideoEditorInterpolationMethod)} disabled={running}>{(["motion", "blend", "rife"] as const).map((value) => <option key={value} value={value}>{videoEditorInterpolationMethodLabel(value)}</option>)}</select></label>
          {interpolationHealth === "checking" ? <p className="muted">Verifica del servizio locale in corso…</p> : null}
          {interpolationHealth === null ? <p className="export-warning">Servizio locale non raggiungibile. Avvialo con <code>{videoEditorInterpolationCommand}</code> e installa ffmpeg (<code>brew install ffmpeg</code>). Senza servizio il montaggio viene comunque consegnato a {fps} fps.</p> : null}
          {methodUnavailable ? <p className="export-warning">{interpolationMethod === "rife" ? "I pesi RIFE non sono presenti nel servizio locale: scegli la stima del movimento ffmpeg." : "ffmpeg non è disponibile nel servizio locale: installalo con brew install ffmpeg e riavvialo."}</p> : null}
          {serviceReady && !methodUnavailable ? <p className="muted">Servizio pronto · {interpolationHealth.device}. I fotogrammi intermedi vengono calcolati dopo la verifica del file a {fps} fps: se l’interpolazione non riesce, il montaggio originale resta consegnato.</p> : null}
        </> : <p className="muted">Senza interpolazione il file conserva esattamente i {fps} fps resi dal montaggio.</p>}
    </fieldset> : null}
    <label>Qualità codifica<select aria-label="Qualità codifica" value={quality} onChange={(event) => setQuality(event.target.value as ExportQuality)} disabled={running}><option value="maximum">Massima · bitrate elevato</option><option value="high">Alta · file più leggero</option></select></label>
    {offlineExportProfile ? <p className="export-recommendation"><strong>Scelta consigliata</strong><span>{offlineExportProfile.recommendation}</span></p> : null}
    <p className="muted">{sourceVideoExport ? "Mantiene risoluzione, rapporto, ordine, timestamp e durata di ogni frame del video caricato. La correzione viene composta offline; i pacchetti audio originali vengono copiati senza ricodifica e senza essere riprodotti durante l’export." : proSubtitles ? completeVideo ? "Usa direttamente risoluzione, rapporto, ordine, timestamp e durata di ogni frame del video caricato. I sottotitoli vengono composti offline; l’audio originale viene copiato senza essere riprodotto durante l’export." : "Esporta soltanto la tipografia, senza il video guida e senza audio duplicato. Ogni frame viene calcolato offline con gli stessi tempi della preview, senza drop volontari." : videoEditor ? "Ogni clip viene decodificata in sequenza e composta offline con fusione, correzione colore e dissolvenze della timeline. L’audio è un mixdown con i volumi e le dissolvenze del montaggio; il file viene riaperto e verificato prima della consegna." : "Calcola ogni frame offline alla risoluzione scelta. L’encoder attende il frame prima di proseguire, conserva il frame rate richiesto fino a 120 fps e unisce l’audio senza riprodurlo: carico e fluidità della preview non possono causare frame persi."}</p>
    {preservesSourceVideo ? <div className="estimate-grid"><span>{totalFrames ? `${totalFrames.toLocaleString("it-IT")} frame sorgente` : "Conteggio frame sorgente in preflight"}</span><span>Durata originale ≈ {Math.ceil(duration)} s</span><span>Nessuna conversione FPS</span></div> : <div className="estimate-grid"><span>{estimate.frames.toLocaleString("it-IT")} frame</span><span>Tempo ≈ {Math.ceil(duration)} s</span><span>Video stimato ≈ {megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes.toFixed(0)} MB`}</span></div>}
    {fps >= 120 || width >= 2160 ? <p className="export-warning">{proSubtitles ? "Il preset scelto richiede molta memoria GPU e tempi di codifica maggiori." : "Il preset scelto richiede più tempo. L’encoder offline attende ciascun frame e non riduce volontariamente risoluzione o frame rate."}</p> : null}
    <progress max="1" value={progress} /><div className="property"><span>Frame</span><output>{currentFrame} / {preservesSourceVideo ? totalFrames || "…" : totalFrames || estimate.frames}</output></div>{error ? <p className="status-error">{error}</p> : null}
    <footer>{running ? <button onClick={onCancel}>Annulla</button> : <><button onClick={onClose}>Chiudi</button><button className="export" onClick={start} disabled={duration <= 0 || proResUnavailable}>Scegli destinazione e crea video</button></>}</footer>
  </section></div>;
}
