import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  cancelLongCatVideoJob, chooseLongCatInput, chooseLongCatOutputDirectory, getLongCatVideoCapabilities,
  getLongCatVideoJob, isLongCatVideoTerminal, longCatVideoPreviewUrl, startLongCatVideoJob,
  type LongCatVideoCapabilities, type LongCatVideoJob, type LongCatVideoMode, type LongCatVideoStartRequest
} from "../services/longcat-video-native";
import {
  cancelRemoteLongCatVideoJob, checkLongCatRemoteEndpoints, chooseRemoteLongCatInput,
  createLongCatRemoteEndpoint, getRemoteLongCatVideoJob, loadLongCatRemoteEndpoints,
  materializeRemoteLongCatResult, openLongCatColabNotebook, revokeRemoteLongCatResult,
  saveLongCatRemoteEndpoints, startRemoteLongCatVideoJob,
  type LongCatRemoteEndpoint, type LongCatRemoteEndpointStatus
} from "../services/longcat-video-remote";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";

const defaultNegativePrompt = "overexposed, static, blurred details, subtitles, worst quality, low quality, JPEG artifacts, deformed, disfigured";
const initialCapabilities: LongCatVideoCapabilities = {
  desktop: false, ready: false, platformSupported: false, runtimeReady: false, repositoryReady: false,
  checkpointReady: false, cudaReady: false, gpuName: null, revision: "6b3f4b8582a8bc3f20f795735f5383716c4ba794",
  reason: null, setupCommand: "npm run longcat-video:setup"
};
const modeLabels: Record<LongCatVideoMode, { label: string; description: string }> = {
  textToVideo: { label: "Text to Video", description: "Genera una scena completa partendo dal prompt." },
  imageToVideo: { label: "Image to Video", description: "Anima una fotografia mantenendone soggetto e proporzioni." },
  videoContinuation: { label: "Video Continuation", description: "Continua il movimento e il contenuto di un video esistente." }
};
type ExecutionMode = "local" | "remote";
type Backend = { kind: "local" } | { kind: "remote"; endpoint: LongCatRemoteEndpoint };
type ActiveJob = { id: string; backend: Backend };

