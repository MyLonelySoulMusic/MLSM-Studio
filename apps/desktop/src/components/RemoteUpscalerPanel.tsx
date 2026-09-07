import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RhythmBallProject } from "@rbs/project-schema";
import { activeRemoteUpscalerEndpoints, discoverRemoteUpscalerModels, normalizeRemoteUpscalerEndpoint, type RemoteUpscalerCatalog } from "../services/remote-upscaler-client";
import { clearRemoteUpscalerVideoCache, UPSCALER_REMOTE_CACHE_CLEARED_EVENT } from "../services/upscaler-python-client";
import { resolveUpscalerTarget } from "../services/upscaler-renderer";
import { useUpscalerBatchStore } from "../store/upscaler-batch-store";

type Settings = RhythmBallProject["animation"]["upscaler"];

function endpointId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `remote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseRemoteUpscalerEndpointBlock(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s,;]+/gi) ?? [];
  const unique = new Map<string, string>();
  for (const match of matches) {
    const cleaned = match.replace(/[)\]}>"']+$/g, "");
    const normalized = normalizeRemoteUpscalerEndpoint(cleaned);
    if (normalized) unique.set(normalized.toLowerCase(), normalized);
  }
  return [...unique.values()];
}

export function RemoteUpscalerPanel({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const [draftUrl, setDraftUrl] = useState("");
  const [catalog, setCatalog] = useState<RemoteUpscalerCatalog | null>(null);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const [clearArmed, setClearArmed] = useState(false); const [clearingCache, setClearingCache] = useState(false); const [cacheFeedback, setCacheFeedback] = useState("");
  const request = useRef<AbortController | null>(null);
  const cacheRequest = useRef<AbortController | null>(null);
  const upscalerBusy = useUpscalerBatchStore((state) => state.running || state.importing || state.singleOperations > 0);
  const remote = settings.remote;
  const latestSettings = useRef(settings);
  latestSettings.current = settings;
  const latestUpdate = useRef(update);
  latestUpdate.current = update;
  const active = useMemo(() => activeRemoteUpscalerEndpoints(settings), [settings]);
  const activeSignature = active.join("\n");
  const patchRemote = useCallback((patch: Partial<Settings["remote"]>) => update({ remote: { ...remote, ...patch } }), [remote, update]);

  const selectRemoteModel = useCallback((modelName: string, availableModels = catalog?.models ?? []) => {
    const model = availableModels.find((item) => item.name === modelName);
    if (!model) { patchRemote({ model: modelName }); return; }
    const dimensions = settings.sourceWidth > 0 && settings.sourceHeight > 0
      ? resolveUpscalerTarget(settings.sourceWidth, settings.sourceHeight, model.scale)
      : null;
    update({
      remote: { ...remote, model: model.name },
      scale: model.scale,
      ...(dimensions ? { finalWidth: dimensions.width, finalHeight: dimensions.height } : {})
    });
  }, [catalog?.models, patchRemote, remote, settings.sourceHeight, settings.sourceWidth, update]);

  const discover = useCallback(async () => {
    const active = activeSignature ? activeSignature.split("\n") : [];
    if (!active.length) { setCatalog(null); setError("Aggiungi e attiva almeno un endpoint."); return; }
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setLoading(true); setError("");
    try {
      const result = await discoverRemoteUpscalerModels(active, controller.signal);
      if (controller.signal.aborted || activeRemoteUpscalerEndpoints(latestSettings.current).join("\n") !== activeSignature) return;
      setCatalog(result);
      const names = new Set(result.models.map((item) => item.name));
      if (result.models.length) {
        const current = latestSettings.current;
        const modelName = names.has(current.remote.model) ? current.remote.model : result.defaultModel || result.models[0]!.name;
        const model = result.models.find((item) => item.name === modelName) ?? result.models[0]!;
        const dimensions = current.sourceWidth > 0 && current.sourceHeight > 0
          ? resolveUpscalerTarget(current.sourceWidth, current.sourceHeight, model.scale)
          : null;
        if (current.remote.model !== model.name) {
          latestUpdate.current({ remote: { ...current.remote, model: model.name }, scale: model.scale, ...(dimensions ? { finalWidth: dimensions.width, finalHeight: dimensions.height } : {}) });
        }
      }
      if (!result.models.length) setError("Gli endpoint raggiungibili non espongono modelli utilizzabili.");
    } catch (reason) { if (!controller.signal.aborted) { setCatalog(null); setError(reason instanceof Error ? reason.message : String(reason)); } }
    finally { if (request.current === controller) { request.current = null; setLoading(false); } }
  }, [activeSignature]);

  useEffect(() => {
    if (!remote.enabled || !activeSignature) return;
    const timer = window.setTimeout(() => void discover(), 350);
    return () => window.clearTimeout(timer);
  }, [activeSignature, discover, remote.enabled]);
  useEffect(() => () => { request.current?.abort(); cacheRequest.current?.abort(); }, []);
  useEffect(() => { if (upscalerBusy) setClearArmed(false); }, [upscalerBusy]);

  const addEndpoint = () => {
    const urls = parseRemoteUpscalerEndpointBlock(draftUrl);
    if (!urls.length) { setError("Incolla uno o più URL completi, per esempio https://abc123.gradio.live"); return; }
    const existing = new Set(remote.endpoints.map((item) => normalizeRemoteUpscalerEndpoint(item.url).toLowerCase()));
    const additions = urls.filter((url) => !existing.has(url.toLowerCase()));
    if (!additions.length) { setError("Gli endpoint incollati sono già presenti."); return; }
    patchRemote({ endpoints: [...remote.endpoints, ...additions.map((url, index) => ({ id: endpointId(), label: `Colab ${remote.endpoints.length + index + 1}`, url, enabled: true }))] });
    setDraftUrl(""); setCatalog(null); setError("");
  };

  const clearCache = async () => {
    if (clearingCache || upscalerBusy) return;
    cacheRequest.current?.abort(); const controller = new AbortController(); cacheRequest.current = controller;
    setClearingCache(true); setClearArmed(false); setCacheFeedback("");
    try {
      const result = await clearRemoteUpscalerVideoCache(controller.signal);
      if (controller.signal.aborted) return;
      const megabytes = result.removedBytes / 1024 / 1024;
      setCacheFeedback(`Cache svuotata: ${result.removedJobs} job rimossi · ${megabytes >= .1 ? `${megabytes.toFixed(1)} MB` : `${result.removedBytes.toLocaleString("it-IT")} byte`}.`);
      window.dispatchEvent(new Event(UPSCALER_REMOTE_CACHE_CLEARED_EVENT));
    } catch (reason) {
      if (!controller.signal.aborted) setCacheFeedback(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (cacheRequest.current === controller) { cacheRequest.current = null; setClearingCache(false); }
    }
  };

  return <div className="remote-upscaler-card">
    <strong>Upscaling remoto · Gradio / Colab</strong>
    <p className="muted">Le foto vengono inviate direttamente. Per i video MLSM conserva tutti i fotogrammi, crea segmenti configurabili e li distribuisce in parallelo tra gli endpoint attivi; ogni risultato resta in locale e l’audio originale viene rimesso soltanto a lavoro completo.</p>
    <div className="remote-upscaler-add"><textarea aria-label="URL endpoint Upscaler remoto" placeholder={"https://abc123.gradio.live\nhttps://def456.gradio.live"} rows={4} value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); addEndpoint(); } }} /><button type="button" onClick={addEndpoint}>Aggiungi endpoint</button><small className="muted">Puoi incollare tutti i link insieme, separati da righe, spazi, virgole o punto e virgola. I duplicati vengono ignorati. Premi Ctrl/Cmd + Invio per aggiungerli.</small></div>
    {remote.endpoints.length ? <div className="remote-upscaler-endpoints">{remote.endpoints.map((endpoint) => {
      const status = catalog?.endpoints.find((item) => normalizeRemoteUpscalerEndpoint(item.url) === normalizeRemoteUpscalerEndpoint(endpoint.url));
      return <div className="remote-upscaler-endpoint" key={endpoint.id}>
        <div className="remote-upscaler-endpoint-head">
          <input aria-label={`Attiva ${endpoint.label}`} type="checkbox" checked={endpoint.enabled} onChange={(event) => patchRemote({ endpoints: remote.endpoints.map((item) => item.id === endpoint.id ? { ...item, enabled: event.target.checked } : item) })} />
          <input className="remote-upscaler-endpoint-name" aria-label={`Nome ${endpoint.label}`} value={endpoint.label} onChange={(event) => patchRemote({ endpoints: remote.endpoints.map((item) => item.id === endpoint.id ? { ...item, label: event.target.value } : item) })} />
          <span className={status?.ok ? "remote-endpoint-ok" : status ? "remote-endpoint-error" : "muted"}>{status?.ok ? `Online · ${status.models.length} modelli` : status?.error || "Non verificato"}</span>
          <button type="button" aria-label={`Rimuovi ${endpoint.label}`} onClick={() => patchRemote({ endpoints: remote.endpoints.filter((item) => item.id !== endpoint.id) })}>Rimuovi</button>
        </div>
        <input className="remote-upscaler-endpoint-url" aria-label={`URL ${endpoint.label}`} title={endpoint.url} type="url" value={endpoint.url} onChange={(event) => patchRemote({ endpoints: remote.endpoints.map((item) => item.id === endpoint.id ? { ...item, url: event.target.value } : item) })} />
      </div>;
    })}</div> : null}
    <button type="button" disabled={loading || !active.length} onClick={() => void discover()}>{loading ? "Controllo endpoint…" : "Verifica endpoint e carica modelli"}</button>
    {catalog?.transport === "direct" ? <small className="remote-upscaler-transport">Collegamento diretto a Gradio attivo. Prima del job il coordinatore verifica tutti gli endpoint; poi assegna contemporaneamente un segmento a ciascun Colab disponibile.</small> : null}
    {catalog?.models.length ? <label>Modello remoto<select aria-label="Modello Upscaler remoto" value={remote.model} onChange={(event) => selectRemoteModel(event.target.value)}>{catalog.models.map((model) => <option key={model.name} value={model.name}>{model.name} · {model.scale}×{model.description ? ` · ${model.description}` : ""}</option>)}</select><small className="muted">Il preflight userà gli endpoint che espongono questo modello e ti farà approvare l’esclusione degli altri.</small></label> : null}
    <label>Tentativi aggiuntivi per segmento: {remote.frameRetries}<input aria-label="Tentativi segmento Upscaler remoto" type="range" min="0" max="6" step="1" value={remote.frameRetries} onChange={(event) => patchRemote({ frameRetries: Number(event.target.value) })} /></label>
    <div className="remote-upscaler-video-options">
      <label>Fotogrammi per segmento
        <input aria-label="Fotogrammi per segmento remoto" type="number" min="1" max="5000" step="1" value={remote.segmentFrames} onChange={(event) => patchRemote({ segmentFrames: Math.max(1, Math.min(5000, Math.round(Number(event.target.value) || 1))) })} />
      </label>
      <small className="muted">Valore predefinito: 100. Puoi usare 300 o più; segmenti grandi riducono il traffico ma richiedono più RAM al Colab.</small>
      <label className="teddy-dance-toggle"><span>Modifica frame rate</span><input aria-label="Modifica frame rate remoto" type="checkbox" checked={remote.outputFps !== null} onChange={(event) => patchRemote({ outputFps: event.target.checked ? 60 : null })} /></label>
      {remote.outputFps !== null ? <label>FPS di uscita
        <input aria-label="FPS uscita Upscaler remoto" type="number" min="1" max="480" step="0.001" value={remote.outputFps} onChange={(event) => patchRemote({ outputFps: Math.max(1, Math.min(480, Number(event.target.value) || 1)) })} />
      </label> : null}
      <small className="muted">Se non attivi questa opzione, MLSM estrae e ricompone tutti i frame originali mantenendo il frame rate della sorgente. Non viene applicato alcun limite automatico a 25 FPS.</small>
    </div>
    {error ? <p className="remote-upscaler-error">{error}</p> : null}
    <div className="remote-upscaler-cache-control">
      <small className="remote-upscaler-storage">Checkpoint video: <code>.upscaler-cache/remote-video-jobs</code>. Ogni segmento ricevuto viene salvato localmente: se un Colab cade puoi riprendere senza rifare le parti già complete.</small>
      {!clearArmed ? <button type="button" disabled={clearingCache || upscalerBusy} onClick={() => { setCacheFeedback(""); setClearArmed(true); }}>{clearingCache ? "Pulizia cache…" : "Svuota tutta la cache video"}</button> : <div className="remote-upscaler-cache-confirm" role="group" aria-label="Conferma pulizia cache video">
        <strong>Eliminare sorgenti, frame e risultati salvati?</strong>
        <button type="button" className="danger" onClick={() => void clearCache()}>Conferma eliminazione</button>
        <button type="button" onClick={() => setClearArmed(false)}>Annulla</button>
      </div>}
      {upscalerBusy ? <small className="muted">La cache si può svuotare quando import ed elaborazioni sono terminati.</small> : null}
      {cacheFeedback ? <p className="remote-upscaler-cache-feedback" role="status">{cacheFeedback}</p> : null}
    </div>
  </div>;
}
