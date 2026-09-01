import { useEffect, useMemo, useRef, useState } from "react";
import {
  createPerformancePromptPlan,
  generateVocalPerformancePromptWithLocalLlm,
  performancePromptSeconds,
  renderVocalPerformancePromptExtension,
  splitPerformancePromptPlan,
  type PerformancePromptExtension,
  type PerformancePromptPlan
} from "../services/mlsm-performance-prompt";
import { preferredLocalAssistantLabel } from "../services/local-model-runtime";

type UiLanguage = "it" | "en";

const modalCopy = {
  it: {
    eyebrow: "LIP SYNC / STRUMENTO INDIPENDENTE", title: "Generatore prompt performance", subtitle: "Crea il prompt dalla sola porzione SRT/VTT. Non avvia e non modifica l’analisi LIP SYNC.", close: "Chiudi generatore prompt",
    source: "Sottotitoli della clip", sourceHint: "Incolla soltanto i blocchi che devono essere cantati oppure importa un file SRT/VTT.", import: "Importa SRT / VTT", paste: "Contenuto SRT o VTT", defaultTab: "Prompt predefinito", llmTab: "Regia con LLM locale", scene: "Scena o regia desiderata", scenePlaceholder: "Es. interpretazione trattenuta all’inizio, poi più intensa; sguardo fisso sul microfono, movimenti minimi e luce cinematografica coerente con l’immagine.",
    useDefault: "Usa prompt predefinito", generate: "Genera con LLM locale", generating: "Controllo locale in corso…", result: "Prompt finale", prompt: "Prompt", extension: "Estensione video", copy: "Copia prompt", copied: "Prompt copiato", editable: "Il risultato resta modificabile prima della copia.",
    timeline: "Timeline rilevata", singing: "canto", pause: "pausa successiva", noPause: "nessuna pausa", frontier: "Se il generatore video produce risultati incoerenti, fai revisionare questo prompt anche da un modello di frontiera come GPT o Claude prima di creare nuovamente il video.",
    defaultStatus: "Prompt predefinito compilato con parole e tempi esatti.", splitStatus: "Timeline oltre 15 secondi: creati due prompt collegati per estensioni video consecutive.", llmReady: "Tre passaggi locali per ogni estensione: regia, controllo continuità/timing e revisione finale.", passesVerified: "passaggi verificati", empty: "Inserisci almeno un blocco SRT/VTT valido.", outputPlaceholder: "Il prompt finale apparirà qui."
  },
  en: {
    eyebrow: "LIP SYNC / INDEPENDENT TOOL", title: "Performance prompt generator", subtitle: "Build the prompt from the selected SRT/VTT excerpt only. It does not start or modify LIP SYNC analysis.", close: "Close prompt generator",
    source: "Clip subtitles", sourceHint: "Paste only the blocks that must be sung or import an SRT/VTT file.", import: "Import SRT / VTT", paste: "SRT or VTT content", defaultTab: "Default prompt", llmTab: "Local LLM direction", scene: "Requested scene or direction", scenePlaceholder: "E.g. restrained opening, then more intensity; eyes fixed on the microphone, minimal movement and cinematic lighting consistent with the image.",
    useDefault: "Use default prompt", generate: "Generate with local LLM", generating: "Local review running…", result: "Final prompt", prompt: "Prompt", extension: "Video extension", copy: "Copy prompt", copied: "Prompt copied", editable: "The result remains editable before copying.",
    timeline: "Detected timeline", singing: "singing", pause: "following pause", noPause: "no pause", frontier: "If the video generator produces inconsistent results, have a frontier model such as GPT or Claude review this prompt before generating the video again.",
    defaultStatus: "Default prompt filled with exact lyrics and timing.", splitStatus: "Timeline over 15 seconds: two linked prompts created for consecutive video extensions.", llmReady: "Three local passes for each extension: direction, continuity/timing audit and final review.", passesVerified: "verified passes", empty: "Enter at least one valid SRT/VTT block.", outputPlaceholder: "The final prompt will appear here."
  }
} as const;

function selectSubtitleFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".srt,.vtt,text/plain";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

function parsePlan(value: string): { plan: PerformancePromptPlan | null; extensions: PerformancePromptExtension[]; error: string | null } {
  if (!value.trim()) return { plan: null, extensions: [], error: null };
  try {
    const plan = createPerformancePromptPlan(value);
    return { plan, extensions: splitPerformancePromptPlan(plan), error: null };
  } catch (reason) { return { plan: null, extensions: [], error: reason instanceof Error ? reason.message : String(reason) }; }
}

function defaultPrompts(extensions: readonly PerformancePromptExtension[]): string[] {
  return extensions.map((extension) => renderVocalPerformancePromptExtension(extension));
}

