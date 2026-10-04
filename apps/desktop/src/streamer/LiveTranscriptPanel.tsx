import { useEffect, useRef, useState } from "react";
import type { LiveTranscriptState } from "./live-transcript";

export function LiveTranscriptPanel({ state, enabled, onToggle, language, speechLanguage, onLanguage }: {
  state: LiveTranscriptState; enabled: boolean; onToggle: () => void; language: "it" | "en"; speechLanguage: string; onLanguage: (value: string) => void;
}) {
  const t = (it: string, en: string) => language === "it" ? it : en;
  const [showDraft, setShowDraft] = useState(() => {
    try { return localStorage.getItem("mlsm-streamer-transcript-display") !== "confirmed"; }
    catch { return true; }
  });
  const toggleDisplay = () => {
    const next = !showDraft; setShowDraft(next);
    try { localStorage.setItem("mlsm-streamer-transcript-display", next ? "live" : "confirmed"); } catch { /* Session preference still works. */ }
  };
  const visiblePartial = showDraft ? state.partial : "";
  const host = useRef<HTMLDivElement>(null); const last = state.phrases.at(-1);
  useEffect(() => { host.current?.scrollTo?.({ top: host.current.scrollHeight, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }, [last?.id, visiblePartial]);
  const startupLabels: Record<string, string> = {
    runtime: t("Preparazione Whisper-Streaming…", "Preparing Whisper-Streaming…"),
    dependencies: t("Installazione del motore MLX…", "Installing the MLX engine…"),
    download: t("Download dei pesi del modello…", "Downloading model weights…"),
    model: t("Caricamento del modello…", "Loading the model…"),
  };
  const statuses = {
    idle: t("Avvia l’audio: il testo apparirà dopo pochi secondi.", "Play audio: text will appear after a few seconds."),
    loading: startupLabels[state.stage] ?? t("Caricamento di Whisper dalla cache locale…", "Loading Whisper from the local cache…"),
    listening: t("In ascolto", "Listening"), transcribing: t("Trascrizione in corso…", "Transcribing…"),
    paused: t("In pausa", "Paused"), off: t("Trascrizione disattivata", "Transcription off"), error: t("Whisper non disponibile", "Whisper unavailable"),
  };
  return <section className={`sav-live-transcript is-${state.phase}`} aria-label={t("Trascrizione audio live", "Live audio transcript")}>
    <header><div><small>WHISPER STREAMING · {t("TESTO LIVE", "LIVE TEXT")}</small><span className="sav-live-status" role="status"><i />{statuses[state.phase]}{state.model ? ` · ${state.model} · ${state.backend.toUpperCase()}` : ""}</span></div><button type="button" aria-pressed={enabled} aria-label={t("Attiva trascrizione live", "Enable live transcription")} onClick={onToggle}>{enabled ? t("Disattiva", "Turn off") : t("Attiva", "Turn on")}</button></header>
    {state.phase === "loading" ? <div className="sav-whisper-setup"><progress aria-label={statuses.loading} {...(state.progress !== null ? { value: state.progress, max: 100 } : {})} /><span>{state.progress !== null ? `${state.progress}% · ` : ""}{t("Solo al primo utilizzo può richiedere alcuni minuti.", "First-time setup may take a few minutes.")}</span></div> : null}
    <div ref={host} className="sav-live-lines">
      {state.phrases.length ? state.phrases.map(phrase => <p key={phrase.id} className={phrase.id === last?.id && !visiblePartial ? "is-current" : "is-history"}>{phrase.text.split(/\s+/).map((word, index) => <span key={`${index}-${word}`} style={{ animationDelay: `${Math.min(index * 16, 160)}ms` }}>{word}{" "}</span>)}</p>) : !visiblePartial ? <div className="sav-live-placeholder"><span>“</span><p>{!showDraft && state.partial ? t("Attendo la conferma del testo…", "Waiting for confirmed text…") : statuses[state.phase]}</p></div> : null}
      {visiblePartial ? <div className="sav-live-provisional"><small>{t("Testo provvisorio · si aggiorna durante l’ascolto", "Provisional text · updates while listening")}</small><p className="is-current">{visiblePartial.split(/\s+/).map((word, index) => <span key={`${index}-${word}`}>{word}{" "}</span>)}</p></div> : null}
      {state.phase === "error" ? <div className="sav-live-error" role="alert">{state.detail}<button type="button" onClick={onToggle}>{t("Disattiva e riattiva per riprovare", "Turn off and on to retry")}</button></div> : null}
    </div>
    <footer><label>{t("Lingua audio", "Audio language")}<select value={speechLanguage} onChange={event => onLanguage(event.target.value)}><option value="auto">Auto</option><option value="it">Italiano</option><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="pt">Português</option></select></label><span>{state.lag > 6 ? t(`Ritardo ≈ ${Math.round(state.lag)} s`, `Delay ≈ ${Math.round(state.lag)} s`) : t("Locale · nessun audio inviato online", "Local · no audio sent online")}</span></footer>
    <button className="sav-live-display-toggle" type="button" aria-pressed={!showDraft} onClick={toggleDisplay} title={t("Il testo confermato può apparire con più ritardo.", "Confirmed text may appear with more delay.")}>{showDraft ? t("Solo testo confermato", "Confirmed text only") : t("Mostra elaborazione live", "Show live processing")}</button>
    <span className="sav-live-sr" aria-live="polite" aria-atomic="true">{visiblePartial || last?.text}</span>
  </section>;
}
