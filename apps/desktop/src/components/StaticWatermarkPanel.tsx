import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useProjectStore } from "../store/project-store";
import { analyzeStaticWatermarkVideoAlignment, frameRatesDiffer } from "../services/static-watermark-alignment";
import { openStaticWatermarkDetailPreview } from "../services/static-watermark-detail-preview";
import { clearStaticWatermarkReferenceFile, getStaticWatermarkReferenceFile, registerStaticWatermarkReferenceFile } from "../services/static-watermark-reference-file";

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Immagine non leggibile."));
    reader.onerror = () => reject(new Error("Immagine non leggibile."));
    reader.readAsDataURL(file);
  });
}

function videoMetadata(url: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const release = () => { video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); video.load(); };
    video.preload = "metadata";
    video.onloadedmetadata = () => { const result = { width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : 0 }; release(); resolve(result); };
    video.onerror = () => { release(); reject(new Error("Il video pulito non è leggibile.")); };
    video.src = url;
  });
}

export function StaticWatermarkPanel({ onImportVideo }: { onImportVideo: (file: File) => Promise<void> }) {
  const settings = useProjectStore((state) => state.project.animation.staticWatermark);
  const update = useProjectStore((state) => state.updateStaticWatermark);
  const analysis = useRef<AbortController | null>(null);
  const lastAutomaticPair = useRef("");
  const [alignmentBusy, setAlignmentBusy] = useState(false);
  const [alignmentMessage, setAlignmentMessage] = useState("");
  const [frameRatePrompt, setFrameRatePrompt] = useState<{ source: number; reference: number } | null>(null);
  const sourceLongerThanReference = settings.videoDurationSeconds > 0 && settings.referenceVideoDurationSeconds > 0 && settings.videoDurationSeconds > settings.referenceVideoDurationSeconds + .05;
  useEffect(() => () => analysis.current?.abort(), []);

  const loadReferenceImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      analysis.current?.abort(); clearStaticWatermarkReferenceFile();
      update({ referenceKind: "image", referenceImageUrl: await dataUrl(file), referenceImageName: file.name, alignmentConfidence: 0, sourceFrameRate: 0, referenceFrameRate: 0, frameRateBasis: null });
      setFrameRatePrompt(null);
      setAlignmentMessage("");
    }
    event.target.value = "";
  };

  const analyze = async (referenceUrl = settings.referenceVideoUrl, referenceFile = getStaticWatermarkReferenceFile(referenceUrl), forceFrameRateChoice = false) => {
    if (!settings.videoUrl || !referenceUrl) { setAlignmentMessage("Carica entrambi i video prima dell’analisi."); return; }
    analysis.current?.abort(); const controller = new AbortController(); analysis.current = controller;
    setAlignmentBusy(true); setAlignmentMessage("Confronto dei fotogrammi e ricerca della sincronizzazione…");
    try {
      const result = await analyzeStaticWatermarkVideoAlignment({ sourceUrl: settings.videoUrl, referenceUrl, region: settings.region, searchSeconds: settings.temporalSearchSeconds, signal: controller.signal, referenceFile });
      if (controller.signal.aborted) return;
      const sourceFrameRate = result.sourceFrameRate ?? 0; const referenceFrameRate = result.referenceFrameRate ?? 0;
      const fpsMismatch = frameRatesDiffer(sourceFrameRate, referenceFrameRate);
      const preservedBasis = forceFrameRateChoice ? null : settings.frameRateBasis;
      update({ referenceTimeOffsetSeconds: result.offsetSeconds, alignmentConfidence: result.confidence, sourceFrameRate, referenceFrameRate, frameRateBasis: fpsMismatch ? preservedBasis : "source" });
      if (fpsMismatch && (forceFrameRateChoice || !preservedBasis)) setFrameRatePrompt({ source: sourceFrameRate, reference: referenceFrameRate });
      const startsTogether = (result.sourceDurationSeconds ?? settings.videoDurationSeconds) > (result.referenceDurationSeconds ?? settings.referenceVideoDurationSeconds) + .05;
      setAlignmentMessage(startsTogether
        ? "Il video pulito parte dall’inizio a velocità originale. Dopo la sua fine, la parte restante resta originale."
        : result.confidence >= .55
          ? `Allineamento pronto · offset ${result.offsetSeconds >= 0 ? "+" : ""}${result.offsetSeconds.toFixed(3)} s · confidenza ${Math.round(result.confidence * 100)}%`
          : `Corrispondenza debole (${Math.round(result.confidence * 100)}%). Controlla che i video riprendano la stessa sequenza.`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setAlignmentMessage(error instanceof Error ? error.message : String(error));
    } finally { if (analysis.current === controller) { analysis.current = null; setAlignmentBusy(false); } }
  };

  useEffect(() => {
    if (settings.referenceKind !== "video" || !settings.videoUrl || !settings.referenceVideoUrl) return;
    const pair = `${settings.videoUrl}\n${settings.referenceVideoUrl}`;
    if (lastAutomaticPair.current === pair) return;
    lastAutomaticPair.current = pair;
    void analyze(settings.referenceVideoUrl, getStaticWatermarkReferenceFile(settings.referenceVideoUrl));
    // L’analisi automatica dipende volutamente solo dall’identità dei due video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.referenceKind, settings.referenceVideoUrl, settings.videoUrl]);

  const loadReferenceVideo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const url = URL.createObjectURL(file);
    let registered = false;
    try {
      const metadata = await videoMetadata(url);
      registerStaticWatermarkReferenceFile(url, file);
      registered = true;
      if (settings.videoUrl) lastAutomaticPair.current = `${settings.videoUrl}\n${url}`;
      update({ referenceKind: "video", referenceVideoUrl: url, referenceVideoName: file.name, referenceVideoWidth: metadata.width, referenceVideoHeight: metadata.height, referenceVideoDurationSeconds: metadata.duration, alignmentConfidence: 0, referenceFrameRate: 0, frameRateBasis: null });
      await analyze(url, file, true);
    } catch (error) {
      if (!registered) URL.revokeObjectURL(url); setAlignmentMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const setRegion = (key: keyof typeof settings.region, value: number) => update({ region: { ...settings.region, [key]: Math.max(0, Math.min(1, value)) } });
  const hasReference = settings.referenceKind === "video" ? Boolean(settings.referenceVideoUrl) : Boolean(settings.referenceImageUrl);
  return <><section className="static-watermark-settings">
    <h2>Static Watermark Remover</h2>
    <p className="muted">Per video di tua proprietà o sui quali sei autorizzato a intervenire. Puoi usare una fotografia oppure il video originale pulito della stessa sequenza.</p>
    <div className="watermark-workflow-step"><span>1</span><div><strong>Video con watermark</strong><small>Risoluzione, frame rate variabile, durata e audio originali vengono conservati.</small></div></div>
    <label className="flyer-upload">Carica video sorgente<input aria-label="Carica video con watermark" type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportVideo(file); }} /></label>
    {settings.videoUrl ? <div className="subtitle-video-loaded"><strong>{settings.videoName}</strong><span>{settings.videoWidth && settings.videoHeight ? `${settings.videoWidth} × ${settings.videoHeight}` : "Metadati video caricati"}</span></div> : null}
    <div className="watermark-workflow-step"><span>2</span><div><strong>Riferimento originale pulito</strong><small>La fotografia resta disponibile; con un video MLSM sincronizza e riallinea ogni fotogramma.</small></div></div>
    <div className="watermark-reference-kind" role="group" aria-label="Tipo riferimento pulito">
      <button type="button" className={settings.referenceKind === "image" ? "is-active" : ""} onClick={() => update({ referenceKind: "image" })}>Fotografia</button>
      <button type="button" className={settings.referenceKind === "video" ? "is-active" : ""} onClick={() => update({ referenceKind: "video" })}>Video pulito</button>
    </div>
    {settings.referenceKind === "image" ? <>
      <label className="flyer-upload">Carica fotografia pulita<input aria-label="Carica fotografia senza watermark" type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={(event) => void loadReferenceImage(event)} /></label>
      {settings.referenceImageUrl ? <div className="watermark-reference-preview" style={{ backgroundImage: `url(${settings.referenceImageUrl})` }}><span>{settings.referenceImageName}</span></div> : null}
    </> : <>
      <label className="flyer-upload">Carica video pulito<input aria-label="Carica video senza watermark" type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" onChange={(event) => void loadReferenceVideo(event)} /></label>
      {settings.referenceVideoUrl ? <div className="subtitle-video-loaded"><strong>{settings.referenceVideoName}</strong><span>{settings.referenceVideoWidth} × {settings.referenceVideoHeight} · {settings.referenceVideoDurationSeconds.toFixed(2)} s</span></div> : null}
      <div className={`watermark-alignment-status ${settings.alignmentConfidence >= .55 ? "is-ready" : alignmentMessage ? "is-warning" : ""}`}><i /> <span>{alignmentBusy ? "Analisi automatica in corso…" : alignmentMessage || "Carica il video pulito: l’analisi partirà automaticamente."}</span></div>
      {settings.sourceFrameRate > 0 && settings.referenceFrameRate > 0 ? <div className="watermark-fps-summary"><span>Watermark <strong>{settings.sourceFrameRate.toFixed(2)} fps</strong></span><span>Pulito <strong>{settings.referenceFrameRate.toFixed(2)} fps</strong></span><span>Base <strong>{settings.frameRateBasis === "reference" ? "video pulito" : settings.frameRateBasis === "source" ? "video con watermark" : "da scegliere"}</strong></span></div> : null}
      <button type="button" disabled={!settings.videoUrl || !settings.referenceVideoUrl || alignmentBusy} onClick={() => void analyze()}>{alignmentBusy ? "Analisi…" : "Ricalcola sincronizzazione"}</button>
      <label className="teddy-dance-toggle"><span>Sincronizzazione temporale automatica</span><input aria-label="Sincronizzazione temporale automatica" type="checkbox" checked={settings.autoTemporalAlignment} onChange={(event) => update({ autoTemporalAlignment: event.target.checked })} /></label>
      <label>Offset video pulito: {`${settings.referenceTimeOffsetSeconds >= 0 ? "+" : ""}${settings.referenceTimeOffsetSeconds.toFixed(3)} s`}<input aria-label="Offset temporale video pulito" type="range" min={-settings.temporalSearchSeconds} max={settings.temporalSearchSeconds} step=".001" value={settings.referenceTimeOffsetSeconds} onChange={(event) => update({ referenceTimeOffsetSeconds: Number(event.target.value), autoTemporalAlignment: false })} /></label>
      {sourceLongerThanReference ? <p className="muted">Il video pulito parte dall’inizio a velocità originale. Dopo la sua fine, la parte restante resta originale.</p> : null}
      <p className="muted">Offset positivo: usa un frame successivo del video pulito. Fuori dall’intervallo disponibile, il video resta originale.</p>
      <label>Intervallo ricerca: ±{settings.temporalSearchSeconds.toFixed(1)} s<input aria-label="Intervallo ricerca temporale" type="range" min=".5" max="30" step=".5" value={settings.temporalSearchSeconds} onChange={(event) => update({ temporalSearchSeconds: Number(event.target.value) })} /></label>
      <label className="teddy-dance-toggle"><span>Riallinea ogni frame</span><input aria-label="Allineamento spaziale automatico" type="checkbox" checked={settings.autoSpatialAlignment} onChange={(event) => update({ autoSpatialAlignment: event.target.checked })} /></label>
      {settings.autoSpatialAlignment ? <>
        <label>Spostamento massimo: {settings.alignmentMaxShift} px<input aria-label="Spostamento massimo allineamento" type="range" min="4" max="120" step="1" value={settings.alignmentMaxShift} onChange={(event) => update({ alignmentMaxShift: Number(event.target.value) })} /></label>
        <label>Stabilizzazione: {Math.round(settings.alignmentSmoothing * 100)}%<input aria-label="Stabilizzazione allineamento" type="range" min="0" max=".96" step=".01" value={settings.alignmentSmoothing} onChange={(event) => update({ alignmentSmoothing: Number(event.target.value) })} /></label>
      </> : null}
    </>}
    <div className="watermark-workflow-step"><span>3</span><div><strong>Seleziona il watermark</strong><small>Trascina direttamente sulla preview oppure regola i valori qui sotto.</small></div></div>
    <div className="watermark-region-grid">
      {([["x", "X"], ["y", "Y"], ["width", "Larghezza"], ["height", "Altezza"]] as const).map(([key, label]) => <label key={key}>{label}<span><input aria-label={`Regione watermark ${label}`} type="number" min="0" max="100" step=".1" value={(settings.region[key] * 100).toFixed(1)} onChange={(event) => setRegion(key, Number(event.target.value) / 100)} />%</span></label>)}
    </div>
    <button type="button" onClick={() => update({ region: { x: .68, y: .04, width: .27, height: .14 } })}>Ripristina selezione</button>
    <button className="watermark-detail-preview-button" type="button" disabled={!settings.videoUrl || !hasReference} onClick={openStaticWatermarkDetailPreview}>⛶ Anteprima zona rimozione</button>
    <h2>Allineamento riferimento</h2>
    <label>Adattamento<select aria-label="Adattamento riferimento pulito" value={settings.referenceFit} onChange={(event) => update({ referenceFit: event.target.value as typeof settings.referenceFit })}><option value="cover">Riempi · ritaglio proporzionale</option><option value="contain">Intero · bande possibili</option><option value="stretch">Estendi al video</option></select></label>
    <label>Scala: {settings.referenceScale.toFixed(2)}×<input aria-label="Scala riferimento pulito" type="range" min=".5" max="2.5" step=".005" value={settings.referenceScale} onChange={(event) => update({ referenceScale: Number(event.target.value) })} /></label>
    <label>Spostamento orizzontale: {Math.round(settings.referenceOffsetX * 100)}%<input aria-label="Spostamento orizzontale riferimento" type="range" min="-1" max="1" step=".0025" value={settings.referenceOffsetX} onChange={(event) => update({ referenceOffsetX: Number(event.target.value) })} /></label>
    <label>Spostamento verticale: {Math.round(settings.referenceOffsetY * 100)}%<input aria-label="Spostamento verticale riferimento" type="range" min="-1" max="1" step=".0025" value={settings.referenceOffsetY} onChange={(event) => update({ referenceOffsetY: Number(event.target.value) })} /></label>
    <h2>Fusione professionale</h2>
    <label>Sfumatura esterna: {settings.feather} px<input aria-label="Sfumatura bordo watermark" type="range" min="0" max="24" step="1" value={settings.feather} onChange={(event) => update({ feather: Number(event.target.value) })} /></label>
    <p className="muted watermark-feather-note">A 0 px tutta la selezione viene sostituita senza sfumatura. Valori superiori fondono soltanto pochi pixel del video immediatamente fuori dalla selezione.</p>
    <label>Opacità patch: {Math.round(settings.patchOpacity * 100)}%<input aria-label="Opacità patch watermark" type="range" min="0" max="1" step=".01" value={settings.patchOpacity} onChange={(event) => update({ patchOpacity: Number(event.target.value) })} /></label>
    <label className="teddy-dance-toggle"><span>Uniforma luminosità automaticamente</span><input aria-label="Uniforma luminosità watermark" type="checkbox" checked={settings.colorMatch} onChange={(event) => update({ colorMatch: event.target.checked })} /></label>
    {settings.colorMatch ? <label>Intensità correzione: {Math.round(settings.colorMatchStrength * 100)}%<input aria-label="Intensità correzione colore watermark" type="range" min="0" max="1" step=".01" value={settings.colorMatchStrength} onChange={(event) => update({ colorMatchStrength: Number(event.target.value) })} /></label> : null}
    <label className="teddy-dance-toggle"><span>Mostra guida nella preview</span><input aria-label="Mostra guida watermark" type="checkbox" checked={settings.guideVisible} onChange={(event) => update({ guideVisible: event.target.checked })} /></label>
    <p className="muted">La cornice di selezione non viene inclusa nell’export.</p>
  </section>
    {frameRatePrompt ? createPortal(<div className="video-editor-tool-modal-backdrop watermark-decision-backdrop" role="presentation">
      <section className="video-editor-tool-modal watermark-decision-dialog" role="dialog" aria-modal="true" aria-labelledby="watermark-fps-title">
        <span className="watermark-decision-kicker">SINCRONIZZAZIONE VIDEO</span>
        <strong id="watermark-fps-title">I frame rate non coincidono</strong>
        <p>Video con watermark: <b>{frameRatePrompt.source.toFixed(3)} fps</b><br />Video pulito: <b>{frameRatePrompt.reference.toFixed(3)} fps</b></p>
        <p>Scegli quale cadenza mantenere. MLSM ricampionerà l’altro video sulla timeline selezionata prima dell’allineamento dei frame.</p>
        <div className="watermark-decision-actions">
          <button className="active-control" type="button" onClick={() => { update({ frameRateBasis: "source" }); setFrameRatePrompt(null); }}>Mantieni FPS video con watermark</button>
          <button type="button" onClick={() => { update({ frameRateBasis: "reference" }); setFrameRatePrompt(null); }}>Mantieni FPS video pulito</button>
        </div>
      </section>
    </div>, document.body) : null}
  </>;
}
