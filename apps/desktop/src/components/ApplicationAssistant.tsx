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
import type { UiLanguage } from "../services/ui-preferences";

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
const assistantCopy = {
  it: { welcome: "Ciao, sono Lonely Bot. Conosco la pagina che stai usando, posso spiegarti ogni controllo, portarti nell’area corretta e avviare Upscaler o Frame Booster dai file che alleghi qui.", initialStatus: "Lonely Bot · API configurabile · fallback locale automatico", close: "Chiudi Lonely Bot", you: "Tu", open: "Apri", review: "verifica", running: "in esecuzione", completed: "completato", error: "errore", cancelled: "annullato", model: "Modello", scale: "Scala", method: "Metodo", multiplier: "Moltiplicatore", start: "Avvia", cancel: "Annulla", download: "Scarica", explain: "Spiega questa pagina", explainPrompt: "Spiegami passo per passo questa pagina e ogni controllo visibile.", upscaler: "Portami all’Upscaler", files: "File necessari", attach: "Allega file", question: "Domanda per Lonely Bot", placeholder: "Chiedi aiuto o allega i file e avvia un lavoro…", send: "Invia domanda", local: "Locale", memory: "memoria", request: "richiesta", requests: "richieste", clearLabel: "Azzera memoria Lonely Bot", clear: "Azzera memoria", openLabel: "Apri Lonely Bot", unavailable: "LLM non disponibile", localAnswer: "Risposta locale", vector: "Vector DB locale", verifiedVector: "Risposta verificata dalla knowledge base vettoriale", verifiedLocal: "Risposta verificata sul database vettoriale locale", knowledgeUpdated: "conoscenza aggiornata dal codice" },
  en: { welcome: "Hi, I’m Lonely Bot. I understand the page you are using, can explain every control, take you to the right workspace, and start Upscaler or Frame Booster from files attached here.", initialStatus: "Lonely Bot · configurable API · automatic local fallback", close: "Close Lonely Bot", you: "You", open: "Open", review: "review", running: "running", completed: "completed", error: "error", cancelled: "cancelled", model: "Model", scale: "Scale", method: "Method", multiplier: "Multiplier", start: "Start", cancel: "Cancel", download: "Download", explain: "Explain this page", explainPrompt: "Explain this page and every visible control step by step.", upscaler: "Take me to Upscaler", files: "Required files", attach: "Attach files", question: "Question for Lonely Bot", placeholder: "Ask for help, or attach files and start a job…", send: "Send question", local: "Local", memory: "memory", request: "request", requests: "requests", clearLabel: "Clear Lonely Bot memory", clear: "Clear memory", openLabel: "Open Lonely Bot", unavailable: "LLM unavailable", localAnswer: "Local answer", vector: "Local Vector DB", verifiedVector: "Answer verified against the vector knowledge base", verifiedLocal: "Answer verified against the local vector database", knowledgeUpdated: "knowledge updated from code" },
} as const;

function welcomeMessage(language: UiLanguage): ChatMessage { return { id: "assistant-welcome", role: "assistant", content: assistantCopy[language].welcome }; }

function replySourceLabel(message: ChatMessage, language: UiLanguage): string | null {
  const copy = assistantCopy[language];
  if (message.source && message.source in providerLabels) return `${providerLabels[message.source as LlmProvider]} · ${message.model ?? ""}`;
  if (message.source === "local-llm") return `${preferredLocalAssistantLabel}${message.providerError ? ` · ${message.providerError}` : ""}`;
  if (message.source === "unavailable") return copy.unavailable;
  if (message.source === "built-in") return copy.localAnswer;
  if (message.source !== "knowledge-base") return null;
  if (!message.fallbackReason) return copy.vector;
  if (message.fallbackReason === "model-loading") return `${copy.vector} · ${preferredLocalAssistantLabel} ${language === "it" ? "in preparazione" : "loading"}`;
  if (message.fallbackReason === "model-timeout") return `${copy.vector} · ${preferredLocalAssistantLabel} ${language === "it" ? "oltre il tempo limite" : "timed out"}`;
  if (message.fallbackReason === "response-rejected") return `${copy.vector} · ${language === "it" ? "risposta scartata" : "answer rejected"}`;
  return `${copy.vector} · ${preferredLocalAssistantLabel} ${language === "it" ? "non disponibile" : "unavailable"}`;
}

