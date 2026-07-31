import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { SmartSubtitleGenerationController } from "../hooks/use-smart-subtitle-generation";
import type { SmartSubtitleAgentTarget } from "../services/subtitle-generation";

const stageLabels = [
  { id: "setup", label: "Modelli", threshold: 2 },
  { id: "whisper", label: "Whisper", threshold: 20 },
  { id: "editing", label: "Allineamento", threshold: 52 },
  { id: "agents", label: "3 agenti", threshold: 58 },
  { id: "final", label: "Finale", threshold: 96 }
] as const;

function initialPosition(): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 420, y: 70 };
  return { x: Math.max(16, Math.round((window.innerWidth - 680) / 2)), y: Math.max(16, Math.round((window.innerHeight - 620) / 2)) };
}

export interface SmartSubtitleAgentInstructionResult {
  cueCount: number;
  changedCount: number;
}

interface SmartSubtitleGenerationModalProps {
  controller: SmartSubtitleGenerationController;
  canInteract?: boolean;
  interactiveDisabledReason?: string;
  onAgentInstruction?: (message: string, target: SmartSubtitleAgentTarget) => Promise<SmartSubtitleAgentInstructionResult>;
}

function agentTargetLabel(target: SmartSubtitleAgentTarget): string {
  if (target === "transcript-editor") return "A1";
  if (target === "timing-director") return "A2";
  if (target === "quality-supervisor") return "A3";
  return "A1+A2+A3";
}

