import { useCallback, useState } from "react";
import type { SmartSubtitleAgentTarget, SubtitleGenerationEvent } from "../services/subtitle-generation";

export interface LoggedGenerationEvent {
  id: string;
  createdAt: number;
  event: SubtitleGenerationEvent;
}

export interface SmartSubtitleGenerationController {
  open: boolean;
  running: boolean;
  outcome: "idle" | "success" | "error";
  events: LoggedGenerationEvent[];
  begin: (message?: string) => void;
  receive: (event: SubtitleGenerationEvent) => void;
  finish: (cueCount: number, verifiedCount: number) => void;
  fail: (message: string) => void;
  beginInteraction: (target: SmartSubtitleAgentTarget, message: string) => void;
  finishInteraction: (cueCount: number, changedCount: number) => void;
  failInteraction: (message: string) => void;
  reopen: () => void;
  close: () => void;
}

export function useSmartSubtitleGeneration(): SmartSubtitleGenerationController {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<SmartSubtitleGenerationController["outcome"]>("idle");
  const [events, setEvents] = useState<LoggedGenerationEvent[]>([]);
  const append = useCallback((event: SubtitleGenerationEvent) => {
    setEvents((current) => [...current.slice(-399), { id: crypto.randomUUID(), createdAt: Date.now(), event }]);
  }, []);
  const begin = useCallback((message = "Preparazione della pipeline locale…") => {
    setEvents([{ id: crypto.randomUUID(), createdAt: Date.now(), event: { type: "stage", stage: "setup", progress: 1, message, indeterminate: true } }]);
    setOpen(true); setRunning(true); setOutcome("idle");
  }, []);
  const finish = useCallback((cueCount: number, verifiedCount: number) => {
    append({ type: "stage", stage: "final", progress: 100, message: `${cueCount} blocchi generati · ${verifiedCount} verificati · timeline aggiornata.` });
    setRunning(false); setOutcome("success"); setOpen(true);
  }, [append]);
  const fail = useCallback((message: string) => {
    append({ type: "stage", stage: "final", progress: 100, message: `Errore: ${message}` });
    setRunning(false); setOutcome("error"); setOpen(true);
  }, [append]);
  const beginInteraction = useCallback((target: SmartSubtitleAgentTarget, message: string) => {
    append({ type: "user-message", stage: "agents", progress: 100, target, message });
    setOpen(true); setRunning(true); setOutcome("idle");
  }, [append]);
  const finishInteraction = useCallback((cueCount: number, changedCount: number) => {
    append({ type: "stage", stage: "final", progress: 100, message: `Intervento completato · ${changedCount} modifiche validate · ${cueCount} blocchi in timeline.` });
    setRunning(false); setOutcome("success"); setOpen(true);
  }, [append]);
  const failInteraction = useCallback((message: string) => {
    append({ type: "stage", stage: "final", progress: 100, message: `Intervento non applicato: ${message}` });
    setRunning(false); setOutcome("error"); setOpen(true);
  }, [append]);
  const reopen = useCallback(() => setOpen(true), []);
  const close = useCallback(() => { if (!running) setOpen(false); }, [running]);
  return { open, running, outcome, events, begin, receive: append, finish, fail, beginInteraction, finishInteraction, failInteraction, reopen, close };
}
