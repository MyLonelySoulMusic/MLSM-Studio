import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import {
  extractMlxDlssNeuralModel,
  importMlxDlssModel,
  installMlxDlss,
  waitForMlxDlssInstall,
  type MlxDlssCapabilities,
  type MlxDlssInstallStatus,
  type MlxDlssModel,
} from "../services/mlx-dlss-client";

interface MlxDlssSetupModalProps {
  open: boolean;
  capabilities: MlxDlssCapabilities | null;
  loading: boolean;
  connectionError: string;
  selectedModel: string | null;
  onCapabilities: (value: MlxDlssCapabilities) => void;
  onRefresh: () => Promise<void>;
  onSelectModel: (modelId: string) => void;
  onClose: () => void;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function MlxDlssSetupModal({ open, capabilities, loading, connectionError, selectedModel, onCapabilities, onRefresh, onSelectModel, onClose }: MlxDlssSetupModalProps) {
  const [installStatus, setInstallStatus] = useState<MlxDlssInstallStatus | null>(null);
  const [busyImport, setBusyImport] = useState(false);
  const [actionError, setActionError] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const errorPanel = useRef<HTMLDivElement>(null);
  const models = useMemo(() => capabilities?.models.filter((model) => model.kind === "neural-rendering") ?? [], [capabilities]);
  const effectiveModel = models.some((model) => model.id === selectedModel) ? selectedModel : models[0]?.id ?? null;
  const installing = Boolean(installStatus && !["idle", "ready", "error"].includes(installStatus.phase));
  const xcodeMissing = Boolean(capabilities?.manualInstallTools.includes("Xcode completo"));
  const xcodeLicensePending = Boolean(capabilities?.manualInstallTools.includes("Licenza Xcode"));

  useEffect(() => {
    if (open) void onRefresh();
  }, [open, onRefresh]);

  useEffect(() => {
    if (open && actionError) errorPanel.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [open, actionError]);

  useEffect(() => {
    const saved = capabilities?.installStatus;
    if (!open || !saved) return;
    setInstallStatus(saved);
    if (saved.phase === "error") {
      setActionError(saved.error || saved.message);
      return;
    }
    if (saved.phase === "ready") {
      setActionError("");
      return;
    }
    if (saved.phase === "idle") return;
    const controller = new AbortController();
    void waitForMlxDlssInstall(controller.signal, setInstallStatus).then(onCapabilities).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      const message = messageOf(reason);
      setActionError(message);
      setInstallStatus({ phase: "error", progress: 0, message, error: message });
    });
    return () => controller.abort();
  }, [open, capabilities?.installStatus, onCapabilities]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !installing && !busyImport) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busyImport, installing, onClose, open]);

  if (!open) return null;

  const processModel = async (file: File) => {
    setBusyImport(true); setActionError("");
    try {
      const value = file.name.toLowerCase() === "nvngx_dlssnr.dll"
        ? await extractMlxDlssNeuralModel(file)
        : await importMlxDlssModel(file, "neural-rendering");
      const imported = value.models.filter((model: MlxDlssModel) => model.kind === "neural-rendering").at(-1);
      onCapabilities(value);
      if (!imported) throw new Error("Il modello Neural Rendering non è stato registrato.");
      onSelectModel(imported.id);
      setPendingFile(null);
    } catch (reason) {
      setActionError(messageOf(reason));
    } finally {
      setBusyImport(false);
    }
  };

  const install = async () => {
    setActionError("");
    setInstallStatus({ phase: "preparing", progress: 0, message: "Avvio installazione…" });
    try {
      const value = await installMlxDlss(undefined, setInstallStatus);
      onCapabilities(value);
      if (pendingFile) await processModel(pendingFile);
    } catch (reason) {
      const message = messageOf(reason);
      setActionError(message);
      setInstallStatus({ phase: "error", progress: 0, message, error: message });
    }
  };

  const importModel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.name.toLowerCase() !== "nvngx_dlssnr.dll" && !file.name.toLowerCase().endsWith(".dlssmodel")) {
      setActionError("Seleziona nvngx_dlssnr.dll oppure un file .dlssmodel.");
      return;
    }
    setPendingFile(file); setActionError("");
    if (runtimeReady) await processModel(file);
  };

  const canClose = !installing && !busyImport;
  const runtimeReady = Boolean(capabilities?.usable);
  const modelReady = runtimeReady && Boolean(effectiveModel);
  return createPortal(<div className="mlx-dlss-setup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && canClose) onClose(); }}>
    <section className="mlx-dlss-setup-modal" role="dialog" aria-modal="true" aria-labelledby="mlx-dlss-setup-title" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><small>UPSCALER · APPLE SILICON</small><h2 id="mlx-dlss-setup-title">Configura MLX-DLSS 5</h2><p>Installa il motore Metal isolato e importa il modello Neural Rendering dalla DLL NVIDIA. I file restano soltanto sul Mac.</p></div>
        <button type="button" aria-label="Chiudi configurazione MLX-DLSS" disabled={!canClose} onClick={onClose}>×</button>
      </header>

      <div className="mlx-dlss-setup-steps">
        <section className={runtimeReady ? "is-complete" : "is-current"}>
          <span className="mlx-dlss-step-number">1</span>
          <div><strong>Motore MLX-DLSS</strong><p>Backend Swift/Metal, strumenti di estrazione e ambiente Python 3.11.</p></div>
          <b>{runtimeReady ? "Pronto" : installing ? `${Math.round((installStatus?.progress ?? 0) * 100)}%` : installStatus?.phase === "error" ? "Errore" : "Da installare"}</b>
        </section>
        <section className={modelReady ? "is-complete" : runtimeReady ? "is-current" : ""}>
          <span className="mlx-dlss-step-number">2</span>
          <div><strong>Modello Neural Rendering</strong><p>Carica `nvngx_dlssnr.dll`; MLSM estrae e conserva soltanto il modello necessario.</p></div>
          <b>{modelReady ? "Pronto" : "Da importare"}</b>
        </section>
      </div>

      <div className="mlx-dlss-setup-body">
        {actionError ? <div ref={errorPanel} className="mlx-dlss-setup-error" role="alert"><strong>Configurazione non completata</strong><p>{actionError}</p><p>Il dettaglio è conservato nel log locale dell’installazione.</p><button type="button" onClick={() => setActionError("")}>Chiudi avviso</button></div> : null}
        {loading ? <div className="mlx-dlss-setup-wait" role="status"><span className="mlx-dlss-spinner" /><strong>Avvio del servizio Upscaler…</strong><p>Verifica del Mac e del runtime locale in corso.</p></div> : null}
        {!loading && connectionError ? <div className="mlx-dlss-setup-error" role="alert"><strong>Servizio locale non raggiungibile</strong><p>{connectionError}</p><button type="button" onClick={() => void onRefresh()}>Riprova connessione</button></div> : null}
        {!loading && capabilities && !capabilities.supported ? <div className="mlx-dlss-setup-error" role="alert"><strong>Questo Mac non soddisfa i requisiti</strong><p>{capabilities.reason || `Richiesti Apple Silicon e macOS ${capabilities.minimumMacOS} o successivo.`}</p></div> : null}

        {!loading && capabilities?.supported && !runtimeReady ? <div className="mlx-dlss-setup-action">
          <div><strong>{capabilities.installed ? "Ripara il motore locale" : "Installa il motore locale"}</strong><p>L’installazione scarica i sorgenti ufficiali MLX-DLSS e prepara il backend Metal fuori dal progetto.</p></div>
          {capabilities.manualInstallTools.length ? <p className="mlx-dlss-setup-requirements">Prima installa manualmente: {capabilities.manualInstallTools.join(", ")}.</p> : null}
          {capabilities.automaticInstallTools.length ? <p className="mlx-dlss-setup-requirements">Installazione automatica inclusa: {capabilities.automaticInstallTools.join(", ")}.</p> : null}
          {capabilities.automaticInstallTools.includes("Metal Toolchain") ? <p className="mlx-dlss-setup-requirements">Il simulatore iOS non è necessario: MLSM scaricherà il compilatore Metal richiesto prima della build.</p> : null}
          {xcodeMissing ? <div className="mlx-dlss-setup-prerequisite-actions"><a href="https://apps.apple.com/app/xcode/id497799835" target="_blank" rel="noreferrer">Scarica Xcode dall’App Store ↗</a><button type="button" onClick={() => { setActionError(""); void onRefresh(); }}>Ho installato Xcode · verifica</button></div> : null}
          {xcodeLicensePending ? <div className="mlx-dlss-setup-license"><p>Xcode è installato. Accetta una volta la licenza dal Terminale:</p><code>sudo xcodebuild -license accept</code><button type="button" onClick={() => { setActionError(""); void onRefresh(); }}>Ho accettato la licenza · verifica</button></div> : null}
          <button type="button" className="primary" disabled={installing} onClick={() => void install()}>{installing ? installStatus?.message || "Installazione…" : capabilities.installed ? "Ripara / aggiorna" : capabilities.installReady ? "Installa MLX-DLSS" : "Installa prerequisiti e MLX-DLSS"}</button>
          {installing ? <progress max="1" value={installStatus?.progress ?? 0} aria-label="Installazione MLX-DLSS" /> : null}
          {installing && installStatus?.detail ? <p role="status" style={{ overflowWrap: "anywhere" }}>{installStatus.detail}</p> : null}
        </div> : null}

        {!loading && capabilities && !runtimeReady ? <div className="mlx-dlss-setup-action">
          <div><strong>Carica la DLL DLSS 5</strong><p>Puoi selezionare subito <code>nvngx_dlssnr.dll</code>. Rimarrà in attesa e verrà estratta automaticamente appena il motore sarà pronto.</p></div>
          <input ref={fileInput} className="mlx-dlss-setup-file" aria-label="Carica DLL DLSS 5" type="file" accept=".dll,.dlssmodel" onChange={(event) => void importModel(event)} />
          <button type="button" className="primary" disabled={busyImport} onClick={() => fileInput.current?.click()}>{pendingFile ? `DLL selezionata · ${pendingFile.name}` : "Scegli nvngx_dlssnr.dll"}</button>
          {pendingFile ? <p className="mlx-dlss-setup-queued" role="status">File pronto. Dopo l’installazione l’estrazione partirà automaticamente.</p> : null}
        </div> : null}

        {!loading && runtimeReady ? <div className="mlx-dlss-setup-action">
          <div><strong>Carica la DLL DLSS 5</strong><p>Seleziona esattamente <code>nvngx_dlssnr.dll</code>. In alternativa puoi importare un file <code>NeuralRendering.dlssmodel</code> già estratto.</p></div>
          <input ref={fileInput} className="mlx-dlss-setup-file" aria-label="Carica DLL DLSS 5" type="file" accept=".dll,.dlssmodel" onChange={(event) => void importModel(event)} />
          <button type="button" className="primary" disabled={busyImport} onClick={() => fileInput.current?.click()}>{busyImport ? "Estrazione del modello…" : "Scegli nvngx_dlssnr.dll"}</button>
          {busyImport ? <div className="mlx-dlss-setup-importing" role="status"><span className="mlx-dlss-spinner" /><span>Analisi DLL ed estrazione Neural Rendering. Può richiedere qualche minuto.</span></div> : null}
          {models.length ? <label>Modello Neural Rendering<select aria-label="Modello Neural Rendering MLX-DLSS" value={effectiveModel ?? ""} onChange={(event) => onSelectModel(event.target.value)}>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label> : null}
        </div> : null}

      </div>

      <footer><span>{modelReady ? "MLX-DLSS è configurato e pronto per essere usato." : "Completa i due passaggi per attivare il modello."}</span><button type="button" disabled={!canClose} onClick={onClose}>Annulla</button><button type="button" className="primary" disabled={!modelReady || !canClose} onClick={() => { if (effectiveModel) onSelectModel(effectiveModel); onClose(); }}>Usa MLX-DLSS</button></footer>
    </section>
  </div>, document.body);
}