function basename(path: string): string {
  if (path.startsWith("mlsm-upload:") || path.startsWith("mlsm-remote-input:")) return decodeURIComponent(path.split(":").at(-1) ?? path);
  return path.split(/[\\/]/).at(-1) ?? path;
}
function outputLabel(path: string): string { return path === "mlsm-browser-download" ? "Download del browser" : path; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function LongCatVideoWorkspace({ onHome }: { onHome?: () => void }): ReactElement {
  const { language } = useUiPreferences(); const copy = uiCopy[language];
  const [capabilities, setCapabilities] = useState(initialCapabilities); const [checking, setChecking] = useState(true);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("local");
  const [endpoints, setEndpoints] = useState<LongCatRemoteEndpoint[]>(() => loadLongCatRemoteEndpoints());
  const [selectedEndpointId, setSelectedEndpointId] = useState(() => loadLongCatRemoteEndpoints()[0]?.id ?? "");
  const [endpointDraft, setEndpointDraft] = useState("");
  const [endpointStatuses, setEndpointStatuses] = useState<Record<string, LongCatRemoteEndpointStatus>>({});
  const [checkingRemote, setCheckingRemote] = useState(false);
  const [mode, setMode] = useState<LongCatVideoMode>("textToVideo");
  const [prompt, setPrompt] = useState(""); const [negativePrompt, setNegativePrompt] = useState(defaultNegativePrompt);
  const [inputPath, setInputPath] = useState(""); const [outputDirectory, setOutputDirectory] = useState("");
  const [ratio, setRatio] = useState("16:9"); const [resolution, setResolution] = useState<"480p" | "720p">("480p");
  const [quality, setQuality] = useState<"fast" | "quality">("fast"); const [numFrames, setNumFrames] = useState(93);
  const [seed, setSeed] = useState(42); const [enableCompile, setEnableCompile] = useState(false);
  const [job, setJob] = useState<LongCatVideoJob | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const activeJobRef = useRef<ActiveJob | null>(null); const operationRef = useRef(0); const abortRef = useRef<AbortController | null>(null);
  const resultPathRef = useRef<string | undefined>(undefined);

  const selectedEndpoint = endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null;
  const selectedStatus = selectedEndpoint ? endpointStatuses[selectedEndpoint.id] : undefined;
  const remoteReady = Boolean(selectedEndpoint?.enabled && selectedStatus?.ok && selectedStatus.capabilities?.ready && !selectedStatus.capabilities.busy);
  const running = job?.status === "queued" || job?.status === "running";
  const backendReady = executionMode === "local" ? capabilities.ready : remoteReady;

  useEffect(() => {
    saveLongCatRemoteEndpoints(endpoints);
    if (endpoints.length && !endpoints.some((item) => item.id === selectedEndpointId)) setSelectedEndpointId(endpoints[0]!.id);
  }, [endpoints, selectedEndpointId]);
  useEffect(() => {
    const current = job?.result?.path;
    if (resultPathRef.current && resultPathRef.current !== current) revokeRemoteLongCatResult(resultPathRef.current);
    resultPathRef.current = current;
  }, [job?.result?.path]);

  const refreshCapabilities = useCallback(async () => {
    const operation = ++operationRef.current; setChecking(true); setNotice(null);
    try { const next = await getLongCatVideoCapabilities(); if (operation === operationRef.current) setCapabilities(next); }
    catch (error) { if (operation === operationRef.current) setNotice(errorMessage(error)); }
    finally { if (operation === operationRef.current) setChecking(false); }
  }, []);
  const cancelBackend = useCallback(async (active: ActiveJob): Promise<void> => {
    if (active.backend.kind === "remote") await cancelRemoteLongCatVideoJob(active.backend.endpoint, active.id).then(() => undefined);
    else await cancelLongCatVideoJob(active.id).then(() => undefined);
  }, []);
  useEffect(() => {
    void refreshCapabilities();
    return () => {
      operationRef.current += 1; abortRef.current?.abort(); const active = activeJobRef.current;
      if (active) void cancelBackend(active).catch(() => undefined);
      if (resultPathRef.current) revokeRemoteLongCatResult(resultPathRef.current);
    };
  }, [cancelBackend, refreshCapabilities]);

  const verifyRemote = useCallback(async () => {
    const operation = ++operationRef.current; const controller = new AbortController(); abortRef.current?.abort(); abortRef.current = controller;
    setCheckingRemote(true); setNotice(null);
    try {
      const statuses = await checkLongCatRemoteEndpoints(endpoints, controller.signal);
      if (operation === operationRef.current) setEndpointStatuses(Object.fromEntries(statuses.map((status) => [status.endpoint.id, status])));
    } catch (error) { if (operation === operationRef.current && !controller.signal.aborted) setNotice(errorMessage(error)); }
    finally { if (operation === operationRef.current) { setCheckingRemote(false); abortRef.current = null; } }
  }, [endpoints]);

  const poll = useCallback(async (active: ActiveJob, operation: number, output: string, signal: AbortSignal) => {
    while (operation === operationRef.current && !signal.aborted) {
      const next = active.backend.kind === "remote"
        ? await getRemoteLongCatVideoJob(active.backend.endpoint, active.id, signal)
        : await getLongCatVideoJob(active.id);
      if (operation !== operationRef.current || signal.aborted) return;
      if (isLongCatVideoTerminal(next.status)) {
        activeJobRef.current = null;
        if (active.backend.kind === "remote" && next.status === "completed") setJob(await materializeRemoteLongCatResult(active.backend.endpoint, next, output, signal));
        else setJob(next);
        return;
      }
      setJob(next); await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
  }, []);

  const chooseInput = async () => {
    if (mode === "textToVideo") return;
    try { const selected = executionMode === "remote" ? await chooseRemoteLongCatInput(mode) : await chooseLongCatInput(mode); if (selected) setInputPath(selected); }
    catch (error) { setNotice(errorMessage(error)); }
  };
  const chooseOutput = async () => { try { const selected = await chooseLongCatOutputDirectory(); if (selected) setOutputDirectory(selected); } catch (error) { setNotice(errorMessage(error)); } };
  const buildRequest = (): LongCatVideoStartRequest => {
    const common = { prompt: prompt.trim(), negativePrompt: negativePrompt.trim(), outputDirectory, numFrames, numInferenceSteps: quality === "fast" ? 16 : 50, guidanceScale: quality === "fast" ? 1 : 4, seed: Math.trunc(seed), useDistill: quality === "fast", enableCompile };
    if (mode === "imageToVideo") return { ...common, mode, inputPath, resolution };
    if (mode === "videoContinuation") return { ...common, mode, inputPath, resolution, numCondFrames: 13 };
    const [width, height] = ratio === "9:16" ? [480, 832] : ratio === "1:1" ? [480, 480] : [832, 480]; return { ...common, mode, width, height };
  };
  const canGenerate = backendReady && Boolean(prompt.trim() && outputDirectory && (mode === "textToVideo" || inputPath)) && !running;
  const generate = async () => {
    if (executionMode === "remote" && !selectedEndpoint) { setNotice("Seleziona e verifica un endpoint Colab."); return; }
    const operation = ++operationRef.current; const controller = new AbortController(); abortRef.current?.abort(); abortRef.current = controller;
    setNotice(null); setJob(null);
    const backend: Backend = executionMode === "remote" ? { kind: "remote", endpoint: selectedEndpoint! } : { kind: "local" };
    try {
      const started = backend.kind === "remote" ? await startRemoteLongCatVideoJob(backend.endpoint, buildRequest(), controller.signal) : await startLongCatVideoJob(buildRequest());
      const active = { id: started.jobId, backend };
      if (operation !== operationRef.current || controller.signal.aborted) { void cancelBackend(active); return; }
      activeJobRef.current = isLongCatVideoTerminal(started.status) ? null : active; setJob(started);
      if (isLongCatVideoTerminal(started.status)) {
        if (backend.kind === "remote" && started.status === "completed") setJob(await materializeRemoteLongCatResult(backend.endpoint, started, outputDirectory, controller.signal));
      } else await poll(active, operation, outputDirectory, controller.signal);
    } catch (error) { if (operation === operationRef.current && !controller.signal.aborted) setNotice(errorMessage(error)); activeJobRef.current = null; }
    finally { if (operation === operationRef.current) abortRef.current = null; }
  };
  const cancel = async () => {
    const active = activeJobRef.current; if (!active) return; operationRef.current += 1; abortRef.current?.abort(); abortRef.current = null; activeJobRef.current = null;
    try { await cancelBackend(active); setJob((current) => current ? { ...current, status: "cancelled", message: "Job annullato" } : current); }
    catch (error) { setNotice(errorMessage(error)); }
  };
  const copySetupCommand = async () => { try { await navigator.clipboard.writeText(capabilities.setupCommand); setNotice("Comando di setup copiato."); } catch { setNotice(`Esegui dalla cartella del progetto: ${capabilities.setupCommand}`); } };
  const addEndpoint = () => { try { const endpoint = createLongCatRemoteEndpoint(endpointDraft, endpoints.length); setEndpoints((current) => [...current, endpoint]); setSelectedEndpointId(endpoint.id); setEndpointDraft(""); setNotice("Endpoint aggiunto. Verificalo prima di generare."); } catch (error) { setNotice(errorMessage(error)); } };
  const updateEndpoint = (id: string, patch: Partial<LongCatRemoteEndpoint>) => { setEndpoints((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)); setEndpointStatuses((current) => { const next = { ...current }; delete next[id]; return next; }); };
  const removeEndpoint = (id: string) => { setEndpoints((current) => current.filter((item) => item.id !== id)); setEndpointStatuses((current) => { const next = { ...current }; delete next[id]; return next; }); };
  const openColab = () => void openLongCatColabNotebook().catch((error) => setNotice(errorMessage(error)));

  return <main className="longcat-workspace" aria-label="LongCat Video">
    <header className="longcat-workspace__bar">
      <button type="button" className="home-button" onClick={onHome} aria-label={copy.home}>⌂ <span>{copy.home}</span></button>
      <div className="longcat-workspace__identity"><span aria-hidden="true">LC</span><div><strong>LongCat Video</strong><small>Meituan foundation model · locale o Colab</small></div></div>
      <div className="longcat-runtime-badge" data-ready={backendReady}>{executionMode === "local" ? checking ? "Controllo runtime…" : capabilities.ready ? `${capabilities.gpuName ?? "CUDA"} pronta` : "Locale non disponibile" : selectedStatus?.capabilities?.ready ? `${selectedStatus.capabilities.gpuName ?? "Colab"} pronta` : "Colab da collegare"}</div>
      <button type="button" onClick={() => executionMode === "local" ? void refreshCapabilities() : void verifyRemote()} disabled={checking || checkingRemote || running}>Aggiorna stato</button>
    </header>
    <div className="longcat-workspace__body">
      <section className="longcat-control-panel" aria-label="Impostazioni LongCat Video">
        <div className="longcat-heading"><span>GENERATIVE VIDEO</span><h1>Crea con LongCat</h1><p>Pipeline ufficiale eseguita sulla GPU locale oppure su uno dei tuoi runtime Colab.</p></div>
        <div className="longcat-execution-tabs" role="tablist" aria-label="Dove eseguire LongCat">
          <button type="button" role="tab" aria-selected={executionMode === "local"} disabled={running} onClick={() => { setExecutionMode("local"); setJob(null); }}>GPU locale</button>
          <button type="button" role="tab" aria-selected={executionMode === "remote"} disabled={running} onClick={() => { setExecutionMode("remote"); setJob(null); }}>Google Colab</button>
        </div>
        {executionMode === "remote" ? <section className="longcat-remote-panel" aria-label="Endpoint Colab">
          <div className="longcat-remote-panel__lead"><div><strong>Runtime remoti</strong><small>Ogni scheda è un Colab indipendente. I controlli vengono eseguiti in parallelo.</small></div><button type="button" onClick={openColab}>Apri notebook Colab</button></div>
          <div className="longcat-endpoint-tabs" role="tablist" aria-label="Endpoint LongCat remoti">{endpoints.map((endpoint) => { const status = endpointStatuses[endpoint.id]; return <button key={endpoint.id} type="button" role="tab" aria-selected={selectedEndpointId === endpoint.id} data-status={status?.ok ? status.capabilities?.ready ? "ready" : "warning" : status ? "error" : "idle"} onClick={() => setSelectedEndpointId(endpoint.id)}>{endpoint.label}<i aria-hidden="true" /></button>; })}</div>
          <div className="longcat-endpoint-add"><input aria-label="Link endpoint Colab" value={endpointDraft} onChange={(event) => setEndpointDraft(event.target.value)} placeholder="https://…gradio.live#mlsm-token=…" disabled={running} /><button type="button" onClick={addEndpoint} disabled={!endpointDraft.trim() || running}>Aggiungi</button></div>
          {selectedEndpoint ? <div className="longcat-endpoint-editor">
            <label><span>Nome scheda</span><input aria-label="Nome endpoint" value={selectedEndpoint.label} onChange={(event) => updateEndpoint(selectedEndpoint.id, { label: event.target.value.slice(0, 80) })} disabled={running} /></label>
            <label><span>Link completo stampato dal notebook</span><input aria-label="URL endpoint" value={selectedEndpoint.url} onChange={(event) => updateEndpoint(selectedEndpoint.id, { url: event.target.value.slice(0, 2048) })} disabled={running} /></label>
            <div><label className="longcat-check"><input type="checkbox" checked={selectedEndpoint.enabled} onChange={(event) => updateEndpoint(selectedEndpoint.id, { enabled: event.target.checked })} disabled={running} /><span>Endpoint attivo</span></label><button type="button" onClick={() => removeEndpoint(selectedEndpoint.id)} disabled={running}>Rimuovi</button></div>
            {selectedStatus ? <p data-ok={Boolean(selectedStatus.ok && selectedStatus.capabilities?.ready)}>{selectedStatus.ok ? selectedStatus.capabilities?.ready ? `${selectedStatus.capabilities.gpuName ?? "GPU Colab"} pronta` : selectedStatus.capabilities?.reason ?? "Runtime non pronto" : selectedStatus.error}</p> : null}
          </div> : null}
          <button type="button" className="longcat-verify-all" onClick={() => void verifyRemote()} disabled={!endpoints.some((item) => item.enabled) || checkingRemote || running}>{checkingRemote ? "Verifica parallela…" : "Verifica tutti gli endpoint attivi"}</button>
        </section> : null}
        <div className="longcat-mode-tabs" role="tablist" aria-label="Modalità di generazione">{(Object.keys(modeLabels) as LongCatVideoMode[]).map((item) => <button key={item} type="button" role="tab" aria-selected={mode === item} onClick={() => { setMode(item); setInputPath(""); }}>{modeLabels[item].label}</button>)}</div>
        <p className="longcat-mode-description">{modeLabels[mode].description}</p>
        {mode !== "textToVideo" ? <div className="longcat-file-field"><div><small>SORGENTE</small><strong>{inputPath ? basename(inputPath) : mode === "imageToVideo" ? "Nessuna immagine" : "Nessun video"}</strong></div><button type="button" onClick={() => void chooseInput()} disabled={running}>Scegli file</button></div> : null}
        <label className="longcat-field"><span>Prompt</span><textarea aria-label="Prompt" rows={5} maxLength={4000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Descrivi soggetto, azione, camera, illuminazione e atmosfera…" disabled={running} /></label>
        <label className="longcat-field"><span>Negative prompt</span><textarea rows={3} maxLength={4000} value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} disabled={running} /></label>
        <div className="longcat-settings-grid">
          {mode === "textToVideo" ? <label><span>Rapporto</span><select value={ratio} onChange={(event) => setRatio(event.target.value)} disabled={running}><option>16:9</option><option>9:16</option><option>1:1</option></select></label> : <label><span>Risoluzione</span><select value={resolution} onChange={(event) => setResolution(event.target.value === "720p" ? "720p" : "480p")} disabled={running}><option value="480p">480p</option><option value="720p">720p</option></select></label>}
          <label><span>Profilo</span><select value={quality} onChange={(event) => setQuality(event.target.value === "quality" ? "quality" : "fast")} disabled={running}><option value="fast">Distilled · 16 step</option><option value="quality">Qualità · 50 step</option></select></label>
          <label><span>Fotogrammi</span><select value={numFrames} onChange={(event) => setNumFrames(Number(event.target.value))} disabled={running}><option value={49}>49 · 3,3 s</option><option value={93}>93 · 6,2 s</option><option value={129}>129 · 8,6 s</option></select></label>
          <label><span>Seed</span><input type="number" min={0} max={2147483647} value={seed} onChange={(event) => setSeed(Number(event.target.value))} disabled={running} /></label>
        </div>
        <label className="longcat-check"><input type="checkbox" checked={enableCompile} onChange={(event) => setEnableCompile(event.target.checked)} disabled={running} /><span>Compila il modello con torch.compile (più lento al primo avvio)</span></label>
        <div className="longcat-file-field"><div><small>DESTINAZIONE</small><strong>{outputDirectory ? outputLabel(outputDirectory) : "Scegli una cartella di output"}</strong></div><button type="button" onClick={() => void chooseOutput()} disabled={running}>Scegli destinazione</button></div>
        <div className="longcat-actions"><button className="longcat-primary" type="button" disabled={!canGenerate} onClick={() => void generate()}>{running ? "Generazione in corso…" : "Genera video"}</button>{running ? <button type="button" onClick={() => void cancel()}>Annulla job</button> : null}</div>
        {notice ? <p className="longcat-notice" role="alert">{notice}</p> : null}
      </section>
      <section className="longcat-stage" aria-label="Risultato LongCat Video">
        {executionMode === "local" && !capabilities.ready && !checking ? <article className="longcat-runtime-card"><span>RUNTIME LOCALE</span><h2>CUDA locale non disponibile</h2><p>{capabilities.reason ?? "Runtime incompleto."}</p><div className="longcat-runtime-checks"><i data-ok={capabilities.platformSupported}>NVIDIA / CUDA</i><i data-ok={capabilities.repositoryReady}>Repository ufficiale</i><i data-ok={capabilities.runtimeReady}>Python 3.10 + PyTorch</i><i data-ok={capabilities.checkpointReady}>Pesi modello</i></div><code>{capabilities.setupCommand}</code><div className="longcat-runtime-card__actions"><button type="button" onClick={() => void copySetupCommand()}>Copia comando setup</button><button type="button" onClick={openColab}>Apri Colab</button></div><small>Colab non viene mai aperto automaticamente: il link esterno parte soltanto dopo il tuo clic. Revisione: {capabilities.revision.slice(0, 12)}.</small></article> : null}
        {executionMode === "remote" && !job && !remoteReady ? <div className="longcat-empty"><div className="longcat-orb" aria-hidden="true">LC</div><strong>Collega un runtime Colab</strong><span>Avvia il notebook, copia il link completo con token, aggiungilo come scheda e verifica gli endpoint.</span></div> : null}
        {executionMode === "local" && checking ? <div className="longcat-empty"><i /><strong>Controllo dell’ambiente locale</strong><span>Verifico CUDA, dipendenze, repository e checkpoint.</span></div> : null}
        {backendReady && !job ? <div className="longcat-empty"><div className="longcat-orb" aria-hidden="true">LC</div><strong>{executionMode === "local" ? "La GPU è pronta" : "Il Colab selezionato è pronto"}</strong><span>Completa le impostazioni e avvia una generazione.</span></div> : null}
        {job && !job.result ? <div className="longcat-job" data-status={job.status}><div className="longcat-orb" aria-hidden="true">LC</div><strong>{job.message ?? "LongCat sta elaborando il video"}</strong><span>{Math.round(job.progress * 100)}%</span><progress max={1} value={job.progress} /><small>{job.status === "failed" ? job.error : executionMode === "remote" ? "Il job viene eseguito sul Colab selezionato." : "Il modello resta interamente sul computer."}</small></div> : null}
        {job?.result ? <div className="longcat-result"><video src={longCatVideoPreviewUrl(job.result.path)} controls playsInline /><div><strong>{basename(job.result.path)}</strong><span>{job.result.width}×{job.result.height} · {job.result.frames} frame · {job.result.durationSeconds.toFixed(1)} s · seed {job.result.seed}</span><code>{job.result.path}</code><a className="longcat-download" href={longCatVideoPreviewUrl(job.result.path)} download={`longcat-${job.jobId}.mp4`}>Scarica MP4</a></div></div> : null}
      </section>
    </div>
  </main>;
}
