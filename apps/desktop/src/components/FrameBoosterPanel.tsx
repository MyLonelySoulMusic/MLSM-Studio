import { useEffect, useRef, useState, type ReactElement } from "react";
import { useProjectStore } from "../store/project-store";
import { registerFrameBoosterSourceFile, releaseFrameBoosterSourceFile } from "../services/frame-booster-source-file";
import { waitForFrameInterpolationHealth, type FrameInterpolationCapabilities, type FrameInterpolationMethod } from "../services/frame-interpolation-client";

const methodGuidance: Record<FrameInterpolationMethod, { title: string; description: string; ideal: string; avoid: string }> = {
  motion: {
    title: "Ricostruisce il movimento",
    description: "FFmpeg analizza la direzione degli oggetti e genera nuovi fotogrammi intermedi con compensazione adattiva AOBMC.",
    ideal: "persone o oggetti in movimento, sport, camera in movimento, animazioni e slow motion.",
    avoid: "tagli molto rapidi, flash, particelle fitte o oggetti che si coprono: possono comparire deformazioni locali."
  },
  "motion-obmc": {
    title: "Movimento bidirezionale OBMC",
    description: "FFmpeg usa MCI, compensazione dei blocchi sovrapposti OBMC e stima bidirezionale. Il filtro applicato è minterpolate con mc_mode=obmc e me_mode=bidir.",
    ideal: "movimenti continui, panoramiche, camera tracking e scene in cui vuoi ridurre gli stacchi visibili tra i blocchi.",
    avoid: "video ad altissima risoluzione, tagli secchi, flash e occlusioni complesse: l'analisi del moto può essere molto lenta."
  },
  blend: {
    title: "Fonde i fotogrammi vicini",
    description: "FFmpeg mescola i fotogrammi esistenti senza ricostruire il moto. È più rapido, ma può produrre scie o immagini doppie.",
    ideal: "inquadrature quasi statiche, panoramiche lente, atmosfera con motion blur ed elaborazioni veloci.",
    avoid: "movimenti rapidi, testo in movimento, bordi netti, sport e scene in cui vuoi dettagli intermedi puliti."
  }
};

function videoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
}

