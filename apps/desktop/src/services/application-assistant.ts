import { applicationHelpContext, fallbackApplicationHelpAnswer } from "../knowledge/application-help";
import { getLocalTextGenerator, localGeneratedAnswer, type LocalChatMessage } from "./local-model-runtime";

export interface ApplicationAssistantContext {
  modeId: string;
  modeLabel: string;
  aspectRatio: string;
  hasAudio: boolean;
  analysisReady: boolean;
}

export interface ApplicationAssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ApplicationAssistantReply {
  content: string;
  source: "local-llm" | "knowledge-base";
}

const assistantModel = "smollm2-135m-instruct";

function cleanAssistantReply(value: string): string {
  return value.replace(/^(assistant|assistente)\s*:\s*/i, "").replace(/\n{3,}/g, "\n\n").trim();
}

export async function answerApplicationQuestion(question: string, history: readonly ApplicationAssistantMessage[], context: ApplicationAssistantContext, progress?: (message: string) => void): Promise<ApplicationAssistantReply> {
  const fallback = fallbackApplicationHelpAnswer(question, context.modeId); const knowledge = applicationHelpContext(question, context.modeId, 3);
  const conversation: LocalChatMessage[] = [
    { role: "system", content: "Sei l’assistente integrato di Dynamic Sound Animation Studio. Rispondi in italiano, in modo breve, concreto e operativo. Usa esclusivamente la knowledge base fornita. Non inventare pulsanti o funzioni. Se un dettaglio non è documentato, dichiaralo. Tieni conto della modalità e dello stato corrente. Non parlare di API o servizi online: il software e il modello lavorano in locale." },
    ...history.slice(-6).map((message): LocalChatMessage => ({ role: message.role, content: message.content.slice(0, 700) })),
    { role: "user", content: `STATO CORRENTE\nModalità: ${context.modeLabel}\nFormato: ${context.aspectRatio}\nAudio: ${context.hasAudio ? "caricato" : "non caricato"}\nAnalisi: ${context.analysisReady ? "completata" : "non completata"}\n\nKNOWLEDGE BASE RECUPERATA\n${knowledge}\n\nDOMANDA\n${question.slice(0, 700)}\n\nFornisci al massimo 7 passaggi brevi quando è utile una procedura.` }
  ];
  try {
    progress?.("Caricamento SmolLM2 locale…");
    const generator = await getLocalTextGenerator(assistantModel, progress);
    progress?.("Consultazione della knowledge base…");
    const output = await generator(conversation, { max_new_tokens: 220, do_sample: false, repetition_penalty: 1.08 });
    const content = cleanAssistantReply(localGeneratedAnswer(output));
    if (!content) return { content: fallback, source: "knowledge-base" };
    return { content, source: "local-llm" };
  } catch {
    return { content: fallback, source: "knowledge-base" };
  }
}
