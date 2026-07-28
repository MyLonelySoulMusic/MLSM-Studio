import { useEffect, useRef, useState, type FormEvent } from "react";
import { answerApplicationQuestion, type ApplicationAssistantContext, type ApplicationAssistantMessage } from "../services/application-assistant";

interface ChatMessage extends ApplicationAssistantMessage {
  id: string;
  source?: "local-llm" | "knowledge-base";
}

const welcomeMessage: ChatMessage = {
  id: "assistant-welcome",
  role: "assistant",
  content: "Ciao. Sono l’assistente locale di Dynamic Sound Animation Studio. Posso guidarti nella modalità attiva, nell’analisi audio, nella timeline, nei sottotitoli e nell’esportazione."
};

export function ApplicationAssistant({ context }: { context: ApplicationAssistantContext }) {
  const [open, setOpen] = useState(false); const [question, setQuestion] = useState(""); const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]); const [running, setRunning] = useState(false); const [status, setStatus] = useState("SmolLM2 locale · knowledge base pronta"); const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [messages, open, running]);
  const ask = async (event: FormEvent) => {
    event.preventDefault(); const text = question.trim(); if (!text || running) return;
    const userMessage: ChatMessage = { id: `assistant-user-${crypto.randomUUID()}`, role: "user", content: text }; const history = messages.map(({ role, content }) => ({ role, content })); setMessages((current) => [...current, userMessage]); setQuestion(""); setRunning(true);
    try {
      const reply = await answerApplicationQuestion(text, history, context, setStatus);
      setMessages((current) => [...current, { id: `assistant-reply-${crypto.randomUUID()}`, role: "assistant", content: reply.content, source: reply.source }]);
      setStatus(reply.source === "local-llm" ? "Risposta generata in locale" : "Risposta dalla knowledge base locale");
    } finally { setRunning(false); }
  };
  const quickAsk = (value: string) => { setQuestion(value); };
  return <div className={`application-assistant${open ? " open" : ""}`}>
    {open ? <section className="assistant-chat" aria-label="Assistente applicazione">
      <header><span className="assistant-avatar" aria-hidden="true">DS</span><div><strong>Assistente Studio</strong><small>{status}</small></div><button aria-label="Chiudi assistente" onClick={() => setOpen(false)}>×</button></header>
      <div className="assistant-messages" ref={scroll} aria-live="polite">{messages.map((message) => <article key={message.id} className={message.role}><span>{message.role === "assistant" ? "Studio Bot" : "Tu"}</span><p>{message.content}</p>{message.source ? <small>{message.source === "local-llm" ? "SmolLM2 · KB locale" : "KB locale · fallback"}</small> : null}</article>)}{running ? <article className="assistant thinking"><span>Studio Bot</span><p><i /><i /><i /></p></article> : null}</div>
      {messages.length === 1 ? <div className="assistant-suggestions"><button onClick={() => quickAsk("Come inizio un nuovo progetto?")}>Da dove inizio?</button><button onClick={() => quickAsk(`Come uso bene la modalità ${context.modeLabel}?`)}>Modalità attiva</button><button onClick={() => quickAsk("Come esporto il video alla massima qualità?")}>Come esporto?</button></div> : null}
      <form onSubmit={(event) => void ask(event)}><textarea aria-label="Domanda per l’assistente" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Chiedi come usare l’applicazione…" rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type="submit" disabled={!question.trim() || running} aria-label="Invia domanda">↑</button></form>
      <footer>Elaborazione locale · nessun dato inviato online</footer>
    </section> : <button className="assistant-launcher" aria-label="Apri assistente applicazione" onClick={() => setOpen(true)}><span>?</span><strong>Guida</strong></button>}
  </div>;
}
