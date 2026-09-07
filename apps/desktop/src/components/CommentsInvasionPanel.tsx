import type { ChangeEvent } from "react";
import { useProjectStore } from "../store/project-store";
import { useCommentsInvasionStore } from "../store/comments-invasion-store";

const directoryAttributes = { webkitdirectory: "", directory: "" } as Record<string, string>;

export function CommentsInvasionPanel({ onImportVideo }: { onImportVideo: (file: File) => Promise<void> }) {
  const settings = useProjectStore((state) => state.project.animation.commentsInvasion);
  const update = useProjectStore((state) => state.updateCommentsInvasion);
  const assets = useCommentsInvasionStore((state) => state.assets);
  const importing = useCommentsInvasionStore((state) => state.importing);
  const error = useCommentsInvasionStore((state) => state.error);
  const addFiles = useCommentsInvasionStore((state) => state.addFiles);
  const removeAsset = useCommentsInvasionStore((state) => state.removeAsset);
  const clear = useCommentsInvasionStore((state) => state.clear);

  const loadFolder = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]; event.target.value = "";
    if (files.length) await addFiles(files);
  };

  return <section className="comments-invasion-settings">
    <div className="vocal-track-advice"><strong>Timbri deterministici, nessun commento perso</strong><span>La cartella viene ordinata naturalmente per nome. Preview ed export usano la stessa sequenza: quando entra il sesto commento, il primo viene rimosso nello stesso frame.</span></div>
    <h2>Video sorgente</h2>
    <label className="flyer-upload">Carica video<input aria-label="Carica video Comments Invasion" type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportVideo(file); }} /></label>
    {settings.videoUrl ? <div className="subtitle-video-loaded"><strong>{settings.videoName}</strong><span>{settings.videoWidth} × {settings.videoHeight} · rapporto sorgente preservato · {settings.videoHasAudio ? "audio originale" : "senza audio"}</span></div> : <p className="muted">Sono accettati video verticali, orizzontali, quadrati e rapporti personalizzati.</p>}

    <h2>Cartella commenti</h2>
    <label className="flyer-upload comments-folder-upload">Seleziona cartella screenshot<input {...directoryAttributes} aria-label="Carica cartella commenti" type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple disabled={importing} onChange={(event) => void loadFolder(event)} /></label>
    <label className="comments-files-fallback">Oppure aggiungi immagini<input aria-label="Aggiungi immagini commenti" type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple disabled={importing} onChange={(event) => void loadFolder(event)} /></label>
    <div className="comments-import-summary"><strong>{importing ? "Lettura cartella…" : `${assets.length} commenti caricati`}</strong>{assets.length ? <button type="button" onClick={() => { if (window.confirm("Rimuovere tutti gli screenshot dei commenti?")) clear(); }}>Svuota</button> : null}</div>
    {error ? <p className="status-error" role="alert">{error}</p> : null}
    {assets.length ? <div className="comments-asset-list" aria-label="Screenshot commenti caricati">{assets.map((asset, index) => <article key={asset.id}><span>{index + 1}</span><img src={asset.url} alt="" loading="lazy" /><div><strong>{asset.name}</strong><small>{asset.width} × {asset.height}</small></div><button type="button" aria-label={`Rimuovi ${asset.name}`} onClick={() => removeAsset(asset.id)}>×</button></article>)}</div> : <p className="muted">PNG, JPEG, WebP e AVIF. I nomi numerici come commento-2 e commento-10 vengono ordinati correttamente.</p>}

    <h2>Presenza a schermo</h2>
    <label>Commenti visibili: {settings.maxVisible}<input aria-label="Numero commenti visibili" type="range" min="1" max="20" step="1" value={settings.maxVisible} onChange={(event) => update({ maxVisible: Number(event.target.value) })} /></label>
    <label>Dimensione commenti: {Math.round(settings.commentScale * 100)}%<input aria-label="Dimensione commenti" type="range" min=".1" max=".8" step=".01" value={settings.commentScale} onChange={(event) => update({ commentScale: Number(event.target.value) })} /></label>
    <label>Un commento ogni: {settings.intervalSeconds.toFixed(2)} s<input aria-label="Intervallo commenti" type="range" min=".15" max="8" step=".05" value={settings.intervalSeconds} onChange={(event) => update({ intervalSeconds: Number(event.target.value) })} /></label>
    <label>Primo timbro dopo: {settings.initialDelaySeconds.toFixed(1)} s<input aria-label="Ritardo primo commento" type="range" min="0" max="10" step=".1" value={settings.initialDelaySeconds} onChange={(event) => update({ initialDelaySeconds: Number(event.target.value) })} /></label>
    <label>Permanenza dopo l’ingresso: {settings.holdDurationSeconds.toFixed(2)} s<input aria-label="Permanenza commenti" type="range" min=".25" max="30" step=".25" value={settings.holdDurationSeconds} onChange={(event) => update({ holdDurationSeconds: Number(event.target.value) })} /></label>

    <h2>Uscita dei commenti</h2>
    <label>Animazione<select aria-label="Animazione uscita commenti" value={settings.exitAnimation} onChange={(event) => update({ exitAnimation: event.target.value as typeof settings.exitAnimation })}><option value="fade">Dissolvenza</option><option value="shrink">Riduzione al centro</option><option value="slide-up">Scivola verso l’alto</option><option value="slide-side">Espulsione laterale</option><option value="spin">Rotazione dinamica</option></select></label>
    <label>Durata uscita: {settings.exitDurationSeconds.toFixed(2)} s<input aria-label="Durata uscita commenti" type="range" min=".08" max="3" step=".02" value={settings.exitDurationSeconds} onChange={(event) => update({ exitDurationSeconds: Number(event.target.value) })} /></label>

    <h2>Impatto del timbro</h2>
    <label>Potenza: {settings.impactIntensity.toFixed(2)}×<input aria-label="Potenza timbro commenti" type="range" min=".25" max="2" step=".05" value={settings.impactIntensity} onChange={(event) => update({ impactIntensity: Number(event.target.value) })} /></label>
    <label>Durata impatto: {settings.impactDurationSeconds.toFixed(2)} s<input aria-label="Durata timbro commenti" type="range" min=".08" max="1.2" step=".02" value={settings.impactDurationSeconds} onChange={(event) => update({ impactDurationSeconds: Number(event.target.value) })} /></label>
    <label>Rotazione massima: {settings.rotationDegrees.toFixed(0)}°<input aria-label="Rotazione commenti" type="range" min="0" max="20" step="1" value={settings.rotationDegrees} onChange={(event) => update({ rotationDegrees: Number(event.target.value) })} /></label>
    <label>Margine sicuro: {Math.round(settings.safeArea * 100)}%<input aria-label="Margine commenti" type="range" min="0" max=".15" step=".005" value={settings.safeArea} onChange={(event) => update({ safeArea: Number(event.target.value) })} /></label>

    <h2>Adattamento video</h2>
    <label>Riempimento<select aria-label="Adattamento video Comments Invasion" value={settings.videoFit} onChange={(event) => update({ videoFit: event.target.value as typeof settings.videoFit })}><option value="contain">Intero · nessun taglio</option><option value="cover">Riempi · ritaglio ai bordi</option></select></label>
    <label>Colore bande<input aria-label="Colore bande Comments Invasion" type="color" value={settings.backgroundColor} onChange={(event) => update({ backgroundColor: event.target.value })} /></label>
  </section>;
}
