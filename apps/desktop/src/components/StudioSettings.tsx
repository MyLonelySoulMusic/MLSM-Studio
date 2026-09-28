import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getLlmSettings,
  DEFAULT_PROVIDER_LIMITS,
  type ProviderLimits,
  llmModelCatalog,
  providerCatalogUrls,
  providerLabels,
  saveLlmSettings,
  settingsRequest,
  type LlmProvider,
  type LlmSettings,
} from "../services/studio-settings";
import { clearCacheEntry, listBrowserCaches, listDiskCaches, type CacheEntry } from "../services/cache-inventory";
import { clearTaskHistory, hasActiveTasks, readTaskHistory, TASK_HISTORY_EVENT } from "../services/task-history";
import { useUiPreferences } from "../services/ui-preferences";
import { RestoreSettingsPanel } from "./RestoreSettingsPanel";

const OPEN_EVENT = "mlsm:open-settings";

const copy = {
  it: {
    title: "Impostazioni",
    subtitle: "MLSM Studio Control Center",
    keys: "API e modelli",
    history: "Attività",
    cache: "Spazio e cache",
    restore: "Restore",
    close: "Chiudi",
    model: "Modello LLM",
    enabled: "Abilita questo provider",
    key: "Nuova API key",
    saved: "Impostazioni salvate",
    save: "Salva configurazione",
    test: "Verifica connessione",
    reset: "Usa chiave da .env",
    present: "Chiave configurata",
    absent: "Chiave assente",
    privacy: "La chiave resta nel backend locale. Lonely Bot invia al provider selezionato soltanto la conversazione, il contesto della pagina e il codice pertinente; se il provider non risponde usa il modello locale.",
    source: "Origine",
    clear: "Ripulisci",
    confirm: "Conferma pulizia",
    cancel: "Annulla",
    refresh: "Aggiorna elenco",
    empty: "Nessun task registrato.",
    clearHistory: "Svuota attività",
    cacheHint: "La pulizia elimina soltanto dati rigenerabili. Progetti, file originali e preferenze restano conservati; i modelli eliminati verranno riscaricati quando serviranno.",
    busy: "Attendi la fine delle elaborazioni prima di pulire la cache.",
    unknown: "Dimensione non disponibile",
    done: "Pulizia completata",
    running: "Operazione in corso",
    completed: "Completato",
    failed: "Fallito",
    cancelled: "Annullato",
    interrupted: "Interrotto",
    lonelyTitle: "LLM · Lonely Bot",
    lonelyDescription: "Scegli il motore di Lonely Bot e configura ogni provider separatamente.",
    activeLlm: "Motore usato da Lonely Bot",
    configure: "Provider da configurare",
    officialCatalog: "Catalogo ufficiale",
    localOnly: "Solo modello locale",
    otherApis: "API · altre funzioni",
    otherApisDescription: "Area riservata alle future integrazioni API di MLSM Studio, separate dalle credenziali di Lonely Bot.",
    noOtherApis: "Nessuna integrazione aggiuntiva disponibile al momento.",
    configured: "Configurato",
    notConfigured: "Da configurare",
    files: "file",
  },
  en: {
    title: "Settings",
    subtitle: "MLSM Studio Control Center",
    keys: "APIs & models",
    history: "Activity",
    cache: "Storage & cache",
    restore: "Restore",
    close: "Close",
    model: "LLM model",
    enabled: "Enable this provider",
    key: "New API key",
    saved: "Settings saved",
    save: "Save configuration",
    test: "Test connection",
    reset: "Use key from .env",
    present: "Key configured",
    absent: "No key configured",
    privacy: "The key stays in the local backend. Lonely Bot sends the selected provider only the conversation, page context and relevant code; if it is unavailable, the local model is used.",
    source: "Source",
    clear: "Clear",
    confirm: "Confirm clearing",
    cancel: "Cancel",
    refresh: "Refresh list",
    empty: "No tasks recorded.",
    clearHistory: "Clear activity",
    cacheHint: "Clearing removes regenerable data only. Projects, original files and preferences are preserved; deleted models will download again when needed.",
    busy: "Wait for active tasks to finish before clearing caches.",
    unknown: "Size unavailable",
    done: "Cleanup completed",
    running: "Operation running",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
    lonelyTitle: "LLM · Lonely Bot",
    lonelyDescription: "Choose Lonely Bot's engine and configure each provider separately.",
    activeLlm: "Engine used by Lonely Bot",
    configure: "Provider to configure",
    officialCatalog: "Official catalog",
    localOnly: "Local model only",
    otherApis: "APIs · other features",
    otherApisDescription: "Reserved for future MLSM Studio API integrations, kept separate from Lonely Bot credentials.",
    noOtherApis: "No additional integrations are available yet.",
    configured: "Configured",
    notConfigured: "Set up required",
    files: "files",
  },
} as const;

