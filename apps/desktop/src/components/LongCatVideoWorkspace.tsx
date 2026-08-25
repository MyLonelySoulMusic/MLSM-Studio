import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  cancelLongCatVideoJob,
  chooseLongCatInput,
  chooseLongCatOutputDirectory,
  getLongCatVideoCapabilities,
  getLongCatVideoJob,
  isLongCatVideoTerminal,
  longCatVideoPreviewUrl,
  startLongCatVideoJob,
  type LongCatVideoCapabilities,
  type LongCatVideoJob,
  type LongCatVideoMode,
  type LongCatVideoStartRequest
} from "../services/longcat-video-native";
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

function basename(path: string): string { if (path.startsWith("mlsm-upload:")) return decodeURIComponent(path.split(":").slice(2).join(":")); return path.split(/[\\/]/).at(-1) ?? path; }
function outputLabel(path: string): string { return path === "mlsm-browser-download" ? "Download del browser" : path; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function LongCatVideoWorkspace({ onHome }: { onHome?: () => void }): ReactElement {
  const { language } = useUiPreferences(); const copy = uiCopy[language];
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<LongCatVideoMode>("textToVideo");
  const [prompt, setPrompt] = useState(""); const [negativePrompt, setNegativePrompt] = useState(defaultNegativePrompt);
  const [inputPath, setInputPath] = useState(""); const [outputDirectory, setOutputDirectory] = useState("");
  const [ratio, setRatio] = useState("16:9"); const [resolution, setResolution] = useState<"480p" | "720p">("480p");
  const [quality, setQuality] = useState<"fast" | "quality">("fast"); const [numFrames, setNumFrames] = useState(93);
  const [seed, setSeed] = useState(42); const [enableCompile, setEnableCompile] = useState(false);
  const [job, setJob] = useState<LongCatVideoJob | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const activeJobRef = useRef<string | null>(null); const operationRef = useRef(0);

  const refreshCapabilities = useCallback(async () => {
    const operation = ++operationRef.current; setChecking(true); setNotice(null);
    try { const next = await getLongCatVideoCapabilities(); if (operation === operationRef.current) setCapabilities(next); }
    catch (error) { if (operation === operationRef.current) setNotice(errorMessage(error)); }
    finally { if (operation === operationRef.current) setChecking(false); }
  }, []);

  useEffect(() => { void refreshCapabilities(); return () => { operationRef.current += 1; const active = activeJobRef.current; if (active) void cancelLongCatVideoJob(active).catch(() => undefined); }; }, [refreshCapabilities]);

  const poll = useCallback(async (jobId: string, operation: number) => {
    while (operation === operationRef.current) {
      const next = await getLongCatVideoJob(jobId);
      if (operation !== operationRef.current) return;
      setJob(next);
      if (isLongCatVideoTerminal(next.status)) { activeJobRef.current = null; return; }
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
  }, []);

  const chooseInput = async () => {
    if (mode === "textToVideo") return;
    try { const selected = await chooseLongCatInput(mode); if (selected) setInputPath(selected); }
    catch (error) { setNotice(errorMessage(error)); }
  };

  const chooseOutput = async () => {
    try { const selected = await chooseLongCatOutputDirectory(); if (selected) setOutputDirectory(selected); }
    catch (error) { setNotice(errorMessage(error)); }
  };

  const buildRequest = (): LongCatVideoStartRequest => {
    const common = {
      prompt: prompt.trim(), negativePrompt: negativePrompt.trim(), outputDirectory, numFrames,
      numInferenceSteps: quality === "fast" ? 16 : 50, guidanceScale: quality === "fast" ? 1 : 4,
      seed: Math.trunc(seed), useDistill: quality === "fast", enableCompile
    };
    if (mode === "imageToVideo") return { ...common, mode, inputPath, resolution };
    if (mode === "videoContinuation") return { ...common, mode, inputPath, resolution, numCondFrames: 13 };
    const [width, height] = ratio === "9:16" ? [480, 832] : ratio === "1:1" ? [480, 480] : [832, 480];
    return { ...common, mode, width, height };
  };

  const canGenerate = capabilities.ready && Boolean(prompt.trim() && outputDirectory && (mode === "textToVideo" || inputPath)) && !job?.status.match(/queued|running/);

  const generate = async () => {
    const operation = ++operationRef.current; setNotice(null); setJob(null);
    try {
      const started = await startLongCatVideoJob(buildRequest());
      if (operation !== operationRef.current) { void cancelLongCatVideoJob(started.jobId); return; }
      activeJobRef.current = isLongCatVideoTerminal(started.status) ? null : started.jobId; setJob(started);
      if (!isLongCatVideoTerminal(started.status)) await poll(started.jobId, operation);
    } catch (error) { if (operation === operationRef.current) setNotice(errorMessage(error)); activeJobRef.current = null; }
  };

  const cancel = async () => {
    const jobId = activeJobRef.current; if (!jobId) return;
    operationRef.current += 1; activeJobRef.current = null;
    try { setJob(await cancelLongCatVideoJob(jobId)); } catch (error) { setNotice(errorMessage(error)); }
  };

  const copySetupCommand = async () => {
    try { await navigator.clipboard.writeText(capabilities.setupCommand); setNotice("Comando di setup copiato."); }
    catch { setNotice(`Esegui dalla cartella del progetto: ${capabilities.setupCommand}`); }
  };

  const running = job?.status === "queued" || job?.status === "running";
  return <main className="longcat-workspace" aria-label="LongCat Video">
    <header className="longcat-workspace__bar">
      <button type="button" className="home-button" onClick={onHome} aria-label={copy.home}>⌂ <span>{copy.home}</span></button>
      <div className="longcat-workspace__identity"><span aria-hidden="true">LC</span><div><strong>LongCat Video</strong><small>Meituan foundation model · local CUDA</small></div></div>
      <div className="longcat-runtime-badge" data-ready={capabilities.ready}>{checking ? "Controllo runtime…" : capabilities.ready ? `${capabilities.gpuName ?? "CUDA"} pronta` : "Runtime da configurare"}</div>
      <button type="button" onClick={() => void refreshCapabilities()} disabled={checking || running}>Aggiorna stato</button>
    </header>

    <div className="longcat-workspace__body">
      <section className="longcat-control-panel" aria-label="Impostazioni LongCat Video">
        <div className="longcat-heading"><span>GENERATIVE VIDEO</span><h1>Crea con LongCat</h1><p>Text-to-video, image-to-video e continuazione con la pipeline ufficiale eseguita in locale.</p></div>
        <div className="longcat-mode-tabs" role="tablist" aria-label="Modalità di generazione">
          {(Object.keys(modeLabels) as LongCatVideoMode[]).map((item) => <button key={item} type="button" role="tab" aria-selected={mode === item} onClick={() => { setMode(item); setInputPath(""); }}>{modeLabels[item].label}</button>)}
        </div>
        <p className="longcat-mode-description">{modeLabels[mode].description}</p>

        {mode !== "textToVideo" ? <div className="longcat-file-field"><div><small>SORGENTE</small><strong>{inputPath ? basename(inputPath) : mode === "imageToVideo" ? "Nessuna immagine" : "Nessun video"}</strong></div><button type="button" onClick={() => void chooseInput()} disabled={running}>Scegli file</button></div> : null}

        <label className="longcat-field"><span>Prompt</span><textarea rows={5} maxLength={4000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Descrivi soggetto, azione, camera, illuminazione e atmosfera…" disabled={running} /></label>
        <label className="longcat-field"><span>Negative prompt</span><textarea rows={3} maxLength={4000} value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} disabled={running} /></label>

        <div className="longcat-settings-grid">
          {mode === "textToVideo" ? <label><span>Rapporto</span><select value={ratio} onChange={(event) => setRatio(event.target.value)} disabled={running}><option>16:9</option><option>9:16</option><option>1:1</option></select></label> : <label><span>Risoluzione</span><select value={resolution} onChange={(event) => setResolution(event.target.value === "720p" ? "720p" : "480p")} disabled={running}><option value="480p">480p</option><option value="720p">720p</option></select></label>}
          <label><span>Profilo</span><select value={quality} onChange={(event) => setQuality(event.target.value === "quality" ? "quality" : "fast")} disabled={running}><option value="fast">Distilled · 16 step</option><option value="quality">Qualità · 50 step</option></select></label>
          <label><span>Fotogrammi</span><select value={numFrames} onChange={(event) => setNumFrames(Number(event.target.value))} disabled={running}><option value={49}>49 · 3,3 s</option><option value={93}>93 · 6,2 s</option><option value={129}>129 · 8,6 s</option></select></label>
          <label><span>Seed</span><input type="number" min={0} max={2147483647} value={seed} onChange={(event) => setSeed(Number(event.target.value))} disabled={running} /></label>
        </div>
        <label className="longcat-check"><input type="checkbox" checked={enableCompile} onChange={(event) => setEnableCompile(event.target.checked)} disabled={running} /><span>Compila il modello con torch.compile (più lento al primo avvio)</span></label>
        <div className="longcat-file-field"><div><small>DESTINAZIONE</small><strong>{outputDirectory ? outputLabel(outputDirectory) : "Scegli una cartella di output"}</strong></div><button type="button" onClick={() => void chooseOutput()} disabled={running}>Scegli destinazione</button></div>

        <div className="longcat-actions">
          <button className="longcat-primary" type="button" disabled={!canGenerate} onClick={() => void generate()}>{running ? "Generazione in corso…" : "Genera video"}</button>
          {running ? <button type="button" onClick={() => void cancel()}>Annulla job</button> : null}
        </div>
        {notice ? <p className="longcat-notice" role="alert">{notice}</p> : null}
      </section>

      <section className="longcat-stage" aria-label="Risultato LongCat Video">
        {!capabilities.ready && !checking ? <article className="longcat-runtime-card">
          <span>RUNTIME LOCALE</span><h2>Configura LongCat-Video</h2>
          <p>{capabilities.reason ?? "Runtime incompleto."}</p>
          <div className="longcat-runtime-checks">
            <i data-ok={capabilities.platformSupported}>NVIDIA / CUDA</i><i data-ok={capabilities.repositoryReady}>Repository ufficiale</i><i data-ok={capabilities.runtimeReady}>Python 3.10 + PyTorch</i><i data-ok={capabilities.checkpointReady}>Pesi modello</i>
          </div>
          <code>{capabilities.setupCommand}</code><button type="button" onClick={() => void copySetupCommand()}>Copia comando setup</button>
          <small>Il setup mantiene repository, ambiente e pesi fuori dal codice versionato. Revisione ufficiale fissata: {capabilities.revision.slice(0, 12)}.</small>
        </article> : null}
        {checking ? <div className="longcat-empty"><i /><strong>Controllo dell’ambiente locale</strong><span>Verifico CUDA, dipendenze, repository e checkpoint.</span></div> : null}
        {capabilities.ready && !job ? <div className="longcat-empty"><div className="longcat-orb" aria-hidden="true">LC</div><strong>La GPU è pronta</strong><span>Completa le impostazioni e avvia una generazione.</span></div> : null}
        {job && !job.result ? <div className="longcat-job" data-status={job.status}><div className="longcat-orb" aria-hidden="true">LC</div><strong>{job.message ?? "LongCat sta elaborando il video"}</strong><span>{Math.round(job.progress * 100)}%</span><progress max={1} value={job.progress} /><small>{job.status === "failed" ? job.error : "Il modello resta interamente sul computer."}</small></div> : null}
        {job?.result ? <div className="longcat-result"><video src={longCatVideoPreviewUrl(job.result.path)} controls playsInline /><div><strong>{basename(job.result.path)}</strong><span>{job.result.width}×{job.result.height} · {job.result.frames} frame · {job.result.durationSeconds.toFixed(1)} s · seed {job.result.seed}</span><code>{job.result.path}</code><a className="longcat-download" href={longCatVideoPreviewUrl(job.result.path)} download={`longcat-${job.jobId}.mp4`}>Scarica MP4</a></div></div> : null}
      </section>
    </div>
  </main>;
}
