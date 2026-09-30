import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  APPLICATION_ASSISTANT_MEMORY_KEY,
  answerApplicationQuestion,
  captureAssistantPageDetails,
  emptyApplicationAssistantMemory,
  suggestAssistantDestination,
  updateApplicationAssistantMemory,
  type ApplicationAssistantContext,
  type ApplicationAssistantMemory,
  type ApplicationAssistantMessage,
  type ApplicationAssistantReply,
} from "../services/application-assistant";
import {
  defaultLonelyBotWorkflowConfig,
  detectLonelyBotWorkflow,
  lonelyBotUpscalerModels,
  runLonelyBotWorkflow,
  validateLonelyBotWorkflow,
  type LonelyBotArtifact,
  type LonelyBotWorkflowConfig,
  type LonelyBotWorkflowKind,
} from "../services/lonely-bot-workflows";
import { preferredLocalAssistantLabel } from "../services/local-model-runtime";
import { useUiPreferences } from "../services/ui-preferences";
import { beginTask } from "../services/task-history";
import { providerLabels, type LlmProvider } from "../services/studio-settings";

interface NavigationAction { modeId: string; label: string }
interface ChatMessage extends ApplicationAssistantMessage {
  id: string;
  source?: ApplicationAssistantReply["source"];
  fallbackReason?: ApplicationAssistantReply["fallbackReason"];
  model?: string;
  providerError?: string;
  navigation?: NavigationAction;
}

interface WorkflowState {
  kind: LonelyBotWorkflowKind;
  config: LonelyBotWorkflowConfig;
  status: "review" | "running" | "completed" | "error" | "cancelled";
  progress: number;
  message: string;
  artifacts: Array<LonelyBotArtifact & { url: string }>;
}

const legacyAssistantMemoryKey = "dynamic-sound-animation-studio.assistant-memory.v1";
export const OPEN_LONELY_BOT_EVENT = "mlsm:open-lonely-bot";
const welcomeMessage: ChatMessage = {
  id: "assistant-welcome",
  role: "assistant",
  content: "Ciao, sono Lonely Bot. Conosco la pagina che stai usando, posso spiegarti ogni controllo, portarti nell’area corretta e avviare Upscaler o Frame Booster dai file che alleghi qui.",
};

function replySourceLabel(message: ChatMessage): string | null {
  if (message.source && message.source in providerLabels) return `${providerLabels[message.source as LlmProvider]} · ${message.model ?? ""}`;
  if (message.source === "local-llm") return `${preferredLocalAssistantLabel}${message.providerError ? ` · ${message.providerError}` : ""}`;
  if (message.source === "unavailable") return "LLM non disponibile";
  if (message.source === "built-in") return "Risposta locale";
  if (message.source !== "knowledge-base") return null;
  if (!message.fallbackReason) return "Vector DB locale";
  if (message.fallbackReason === "model-loading") return `Vector DB locale · ${preferredLocalAssistantLabel} in preparazione`;
  if (message.fallbackReason === "model-timeout") return `Vector DB locale · ${preferredLocalAssistantLabel} oltre il tempo limite`;
  if (message.fallbackReason === "response-rejected") return `Vector DB locale · risposta ${preferredLocalAssistantLabel} scartata`;
  return `Vector DB locale · ${preferredLocalAssistantLabel} non disponibile`;
}

function replyStatus(reply: ApplicationAssistantReply): string {
  if (reply.source in providerLabels) return `${providerLabels[reply.source as LlmProvider]} · ${reply.model}${reply.knowledgeUpdated ? " · conoscenza aggiornata dal codice" : ""}`;
  if (reply.source === "unavailable") return "LLM non disponibile";
  if (reply.source === "local-llm") return "Risposta verificata sul database vettoriale locale";
  if (reply.source === "built-in") return "Risposta locale";
  return "Risposta verificata dalla knowledge base vettoriale";
}