function ProviderLogo({ provider }: { provider: LlmProvider }) {
  if (provider === "nvidia") {
    return <svg className="provider-logo provider-logo-nvidia" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z" /></svg>;
  }
  if (provider === "gemini") {
    return <svg className="provider-logo provider-logo-gemini" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" /></svg>;
  }
  if (provider === "xai") {
    return <svg className="provider-logo provider-logo-xai" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" /></svg>;
  }
  return <span className="provider-logo provider-logo-openai" aria-hidden="true">OpenAI</span>;
}

function NavIcon({ id }: { id: "keys" | "history" | "cache" | "restore" }) {
  if (id === "keys") return <span aria-hidden="true">⌁</span>;
  if (id === "history") return <span aria-hidden="true">◷</span>;
  if (id === "restore") return <span aria-hidden="true">↻</span>;
  return <span aria-hidden="true">◫</span>;
}

interface ConnectionCheck {
  provider: LlmProvider;
  model: string;
  kind: "running" | "success" | "error";
  detail: string;
}

export function SettingsButton() {
  const { language } = useUiPreferences();
  return <button type="button" className="studio-settings-button" aria-label={copy[language].title} title={copy[language].title} onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m10 3-1 3-3 1-3-1-1 4 3 2v3l-2 2 3 3 3-1 3 1 1 3 4-1v-3l2-2h3l1-4-3-1-1-3 1-3-3-2-2 2z" /><circle cx="12" cy="12" r="3.5" /></svg></button>;
}