export function MlsmPerformancePromptModal({ open, onClose, initialSubtitles = "", language }: {
  open: boolean;
  onClose: () => void;
  initialSubtitles?: string;
  language: UiLanguage;
}) {
  const t = modalCopy[language];
  const [subtitleDraft, setSubtitleDraft] = useState(initialSubtitles);
  const [sourceName, setSourceName] = useState("");
  const [mode, setMode] = useState<"default" | "llm">("default");
  const [sceneRequest, setSceneRequest] = useState("");
  const [outputs, setOutputs] = useState<string[]>([]);
  const [activeOutputIndex, setActiveOutputIndex] = useState(0);
  const [status, setStatus] = useState<string>(t.empty);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const subtitleTextareaRef = useRef<HTMLTextAreaElement>(null);
  const parsed = useMemo(() => parsePlan(subtitleDraft), [subtitleDraft]);

  useEffect(() => {
    if (!open) return;
    setSubtitleDraft(initialSubtitles);
    setSourceName("");
    setSceneRequest("");
    setMode("default");
    setCopied(false);
    setActiveOutputIndex(0);
    const initial = parsePlan(initialSubtitles);
    if (initial.plan) {
      setOutputs(defaultPrompts(initial.extensions));
      setStatus(initial.extensions.length > 1 ? t.splitStatus : t.defaultStatus);
    } else {
      setOutputs([]);
      setStatus(initial.error ?? t.empty);
    }
  }, [initialSubtitles, open, t.defaultStatus, t.empty, t.splitStatus]);

  useEffect(() => {
    if (!open || running) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open, running]);

  if (!open) return null;

  const importSubtitles = async () => {
    const file = await selectSubtitleFile();
    if (!file) return;
    const text = await file.text();
    setSourceName(file.name);
    setSubtitleDraft(text);
    const next = parsePlan(text);
    if (next.plan) {
      setOutputs(defaultPrompts(next.extensions));
      setActiveOutputIndex(0);
      setStatus(next.extensions.length > 1 ? t.splitStatus : t.defaultStatus);
    } else {
      setOutputs([]);
      setStatus(next.error ?? t.empty);
    }
  };

  const useDefault = () => {
    if (!parsed.plan) { setStatus(parsed.error ?? t.empty); return; }
    setOutputs(defaultPrompts(parsed.extensions));
    setActiveOutputIndex(0);
    setMode("default");
    setCopied(false);
    setStatus(parsed.extensions.length > 1 ? t.splitStatus : t.defaultStatus);
  };

  const generateWithLlm = async () => {
    if (running) return;
    if (!parsed.plan) {
      setStatus(parsed.error ?? t.empty);
      subtitleTextareaRef.current?.focus();
      return;
    }
    setMode("llm");
    setRunning(true);
    setCopied(false);
    // Keep a complete deterministic prompt visible even if the local model is
    // still downloading or one of its review passes fails.
    setOutputs(defaultPrompts(parsed.extensions));
    setActiveOutputIndex(0);
    try {
      let completedPasses = 0;
      for (const extension of parsed.extensions) {
        const generated = await generateVocalPerformancePromptWithLocalLlm({
          plan: extension.plan,
          sceneRequest,
          onProgress: (pass, total, message) => {
            const globalPass = extension.index * total + pass;
            setStatus(`${message}${pass ? ` · ${globalPass}/${total * extension.total}` : ` · ${extension.index + 1}/${extension.total}`}`);
          }
        });
        completedPasses += generated.passesCompleted;
        setOutputs((current) => current.map((prompt, index) => index === extension.index ? renderVocalPerformancePromptExtension(extension, generated.sceneDirection) : prompt));
      }
      setStatus(`${preferredLocalAssistantLabel} · ${completedPasses}/${parsed.extensions.length * 3} ${t.passesVerified}`);
    } catch (reason) {
      setStatus(`${reason instanceof Error ? reason.message : String(reason)} ${t.defaultStatus}`);
    } finally { setRunning(false); }
  };

  const copyOutput = async () => {
    const output = outputs[activeOutputIndex] ?? "";
    if (!output.trim()) return;
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(output);
    else {
      const textarea = document.createElement("textarea"); textarea.value = output; textarea.style.position = "fixed"; textarea.style.opacity = "0"; document.body.append(textarea); textarea.select(); document.execCommand("copy"); textarea.remove();
    }
    setCopied(true);
    setStatus(t.copied);
  };

  const activeOutput = outputs[activeOutputIndex] ?? "";
  const updateActiveOutput = (value: string) => setOutputs((current) => current.map((prompt, index) => index === activeOutputIndex ? value.replace(/[<>]/gu, "") : prompt));

  return <div className="lipsync-prompt-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !running) onClose(); }}>
    <section className="lipsync-prompt-modal" role="dialog" aria-modal="true" aria-labelledby="lipsync-prompt-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="lipsync-prompt-header"><div><small>{t.eyebrow}</small><h2 id="lipsync-prompt-title">{t.title}</h2><p>{t.subtitle}</p></div><button type="button" aria-label={t.close} disabled={running} onClick={onClose}>×</button></header>
      <div className="lipsync-prompt-body">
        <aside className="lipsync-prompt-source">
          <header><strong>{t.source}</strong><p>{t.sourceHint}</p></header>
          <button type="button" className="lipsync-prompt-import" disabled={running} onClick={() => void importSubtitles()}>{t.import}<span>{sourceName || "SRT / VTT"}</span></button>
          <label><span>{t.paste}</span><textarea ref={subtitleTextareaRef} aria-label={t.paste} rows={11} disabled={running} value={subtitleDraft} onChange={(event) => { setSubtitleDraft(event.target.value); setCopied(false); }} /></label>
          {parsed.error ? <p className="lipsync-prompt-error" role="alert">{parsed.error}</p> : null}
          {parsed.plan ? <section className="lipsync-prompt-timeline"><header><strong>{t.timeline}</strong><span>{performancePromptSeconds(parsed.plan.durationSeconds)} s</span></header>{parsed.plan.cues.map((cue) => <article key={`${cue.index}-${cue.startSeconds}`}><b>{String(cue.index + 1).padStart(2, "0")}</b><div><strong>{cue.lyrics}</strong><small>{performancePromptSeconds(cue.startSeconds)}–{performancePromptSeconds(cue.endSeconds)} s · {performancePromptSeconds(cue.durationSeconds)} s {t.singing}</small><em>{cue.pauseAfterSeconds > .001 ? `${performancePromptSeconds(cue.pauseAfterSeconds)} s ${t.pause}` : t.noPause}</em></div></article>)}</section> : null}
        </aside>
        <main className="lipsync-prompt-editor">
          <nav role="tablist" aria-label={t.title}><button type="button" role="tab" aria-selected={mode === "default"} className={mode === "default" ? "active" : ""} disabled={running} onClick={() => setMode("default")}>{t.defaultTab}</button><button type="button" role="tab" aria-selected={mode === "llm"} className={mode === "llm" ? "active" : ""} disabled={running} onClick={() => setMode("llm")}>{t.llmTab}</button></nav>
          {mode === "llm" ? <label className="lipsync-prompt-scene"><span>{t.scene}</span><textarea aria-label={t.scene} rows={4} disabled={running} value={sceneRequest} placeholder={t.scenePlaceholder} onChange={(event) => setSceneRequest(event.target.value)} /><small>{t.llmReady}</small></label> : <div className="lipsync-prompt-default-info"><strong>DEFAULT</strong><p>{t.defaultStatus}</p></div>}
          <div className="lipsync-prompt-actions"><button type="button" disabled={!parsed.plan || running} onClick={useDefault}>{t.useDefault}</button><button type="button" className="primary" disabled={running} onClick={() => void generateWithLlm()}>{running ? t.generating : parsed.plan ? `${t.generate} · ${parsed.extensions.length * 3}×` : t.generate}</button></div>
          {parsed.extensions.length > 1 ? <nav className="lipsync-prompt-output-tabs" aria-label={t.extension}>{parsed.extensions.map((extension) => <button type="button" key={extension.index} className={activeOutputIndex === extension.index ? "active" : ""} aria-pressed={activeOutputIndex === extension.index} onClick={() => { setActiveOutputIndex(extension.index); setCopied(false); }}><strong>{t.prompt} {extension.index + 1}</strong><small>{performancePromptSeconds(extension.sourceStartSeconds)}–{performancePromptSeconds(extension.sourceEndSeconds)} s</small></button>)}</nav> : null}
          <label className="lipsync-prompt-output"><span>{t.result}{outputs.length > 1 ? ` ${activeOutputIndex + 1}/${outputs.length}` : ""}<small>{t.editable}</small></span><textarea aria-label={t.result} rows={18} value={activeOutput} placeholder={t.outputPlaceholder} onChange={(event) => { updateActiveOutput(event.target.value); setCopied(false); }} /></label>
          <div className="lipsync-prompt-status" data-running={running}><span>{running ? <i /> : null}{status}</span><button type="button" disabled={!activeOutput.trim() || running} onClick={() => void copyOutput()}>{copied ? `✓ ${t.copied}` : t.copy}</button></div>
          <p className="lipsync-prompt-frontier">{t.frontier}</p>
        </main>
      </div>
    </section>
  </div>;
}
