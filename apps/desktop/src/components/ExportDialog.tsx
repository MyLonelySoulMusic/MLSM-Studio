import { useState } from "react";
import { estimateExportResources } from "@rbs/export-engine";
import { recordingBitrate, type ExportQuality } from "../services/live-video-exporter";
import type { ProSubtitleExportFormatId } from "../services/pro-subtitle-exporter";

export interface ProSubtitleDialogSettings {
  backgroundMode: "transparent" | "solid";
  backgroundColor: string;
  exportFormat: "webmVp9Alpha" | "movProRes4444";
  hasSourceVideo: boolean;
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
  sourceVideoExport?: { label: string } | undefined;
  offlineFrameExport?: boolean;
  offlineExportProfile?: { title: string; defaultResolution: string; defaultFps: number; recommendation: string } | undefined;
  onClose: () => void;
  onCancel: () => void;
  onStart: (settings: ExportDialogStartSettings) => void;
}

export function ExportDialog({ duration, running, progress, currentFrame, totalFrames, error, aspectRatio = "9:16", proSubtitles, sourceVideoExport, offlineFrameExport = false, offlineExportProfile, onClose, onCancel, onStart }: ExportDialogProps) {
  const [resolution, setResolution] = useState(offlineExportProfile?.defaultResolution ?? (aspectRatio === "16:9" ? "1920x1080" : "1080x1920"));
  const [fps, setFps] = useState(offlineExportProfile?.defaultFps ?? 30);
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
    } : {})
  });

  return <div className="dialog-backdrop" role="presentation"><section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <header><h2 id="export-title">{offlineExportProfile?.title ?? (sourceVideoExport ? `Esporta ${sourceVideoExport.label}` : proSubtitles ? "Esporta Pro Subtitles" : "Video finale")}</h2><button aria-label="Chiudi" onClick={onClose} disabled={running}>×</button></header>
    {proSubtitles ? <>
      <label>Contenuto export<select aria-label="Contenuto export ProSubtitles" value={proSubtitleOutputMode} onChange={(event) => setProSubtitleOutputMode(event.target.value as typeof proSubtitleOutputMode)} disabled={running}><option value="subtitleLayer">Solo sottotitoli · layer per il montaggio</option><option value="completeVideo" disabled={!proSubtitles.hasSourceVideo}>Video originale + sottotitoli incorporati</option></select></label>
      {completeVideo
        ? <label>Formato<select aria-label="Formato video completo ProSubtitles" disabled><option>MP4 · H.264 + audio originale</option></select></label>
        : <>
          <label>Tipo di livello<select aria-label="Tipo di livello ProSubtitles" value={backgroundMode} onChange={(event) => setBackgroundMode(event.target.value as typeof backgroundMode)} disabled={running}><option value="transparent">Trasparente · overlay per CapCut</option><option value="solid">Sfondo di un colore · fallback universale</option></select></label>
          {backgroundMode === "transparent" ? <label>Formato<select aria-label="Formato ProSubtitles" value={alphaFormat} onChange={(event) => setAlphaFormat(event.target.value as typeof alphaFormat)} disabled={running}><option value="webmVp9Alpha">WebM · VP9 con canale alpha</option><option value="movProRes4444">MOV · Apple ProRes 4444 con alpha</option></select></label> : <><label>Formato<select disabled><option>MP4 · H.264 su sfondo pieno</option></select></label><label>Colore sfondo<input aria-label="Colore sfondo export ProSubtitles" type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} disabled={running} /></label><label className="export-fallback-toggle"><input type="checkbox" checked={allowOpaqueWebmFallback} onChange={(event) => setAllowOpaqueWebmFallback(event.target.checked)} disabled={running} /> Consenti WebM VP9 opaco solo se H.264 non è disponibile</label></>}
        </>}
      {proResUnavailable ? <p className="export-warning">ProRes 4444 richiede la build desktop con FFmpeg. La versione web non produrrà un MOV finto o privo di alpha: scegli WebM VP9 con alpha.</p> : null}
    </> : <label>Formato<select disabled><option>{sourceVideoExport ? "MP4 · H.264 + audio originale · proprietà sorgente" : offlineFrameExport ? "MP4 · H.264/AAC offline" : "MP4 H.264 oppure WebM VP9 automatico"}</option></select></label>}
    {!preservesSourceVideo ? <>
      <label>Risoluzione<select aria-label="Risoluzione" value={resolution} onChange={(event) => setResolution(event.target.value)} disabled={running}>{offlineExportProfile ? <><option value="1920x1080">1920 × 1080 (16:9 · Full HD)</option><option value="2560x1440">2560 × 1440 (16:9 · QHD / 2K)</option><option value="3840x2160">3840 × 2160 (16:9 · 4K consigliato)</option><option value="5120x2880">5120 × 2880 (16:9 · 5K)</option><option value="7680x4320">7680 × 4320 (16:9 · 8K)</option></> : <><option value="540x960">540 × 960 (9:16)</option><option value="1080x1920">1080 × 1920 (9:16)</option><option value="1920x1080">1920 × 1080 (16:9)</option><option value="2160x3840">2160 × 3840 (9:16 · 4K verticale)</option><option value="3840x2160">3840 × 2160 (16:9 · 4K orizzontale)</option></>}</select></label>
      <label>Frame rate<select value={fps} onChange={(event) => setFps(Number(event.target.value))} disabled={running}>{[24, 25, 30, 50, 60, 120].map((value) => <option key={value}>{value}</option>)}</select></label>
    </> : null}
    <label>Qualità codifica<select aria-label="Qualità codifica" value={quality} onChange={(event) => setQuality(event.target.value as ExportQuality)} disabled={running}><option value="maximum">Massima · bitrate elevato</option><option value="high">Alta · file più leggero</option></select></label>
    {offlineExportProfile ? <p className="export-recommendation"><strong>Scelta consigliata</strong><span>{offlineExportProfile.recommendation}</span></p> : null}
    <p className="muted">{sourceVideoExport ? "Mantiene risoluzione, rapporto, ordine, timestamp e durata di ogni frame del video caricato. La correzione viene composta offline; i pacchetti audio originali vengono copiati senza ricodifica e senza essere riprodotti durante l’export." : proSubtitles ? completeVideo ? "Usa direttamente risoluzione, rapporto, ordine, timestamp e durata di ogni frame del video caricato. I sottotitoli vengono composti offline; l’audio originale viene copiato senza essere riprodotto durante l’export." : "Esporta soltanto la tipografia, senza il video guida e senza audio duplicato. Ogni frame viene calcolato offline con gli stessi tempi della preview, senza drop volontari." : offlineFrameExport ? "Decodifica il video sorgente e calcola ogni frame offline alla risoluzione scelta. L’encoder attende il frame prima di proseguire, conserva il frame rate richiesto fino a 120 fps e unisce l’audio senza riprodurlo: la velocità della preview non influenza il risultato." : "Registra lo stesso renderer WebGL della preview con audio originale. La qualità Massima è predefinita e conserva meglio vetro, riflessi, neon, texture e movimenti rapidi."}</p>
    {preservesSourceVideo ? <div className="estimate-grid"><span>{totalFrames ? `${totalFrames.toLocaleString("it-IT")} frame sorgente` : "Conteggio frame sorgente in preflight"}</span><span>Durata originale ≈ {Math.ceil(duration)} s</span><span>Nessuna conversione FPS</span></div> : <div className="estimate-grid"><span>{estimate.frames.toLocaleString("it-IT")} frame</span><span>Tempo ≈ {Math.ceil(duration)} s</span><span>Video stimato ≈ {megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes.toFixed(0)} MB`}</span></div>}
    {fps >= 120 || width >= 2160 ? <p className="export-warning">{proSubtitles ? "Il preset scelto richiede molta memoria GPU e tempi di codifica maggiori." : offlineFrameExport ? "Il preset scelto richiede più tempo. L’encoder offline attende ciascun frame e non riduce volontariamente risoluzione o frame rate." : "La registrazione avviene in tempo reale: il preset scelto richiede una GPU potente per non perdere frame."}</p> : null}
    <progress max="1" value={progress} /><div className="property"><span>Frame</span><output>{currentFrame} / {preservesSourceVideo ? totalFrames || "…" : totalFrames || estimate.frames}</output></div>{error ? <p className="status-error">{error}</p> : null}
    <footer>{running ? <button onClick={onCancel}>Annulla</button> : <><button onClick={onClose}>Chiudi</button><button className="export" onClick={start} disabled={duration <= 0 || proResUnavailable}>Scegli destinazione e crea video</button></>}</footer>
  </section></div>;
}