export function SmartSubtitleGenerationModal({ controller, canInteract = true, interactiveDisabledReason, onAgentInstruction }: SmartSubtitleGenerationModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const conversationScroll = useRef<HTMLDivElement>(null);
  const consoleScroll = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [position, setPosition] = useState(initialPosition);
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [instruction, setInstruction] = useState("");
  const [target, setTarget] = useState<SmartSubtitleAgentTarget>("all");
  const [submitting, setSubmitting] = useState(false);
  const firstTimestamp = controller.events[0]?.createdAt ?? now;
  const latest = controller.events.at(-1)?.event;
  const progress = latest?.progress ?? 0;
  const whisper = [...controller.events].reverse().find((entry) => entry.event.type === "whisper-output")?.event;
  const conversationEvents = controller.events.filter((entry) => entry.event.type === "agent" || entry.event.type === "user-message");
  const stageEvents = controller.events.filter((entry) => entry.event.type === "stage");
  const latestMessage = latest?.type === "whisper-output"
    ? `Whisper completato · ${latest.document.words.length} parole e ${latest.document.phrases.length} frasi rilevate.`
    : latest?.message;

  useEffect(() => {
    if (!controller.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [controller.running]);
  useEffect(() => { if (controller.running) setCollapsed(false); }, [controller.running]);
  useEffect(() => {
    if (conversationScroll.current) conversationScroll.current.scrollTop = conversationScroll.current.scrollHeight;
    if (consoleScroll.current) consoleScroll.current.scrollTop = consoleScroll.current.scrollHeight;
  }, [controller.events]);

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : 0;
    const active = drag.current; if (!active || active.pointerId !== pointerId || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const bounds = panel.current?.getBoundingClientRect(); const width = bounds?.width ?? 680; const height = bounds?.height ?? 620;
    setPosition({
      x: Math.max(8, Math.min(window.innerWidth - Math.min(width, 120), event.clientX - active.offsetX)),
      y: Math.max(8, Math.min(window.innerHeight - Math.min(height, 72), event.clientY - active.offsetY))
    });
  };
  const stopDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : 0;
    if (drag.current?.pointerId !== pointerId) return;
    drag.current = null;
    if (!event.currentTarget.hasPointerCapture || event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture?.(pointerId);
  };
  const submitInstruction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = instruction.replace(/\s+/g, " ").trim();
    if (!message || !onAgentInstruction || !canInteract || controller.running || submitting) return;
    setSubmitting(true);
    controller.beginInteraction(target, message);
    setInstruction("");
    try {
      const result = await onAgentInstruction(message, target);
      controller.finishInteraction(result.cueCount, result.changedCount);
    } catch (error) {
      controller.failInteraction(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (!controller.open) return null;
  const elapsed = Math.max(0, now - firstTimestamp) / 1000;
  return <div
    ref={panel}
    className={`smart-subtitle-modal${collapsed ? " collapsed" : ""}${controller.outcome === "error" ? " failed" : ""}`}
    style={{ left: position.x, top: position.y }}
    role="dialog"
    aria-modal="false"
    aria-label="Smart Subtitles generation"
  >
    <header
      className="smart-subtitle-drag"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
        const bounds = panel.current?.getBoundingClientRect(); if (!bounds) return;
        const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : 0;
        drag.current = { pointerId, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
        event.currentTarget.setPointerCapture?.(pointerId);
      }}
      onPointerMove={move}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <span className="smart-subtitle-grip" aria-hidden="true">⠿</span>
      <div><strong>Smart Subtitles generation</strong><small>{controller.running ? `In elaborazione · ${elapsed.toFixed(1)} s` : controller.outcome === "success" ? `Completato · ${elapsed.toFixed(1)} s` : controller.outcome === "error" ? "Operazione interrotta" : "Redazione pronta per le istruzioni"}</small></div>
      <button type="button" aria-label={collapsed ? "Espandi log generazione" : "Riduci log generazione"} onClick={() => setCollapsed((value) => !value)}>{collapsed ? "□" : "—"}</button>
      <button type="button" aria-label="Chiudi log generazione" disabled={controller.running} title={controller.running ? "La finestra potrà essere chiusa al termine" : "Chiudi"} onClick={controller.close}>×</button>
    </header>
    {collapsed ? <div className="smart-subtitle-collapsed-status"><span>{latestMessage ?? "Preparazione…"}</span><strong>{Math.round(progress)}%</strong></div> : <>
      <div className="smart-subtitle-progress">
        <div className="smart-subtitle-progress-track" aria-label={`Avanzamento generazione ${Math.round(progress)}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span className={latest?.type === "stage" && latest.indeterminate ? "indeterminate" : ""} style={{ width: `${Math.max(2, progress)}%` }} /></div>
        <strong>{Math.round(progress)}%</strong>
        <p>{latestMessage ?? "Preparazione…"}</p>
      </div>
      <div className="smart-subtitle-stages">{stageLabels.map((stage, index) => {
        const active = latest?.stage === stage.id; const done = progress > (stageLabels[index + 1]?.threshold ?? 100) || progress === 100;
        return <span key={stage.id} className={active ? "active" : done ? "done" : ""}><i>{done ? "✓" : index + 1}</i>{stage.label}</span>;
      })}</div>
      <div className="smart-subtitle-content">
        <section className="smart-whisper-output">
          <header><div><span>WHISPER OUTPUT</span><strong>{whisper?.type === "whisper-output" ? `${whisper.document.words.length} parole · ${whisper.document.phrases.length} frasi` : "Trascrizione in attesa"}</strong></div>{whisper?.type === "whisper-output" ? <em>{whisper.document.model.replace("_timestamped", "").replace("whisper-", "Whisper ")}</em> : null}</header>
          {whisper?.type === "whisper-output" ? <pre>{whisper.document.transcript || "Whisper non ha rilevato parlato."}</pre> : <div className="smart-whisper-waiting"><i /><i /><i /><span>Il testo apparirà appena Whisper termina la decodifica.</span></div>}
        </section>
        <section className="smart-agent-conversation">
          <header><span>REDAZIONE LOCALE</span><strong>Tre agenti condividono contesto e rapporti</strong></header>
          <div ref={conversationScroll}>{conversationEvents.length ? conversationEvents.map((entry) => {
            if (entry.event.type === "user-message") return <article key={entry.id} className="user-message">
              <span>TU</span>
              <div><header><strong>Istruzione dell’utente</strong><small>destinatario {agentTargetLabel(entry.event.target)}</small></header><p>{entry.event.message}</p></div>
            </article>;
            if (entry.event.type !== "agent") return null;
            const shortName = entry.event.agentId === "transcript-editor" ? "A1" : entry.event.agentId === "timing-director" ? "A2" : "A3";
            return <article key={entry.id} className={`${entry.event.agentId} ${entry.event.state}`}>
              <span>{shortName}</span>
              <div><header><strong>{entry.event.agentName}</strong><small>{entry.event.interactive ? "intervento" : "passaggio"} {entry.event.turn}/{entry.event.totalTurns}</small></header><em>{entry.event.specialty}</em><p>{entry.event.state === "thinking" ? <><i /><i /><i /> {entry.event.message}</> : entry.event.message}</p></div>
            </article>;
          }) : <p className="smart-agent-waiting">Gli agenti inizieranno a confrontarsi dopo l’output Whisper e l’allineamento iniziale.</p>}</div>
        </section>
      </div>
      {onAgentInstruction ? <section className="smart-agent-composer">
        <header><div><span>PARLA CON GLI AGENTI</span><strong>Le correzioni validate vengono applicate direttamente alla timeline</strong></div><small>timestamp protetti</small></header>
        <form onSubmit={(event) => void submitInstruction(event)}>
          <select aria-label="Agente destinatario" value={target} disabled={controller.running || submitting} onChange={(event) => setTarget(event.target.value as SmartSubtitleAgentTarget)}>
            <option value="all">Tutti e tre · revisione coordinata</option>
            <option value="transcript-editor">A1 · Transcript Editor</option>
            <option value="timing-director">A2 · Timing Director</option>
            <option value="quality-supervisor">A3 · Quality Supervisor</option>
          </select>
          <textarea
            aria-label="Istruzione per gli agenti"
            rows={2}
            value={instruction}
            disabled={controller.running || submitting || !canInteract}
            placeholder="Es. Nel blocco 7 correggi “strade vuote”; poi unisci 11 e 12 perché appartengono alla stessa frase."
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" disabled={!instruction.trim() || controller.running || submitting || !canInteract}>{controller.running || submitting ? "Agenti al lavoro…" : "Invia e correggi"}</button>
        </form>
        <p>{canInteract ? "A1 corregge il testo, A2 struttura e tempi, A3 verifica qualità. Usa Shift+Invio per andare a capo." : interactiveDisabledReason ?? "Genera o importa prima dei sottotitoli e abilita il modello locale."}</p>
      </section> : null}
      <section className="smart-generation-console">
        <header><span>LOG TECNICO</span><small>{stageEvents.length} eventi</small></header>
        <div ref={consoleScroll}>{stageEvents.map((entry) => entry.event.type === "stage" ? <p key={entry.id}><time>{new Date(entry.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span>{entry.event.message}</span></p> : null)}</div>
      </section>
      <footer><span>⠿ Trascina la barra superiore per spostare la finestra.</span><span>Elaborazione locale · nessun audio inviato online</span></footer>
    </>}
  </div>;
}
