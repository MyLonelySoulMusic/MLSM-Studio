import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useProjectStore } from "../store/project-store";
import { useVideoEditorPlayback } from "../store/video-editor-playback-store";
import { WebAudioAnalyzer } from "../services/web-audio-analyzer";
import { forgetVideoEditorFile, importVideoEditorAssets, registerVideoEditorFiles, videoEditorAcceptedFiles, videoEditorAssetDragType, videoEditorSessionFile } from "../services/video-editor-import";
import { videoEditorAspectLabel, videoEditorCompositionForAsset, videoEditorTimelineDuration, type VideoEditorAsset } from "../services/video-editor";
import { VideoEditorEffectsLibrary } from "./VideoEditorEffectsLibrary";

const kindLabels = { video: "Video", image: "Immagine", audio: "Audio" } as const;
const kindIcons = { video: "▶", image: "▣", audio: "∿" } as const;

function assetSummary(asset: VideoEditorAsset): string {
  const parts: string[] = [];
  if (asset.width && asset.height) parts.push(`${asset.width} × ${asset.height}`);
  if (asset.durationSeconds > 0) parts.push(`${asset.durationSeconds.toFixed(2)} s`);
  else if (asset.kind === "image") parts.push("fermo immagine");
  if (asset.kind === "video") parts.push(asset.hasAudio ? "con audio" : "senza audio");
  if (asset.bpm) parts.push(`${asset.bpm.toFixed(1)} BPM`);
  if (asset.beats.length) parts.push(`${asset.beats.length} battute`);
  return parts.join(" · ");
}

