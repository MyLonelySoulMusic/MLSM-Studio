import { DiscordLink } from "./DiscordLink";
import { SettingsButton } from "./StudioSettings";
import { useEffect, useRef, useState } from "react";
import { SupportArtistButton } from "./ArtistSupport";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { MemoryButton } from "./MemoryStudio";

const workspaceUrl = "/music/ai-quantizer/";
interface BootstrapStatus { status?: string; progress?: number; logs?: string[]; message?: string; runtime?: string }

const bootstrapCopy = {
  it: {
    connecting: "Connessione al runtime interno…", retrying: "Nuovo tentativo in corso…", retryError: "Impossibile riavviare il setup.",
    title: "Preparazione AI Quantizer", fallback: "MLSM sta creando o avviando il motore audio interno.", retry: "Riprova installazione",
    logLabel: "Log preparazione AI Quantizer", runtimeLog: "LOG RUNTIME", checking: "verifica", waiting: "In attesa del primo messaggio dal runtime…"
  },
  en: {
    connecting: "Connecting to the internal runtime…", retrying: "Starting a new attempt…", retryError: "Unable to restart setup.",
    title: "Preparing AI Quantizer", fallback: "MLSM is creating or starting the internal audio engine.", retry: "Retry installation",
    logLabel: "AI Quantizer setup log", runtimeLog: "RUNTIME LOG", checking: "checking", waiting: "Waiting for the first runtime message…"
  }
} as const;

const bootstrapTranslations: Readonly<Record<string, string>> = {
  "Connessione al runtime interno…": "Connecting to the internal runtime…",
  "Nuovo tentativo in corso…": "Starting a new attempt…",
  "Preparazione dell’ambiente Python interno in corso.": "Preparing the internal Python environment.",
  "Avvio del motore audio interno in corso.": "Starting the internal audio engine.",
  "Avvio del backend audio interno.": "Starting the internal audio backend.",
  "Installazione delle dipendenze nel runtime isolato. Questa operazione avviene una sola volta.": "Installing dependencies in the isolated runtime. This only happens once.",
  "Verifica dell’ambiente Python": "Checking the Python environment",
  "Creazione dell’ambiente isolato .venv-ai-quantizer": "Creating the isolated .venv-ai-quantizer environment",
  "Aggiornamento di pip": "Updating pip",
  "Installazione di Beat This, PyTorch e dipendenze audio": "Installing Beat This, PyTorch and audio dependencies",
  "Ambiente Python pronto, avvio del backend": "Python environment ready, starting the backend"
};

function localizeBootstrapText(value: string | undefined, language: "it" | "en", fallback: string) {
  if (!value) return fallback;
  if (language === "it") return value;
  const direct = bootstrapTranslations[value];
  if (direct) return direct;
  return value.replace(/^Installazione di Python (.+)$/, "Installing Python $1");
}

function localizeBootstrapStatus(value: string | undefined, language: "it" | "en", fallback: string) {
  if (!value) return fallback;
  if (language === "it") return value;
  return ({ checking: "checking", starting: "starting", "setting-up": "installing", blocked: "blocked", failed: "failed", ready: "ready" } as Record<string, string>)[value] ?? value;
}

export function AIQuantizerWorkspace({ onHome }: { onHome?: () => void }) {
  const { language, theme, setLanguage, setTheme } = useUiPreferences(); const copy = uiCopy[language];
  const localized = bootstrapCopy[language];
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameUrlRef = useRef(`${workspaceUrl}?lang=${language}&theme=${theme}`);
  const [status, setStatus] = useState<"checking" | "ready">("checking");
  const [bootstrap, setBootstrap] = useState<BootstrapStatus>({ progress: 0, logs: [], message: bootstrapCopy.it.connecting });
  useEffect(() => {
    let active = true;
    const check = () => fetch(`${workspaceUrl}api/health`).then(async (response) => {
      const health = await response.json() as BootstrapStatus;
      if (!active) return;
      const ready = response.ok && health.runtime === "mlsm-internal-ai-quantizer";
      setStatus(ready ? "ready" : "checking");
      if (!ready) setBootstrap(health);
    }).catch(() => { if (active) setStatus("checking"); });
    void check(); const timer = window.setInterval(check, 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: "mlsm-language", language }, window.location.origin);
    frameRef.current?.contentWindow?.postMessage({ type: "mlsm-theme", theme }, window.location.origin);
  }, [language, status, theme]);
  const retryBootstrap = async () => {
    setBootstrap((current) => ({ ...current, status: "starting", progress: 0, message: bootstrapCopy.it.retrying }));
    try {
      const response = await fetch(`${workspaceUrl}api/bootstrap/retry`, { method: "POST" });
      setBootstrap(await response.json() as BootstrapStatus);
    } catch (error) {
      setBootstrap((current) => ({ ...current, status: "failed", message: error instanceof Error ? error.message : localized.retryError }));
    }
  };
  return <div className="ai-quantizer-workspace">
    <header className="ai-quantizer-workspace__bar">
      <button type="button" className="home-button" onClick={onHome} aria-label={copy.home}>⌂ <span>{copy.home}</span></button>
      <div className="ai-quantizer-workspace__identity"><img src="/mlsm-studio-favicon-192.png" alt="" /><span><strong>MLSM Studio</strong><small>Music / AI Quantizer</small></span></div>
      <div className="ai-quantizer-workspace__status" data-status={status}><i />{status === "ready" ? (language === "it" ? "Motore audio pronto" : "Audio engine ready") : (language === "it" ? "Preparazione motore…" : "Preparing engine…")}</div>
      <div className="ai-quantizer-workspace__actions"><DiscordLink /><SettingsButton /><MemoryButton /><SupportArtistButton /><select aria-label={copy.language} value={language} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "it")}><option value="it">IT</option><option value="en">EN</option></select><button type="button" className="theme-toggle" onClick={() => setTheme(theme === "day" ? "night" : "day")}>{theme === "day" ? "☼" : "◐"}</button></div>
    </header>
    <div className="ai-quantizer-workspace__body">
      {status === "ready"
        ? <iframe ref={frameRef} title="MLSM Studio AI Quantizer" src={frameUrlRef.current} className="ai-quantizer-workspace__frame" allow="autoplay" onLoad={() => {
            frameRef.current?.contentWindow?.postMessage({ type: "mlsm-language", language }, window.location.origin);
            frameRef.current?.contentWindow?.postMessage({ type: "mlsm-theme", theme }, window.location.origin);
          }} />
        : <div className="ai-quantizer-workspace__preparing">
            <i aria-hidden="true" /><strong>{localized.title}</strong>
            <span>{localizeBootstrapText(bootstrap.message, language, localized.fallback)}</span>
            <div className="ai-quantizer-bootstrap-progress"><div><b style={{ width: `${Math.max(0, Math.min(100, bootstrap.progress ?? 0))}%` }} /></div><output>{Math.round(bootstrap.progress ?? 0)}%</output></div>
            {bootstrap.status === "failed" || bootstrap.status === "blocked" ? <button type="button" className="ai-quantizer-bootstrap-retry" onClick={() => void retryBootstrap()}>{localized.retry}</button> : null}
            <section className="ai-quantizer-bootstrap-log" aria-label={localized.logLabel}><header><b>{localized.runtimeLog}</b><small>{localizeBootstrapStatus(bootstrap.status, language, localized.checking)}</small></header><pre>{bootstrap.logs?.length ? bootstrap.logs.map((line) => localizeBootstrapText(line, language, line)).join("\n") : localized.waiting}</pre></section>
          </div>}
    </div>
  </div>;
}
