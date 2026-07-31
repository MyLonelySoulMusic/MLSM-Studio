import { useEffect, useRef, useState, type FormEvent } from "react";
import { APPLICATION_ASSISTANT_MEMORY_KEY, answerApplicationQuestion, emptyApplicationAssistantMemory, updateApplicationAssistantMemory, type ApplicationAssistantContext, type ApplicationAssistantMemory, type ApplicationAssistantMessage, type ApplicationAssistantReply } from "../services/application-assistant";
import { isLocalTextGeneratorReady, preferredLocalAssistantLabel, preferredLocalAssistantModel, warmLocalTextGenerator } from "../services/local-model-runtime";

interface ChatMessage extends ApplicationAssistantMessage {
  id: string;
  source?: ApplicationAssistantReply["source"];
  fallbackReason?: ApplicationAssistantReply["fallbackReason"];
}

const legacyAssistantMemoryKey = "dynamic-sound-animation-studio.assistant-memory.v1";

const welcomeMessage: ChatMessage = {
  id: "assistant-welcome",
  role: "assistant",
  content: "Ciao, sono Studio Bot. Dimmi cosa vuoi creare oppure dove sei bloccato: posso guidarti nell’avvio del progetto, nella modalità attiva, nell’analisi audio, nei sottotitoli, nella timeline, nella risoluzione dei problemi e nell’esportazione."
};

function replySourceLabel(message: ChatMessage): string | null {
  if (message.source === "local-llm") return `${preferredLocalAssistantLabel} · KB locale`;
  if (message.source === "built-in") return "Risposta conversazionale locale";
  if (message.source !== "knowledge-base") return null;
  if (message.fallbackReason === "model-loading") return `KB locale · ${preferredLocalAssistantLabel} ancora in preparazione`;
  if (message.fallbackReason === "model-timeout") return `KB locale · ${preferredLocalAssistantLabel} non ha risposto in tempo`;
  if (message.fallbackReason === "response-rejected") return `KB locale · risposta ${preferredLocalAssistantLabel} scartata dal controllo qualità`;
  return `KB locale · ${preferredLocalAssistantLabel} non disponibile`;
}

function replyStatus(reply: ApplicationAssistantReply): string {
  if (reply.source === "local-llm") return "Risposta generata dal modello locale";
  if (reply.source === "built-in") return "Risposta conversazionale locale";
  if (reply.fallbackReason === "model-loading") return `${preferredLocalAssistantLabel} ancora in preparazione · risposta verificata dalla knowledge base`;
  if (reply.fallbackReason === "model-timeout") return `${preferredLocalAssistantLabel} oltre il tempo limite · risposta verificata dalla knowledge base`;
  if (reply.fallbackReason === "response-rejected") return `Risposta ${preferredLocalAssistantLabel} non attendibile · sostituita dalla knowledge base`;
  return `${preferredLocalAssistantLabel} non disponibile · risposta verificata dalla knowledge base`;
}

function loadAssistantMemory(): ApplicationAssistantMemory {
  try {
    const stored = localStorage.getItem(APPLICATION_ASSISTANT_MEMORY_KEY);
    if (!stored) {
      localStorage.removeItem(legacyAssistantMemoryKey);
      return emptyApplicationAssistantMemory;
    }
    const parsed = JSON.parse(stored) as Partial<ApplicationAssistantMemory>;
    return { summary: typeof parsed.summary === "string" ? parsed.summary : "", turnCount: Number.isFinite(parsed.turnCount) ? Math.max(0, Number(parsed.turnCount)) : 0 };
  } catch { return emptyApplicationAssistantMemory; }
}