export function StudioSettings() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  return open ? createPortal(<SettingsDialog onClose={() => setOpen(false)} />, document.body) : null;
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { language } = useUiPreferences();
  const t = copy[language];
  const [tab, setTab] = useState<"keys" | "history" | "cache" | "restore">("keys");
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [provider, setProvider] = useState<LlmProvider>("nvidia");
  const [activeProvider, setActiveProvider] = useState<LlmProvider | "local">("nvidia");
  const [model, setModel] = useState(llmModelCatalog.nvidia[0]!.id);
  const [enabled, setEnabled] = useState(true);
  const [limits, setLimits] = useState<ProviderLimits>(DEFAULT_PROVIDER_LIMITS);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [connectionCheck, setConnectionCheck] = useState<ConnectionCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState(readTaskHistory);
  const [caches, setCaches] = useState<CacheEntry[]>([]);
  const [pending, setPending] = useState<CacheEntry | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const config = settings?.providers[provider];
  const catalog = llmModelCatalog[provider];
  const currentModelIsListed = catalog.some((item) => item.id === model);

  const succeed = (value: string) => { setMessageKind("success"); setMessage(value); };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try { await action(); }
    catch (error) { setMessageKind("error"); setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const chooseProvider = (id: LlmProvider) => {
    setProvider(id);
    setKey("");
    setModel(settings?.providers[id].model ?? llmModelCatalog[id][0]!.id);
    setEnabled(settings?.providers[id].enabled ?? true);
    setLimits({ ...DEFAULT_PROVIDER_LIMITS, ...settings?.providers[id].limits });
    setMessage("");
    setConnectionCheck(null);
  };

  useEffect(() => {
    let live = true;
    void getLlmSettings().then((value) => {
      if (!live) return;
      setSettings(value);
      setActiveProvider(value.activeProvider);
      setModel(value.providers.nvidia.model);
      setEnabled(value.providers.nvidia.enabled);
      setLimits({ ...DEFAULT_PROVIDER_LIMITS, ...value.providers.nvidia.limits });
    }).catch((error) => {
      if (live) { setMessageKind("error"); setMessage(String(error)); }
    });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const changed = () => setTasks(readTaskHistory());
    window.addEventListener(TASK_HISTORY_EVENT, changed);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener(TASK_HISTORY_EVENT, changed);
      window.removeEventListener("storage", changed);
    };
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),a,input,select,textarea,[tabindex='0']") ?? [])];
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);

  const refreshCaches = async () => {
    const [browser, disk] = await Promise.all([listBrowserCaches(), listDiskCaches()]);
    setCaches([...disk, ...browser]);
  };
  const testConnection = async () => {
    if (busy || !model.trim()) return;
    const checkedProvider = provider;
    const checkedModel = model.trim();
    const startedAt = performance.now();
    setBusy(true);
    setMessage("");
    setConnectionCheck({
      provider: checkedProvider,
      model: checkedModel,
      kind: "running",
      detail: language === "it" ? "Richiesta reale in corso…" : "Live request in progress…",
    });
    try {
      const result = await settingsRequest<{ ok: boolean; model: string }>({ action: "test", provider: checkedProvider, model: checkedModel });
      const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
      setConnectionCheck({
        provider: checkedProvider,
        model: result.model,
        kind: "success",
        detail: language === "it" ? `Connessione OK · risposta in ${elapsed} ms` : `Connection OK · response in ${elapsed} ms`,
      });
    } catch (error) {
      const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
      setConnectionCheck({
        provider: checkedProvider,
        model: checkedModel,
        kind: "error",
        detail: `${language === "it" ? "Connessione fallita" : "Connection failed"} · ${error instanceof Error ? error.message : String(error)} · ${elapsed} ms`,
      });
    } finally {
      setBusy(false);
    }
  };

  return <div className="studio-settings-backdrop">
    <div ref={dialog} tabIndex={-1} className="studio-settings-dialog" role="dialog" aria-modal="true" aria-label={t.title}>
      <header>
        <div className="settings-title-mark" aria-hidden="true">M</div>
        <div><h1>{t.title}</h1><small>{t.subtitle}</small></div>
        <button className="settings-close" aria-label={t.close} onClick={onClose}>×</button>
      </header>
      <div className="studio-settings-body">
        <nav aria-label={t.title}>{(["keys", "history", "cache", "restore"] as const).map((id) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); setMessage(""); if (id === "cache") void run(refreshCaches); }}><NavIcon id={id} /><span>{t[id]}</span></button>)}</nav>
        <main>
          <div className="settings-section-heading"><span>{tab === "keys" ? "01" : tab === "history" ? "02" : tab === "cache" ? "03" : "04"}</span><h2>{t[tab]}</h2></div>
          {message ? <p className={`settings-feedback ${messageKind === "error" ? "is-error" : "is-success"}`} role="status">{message}</p> : null}

          {tab === "keys" ? <div className="settings-api-layout">
            <section className="settings-api-zone settings-api-llm">
              <div className="settings-zone-header"><div><small>AI ASSISTANT</small><h3>{t.lonelyTitle}</h3><p>{t.lonelyDescription}</p></div><span className="settings-zone-chip">LLM</span></div>
              <label className="settings-field">{t.activeLlm}<select aria-label={language === "it" ? "LLM attivo" : "Active LLM"} value={activeProvider} onChange={(event) => setActiveProvider(event.target.value as LlmProvider | "local")}>{Object.entries(providerLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="local">{t.localOnly}</option></select></label>
              <div className="settings-provider-heading"><span>{t.configure}</span><a href={providerCatalogUrls[provider]} target="_blank" rel="noreferrer">{t.officialCatalog} ↗</a></div>
              <div className="settings-provider-grid">{(Object.keys(providerLabels) as LlmProvider[]).map((id) => {
                const item = settings?.providers[id];
                return <button type="button" key={id} className={`settings-provider-card provider-${id}`} aria-pressed={provider === id} onClick={() => chooseProvider(id)}>
                  <span className="settings-provider-logo"><ProviderLogo provider={id} /></span>
                  <span><strong>{providerLabels[id]}</strong><small>{item?.configured ? t.configured : t.notConfigured}</small></span>
                  <i className={item?.configured ? "is-ready" : ""} aria-hidden="true" />
                </button>;
              })}</div>
              <div className="settings-provider-editor">
                <div className="settings-provider-editor-title"><ProviderLogo provider={provider} /><div><strong>{providerLabels[provider]}</strong><span className={config?.configured ? "is-ready" : ""}>{config?.configured ? t.present : t.absent}{config ? ` · ${t.source}: ${config.keySource}` : ""}</span></div></div>
                <label className="settings-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />{t.enabled}</label>
                <label className="settings-field">{t.model}<select aria-label={t.model} value={model} disabled={busy} onChange={(event) => { setModel(event.target.value); setConnectionCheck(null); }}>{!currentModelIsListed ? <option value={model}>{model} · current</option> : null}{catalog.map((item) => <option key={item.id} value={item.id} disabled={item.disabled}>{item.label}{item.note ? ` · ${item.note}` : ""}</option>)}</select><code>{model}</code></label>
                <label className="settings-field">{t.key}<input type="password" value={key} autoComplete="new-password" onChange={(event) => setKey(event.target.value)} placeholder="••••••••••••" /></label>
                {connectionCheck?.provider === provider ? <div className={`settings-connection-status is-${connectionCheck.kind}`} role="status" aria-live="polite"><i aria-hidden="true" /><span><strong>{providerLabels[connectionCheck.provider]} · {connectionCheck.model}</strong><small>{connectionCheck.detail}</small></span></div> : null}
                <fieldset className="settings-field" data-ui-copy>
                  <legend>{language === "it" ? "Limiti API del provider" : "Provider API limits"}</legend>
                  <label><input type="checkbox" checked={limits.enabled} onChange={event => setLimits({ ...limits, enabled: event.target.checked })} />{language === "it" ? "Applica limiti e accoda le richieste in ordine" : "Apply limits and queue requests in order"}</label>
                  {limits.enabled && <>
                    <label>{language === "it" ? "Richieste massime" : "Maximum requests"}<input type="number" min={1} max={100000} value={limits.requests} onChange={event => setLimits({ ...limits, requests: Math.max(1, Number(event.target.value)) })} /></label>
                    <label>{language === "it" ? "Ogni (secondi): 1 = al secondo, 60 = al minuto" : "Per (seconds): 1 = per second, 60 = per minute"}<input type="number" min={1} max={3600} value={limits.windowSeconds} onChange={event => setLimits({ ...limits, windowSeconds: Math.max(1, Number(event.target.value)) })} /></label>
                    <label>{language === "it" ? "Contesto massimo in token (0 = nessun limite configurato)" : "Maximum context tokens (0 = no configured limit)"}<input type="number" min={0} max={2000000} value={limits.contextTokens} onChange={event => setLimits({ ...limits, contextTokens: Math.max(0, Number(event.target.value)) })} /></label>
                    <small>{language === "it" ? "Il contesto include richiesta e risposta. Reports riduce i campioni con una stima prudenziale; non altera i dati originali." : "Context includes input and output. Reports reduces samples using a conservative estimate; source data stays intact."}</small>
                  </>}
                </fieldset>
                <div className="settings-actions settings-provider-actions">
                  <button className="is-primary" disabled={busy || !model.trim()} onClick={() => void run(async () => { const next = await saveLlmSettings({ provider, activeProvider, model: model.trim(), enabled, limits, ...(key.trim() ? { apiKey: key.trim() } : {}) }); setSettings(next); setKey(""); succeed(t.saved); })}>{t.save}</button>
                  <button disabled={busy || !config?.configured || !model.trim()} onClick={() => void testConnection()}>{t.test}</button>
                  <button disabled={busy || config?.keySource !== "settings"} onClick={() => void run(async () => { setSettings(await saveLlmSettings({ provider, activeProvider, model, enabled, apiKey: "" })); setKey(""); succeed(t.saved); })}>{t.reset}</button>
                  <button className="is-danger" disabled={busy || !config?.configured} onClick={() => void run(async () => { setSettings(await saveLlmSettings({ provider, model, enabled, removeKey: true })); setKey(""); succeed(t.saved); })}>{language === "it" ? "Rimuovi chiave" : "Remove key"}</button>
                </div>
              </div>
              <p className="settings-privacy">⌾ {t.privacy}</p>
            </section>
            <section className="settings-api-zone settings-api-future">
              <div className="settings-zone-header"><div><small>EXTENSIONS</small><h3>{t.otherApis}</h3><p>{t.otherApisDescription}</p></div><span className="settings-zone-chip">API</span></div>
              <div className="settings-empty-state"><span aria-hidden="true">＋</span><strong>{t.noOtherApis}</strong><small>{language === "it" ? "Qui compariranno API per servizi audio, video, pubblicazione e automazioni." : "APIs for audio, video, publishing and automation services will appear here."}</small></div>
            </section>
          </div> : null}

          {tab === "history" ? <section className="settings-simple-section"><div className="settings-list-toolbar"><p>{language === "it" ? "Operazioni recenti eseguite in MLSM Studio." : "Recent operations run in MLSM Studio."}</p><button disabled={busy || !tasks.length} onClick={() => { clearTaskHistory(); setTasks(readTaskHistory()); }}>{t.clearHistory}</button></div>{!tasks.length ? <div className="settings-empty-state"><span aria-hidden="true">✓</span><strong>{t.empty}</strong></div> : <ol className="settings-history">{tasks.map((task) => <li key={task.id}><strong>{task.label}</strong><span>{t[task.status]} · {new Date(task.startedAt).toLocaleString(language)}{task.finishedAt ? ` · ${((task.finishedAt - task.startedAt) / 1000).toFixed(1)} s` : ""}</span>{task.detail ? <small>{task.detail}</small> : null}</li>)}</ol>}</section> : null}

          {tab === "cache" ? <section className="settings-simple-section"><div className="settings-list-toolbar"><p>{t.cacheHint}</p><button disabled={busy} onClick={() => void run(refreshCaches)}>{t.refresh}</button></div>{hasActiveTasks() ? <p className="settings-feedback is-error">{t.busy}</p> : null}<div className="settings-caches">{caches.map((entry) => <article key={`${entry.kind}:${entry.id}`}><div className="settings-cache-icon" aria-hidden="true">{entry.kind === "disk" ? "▣" : "◈"}</div><div><strong>{entry.label}</strong><small>{entry.location}</small><span>{entry.bytes === null ? t.unknown : `${(entry.bytes / 1024 / 1024).toFixed(1)} MiB`}{entry.entries !== undefined ? ` · ${entry.entries} ${t.files}` : ""}</span></div>{pending?.id === entry.id && pending.kind === entry.kind ? <div className="settings-actions"><button className="is-danger" disabled={busy} onClick={() => void run(async () => { await clearCacheEntry(entry); setPending(null); await refreshCaches(); succeed(t.done); })}>{t.confirm}</button><button onClick={() => setPending(null)}>{t.cancel}</button></div> : <button disabled={busy || hasActiveTasks()} onClick={() => setPending(entry)}>{t.clear}</button>}</article>)}</div>{!busy && !caches.length ? <div className="settings-empty-state"><span aria-hidden="true">↻</span><strong>{language === "it" ? "Premi Aggiorna elenco per misurare le cache." : "Select Refresh list to measure caches."}</strong></div> : null}</section> : null}

          {tab === "restore" ? <RestoreSettingsPanel language={language} /> : null}

          {busy ? <p className="settings-busy" role="status"><i />{t.running}…</p> : null}
        </main>
      </div>
    </div>
  </div>;
}
