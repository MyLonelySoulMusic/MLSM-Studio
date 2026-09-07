import { useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { useProjectStore } from "../store/project-store";
import { useVideoEditorPlayback } from "../store/video-editor-playback-store";
import {
  importVideoEditorAssets,
  registerVideoEditorFiles,
  videoEditorAcceptedFiles,
  videoEditorAssetDragType,
  videoEditorAssetKindDragType
} from "../services/video-editor-import";
import type { VideoEditorAsset } from "../services/video-editor";

const kindLabels = { video: "Video", image: "Immagine", audio: "Audio" } as const;
const kindIcons = { video: "▶", image: "▣", audio: "∿" } as const;

function assetSummary(asset: VideoEditorAsset): string {
  const dimensions = asset.width > 0 && asset.height > 0 ? `${asset.width} × ${asset.height}` : null;
  const duration = asset.durationSeconds > 0 ? `${asset.durationSeconds.toFixed(2)} s` : asset.kind === "image" ? "fermo immagine" : null;
  return [dimensions, duration].filter(Boolean).join(" · ");
}

function firstCompatibleTrack(settings: ReturnType<typeof useProjectStore.getState>["project"]["animation"]["videoEditor"], asset: VideoEditorAsset) {
  const kind = asset.kind === "audio" ? "audio" : "video";
  return settings.tracks.find((track) => track.kind === kind && !track.locked) ?? null;
}

/**
 * Media bin minimale, volutamente privo di controlli di montaggio: come in
 * CapCut, qui si importano i sorgenti e li si trascina nella timeline. Le
 * regolazioni, gli effetti e la gestione delle tracce vivono nei tab dedicati
 * o nell'inspector contestuale della clip selezionata.
 */
export function VideoEditorPanel() {
  const settings = useProjectStore((state) => state.project.animation.videoEditor);
  const addAssets = useProjectStore((state) => state.addVideoEditorAssets);
  const addClip = useProjectStore((state) => state.addVideoEditorClip);
  const setStatus = useProjectStore((state) => state.setStatus);
  const currentTime = useVideoEditorPlayback((state) => state.currentTime);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const ingest = async (files: readonly File[]) => {
    if (!files.length) return;
    setImporting(true);
    setErrors([]);
    try {
      const report = await importVideoEditorAssets(files);
      registerVideoEditorFiles(report.files);
      if (report.assets.length) addAssets(report.assets);
      setErrors(report.errors);
    } finally {
      setImporting(false);
    }
  };

  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    void ingest(files);
  };

  const dropFiles = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    void ingest([...event.dataTransfer.files]);
  };

  const insertAtPlayhead = (asset: VideoEditorAsset) => {
    const track = firstCompatibleTrack(settings, asset);
    if (!track) {
      setStatus(`Nessuna traccia ${asset.kind === "audio" ? "audio" : "video"} sbloccata disponibile.`);
      return;
    }
    const clipId = addClip(asset.id, { trackId: track.id, startSeconds: currentTime, strictTrack: true });
    if (!clipId) setStatus("Il media non è compatibile con la traccia selezionata o la traccia è bloccata.");
  };

  const handleAssetKeyDown = (event: KeyboardEvent<HTMLElement>, asset: VideoEditorAsset) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    insertAtPlayhead(asset);
  };

  return <section className="video-editor-media-bin" aria-label="Media Video Editor">
    <header className="video-editor-media-header">
      <div><strong>Media</strong><span>{settings.assets.length ? `${settings.assets.length} elementi` : "Importa i file del progetto"}</span></div>
      <kbd>Invio · inserisci</kbd>
    </header>
    <div
      className={`video-editor-media-dropzone${dragging ? " dropzone-active" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={dropFiles}
    >
      <label className="video-editor-media-import">{importing ? "Importazione…" : "Importa media"}<input aria-label="Importa media Video Editor" type="file" multiple accept={videoEditorAcceptedFiles} disabled={importing} onClick={(event) => { event.currentTarget.value = ""; }} onChange={chooseFiles} /></label>
      <span>Trascina qui video, immagini o audio</span>
    </div>
    {errors.length ? <ul className="video-editor-errors">{errors.map((message) => <li key={message}>{message}</li>)}</ul> : null}
    {settings.assets.length ? <div className="video-editor-media-grid" role="list" aria-label="Media importati">{settings.assets.map((asset) => {
      const track = firstCompatibleTrack(settings, asset);
      return <article
        key={asset.id}
        className={`video-editor-media-tile pool-${asset.kind}${track ? "" : " is-unavailable"}`}
        role="button"
        tabIndex={0}
        draggable
        aria-label={`${asset.name} · ${kindLabels[asset.kind]}${assetSummary(asset) ? ` · ${assetSummary(asset)}` : ""}`}
        title={track ? "Trascina nella timeline · Invio inserisce al playhead" : "Nessuna traccia compatibile sbloccata"}
        onKeyDown={(event) => handleAssetKeyDown(event, asset)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(videoEditorAssetDragType, asset.id);
          event.dataTransfer.setData(videoEditorAssetKindDragType, asset.kind);
        }}
      >
        <div className={`video-editor-media-thumb${asset.kind === "image" ? " is-image" : ""}${asset.kind === "audio" || !asset.thumbnailUrl ? " is-audio" : ""}`} style={asset.thumbnailUrl ? { backgroundImage: asset.kind === "image" ? `url(${asset.thumbnailUrl}), linear-gradient(45deg, #aeb2bc 25%, transparent 25%, transparent 75%, #aeb2bc 75%), linear-gradient(45deg, #aeb2bc 25%, transparent 25%, transparent 75%, #aeb2bc 75%)` : `url(${asset.thumbnailUrl})`, backgroundSize: asset.kind === "image" ? "cover, 12px 12px, 12px 12px" : "cover", backgroundPosition: asset.kind === "image" ? "center, 0 0, 6px 6px" : "center" } : undefined}><span>{kindIcons[asset.kind]}</span></div>
        <div className="video-editor-media-tile-copy"><strong title={asset.name}>{asset.name}</strong><span>{kindLabels[asset.kind]}{assetSummary(asset) ? ` · ${assetSummary(asset)}` : ""}</span></div>
        <small className="video-editor-media-tile-hint">{track ? "Trascina nella timeline" : "Traccia compatibile non disponibile"}</small>
      </article>;
    })}</div> : <p className="video-editor-media-empty">Il media bin è vuoto.</p>}
  </section>;
}