function replyStatus(reply: ApplicationAssistantReply, language: UiLanguage): string {
  const copy = assistantCopy[language];
  if (reply.source in providerLabels) return `${providerLabels[reply.source as LlmProvider]} · ${reply.model}${reply.knowledgeUpdated ? ` · ${copy.knowledgeUpdated}` : ""}`;
  if (reply.source === "unavailable") return copy.unavailable;
  if (reply.source === "local-llm") return copy.verifiedLocal;
  if (reply.source === "built-in") return copy.localAnswer;
  return copy.verifiedVector;
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
  const copy = assistantCopy[language];
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [welcomeMessage(language)]);
  const [memory, setMemory] = useState<ApplicationAssistantMemory>(loadAssistantMemory);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>(copy.initialStatus);
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
  useEffect(() => { setMessages((current) => current.length === 1 && current[0]?.id === "assistant-welcome" ? [welcomeMessage(language)] : current); setStatus((current) => Object.values(assistantCopy).some((value) => value.initialStatus === current) ? copy.initialStatus : current); }, [copy.initialStatus, language]);
  useEffect(() => { const show = () => setOpen(true); window.addEventListener(OPEN_LONELY_BOT_EVENT, show); return () => window.removeEventListener(OPEN_LONELY_BOT_EVENT, show); }, []);
  useEffect(() => { try { localStorage.setItem(APPLICATION_ASSISTANT_MEMORY_KEY, JSON.stringify(memory)); } catch { /* session-only memory */ } }, [memory]);
  useEffect(() => () => { workflowAbort.current?.abort(); releaseArtifacts(); }, []);

  const appendAssistant = (content: string, extra: Partial<ChatMessage> = {}) => setMessages((current) => [...current, { id: `assistant-reply-${crypto.randomUUID()}`, role: "assistant", content, ...extra }]);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if ((!text && !attachments.length) || running || workflow?.status === "running") return;
    const attachmentNote = attachments.length ? `\n\n${language === "it" ? "Allegati" : "Attachments"}: ${attachments.map((file) => file.name).join(", ")}` : "";
    const userMessage: ChatMessage = { id: `assistant-user-${crypto.randomUUID()}`, role: "user", content: text ? `${text}${attachmentNote}` : `${language === "it" ? "Ho allegato" : "I attached"} ${attachments.map((file) => file.name).join(", ")}.` };
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, userMessage]); setQuestion("");
    if (!text) {
      appendAssistant(language === "it" ? "Ho ricevuto i file. Dimmi se vuoi avviare Upscaler o Frame Booster: controllerò subito che quantità e formati siano corretti." : "I received the files. Tell me whether to start Upscaler or Frame Booster; I will first validate file count and formats.");
      return;
    }
    const workflowKind = detectLonelyBotWorkflow(text);
    if (workflowKind) {
      const validation = validateLonelyBotWorkflow(workflowKind, attachments);
      if (validation) { appendAssistant(validation); return; }
      releaseArtifacts();
      const config = { ...defaultLonelyBotWorkflowConfig, kind: workflowKind };
      setWorkflow({ kind: workflowKind, config, status: "review", progress: 0, message: language === "it" ? "File verificati. Controlla le opzioni facoltative e premi Avvia." : "Files verified. Review the optional settings and select Start.", artifacts: [] });
      const navigation = suggestAssistantDestination(text, context.modeId);
      appendAssistant(language === "it" ? `${attachments.length} ${attachments.length === 1 ? "file verificato" : "file verificati"}. Le impostazioni sotto sono facoltative e hanno già valori sicuri; il lavoro partirà solo quando premi Avvia.` : `${attachments.length} ${attachments.length === 1 ? "file verified" : "files verified"}. The settings below are optional and already have safe defaults; the job starts only after you select Start.`, navigation ? { navigation } : {});
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
      setStatus(replyStatus(reply, language));
    } catch {
      finishTask("failed");
      const content = language === "it" ? "Non riesco a completare la risposta locale. I controlli della pagina restano disponibili: riprova indicando il nome esatto del pulsante o del menu." : "I cannot complete the local answer. The page controls remain available; retry using the exact button or menu name.";
      appendAssistant(content, { source: "knowledge-base" });
      setMemory((current) => updateApplicationAssistantMemory(current, text, content));
      setStatus(language === "it" ? "Errore del modello · vector DB locale ancora disponibile" : "Model error · local Vector DB still available");
    } finally { setRunning(false); }
  };

  const startWorkflow = async () => {
    if (!workflow || workflow.status === "running") return;
    const controller = new AbortController(); workflowAbort.current = controller;
    setWorkflow((current) => current ? { ...current, status: "running", progress: 0, message: `${language === "it" ? "Avvio" : "Starting"} ${workflowLabel(current.kind)}…`, artifacts: [] } : current);
    try {
      const artifacts = await runLonelyBotWorkflow({ config: workflow.config, files: attachments, signal: controller.signal, onProgress: (value) => setWorkflow((current) => current ? { ...current, progress: Math.max(0, Math.min(1, value.progress)), message: value.message } : current) });
      const ready = artifacts.map((artifact) => { const url = URL.createObjectURL(artifact.blob); artifactUrls.current.push(url); return { ...artifact, url }; });
      setWorkflow((current) => current ? { ...current, status: "completed", progress: 1, message: language === "it" ? `${workflowLabel(current.kind)} completato e verificato.` : `${workflowLabel(current.kind)} completed and verified.`, artifacts: ready } : current);
      appendAssistant(language === "it" ? `${workflowLabel(workflow.kind)} completato. Puoi scaricare ${ready.length === 1 ? "il file" : "i file"} dal risultato qui sotto.` : `${workflowLabel(workflow.kind)} completed. Download ${ready.length === 1 ? "the file" : "the files"} from the result below.`);
      setAttachments([]);
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      setWorkflow((current) => current ? { ...current, status: cancelled ? "cancelled" : "error", message: cancelled ? (language === "it" ? "Operazione annullata." : "Operation cancelled.") : error instanceof Error ? error.message : String(error) } : current);
    } finally { workflowAbort.current = null; }
  };

  const updateWorkflow = (patch: Partial<LonelyBotWorkflowConfig>) => setWorkflow((current) => current && current.status === "review" ? { ...current, config: { ...current.config, ...patch } } : current);

  const workflowStatus = workflow ? copy[workflow.status] : "";
  return <div className={`application-assistant${open ? " open" : ""}`} data-ui-copy>
    {open ? <section className="assistant-chat lonely-bot-chat" aria-label="Lonely Bot">
      <header><span className="assistant-avatar" aria-hidden="true">LB</span><div><strong>Lonely Bot</strong><small>{status}</small></div><button aria-label={copy.close} onClick={() => setOpen(false)}>×</button></header>
      <div className="assistant-messages" ref={scroll} aria-live="polite">
        {messages.map((message) => <article key={message.id} className={message.role}><span>{message.role === "assistant" ? "Lonely Bot" : copy.you}</span><p>{message.content}</p>{message.navigation && onNavigate ? <button className="assistant-navigation" type="button" onClick={() => onNavigate(message.navigation!.modeId)}>{copy.open} {message.navigation.label} →</button> : null}{replySourceLabel(message, language) ? <small>{replySourceLabel(message, language)}</small> : null}</article>)}
        {running ? <article className="assistant thinking"><span>Lonely Bot</span><p><i /><i /><i /></p></article> : null}
        {workflow ? <article className={`assistant-workflow is-${workflow.status}`}>
          <span>{workflowLabel(workflow.kind)} · {workflowStatus}</span>
          {workflow.status === "review" ? <div className="assistant-workflow-options">
            {workflow.kind === "upscaler" ? <><label>{copy.model}<select value={workflow.config.model} onChange={(event) => updateWorkflow({ model: event.target.value as LonelyBotWorkflowConfig["model"] })}>{lonelyBotUpscalerModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label><label>{copy.scale}<select value={workflow.config.scale} onChange={(event) => updateWorkflow({ scale: Number(event.target.value) as 2 | 4 })}><option value="2">2×</option><option value="4">4×</option></select></label></> : <><label>{copy.method}<select value={workflow.config.frameMethod} onChange={(event) => updateWorkflow({ frameMethod: event.target.value as LonelyBotWorkflowConfig["frameMethod"] })}><option value="motion">Motion AOBMC</option><option value="motion-obmc">Motion OBMC bidirectional</option><option value="blend">Frame blend</option></select></label><label>{copy.multiplier}<select value={workflow.config.frameMultiplier} onChange={(event) => updateWorkflow({ frameMultiplier: Number(event.target.value) as 2 | 3 | 4 })}><option value="2">2×</option><option value="3">3×</option><option value="4">4×</option></select></label></>}
            <button type="button" onClick={() => void startWorkflow()}>{copy.start} {workflowLabel(workflow.kind)}</button>
          </div> : null}
          {workflow.status !== "review" ? <><div className="assistant-workflow-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(workflow.progress * 100)}><i style={{ width: `${Math.round(workflow.progress * 100)}%` }} /></div><p>{workflow.message}</p></> : <p>{workflow.message}</p>}
          {workflow.status === "running" ? <button type="button" onClick={() => workflowAbort.current?.abort()}>{copy.cancel}</button> : null}
          {workflow.artifacts.map((artifact) => <a key={artifact.url} className="assistant-download" href={artifact.url} download={artifact.name}>{copy.download} {artifact.name}</a>)}
        </article> : null}
      </div>
      {messages.length === 1 ? <div className="assistant-suggestions"><button onClick={() => setQuestion(copy.explainPrompt)}>{copy.explain}</button><button onClick={() => setQuestion(language === "it" ? "Dove devo andare per fare un upscaling?" : "Where do I go to upscale an image or video?")}>{copy.upscaler}</button><button onClick={() => setQuestion(language === "it" ? "Quali file servono per questa funzione?" : "Which files does this feature require?")}>{copy.files}</button></div> : null}
      {attachments.length ? <div className="assistant-attachments">{attachments.map((file, index) => <span key={`${file.name}-${file.lastModified}-${index}`}>{file.name}<button type="button" aria-label={`${language === "it" ? "Rimuovi" : "Remove"} ${file.name}`} onClick={() => setAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div> : null}
      <form onSubmit={(event) => void ask(event)}><input ref={fileInput} type="file" multiple hidden onChange={(event) => { const files = [...(event.target.files ?? [])]; setAttachments((current) => [...current, ...files]); event.target.value = ""; }} /><button className="assistant-attach" type="button" aria-label={copy.attach} onClick={() => fileInput.current?.click()}>＋</button><textarea aria-label={copy.question} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={copy.placeholder} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type="submit" disabled={(!question.trim() && !attachments.length) || running} aria-label={copy.send}>↑</button></form>
      <footer><span>{copy.local} · {copy.memory}: {memory.turnCount} {memory.turnCount === 1 ? copy.request : copy.requests}</span><button type="button" aria-label={copy.clearLabel} onClick={() => { workflowAbort.current?.abort(); releaseArtifacts(); setMemory(emptyApplicationAssistantMemory); setMessages([welcomeMessage(language)]); setAttachments([]); setWorkflow(null); localStorage.removeItem(APPLICATION_ASSISTANT_MEMORY_KEY); localStorage.removeItem(legacyAssistantMemoryKey); }}>{copy.clear}</button></footer>
    </section> : hideLauncher ? null : <button className="assistant-launcher" aria-label={copy.openLabel} onClick={() => setOpen(true)}><span>LB</span><strong>Lonely Bot</strong></button>}
  </div>;
}