function loadAssistantMemory(): ApplicationAssistantMemory {
  try {
    const stored = localStorage.getItem(APPLICATION_ASSISTANT_MEMORY_KEY);
    if (!stored) { localStorage.removeItem(legacyAssistantMemoryKey); return emptyApplicationAssistantMemory; }
    const parsed = JSON.parse(stored) as Partial<ApplicationAssistantMemory>;
    return { summary: typeof parsed.summary === "string" ? parsed.summary : "", turnCount: Number.isFinite(parsed.turnCount) ? Math.max(0, Number(parsed.turnCount)) : 0 };
  } catch { return emptyApplicationAssistantMemory; }
}

function workflowLabel(kind: LonelyBotWorkflowKind): string { return kind === "upscaler" ? "Upscaler" : "Frame Booster"; }

export function ApplicationAssistant({ context, onNavigate, hideLauncher = false }: { context: ApplicationAssistantContext; onNavigate?: (modeId: string) => void; hideLauncher?: boolean }) {
  const { language } = useUiPreferences();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [memory, setMemory] = useState<ApplicationAssistantMemory>(loadAssistantMemory);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Lonely Bot · API configurabile · fallback locale automatico");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const workflowAbort = useRef<AbortController | null>(null);
  const artifactUrls = useRef<string[]>([]);

  const releaseArtifacts = () => {
    for (const url of artifactUrls.current) URL.revokeObjectURL(url);
    artifactUrls.current = [];
  };

  useEffect(() => { if (open && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [messages, open, running, workflow]);
  useEffect(() => { const show = () => setOpen(true); window.addEventListener(OPEN_LONELY_BOT_EVENT, show); return () => window.removeEventListener(OPEN_LONELY_BOT_EVENT, show); }, []);
  useEffect(() => { try { localStorage.setItem(APPLICATION_ASSISTANT_MEMORY_KEY, JSON.stringify(memory)); } catch { /* session-only memory */ } }, [memory]);
  useEffect(() => () => { workflowAbort.current?.abort(); releaseArtifacts(); }, []);

  const appendAssistant = (content: string, extra: Partial<ChatMessage> = {}) => setMessages((current) => [...current, { id: `assistant-reply-${crypto.randomUUID()}`, role: "assistant", content, ...extra }]);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if ((!text && !attachments.length) || running || workflow?.status === "running") return;
    const attachmentNote = attachments.length ? `\n\nAllegati: ${attachments.map((file) => file.name).join(", ")}` : "";
    const userMessage: ChatMessage = { id: `assistant-user-${crypto.randomUUID()}`, role: "user", content: text ? `${text}${attachmentNote}` : `Ho allegato ${attachments.map((file) => file.name).join(", ")}.` };
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, userMessage]); setQuestion("");
    if (!text) {
      appendAssistant("Ho ricevuto i file. Dimmi se vuoi avviare Upscaler o Frame Booster: controllerò subito che quantità e formati siano corretti.");
      return;
    }
    const workflowKind = detectLonelyBotWorkflow(text);
    if (workflowKind) {
      const validation = validateLonelyBotWorkflow(workflowKind, attachments);
      if (validation) { appendAssistant(validation); return; }
      releaseArtifacts();
      const config = { ...defaultLonelyBotWorkflowConfig, kind: workflowKind };
      setWorkflow({ kind: workflowKind, config, status: "review", progress: 0, message: "File verificati. Controlla le opzioni facoltative e premi Avvia.", artifacts: [] });
      const navigation = suggestAssistantDestination(text, context.modeId);
      appendAssistant(`${attachments.length} ${attachments.length === 1 ? "file verificato" : "file verificati"}. Le impostazioni sotto sono facoltative e hanno già valori sicuri; il lavoro partirà solo quando premi Avvia.`, navigation ? { navigation } : {});
      return;
    }
    setRunning(true);
    const finishTask = beginTask("Lonely Bot");
    try {
      const settingsDialog = document.querySelector(".studio-settings-dialog");
      const reply = await answerApplicationQuestion(text, history, { ...context, ...(settingsDialog ? { modeId: "studioSettings", modeLabel: language === "it" ? "Impostazioni" : "Settings" } : {}), language, pageDetails: captureAssistantPageDetails(settingsDialog ?? document) }, setStatus, memory);
      const navigation = suggestAssistantDestination(text, context.modeId);
      appendAssistant(reply.content, { source: reply.source, ...(reply.fallbackReason ? { fallbackReason: reply.fallbackReason } : {}), ...(reply.model ? { model: reply.model } : {}), ...(reply.providerError ? { providerError: reply.providerError } : {}), ...(navigation ? { navigation } : {}) });
      if (reply.source !== "built-in" && reply.source !== "unavailable") setMemory((current) => updateApplicationAssistantMemory(current, text, reply.content));
      finishTask(reply.source === "unavailable" ? "failed" : "completed", reply.model ?? reply.source);
      setStatus(replyStatus(reply));
    } catch {
      finishTask("failed");
      const content = "Non riesco a completare la risposta locale. I controlli della pagina restano disponibili: riprova indicando il nome esatto del pulsante o del menu.";
      appendAssistant(content, { source: "knowledge-base" });
      setMemory((current) => updateApplicationAssistantMemory(current, text, content));
      setStatus("Errore del modello · vector DB locale ancora disponibile");
    } finally { setRunning(false); }
  };

  const startWorkflow = async () => {
    if (!workflow || workflow.status === "running") return;
    const controller = new AbortController(); workflowAbort.current = controller;
    setWorkflow((current) => current ? { ...current, status: "running", progress: 0, message: `Avvio ${workflowLabel(current.kind)}…`, artifacts: [] } : current);
    try {
      const artifacts = await runLonelyBotWorkflow({ config: workflow.config, files: attachments, signal: controller.signal, onProgress: (value) => setWorkflow((current) => current ? { ...current, progress: Math.max(0, Math.min(1, value.progress)), message: value.message } : current) });
      const ready = artifacts.map((artifact) => { const url = URL.createObjectURL(artifact.blob); artifactUrls.current.push(url); return { ...artifact, url }; });
      setWorkflow((current) => current ? { ...current, status: "completed", progress: 1, message: `${workflowLabel(current.kind)} completato e verificato.`, artifacts: ready } : current);
      appendAssistant(`${workflowLabel(workflow.kind)} completato. Puoi scaricare ${ready.length === 1 ? "il file" : "i file"} dal risultato qui sotto.`);
      setAttachments([]);
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      setWorkflow((current) => current ? { ...current, status: cancelled ? "cancelled" : "error", message: cancelled ? "Operazione annullata." : error instanceof Error ? error.message : String(error) } : current);
    } finally { workflowAbort.current = null; }
  };

  const updateWorkflow = (patch: Partial<LonelyBotWorkflowConfig>) => setWorkflow((current) => current && current.status === "review" ? { ...current, config: { ...current.config, ...patch } } : current);

  return <div className={`application-assistant${open ? " open" : ""}`}>
    {open ? <section className="assistant-chat lonely-bot-chat" aria-label="Lonely Bot">
      <header><span className="assistant-avatar" aria-hidden="true">LB</span><div><strong>Lonely Bot</strong><small>{status}</small></div><button aria-label="Chiudi Lonely Bot" onClick={() => setOpen(false)}>×</button></header>
      <div className="assistant-messages" ref={scroll} aria-live="polite">
        {messages.map((message) => <article key={message.id} className={message.role}><span>{message.role === "assistant" ? "Lonely Bot" : "Tu"}</span><p>{message.content}</p>{message.navigation && onNavigate ? <button className="assistant-navigation" type="button" onClick={() => onNavigate(message.navigation!.modeId)}>Apri {message.navigation.label} →</button> : null}{replySourceLabel(message) ? <small>{replySourceLabel(message)}</small> : null}</article>)}
        {running ? <article className="assistant thinking"><span>Lonely Bot</span><p><i /><i /><i /></p></article> : null}
        {workflow ? <article className={`assistant-workflow is-${workflow.status}`}>
          <span>{workflowLabel(workflow.kind)} · {workflow.status === "review" ? "verifica" : workflow.status}</span>
          {workflow.status === "review" ? <div className="assistant-workflow-options">
            {workflow.kind === "upscaler" ? <><label>Modello<select value={workflow.config.model} onChange={(event) => updateWorkflow({ model: event.target.value as LonelyBotWorkflowConfig["model"] })}>{lonelyBotUpscalerModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label><label>Scala<select value={workflow.config.scale} onChange={(event) => updateWorkflow({ scale: Number(event.target.value) as 2 | 4 })}><option value="2">2×</option><option value="4">4×</option></select></label></> : <><label>Metodo<select value={workflow.config.frameMethod} onChange={(event) => updateWorkflow({ frameMethod: event.target.value as LonelyBotWorkflowConfig["frameMethod"] })}><option value="motion">Motion AOBMC</option><option value="motion-obmc">Motion OBMC bidirezionale</option><option value="blend">Frame blend</option></select></label><label>Moltiplicatore<select value={workflow.config.frameMultiplier} onChange={(event) => updateWorkflow({ frameMultiplier: Number(event.target.value) as 2 | 3 | 4 })}><option value="2">2×</option><option value="3">3×</option><option value="4">4×</option></select></label></>}
            <button type="button" onClick={() => void startWorkflow()}>Avvia {workflowLabel(workflow.kind)}</button>
          </div> : null}
          {workflow.status !== "review" ? <><div className="assistant-workflow-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(workflow.progress * 100)}><i style={{ width: `${Math.round(workflow.progress * 100)}%` }} /></div><p>{workflow.message}</p></> : <p>{workflow.message}</p>}
          {workflow.status === "running" ? <button type="button" onClick={() => workflowAbort.current?.abort()}>Annulla</button> : null}
          {workflow.artifacts.map((artifact) => <a key={artifact.url} className="assistant-download" href={artifact.url} download={artifact.name}>Scarica {artifact.name}</a>)}
        </article> : null}
      </div>
      {messages.length === 1 ? <div className="assistant-suggestions"><button onClick={() => setQuestion("Spiegami passo per passo questa pagina e ogni controllo visibile.")}>Spiega questa pagina</button><button onClick={() => setQuestion("Dove devo andare per fare un upscaling?")}>Portami all’Upscaler</button><button onClick={() => setQuestion("Quali file servono per questa funzione?")}>File necessari</button></div> : null}
      {attachments.length ? <div className="assistant-attachments">{attachments.map((file, index) => <span key={`${file.name}-${file.lastModified}-${index}`}>{file.name}<button type="button" aria-label={`Rimuovi ${file.name}`} onClick={() => setAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div> : null}
      <form onSubmit={(event) => void ask(event)}><input ref={fileInput} type="file" multiple hidden onChange={(event) => { const files = [...(event.target.files ?? [])]; setAttachments((current) => [...current, ...files]); event.target.value = ""; }} /><button className="assistant-attach" type="button" aria-label="Allega file" onClick={() => fileInput.current?.click()}>＋</button><textarea aria-label="Domanda per Lonely Bot" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Chiedi aiuto o allega i file e avvia un lavoro…" rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type="submit" disabled={(!question.trim() && !attachments.length) || running} aria-label="Invia domanda">↑</button></form>
      <footer><span>Locale · memoria: {memory.turnCount} richieste</span><button type="button" aria-label="Azzera memoria Lonely Bot" onClick={() => { workflowAbort.current?.abort(); releaseArtifacts(); setMemory(emptyApplicationAssistantMemory); setMessages([welcomeMessage]); setAttachments([]); setWorkflow(null); localStorage.removeItem(APPLICATION_ASSISTANT_MEMORY_KEY); localStorage.removeItem(legacyAssistantMemoryKey); }}>Azzera memoria</button></footer>
    </section> : hideLauncher ? null : <button className="assistant-launcher" aria-label="Apri Lonely Bot" onClick={() => setOpen(true)}><span>LB</span><strong>Lonely Bot</strong></button>}
  </div>;
}
