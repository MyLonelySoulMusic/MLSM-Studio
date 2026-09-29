import { useEffect, useRef, useState, type ReactElement } from "react";
import { useProjectStore } from "../store/project-store";
import { registerFrameBoosterSourceFile, releaseFrameBoosterSourceFile } from "../services/frame-booster-source-file";
import { probeFrameInterpolationSource, waitForFrameInterpolationHealth, type FrameInterpolationCapabilities, type FrameInterpolationMethod } from "../services/frame-interpolation-client";
import { shutdownAreaPythonServices } from "../services/python-service-lifecycle";
import {
  pythonUpscalerRuntimeDiagnostic,
  subscribePythonUpscalerRuntimeDiagnostic,
  type PythonUpscalerRuntimeDiagnostic,
} from "../services/upscaler-python-client";

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

function fpsLabel(value: number): string {
  return Number(value.toFixed(3)).toString();
}

const runtimeStartupPhases = new Set<PythonUpscalerRuntimeDiagnostic["phase"]>(["probing", "starting", "waiting"]);
const runtimePhaseLabels: Record<PythonUpscalerRuntimeDiagnostic["phase"], string> = {
  idle: "In attesa",
  probing: "Verifica del runtime",
  starting: "Avvio del backend",
  waiting: "Caricamento Python in corso",
  ready: "Backend pronto",
  error: "Avvio non riuscito",
};

function diagnosticTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function FrameBoosterPanel(): ReactElement {
  const settings = useProjectStore((state) => state.project.animation.frameBooster);
  const update = useProjectStore((state) => state.updateFrameBooster);
  const [capabilities, setCapabilities] = useState<FrameInterpolationCapabilities | null>(null);
  const [checking, setChecking] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [runtimeDiagnostic, setRuntimeDiagnostic] = useState<PythonUpscalerRuntimeDiagnostic>(() => pythonUpscalerRuntimeDiagnostic());
  const [runtimeCheckStartedAt, setRuntimeCheckStartedAt] = useState<number | null>(null);
  const [runtimeNow, setRuntimeNow] = useState(() => Date.now());
  const healthOperation = useRef(0);
  const healthController = useRef<AbortController | null>(null);
  const importOperation = useRef(0);
  const importCleanup = useRef<(() => void) | null>(null);
  const probeController = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const check = async () => {
    healthController.current?.abort();
    const controller = new AbortController();
    healthController.current = controller;
    const owner = ++healthOperation.current;
    setChecking(true);
    setCapabilities(null);
    setRuntimeError(null);
    setRuntimeCheckStartedAt(Date.now());
    setRuntimeNow(Date.now());
    try {
      const result = await waitForFrameInterpolationHealth({ timeoutMs: 60_000, signal: controller.signal });
      if (!mounted.current || healthOperation.current !== owner) return;
      setCapabilities(result);
      const diagnostic = pythonUpscalerRuntimeDiagnostic();
      setRuntimeDiagnostic(result?.ffmpeg && result.jobs ? { ...diagnostic, phase: "ready" } : diagnostic);
      setRuntimeError(result ? null : diagnostic.message);
    } catch (error) {
      if (controller.signal.aborted || !mounted.current || healthOperation.current !== owner) return;
      setRuntimeError(`Avvio del backend non riuscito: ${error instanceof Error ? error.message : String(error)}`);
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
    // deve riaprire esplicitamente l’ownership, altrimenti la risposta health
    // viene ignorata e `checking` resta true per sempre.
    mounted.current = true;
    const unsubscribeRuntimeDiagnostic = subscribePythonUpscalerRuntimeDiagnostic((diagnostic) => {
      if (!mounted.current) return;
      setRuntimeDiagnostic(diagnostic);
      if (runtimeStartupPhases.has(diagnostic.phase)) {
        setRuntimeCheckStartedAt((startedAt) => startedAt ?? diagnosticTimestamp(diagnostic.at) ?? Date.now());
      }
    });
    const reset = () => {
      importOperation.current += 1;
      importCleanup.current?.();
      importCleanup.current = null;
      probeController.current?.abort();
      probeController.current = null;
      setImportError(null);
      setImportNotice(null);
    };
    window.addEventListener("frame-booster:reset", reset);
    void check();
    return () => {
      window.removeEventListener("frame-booster:reset", reset);
      unsubscribeRuntimeDiagnostic();
      mounted.current = false;
      healthController.current?.abort();
      healthController.current = null;
      healthOperation.current += 1;
      importOperation.current += 1;
      importCleanup.current?.();
      importCleanup.current = null;
      probeController.current?.abort();
      probeController.current = null;
      // Frame Booster owns the local Python runtime while this mode is open.
      // Releasing it here makes mode changes stop the .venv process; a later
      // mount waits for this shutdown and starts a fresh owned process.
      void shutdownAreaPythonServices("frame-booster-unmount");
    };
  }, []);

  const upload = (file: File) => {
    if (!videoFile(file)) {
      setImportError("Seleziona un file video valido.");
      return;
    }
    importCleanup.current?.();
    importCleanup.current = null;
    probeController.current?.abort();
    const metadataController = new AbortController();
    probeController.current = metadataController;
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
      if (notice !== null) setImportNotice(notice);
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
    void probeFrameInterpolationSource(file, metadataController.signal).then((metadata) => {
      if (!mounted.current || importOperation.current !== owner || useProjectStore.getState().project.animation.frameBooster.sourceUrl !== url) return;
      update({
        sourceFps: metadata.fps,
        sourceFrameCount: metadata.frameCount,
        sourceWidth: metadata.width,
        sourceHeight: metadata.height,
        sourceDurationSeconds: metadata.durationSeconds,
        sourceHasAudio: metadata.hasAudio,
      });
      setImportNotice(`Metadati rilevati · ${fpsLabel(metadata.fps)} fps · ${metadata.frameCount} frame · ${metadata.hasAudio ? "audio presente" : "senza audio"}`);
    }).catch((error) => {
      if (metadataController.signal.aborted || !mounted.current || importOperation.current !== owner) return;
      setImportNotice(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (probeController.current === metadataController) probeController.current = null;
      if (mounted.current) setRuntimeDiagnostic(pythonUpscalerRuntimeDiagnostic());
    });
  };

  const runtimeReady = Boolean(capabilities?.ffmpeg && capabilities.jobs && runtimeDiagnostic.phase === "ready");
  const runtimeStartupActive = checking || runtimeStartupPhases.has(runtimeDiagnostic.phase);
  const runtimeTerminalMessage = runtimeError ?? (runtimeDiagnostic.phase === "error" ? runtimeDiagnostic.message : null);
  const runtimeElapsedSeconds = runtimeCheckStartedAt === null
    ? 0
    : Math.max(0, Math.floor((runtimeNow - runtimeCheckStartedAt) / 1_000));
  const runtimeRecentLogs = runtimeDiagnostic.recentLogs ?? [];
  useEffect(() => {
    if (!runtimeStartupActive) return;
    setRuntimeNow(Date.now());
    const timer = window.setInterval(() => setRuntimeNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [runtimeStartupActive]);
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
      <input aria-label="Carica video Frame Booster" type="file" accept="video/*,.mkv,.avi" onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) upload(file);
      }} />
    </label>
    {importError ? <p className="status-error" role="alert">{importError}</p> : null}
    {importNotice ? <p className="muted" role="status">{importNotice}</p> : null}
    {settings.sourceName ? <div className="frame-booster-source"><strong>{settings.sourceName}</strong><span>{settings.sourceWidth > 0 && settings.sourceHeight > 0 ? `${settings.sourceWidth} × ${settings.sourceHeight}` : "Dimensioni in rilevamento"}{settings.sourceDurationSeconds > 0 ? ` · ${settings.sourceDurationSeconds.toFixed(2)} s` : ""}{settings.sourceFps ? ` · ${fpsLabel(settings.sourceFps)} fps` : " · rilevamento FPS in corso…"}</span></div> : null}
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
    {runtimeStartupActive ? <div className="frame-booster-runtime-startup" role="status" aria-live="polite">
      <div className="frame-booster-runtime-startup__heading">
        <span className="frame-booster-runtime-spinner" aria-hidden="true" />
        <div>
          <strong>Avvio del backend locale</strong>
          <span>{runtimePhaseLabels[runtimeDiagnostic.phase]} · {runtimeElapsedSeconds} s</span>
        </div>
      </div>
      <div className="frame-booster-runtime-progress" role="progressbar" aria-label="Avanzamento avvio backend" />
      <p>{runtimeDiagnostic.message}</p>
      {runtimeDiagnostic.logPath ? <p className="frame-booster-runtime-log-path">Log: <code>{runtimeDiagnostic.logPath}</code></p> : null}
      <details className="frame-booster-runtime-logs">
        <summary>Log recenti ({runtimeRecentLogs.length})</summary>
        <pre>{runtimeRecentLogs.length > 0 ? runtimeRecentLogs.join("\n") : "Nessun log ricevuto dal backend."}</pre>
      </details>
      <button type="button" onClick={() => void check()}>Riprova avvio</button>
    </div> : null}
    <div className={`frame-booster-capability ${runtimeReady ? "is-ready" : runtimeTerminalMessage ? "is-error" : "is-warning"}`}>
      <strong>{runtimeReady ? "FFmpeg pronto" : runtimeTerminalMessage ? "Backend non disponibile" : checking ? "Avvio del runtime…" : "Backend non disponibile"}</strong>
      <span>{runtimeTerminalMessage ?? (runtimeReady ? "Motion AOBMC, Motion OBMC e Frame blend sono pronti." : "Avvio automatico del servizio locale in corso. I metodi FFmpeg non richiedono download di modelli.")}</span>
      {runtimeTerminalMessage && runtimeDiagnostic.logPath ? <span>Controlla il log del backend e premi Riprova backend.</span> : null}
      <button type="button" onClick={() => void check()} disabled={checking}>Riprova backend</button>
    </div>
    <details className="frame-booster-diagnostics">
      <summary>Diagnostica backend</summary>
      <dl>
        <div><dt>Endpoint</dt><dd>http://127.0.0.1:8765</dd></div>
        <div><dt>Stato</dt><dd>{runtimeDiagnostic.phase}</dd></div>
        <div><dt>Ultimo evento</dt><dd>{runtimeDiagnostic.message}</dd></div>
        {runtimeDiagnostic.pid ? <div><dt>PID</dt><dd>{runtimeDiagnostic.pid}</dd></div> : null}
        {runtimeDiagnostic.logPath ? <div><dt>Log</dt><dd><code>{runtimeDiagnostic.logPath}</code></dd></div> : null}
        {runtimeRecentLogs.length > 0 ? <div><dt>Log recenti</dt><dd>{runtimeRecentLogs.length}</dd></div> : null}
        <div><dt>Ora</dt><dd>{runtimeDiagnostic.at}</dd></div>
      </dl>
      {!runtimeStartupActive && runtimeRecentLogs.length > 0 ? <pre className="frame-booster-runtime-log-output">{runtimeRecentLogs.join("\n")}</pre> : null}
    </details>
  </section>;
}