export function VideoEditorPanel() {
  const settings = useProjectStore((state) => state.project.animation.videoEditor);
  const addAssets = useProjectStore((state) => state.addVideoEditorAssets);
  const removeAsset = useProjectStore((state) => state.removeVideoEditorAsset);
  const addClip = useProjectStore((state) => state.addVideoEditorClip);
  const update = useProjectStore((state) => state.updateVideoEditor);
  const addTrack = useProjectStore((state) => state.addVideoEditorTrack);
  const setAssetAnalysis = useProjectStore((state) => state.setVideoEditorAssetAnalysis);
  const setStatus = useProjectStore((state) => state.setStatus);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [analysing, setAnalysing] = useState<string | null>(null);
  const [targetTracks, setTargetTracks] = useState<Record<string, string>>({});
  const currentTime = useVideoEditorPlayback((state) => state.currentTime);
  const analyzer = useRef(new WebAudioAnalyzer());
  const duration = useMemo(() => videoEditorTimelineDuration(settings), [settings]);

  const ingest = async (files: readonly File[]) => {
    if (!files.length) return;
    setImporting(true);
    setErrors([]);
    try {
      const report = await importVideoEditorAssets(files);
      registerVideoEditorFiles(report.files);
      if (report.assets.length) {
        // Al primo media visivo il monitor adotta il rapporto reale della sorgente:
        // un 9:16 non nasce più dentro una composizione 16:9 ereditata dal default.
        const firstVisual = report.assets.find((asset) => asset.kind !== "audio");
        if (!settings.assets.some((asset) => asset.kind !== "audio") && firstVisual) {
          const composition = videoEditorCompositionForAsset(firstVisual);
          if (composition) update({ outputWidth: composition.width, outputHeight: composition.height });
        }
        addAssets(report.assets);
      }
      setErrors(report.errors);
    } finally { setImporting(false); }
  };

  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    void ingest(files);
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void ingest([...event.dataTransfer.files]);
  };

  /**
   * L’analisi ritmica riusa l’analizzatore dello studio: le battute trovate diventano
   * punti magnetici in timeline e la base per la sincronizzazione audio/video.
   */
  const analyseRhythm = async (asset: VideoEditorAsset) => {
    if (asset.kind !== "audio" && !asset.hasAudio) { setErrors([`${asset.name}: non contiene audio analizzabile.`]); return; }
    setAnalysing(asset.id);
    setErrors([]);
    try {
      const file = videoEditorSessionFile(asset.id);
      // L’hash della cache identifica il materiale: senza il file di sessione si usa
      // nome e durata, stabili per lo stesso media all’interno del progetto.
      const hash = file ? `${asset.id}-${file.size}` : `${asset.id}-${asset.durationSeconds}`;
      const { result } = await analyzer.current.analyze(asset.url, hash);
      setAssetAnalysis(asset.id, { bpm: result.globalBpm, beats: result.beats, downbeats: result.downbeats });
    } catch (error) {
      setErrors([`${asset.name}: ${error instanceof Error ? error.message : "analisi non riuscita"}`]);
    } finally { setAnalysing(null); }
  };

  const setOutputSize = (width: number, height: number) => update({ outputWidth: width, outputHeight: height });
  const compatibleTracks = (asset: VideoEditorAsset) => settings.tracks.filter((track) => track.kind === (asset.kind === "audio" ? "audio" : "video") && !track.locked);
  const defaultTrack = (asset: VideoEditorAsset) => compatibleTracks(asset)[0] ?? null;
  const insertAsset = (asset: VideoEditorAsset, atPlayhead: boolean) => {
    const trackId = targetTracks[asset.id] ?? defaultTrack(asset)?.id;
    const id = addClip(asset.id, { ...(trackId ? { trackId } : {}), ...(atPlayhead ? { startSeconds: currentTime } : {}) });
    if (!id) setStatus("Nessun livello compatibile disponibile: aggiungi o sblocca un livello video o una traccia audio.");
  };
  const removeMedia = (asset: VideoEditorAsset) => {
    const protectedByLock = settings.clips.some((clip) => clip.assetId === asset.id && settings.tracks.some((track) => track.id === clip.trackId && track.locked));
    if (protectedByLock) {
      setStatus("Media in uso su una traccia bloccata: sblocca il livello prima di rimuoverlo dal pool.");
      return;
    }
    forgetVideoEditorFile(asset.id);
    if (asset.url.startsWith("blob:")) URL.revokeObjectURL(asset.url);
    if (asset.thumbnailUrl?.startsWith("blob:") && asset.thumbnailUrl !== asset.url) URL.revokeObjectURL(asset.thumbnailUrl);
    removeAsset(asset.id);
  };

  return <section className="video-editor-settings">
    <VideoEditorEffectsLibrary />
    <h2>Pool media</h2>
    <div
      className={`video-editor-dropzone${dragging ? " dropzone-active" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <label className="flyer-upload">{importing ? "Importazione…" : "Carica video, immagini, audio"}<input aria-label="Carica file nel pool media" type="file" multiple accept={videoEditorAcceptedFiles} disabled={importing} onChange={chooseFiles} /></label>
      <span className="muted">Trascina qui i file del progetto oppure usa il pulsante.</span>
    </div>
    {errors.length ? <ul className="video-editor-errors">{errors.map((message) => <li key={message}>{message}</li>)}</ul> : null}
    {settings.assets.length
      ? <ul className="video-editor-pool">{settings.assets.map((asset) => {
        const tracks = compatibleTracks(asset); const targetTrackId = targetTracks[asset.id] ?? defaultTrack(asset)?.id ?? "";
        const protectedByLock = settings.clips.some((clip) => clip.assetId === asset.id && settings.tracks.some((track) => track.id === clip.trackId && track.locked));
        return <li key={asset.id} className={`pool-item pool-${asset.kind}`} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(videoEditorAssetDragType, asset.id); }}>
        {asset.thumbnailUrl ? <div className="pool-thumbnail" style={{ backgroundImage: `url(${asset.thumbnailUrl})` }}><span>{kindIcons[asset.kind]}</span></div> : <div className="pool-thumbnail pool-thumbnail-audio"><span>{kindIcons[asset.kind]}</span></div>}
        <div className="pool-item-head"><span className="pool-icon" aria-hidden="true">{kindIcons[asset.kind]}</span><strong title={asset.name}>{asset.name}</strong></div>
        <span className="pool-meta">{kindLabels[asset.kind]}{assetSummary(asset) ? ` · ${assetSummary(asset)}` : ""}</span>
        <label className="pool-track-target">Livello di destinazione<select aria-label={`Livello destinazione ${asset.name}`} value={targetTrackId} onChange={(event) => setTargetTracks((current) => ({ ...current, [asset.id]: event.target.value }))}>{tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
        <div className="pool-actions">
          <button type="button" onClick={() => insertAsset(asset, true)}>Inserisci nel livello al playhead</button>
          <button type="button" onClick={() => insertAsset(asset, false)}>Aggiungi in coda al livello</button>
          {asset.kind === "audio" || asset.hasAudio
            ? <button type="button" disabled={analysing === asset.id} onClick={() => void analyseRhythm(asset)}>{analysing === asset.id ? "Analisi…" : asset.beats.length ? "Rianalizza battute" : "Analizza battute"}</button>
            : null}
          {asset.kind !== "audio" ? <button type="button" onClick={() => {
            const composition = videoEditorCompositionForAsset(asset);
            if (composition) setOutputSize(composition.width, composition.height);
          }}>Adatta formato al media</button> : null}
          <button type="button" className="pool-remove" disabled={protectedByLock} title={protectedByLock ? "Sblocca la traccia che usa questo media prima di rimuoverlo" : "Rimuovi dal pool media"} onClick={() => removeMedia(asset)}>Rimuovi</button>
        </div>
      </li>; })}</ul>
      : <p className="muted">Il pool è vuoto. I file caricati restano locali e non vengono mai inviati altrove.</p>}

    <h2>Livelli e tracce</h2>
    <div className="video-editor-track-actions">
      <button type="button" onClick={() => addTrack("video")}>Nuovo livello video</button>
      <button type="button" onClick={() => addTrack("audio")}>Nuova traccia audio</button>
    </div>
    <p className="muted">Ogni livello video è equivalente: può contenere clip trasformate, sovrapposte, miscelate e dotate di effetti. Il livello più in alto viene disegnato sopra gli altri.</p>

    <h2>Calamita</h2>
    <label className="teddy-dance-toggle"><span>Calamita attiva</span><input aria-label="Calamita Video Editor" type="checkbox" checked={settings.snapEnabled} onChange={(event) => update({ snapEnabled: event.target.checked })} /></label>
    <label className="teddy-dance-toggle"><span>Aggancia alle battute</span><input aria-label="Aggancia alle battute Video Editor" type="checkbox" checked={settings.snapToBeats} onChange={(event) => update({ snapToBeats: event.target.checked })} /></label>
    <label>Raggio calamita: {Math.round(settings.snapThresholdSeconds * 1000)} ms<input aria-label="Raggio calamita Video Editor" type="range" min=".005" max=".5" step=".005" value={settings.snapThresholdSeconds} onChange={(event) => update({ snapThresholdSeconds: Number(event.target.value) })} /></label>
    <p className="muted">Con la calamita attiva due clip si accostano senza lasciare un vuoto al centro.</p>

    <h2>Composizione</h2>
    <div className="video-editor-composition-badge"><strong>{videoEditorAspectLabel(settings.outputWidth, settings.outputHeight)}</strong><span>{settings.outputHeight > settings.outputWidth ? "Verticale" : settings.outputHeight === settings.outputWidth ? "Quadrata" : "Orizzontale"}</span></div>
    <label>Colore di sfondo<input aria-label="Colore sfondo Video Editor" type="color" value={settings.backgroundColor} onChange={(event) => update({ backgroundColor: event.target.value })} /></label>
    <div className="video-editor-resolution">
      <label>Larghezza<input aria-label="Larghezza composizione Video Editor" type="number" min="64" max="7680" step="2" value={settings.outputWidth} onChange={(event) => update({ outputWidth: Math.max(64, Math.min(7680, Math.round(Number(event.target.value) / 2) * 2)) })} /></label>
      <span>×</span>
      <label>Altezza<input aria-label="Altezza composizione Video Editor" type="number" min="64" max="7680" step="2" value={settings.outputHeight} onChange={(event) => update({ outputHeight: Math.max(64, Math.min(7680, Math.round(Number(event.target.value) / 2) * 2)) })} /></label>
    </div>
    <div className="upscaler-presets">
      <button type="button" className={settings.outputWidth / settings.outputHeight === 16 / 9 ? "active-control" : ""} onClick={() => setOutputSize(1920, 1080)}>16:9</button>
      <button type="button" className={settings.outputWidth / settings.outputHeight === 9 / 16 ? "active-control" : ""} onClick={() => setOutputSize(1080, 1920)}>9:16</button>
      <button type="button" className={settings.outputWidth === settings.outputHeight ? "active-control" : ""} onClick={() => setOutputSize(1080, 1080)}>1:1</button>
      <button type="button" className={settings.outputWidth / settings.outputHeight === 4 / 5 ? "active-control" : ""} onClick={() => setOutputSize(1080, 1350)}>4:5</button>
    </div>
    <div className="estimate-grid"><span>{settings.clips.length} clip</span><span>{settings.tracks.length} tracce</span><span>Durata {duration.toFixed(2)} s</span></div>
  </section>;
}