export function FrameBoosterPanel(): ReactElement {
  const settings = useProjectStore((state) => state.project.animation.frameBooster);
  const update = useProjectStore((state) => state.updateFrameBooster);
  const [capabilities, setCapabilities] = useState<FrameInterpolationCapabilities | null>(null);
  const [checking, setChecking] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const healthOperation = useRef(0);
  const healthController = useRef<AbortController | null>(null);
  const importOperation = useRef(0);
  const importCleanup = useRef<(() => void) | null>(null);
  const mounted = useRef(true);

  const check = async () => {
    healthController.current?.abort();
    const controller = new AbortController();
    healthController.current = controller;
    const owner = ++healthOperation.current;
    setChecking(true);
    try {
      const result = await waitForFrameInterpolationHealth({ timeoutMs: 15_000, signal: controller.signal });
      if (!mounted.current || healthOperation.current !== owner) return;
      setCapabilities(result);
      setRuntimeError(result ? null : "Il backend non è partito entro 15 secondi. Riavvia MLSM Studio e premi Ricontrolla backend.");
    } finally {
      if (mounted.current && healthOperation.current === owner) {
        healthController.current = null;
        setChecking(false);
      }
    }
  };

  useEffect(() => {
    // React StrictMode esegue setup → cleanup → setup in sviluppo. Il cleanup
    // precedente marca correttamente l'istanza come smontata; il nuovo setup
    // deve riaprire esplicitamente l'ownership, altrimenti la risposta health
    // viene ignorata e `checking` resta true per sempre.
    mounted.current = true;
    const reset = () => {
      importOperation.current += 1;
      importCleanup.current?.();
      importCleanup.current = null;
      setImportError(null);
      setImportNotice(null);
    };
    window.addEventListener("frame-booster:reset", reset);
    void check();
    return () => {
      window.removeEventListener("frame-booster:reset", reset);
      mounted.current = false;
      healthController.current?.abort();
      healthController.current = null;
      healthOperation.current += 1;
      importOperation.current += 1;
      importCleanup.current?.();
      importCleanup.current = null;
    };
  }, []);

  const upload = (file: File) => {
    if (!videoFile(file)) {
      setImportError("Seleziona un file video valido.");
      return;
    }
    importCleanup.current?.();
    importCleanup.current = null;
    const owner = ++importOperation.current;
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const previousUrl = useProjectStore.getState().project.animation.frameBooster.sourceUrl;
    registerFrameBoosterSourceFile(url, file);
    update({
      sourceUrl: url, sourceName: file.name, sourceWidth: 0, sourceHeight: 0,
      sourceDurationSeconds: 0, sourceFps: null, sourceFrameCount: null,
      sourceHasAudio: false, lastOutput: null
    });
    releaseFrameBoosterSourceFile(previousUrl);
    setImportError(null);
    setImportNotice("Video caricato. Rilevamento dei metadati in corso…");
    video.preload = "metadata";
    video.muted = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const dispose = () => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    const finish = (notice: string | null) => {
      if (!mounted.current || importOperation.current !== owner) {
        dispose();
        return;
      }
      if (importCleanup.current) importCleanup.current = null;
      setImportNotice(notice);
      dispose();
    };
    importCleanup.current = dispose;
    video.onloadedmetadata = () => {
      if (mounted.current && importOperation.current === owner && useProjectStore.getState().project.animation.frameBooster.sourceUrl === url) {
        update({
          sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
          sourceDurationSeconds: Number.isFinite(video.duration) ? video.duration : 0
        });
      }
      finish(null);
    };
    video.onerror = () => {
      finish("Video caricato. I dettagli tecnici verranno rilevati dal backend prima dell’elaborazione.");
    };
    video.src = url;
    timeout = setTimeout(() => finish("Video caricato. I dettagli tecnici verranno rilevati dal backend prima dell’elaborazione."), 8_000);
    video.load();
  };

  const runtimeReady = Boolean(capabilities?.ffmpeg);
  const selectedMethod: FrameInterpolationMethod = settings.method === "blend" || settings.method === "motion-obmc" ? settings.method : "motion";
  const guidance = methodGuidance[selectedMethod];
  const runtimeLabel = checking ? "Avvio…" : runtimeReady ? "Pronto" : "Non disponibile";
  return <section className="frame-booster-panel">
    <header className="frame-booster-heading">
      <div><span>Interpolazione video</span><h2>Frame Booster</h2></div>
      <span className={`frame-booster-runtime-dot ${runtimeReady ? "is-ready" : ""}`}>{runtimeLabel}</span>
    </header>
    <p className="muted">Aumenta i fotogrammi preservando risoluzione, rapporto e audio originale.</p>
    <label className="frame-booster-upload">
      <strong>{settings.sourceName ? "Sostituisci video" : "Scegli un video"}</strong>
      <span>MP4, MOV, WebM, MKV o AVI</span>
      <input aria-label="Carica video Frame Booster" type="file" accept="video/*,.mkv,.avi" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) upload(file);
        event.target.value = "";
      }} />
    </label>
    {importError ? <p className="status-error" role="alert">{importError}</p> : null}
    {importNotice ? <p className="muted" role="status">{importNotice}</p> : null}
    {settings.sourceName ? <div className="frame-booster-source"><strong>{settings.sourceName}</strong><span>{settings.sourceWidth > 0 && settings.sourceHeight > 0 ? `${settings.sourceWidth} × ${settings.sourceHeight}` : "Dimensioni rilevate dal server"}{settings.sourceDurationSeconds > 0 ? ` · ${settings.sourceDurationSeconds.toFixed(2)} s` : ""}{settings.sourceFps ? ` · ${settings.sourceFps.toFixed(3)} fps` : " · FPS rilevati dal server"}</span></div> : null}
    <div className="frame-booster-method-control">
      <label>Metodo<select aria-label="Metodo Frame Booster" value={selectedMethod} onChange={(event) => update({ method: event.target.value as FrameInterpolationMethod })}><option value="motion">Motion AOBMC · FFmpeg</option><option value="motion-obmc">Motion OBMC bidirezionale · FFmpeg</option><option value="blend">Frame blend · FFmpeg</option></select></label>
      <div className="frame-booster-method-guide" aria-live="polite">
        <strong>{guidance.title}</strong>
        <p>{guidance.description}</p>
        <span><b>Ideale per:</b> {guidance.ideal}</span>
        <span><b>Meglio evitarlo con:</b> {guidance.avoid}</span>
      </div>
    </div>
    <div className="frame-booster-controls">
      <label>Target<select aria-label="Target Frame Booster" value={settings.targetMode} onChange={(event) => update({ targetMode: event.target.value as typeof settings.targetMode })}><option value="multiplier">Moltiplicatore</option><option value="fps">FPS diretto</option></select></label>
      {settings.targetMode === "multiplier" ? <label>Moltiplicatore<select aria-label="Moltiplicatore Frame Booster" value={settings.targetMultiplier} onChange={(event) => update({ targetMultiplier: Number(event.target.value) as typeof settings.targetMultiplier })}>{[2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label> : <label>FPS target<input aria-label="FPS target Frame Booster" type="number" min="1" max="480" step=".01" value={settings.targetFps} onChange={(event) => update({ targetFps: Number(event.target.value) })} /></label>}
    </div>
    <div className={`frame-booster-capability ${runtimeReady ? "is-ready" : "is-warning"}`}>
      <strong>{checking ? "Avvio del runtime…" : capabilities?.ffmpeg ? "FFmpeg pronto" : "Backend non disponibile"}</strong>
      <span>{runtimeError ?? (capabilities?.ffmpeg ? "Motion AOBMC, Motion OBMC e Frame blend sono pronti." : "Avvio automatico del servizio locale in corso.")}</span>
      <button type="button" onClick={() => void check()} disabled={checking}>Ricontrolla backend</button>
    </div>
  </section>;
}
