import type { ChangeEvent } from "react";
import { useProjectStore } from "../store/project-store";
import { openStaticWatermarkDetailPreview } from "../services/static-watermark-detail-preview";

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Immagine non leggibile."));
    reader.onerror = () => reject(new Error("Immagine non leggibile."));
    reader.readAsDataURL(file);
  });
}

export function StaticWatermarkPanel({ onImportVideo }: { onImportVideo: (file: File) => Promise<void> }) {
  const settings = useProjectStore((state) => state.project.animation.staticWatermark);
  const update = useProjectStore((state) => state.updateStaticWatermark);
  const loadReference = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) update({ referenceImageUrl: await dataUrl(file), referenceImageName: file.name });
    event.target.value = "";
  };
  const setRegion = (key: keyof typeof settings.region, value: number) => update({ region: { ...settings.region, [key]: Math.max(0, Math.min(1, value)) } });
  return <section className="static-watermark-settings">
    <h2>Static Watermark Remover</h2>
    <p className="muted">Per video di tua proprietà o sui quali sei autorizzato a intervenire. Il video e la fotografia devono rappresentare la stessa inquadratura.</p>
    <div className="watermark-workflow-step"><span>1</span><div><strong>Video con watermark</strong><small>Risoluzione, frame rate variabile, durata e audio originali vengono conservati.</small></div></div>
    <label className="flyer-upload">Carica video sorgente<input aria-label="Carica video con watermark" type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportVideo(file); }} /></label>
    {settings.videoUrl ? <div className="subtitle-video-loaded"><strong>{settings.videoName}</strong><span>{settings.videoWidth && settings.videoHeight ? `${settings.videoWidth} × ${settings.videoHeight}` : "Metadati video caricati"}</span></div> : null}
    <div className="watermark-workflow-step"><span>2</span><div><strong>Fotografia originale pulita</strong><small>Viene riallineata sul video e usata soltanto dentro la selezione.</small></div></div>
    <label className="flyer-upload">Carica fotografia pulita<input aria-label="Carica fotografia senza watermark" type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={(event) => void loadReference(event)} /></label>
    {settings.referenceImageUrl ? <div className="watermark-reference-preview" style={{ backgroundImage: `url(${settings.referenceImageUrl})` }}><span>{settings.referenceImageName}</span></div> : null}
    <div className="watermark-workflow-step"><span>3</span><div><strong>Seleziona il watermark</strong><small>Trascina direttamente sulla preview oppure regola i valori qui sotto.</small></div></div>
    <div className="watermark-region-grid">
      {([['x', 'X'], ['y', 'Y'], ['width', 'Larghezza'], ['height', 'Altezza']] as const).map(([key, label]) => <label key={key}>{label}<span><input aria-label={`Regione watermark ${label}`} type="number" min="0" max="100" step=".1" value={(settings.region[key] * 100).toFixed(1)} onChange={(event) => setRegion(key, Number(event.target.value) / 100)} />%</span></label>)}
    </div>
    <button type="button" onClick={() => update({ region: { x: .68, y: .04, width: .27, height: .14 } })}>Ripristina selezione</button>
    <button className="watermark-detail-preview-button" type="button" disabled={!settings.videoUrl || !settings.referenceImageUrl} onClick={openStaticWatermarkDetailPreview}>⛶ Anteprima zona rimozione</button>
    <h2>Allineamento riferimento</h2>
    <label>Adattamento<select aria-label="Adattamento fotografia di riferimento" value={settings.referenceFit} onChange={(event) => update({ referenceFit: event.target.value as typeof settings.referenceFit })}><option value="cover">Riempi · ritaglio proporzionale</option><option value="contain">Intera · bande possibili</option><option value="stretch">Estendi al video</option></select></label>
    <label>Scala: {settings.referenceScale.toFixed(2)}×<input aria-label="Scala fotografia di riferimento" type="range" min=".5" max="2.5" step=".005" value={settings.referenceScale} onChange={(event) => update({ referenceScale: Number(event.target.value) })} /></label>
    <label>Spostamento orizzontale: {Math.round(settings.referenceOffsetX * 100)}%<input aria-label="Spostamento orizzontale riferimento" type="range" min="-1" max="1" step=".0025" value={settings.referenceOffsetX} onChange={(event) => update({ referenceOffsetX: Number(event.target.value) })} /></label>
    <label>Spostamento verticale: {Math.round(settings.referenceOffsetY * 100)}%<input aria-label="Spostamento verticale riferimento" type="range" min="-1" max="1" step=".0025" value={settings.referenceOffsetY} onChange={(event) => update({ referenceOffsetY: Number(event.target.value) })} /></label>
    <h2>Fusione professionale</h2>
    <label>Sfumatura esterna: {settings.feather} px<input aria-label="Sfumatura bordo watermark" type="range" min="0" max="24" step="1" value={settings.feather} onChange={(event) => update({ feather: Number(event.target.value) })} /></label>
    <p className="muted watermark-feather-note">A 0 px tutta la selezione viene sostituita senza sfumatura. Valori superiori fondono soltanto pochi pixel del video immediatamente fuori dalla selezione: non rendono mai trasparenti i pixel corretti al suo interno.</p>
    <label>Opacità patch: {Math.round(settings.patchOpacity * 100)}%<input aria-label="Opacità patch watermark" type="range" min="0" max="1" step=".01" value={settings.patchOpacity} onChange={(event) => update({ patchOpacity: Number(event.target.value) })} /></label>
    <label className="teddy-dance-toggle"><span>Uniforma luminosità automaticamente</span><input aria-label="Uniforma luminosità watermark" type="checkbox" checked={settings.colorMatch} onChange={(event) => update({ colorMatch: event.target.checked })} /></label>
    {settings.colorMatch ? <label>Intensità correzione: {Math.round(settings.colorMatchStrength * 100)}%<input aria-label="Intensità correzione colore watermark" type="range" min="0" max="1" step=".01" value={settings.colorMatchStrength} onChange={(event) => update({ colorMatchStrength: Number(event.target.value) })} /></label> : null}
    <label className="teddy-dance-toggle"><span>Mostra guida nella preview</span><input aria-label="Mostra guida watermark" type="checkbox" checked={settings.guideVisible} onChange={(event) => update({ guideVisible: event.target.checked })} /></label>
    <p className="muted">La cornice di selezione non viene inclusa nell’export.</p>
  </section>;
}
