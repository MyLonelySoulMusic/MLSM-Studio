import { DiscordLink } from "../components/DiscordLink";
import { useEffect, useMemo, useRef, useState } from "react";
import { MemoryButton } from "../components/MemoryStudio";
import { SettingsButton } from "../components/StudioSettings";
import { SupportArtistButton } from "../components/ArtistSupport";
import { useUiPreferences } from "../services/ui-preferences";
import { documentationTopics } from "./documentation-content";
import { lexicalDocumentationSearch, semanticDocumentationSearch, type DocumentationSearchMode, type DocumentationSearchResult } from "./documentation-search";
import "./documentation.css";

const copy = {
  it: { eyebrow: "MLSM STUDIO · GUIDA COMPLETA", title: "Documentation", intro: "Scopri ogni area, segui i flussi operativi e trova una funzione descrivendo ciò che vuoi fare.", search: "Cerca per obiettivo, problema o funzione…", searchLabel: "Ricerca intelligente nella documentazione", local: "Ricerca intelligente locale", lexical: "Risultati immediati", semantic: "MiniLM · risultati semantici", fallback: "MiniLM non disponibile · ricerca locale per testo", all: "Tutta la documentazione", results: "Risultati", noResults: "Nessun risultato. Prova a descrivere il risultato che vuoi ottenere.", how: "Come funziona", functions: "Funzioni", privacy: "La ricerca resta sul dispositivo: nessuna query viene inviata a servizi esterni.", home: "Torna alle aree", open: "Apri sezione", loading: "Preparazione ricerca semantica…" },
  en: { eyebrow: "MLSM STUDIO · COMPLETE GUIDE", title: "Documentation", intro: "Explore every workspace, follow operational flows and find a feature by describing what you need.", search: "Search by goal, issue or feature…", searchLabel: "Intelligent documentation search", local: "Local intelligent search", lexical: "Instant results", semantic: "MiniLM · semantic results", fallback: "MiniLM unavailable · local text search", all: "All documentation", results: "Results", noResults: "No results. Try describing the outcome you want.", how: "How it works", functions: "Features", privacy: "Search stays on this device: no query is sent to external services.", home: "Back to workspaces", open: "Open section", loading: "Preparing semantic search…" },
} as const;

export function DocumentationWorkspace({ onHome }: { onHome: () => void }) {
  const { language, theme, setLanguage, setTheme } = useUiPreferences();
  const text = copy[language];
  const topics = useMemo(() => documentationTopics(language), [language]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<DocumentationSearchMode>("idle");
  const [status, setStatus] = useState<string>(text.local);
  const [results, setResults] = useState<DocumentationSearchResult[]>(() => lexicalDocumentationSearch("", topics));
  const request = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const current = ++request.current;
    const immediate = lexicalDocumentationSearch(trimmed, topics);
    setResults(immediate);
    if (trimmed.length < 2) { setMode("idle"); setStatus(text.local); return; }
    setMode("lexical"); setStatus(text.lexical);
    const timer = window.setTimeout(() => {
      setStatus(text.loading);
      void semanticDocumentationSearch(trimmed, topics, (message) => { if (request.current === current) setStatus(language === "it" ? message : text.loading); })
        .then((semantic) => { if (request.current === current) { setResults(semantic); setMode("semantic"); setStatus(text.semantic); } })
        .catch(() => { if (request.current === current) { setMode("fallback"); setStatus(text.fallback); } });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [language, query, topics, text.fallback, text.lexical, text.loading, text.local, text.semantic]);

  const openTopic = (result: DocumentationSearchResult) => {
    const target = document.getElementById(`documentation-${result.topic.id}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => target?.querySelector<HTMLElement>(result.featureIndex === undefined ? "h2" : `[data-feature-index="${result.featureIndex}"]`)?.focus({ preventScroll: true }), 420);
  };

  return <main className="documentation-workspace" aria-label="Documentation" data-ui-copy>
    <header className="documentation-topbar">
      <button type="button" className="documentation-home" onClick={onHome} aria-label={text.home}>← <span>{text.home}</span></button>
      <div className="documentation-brand"><img src="/mlsm-studio-favicon-192.png" alt="" /><strong>MLSM Studio</strong><span>/ {text.title}</span></div>
      <div className="documentation-preferences">
        <DiscordLink /><SettingsButton />
        <MemoryButton compact />
        <SupportArtistButton compact />
        <select aria-label={language === "it" ? "Lingua" : "Language"} value={language} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "it")}>
          <option value="it">IT</option><option value="en">EN</option>
        </select>
        <button type="button" onClick={() => setTheme(theme === "day" ? "night" : "day")} aria-label={language === "it" ? (theme === "day" ? "Tema scuro" : "Tema chiaro") : (theme === "day" ? "Dark theme" : "Light theme")}>{theme === "day" ? "◐" : "☼"}</button>
      </div>
    </header>
    <section className="documentation-hero">
      <div><span>{text.eyebrow}</span><h1>{text.title}</h1><p>{text.intro}</p></div>
      <div className={`documentation-search is-${mode}`}>
        <label htmlFor="documentation-query">{text.searchLabel}</label>
        <div><span aria-hidden="true">⌕</span><input id="documentation-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} autoComplete="off" /><i aria-hidden="true" /></div>
        <footer><span className="documentation-search-status" role="status"><b />{status}</span><small>{text.privacy}</small></footer>
      </div>
    </section>
    <div className="documentation-layout">
      <aside className="documentation-index"><strong>{query.trim() ? `${text.results} · ${results.length}` : text.all}</strong><nav>{(query.trim() ? results.map((result) => result.topic) : topics).map((item) => <a key={item.id} href={`#documentation-${item.id}`}>{item.title}</a>)}</nav></aside>
      <section className="documentation-content">
        {query.trim() ? <div className="documentation-results" aria-live="polite">{results.length ? results.map((result, index) => <button key={result.topic.id} type="button" onClick={() => openTopic(result)}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{result.topic.eyebrow}</small><strong>{result.topic.title}</strong><p>{result.featureIndex === undefined ? result.topic.summary : result.topic.features[result.featureIndex]?.description}</p></div><em>{text.open} ↘</em></button>) : <p>{text.noResults}</p>}</div> : null}
        {topics.map((item, topicIndex) => <article id={`documentation-${item.id}`} className="documentation-topic" key={item.id}>
          <header><span>{String(topicIndex + 1).padStart(2, "0")} · {item.eyebrow}</span><h2 tabIndex={-1}>{item.title}</h2><p>{item.summary}</p></header>
          <section><h3>{text.how}</h3><ol>{item.steps.map((step) => <li key={step}>{step}</li>)}</ol></section>
          <section><h3>{text.functions}</h3><div className="documentation-feature-grid">{item.features.map((feature, index) => <div key={feature.title} data-feature-index={index} tabIndex={-1}><span>{String(index + 1).padStart(2, "0")}</span><h4>{feature.title}</h4><p>{feature.description}</p></div>)}</div></section>
        </article>)}
      </section>
    </div>
  </main>;
}