export function ApplicationAssistant({ context }: { context: ApplicationAssistantContext }) {
  const [open, setOpen] = useState(false); const [question, setQuestion] = useState(""); const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]); const [memory, setMemory] = useState<ApplicationAssistantMemory>(loadAssistantMemory); const [running, setRunning] = useState(false); const [status, setStatus] = useState(`${preferredLocalAssistantLabel} locale · knowledge base pronta`); const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [messages, open, running]);
  useEffect(() => { try { localStorage.setItem(APPLICATION_ASSISTANT_MEMORY_KEY, JSON.stringify(memory)); } catch { /* La chat continua anche senza persistenza. */ } }, [memory]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    if (isLocalTextGeneratorReady(preferredLocalAssistantModel)) { setStatus(`${preferredLocalAssistantLabel} pronto · knowledge base locale`); return; }
    setStatus(`Preparazione ${preferredLocalAssistantLabel}…`);
    void warmLocalTextGenerator(preferredLocalAssistantModel, (message) => { if (active) setStatus(message); }).then((ready) => {
      if (active) setStatus(ready ? `${preferredLocalAssistantLabel} pronto · knowledge base locale` : `${preferredLocalAssistantLabel} non disponibile · knowledge base locale attiva`);
    });
    return () => { active = false; };
  }, [open]);
  const ask = async (event: FormEvent) => {
    event.preventDefault(); const text = question.trim(); if (!text || running) return;
    const userMessage: ChatMessage = { id: `assistant-user-${crypto.randomUUID()}`, role: "user", content: text }; const history = messages.map(({ role, content }) => ({ role, content })); setMessages((current) => [...current, userMessage]); setQuestion(""); setRunning(true);
    try {
      const reply = await answerApplicationQuestion(text, history, context, setStatus, memory);
      setMessages((current) => [...current, { id: `assistant-reply-${crypto.randomUUID()}`, role: "assistant", content: reply.content, source: reply.source, fallbackReason: reply.fallbackReason }]);
      if (reply.source !== "built-in") setMemory((current) => updateApplicationAssistantMemory(current, text, reply.content));
      setStatus(replyStatus(reply));
    } catch {
      const content = "Non riesco a completare la generazione locale. Consulta i controlli della modalità attiva oppure riprova: la chat è stata sbloccata.";
      setMessages((current) => [...current, { id: `assistant-reply-${crypto.randomUUID()}`, role: "assistant", content, source: "knowledge-base" }]);
      setMemory((current) => updateApplicationAssistantMemory(current, text, content));
      setStatus("Errore inatteso del modello · risposta di sicurezza dalla knowledge base");
    } finally { setRunning(false); }
  };
  const quickAsk = (value: string) => { setQuestion(value); };
  return <div className={`application-assistant${open ? " open" : ""}`}>
    {open ? <section className="assistant-chat" aria-label="Assistente applicazione">
      <header><span className="assistant-avatar" aria-hidden="true">DS</span><div><strong>Assistente Studio</strong><small>{status}</small></div><button aria-label="Chiudi assistente" onClick={() => setOpen(false)}>×</button></header>
      <div className="assistant-messages" ref={scroll} aria-live="polite">{messages.map((message) => <article key={message.id} className={message.role}><span>{message.role === "assistant" ? "Studio Bot" : "Tu"}</span><p>{message.content}</p>{replySourceLabel(message) ? <small>{replySourceLabel(message)}</small> : null}</article>)}{running ? <article className="assistant thinking"><span>Studio Bot</span><p><i /><i /><i /></p></article> : null}</div>
      {messages.length === 1 ? <div className="assistant-suggestions"><button onClick={() => quickAsk("Presentati e dimmi in cosa puoi aiutarmi.")}>Cosa puoi fare?</button><button onClick={() => quickAsk("Come inizio un nuovo progetto?")}>Da dove inizio?</button><button onClick={() => quickAsk(`Come uso bene la modalità ${context.modeLabel}?`)}>Modalità attiva</button><button onClick={() => quickAsk("Come esporto il video alla massima qualità?")}>Come esporto?</button></div> : null}
      <form onSubmit={(event) => void ask(event)}><textarea aria-label="Domanda per l’assistente" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Chiedi come usare l’applicazione…" rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type="submit" disabled={!question.trim() || running} aria-label="Invia domanda">↑</button></form>
      <footer><span>Elaborazione locale · memoria: {memory.turnCount} richieste</span><button type="button" aria-label="Azzera memoria assistente" onClick={() => { setMemory(emptyApplicationAssistantMemory); setMessages([welcomeMessage]); localStorage.removeItem(APPLICATION_ASSISTANT_MEMORY_KEY); localStorage.removeItem(legacyAssistantMemoryKey); }}>Azzera memoria</button></footer>
    </section> : <button className="assistant-launcher" aria-label="Apri assistente applicazione" onClick={() => setOpen(true)}><span>?</span><strong>Guida</strong></button>}
  </div>;
}
