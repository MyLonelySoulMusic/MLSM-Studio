import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RhythmBallProject } from "@rbs/project-schema";
import { activeRemoteUpscalerEndpoints, discoverRemoteUpscalerModels, normalizeRemoteUpscalerEndpoint, type RemoteUpscalerCatalog } from "../services/remote-upscaler-client";
import { clearRemoteUpscalerVideoCache, UPSCALER_REMOTE_CACHE_CLEARED_EVENT } from "../services/upscaler-python-client";
import { useUpscalerBatchStore } from "../store/upscaler-batch-store";

type Settings = RhythmBallProject["animation"]["upscaler"];

function endpointId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `remote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  const active = useMemo(() => activeRemoteUpscalerEndpoints(settings), [settings]);
  const activeSignature = active.join("\n");
  const patchRemote = useCallback((patch: Partial<Settings["remote"]>) => update({ remote: { ...remote, ...patch } }), [remote, update]);

  const discover = useCallback(async () => {
    if (!active.length) { setCatalog(null); setError("Aggiungi e attiva almeno un endpoint."); return; }
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setLoading(true); setError("");
    try {
      const result = await discoverRemoteUpscalerModels(active, controller.signal);
      if (controller.signal.aborted) return;
      setCatalog(result);
      const names = new Set(result.models.map((item) => item.name));
      if (!names.has(remote.model)) patchRemote({ model: result.defaultModel || result.models[0]?.name || "" });
      if (!result.models.length) setError("Gli endpoint rispondono, ma non hanno un modello in comune. Disattiva quelli incompatibili.");
    } catch (reason) { if (!controller.signal.aborted) { setCatalog(null); setError(reason instanceof Error ? reason.message : String(reason)); } }
    finally { if (request.current === controller) { request.current = null; setLoading(false); } }
  }, [active, patchRemote, remote.model]);

  useEffect(() => {
    if (!remote.enabled || !activeSignature) return;
    const timer = window.setTimeout(() => void discover(), 350);
    return () => window.clearTimeout(timer);
  }, [activeSignature, discover, remote.enabled]);
  useEffect(() => () => { request.current?.abort(); cacheRequest.current?.abort(); }, []);
  useEffect(() => { if (upscalerBusy) setClearArmed(false); }, [upscalerBusy]);

  const addEndpoint = () => {
    const url = draftUrl.trim(); if (!url) return;
    if (!/^https?:\/\//i.test(url)) { setError("Inserisci un URL completo, per esempio https://abc123.gradio.live"); return; }
    if (remote.endpoints.some((item) => normalizeRemoteUpscalerEndpoint(item.url) === normalizeRemoteUpscalerEndpoint(url))) { setError("Questo endpoint è già presente."); return; }
    patchRemote({ endpoints: [...remote.endpoints, { id: endpointId(), label: `Colab ${remote.endpoints.length + 1}`, url, enabled: true }] });
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
    <label className="teddy-dance-toggle"><span>Upscaling remoto · Gradio / Colab</span><input aria-label="Abilita Upscaler remoto" type="checkbox" checked={remote.enabled} onChange={(event) => patchRemote({ enabled: event.target.checked })} /></label>
    <p className="muted">Foto e frame video vengono inviati agli endpoint attivi. Per i video MLSM assegna un frame per endpoint, salva ogni risultato in locale e rimette l’audio originale soltanto a lavoro completo.</p>
    <div className="remote-upscaler-add"><input aria-label="URL endpoint Upscaler remoto" type="url" placeholder="https://abc123.gradio.live" value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addEndpoint(); } }} /><button type="button" onClick={addEndpoint}>Aggiungi endpoint</button></div>
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
    {catalog?.models.length ? <label>Modello remoto comune<select aria-label="Modello Upscaler remoto" value={remote.model} onChange={(event) => patchRemote({ model: event.target.value })}>{catalog.models.map((model) => <option key={model.name} value={model.name}>{model.name} · {model.scale}×{model.description ? ` · ${model.description}` : ""}</option>)}</select></label> : null}
    <label>Tentativi aggiuntivi per frame: {remote.frameRetries}<input aria-label="Tentativi frame Upscaler remoto" type="range" min="0" max="6" step="1" value={remote.frameRetries} onChange={(event) => patchRemote({ frameRetries: Number(event.target.value) })} /></label>
    {error ? <p className="remote-upscaler-error">{error}</p> : null}
    <div className="remote-upscaler-cache-control">
      <small className="remote-upscaler-storage">Checkpoint video: <code>.upscaler-cache/remote-video-jobs</code>. Prima di ogni job remoto scegli se riprendere una cache compatibile o ripartire da zero.</small>
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
