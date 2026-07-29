import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  ready: false,
  warm: vi.fn(),
  generator: vi.fn()
}));

vi.mock("./local-model-runtime", () => ({
  isLocalTextGeneratorReady: () => runtime.ready,
  warmLocalTextGenerator: runtime.warm,
  getLocalTextGenerator: async () => runtime.generator,
  localGeneratedAnswer: (output: { generated_text?: string }[]) => output[0]?.generated_text ?? ""
}));

import { APPLICATION_ASSISTANT_SYSTEM_PROMPT, answerApplicationQuestion, emptyApplicationAssistantMemory, isGroundedApplicationAnswer, summarizeApplicationConversation, updateApplicationAssistantMemory } from "./application-assistant";

const context = { modeId: "walkingCube", modeLabel: "Cube Animation", aspectRatio: "9:16", hasAudio: true, analysisReady: true };

describe("application assistant runtime", () => {
  beforeEach(() => { vi.useRealTimers(); runtime.ready = false; runtime.warm.mockReset(); runtime.generator.mockReset(); });

  it("risponde subito dalla knowledge base mentre prepara il modello in background", async () => {
    const reply = await answerApplicationQuestion("Come cambio lo sfondo?", [], context);
    expect(reply.source).toBe("knowledge-base");
    expect(reply.content.length).toBeGreaterThan(40);
    expect(runtime.warm).toHaveBeenCalledOnce();
  });

  it("usa un prompt base vincolato all'interfaccia reale", () => {
    expect(APPLICATION_ASSISTANT_SYSTEM_PROMPT).toContain("Non inventare pulsanti");
    expect(APPLICATION_ASSISTANT_SYSTEM_PROMPT).toContain("memoria riassunta");
    expect(APPLICATION_ASSISTANT_SYSTEM_PROMPT).toContain("Rispondi in italiano");
    expect(APPLICATION_ASSISTANT_SYSTEM_PROMPT).toContain("NON_DOCUMENTATO");
  });

  it("riassume e limita la memoria mantenendo i turni recenti", () => {
    let memory = emptyApplicationAssistantMemory;
    for (let index = 0; index < 20; index += 1) memory = updateApplicationAssistantMemory(memory, `Domanda ${index} ${"x".repeat(180)}`, `Risposta ${index} ${"y".repeat(280)}`);
    expect(memory.turnCount).toBe(20);
    expect(memory.summary.length).toBeLessThanOrEqual(1800);
    expect(memory.summary).toContain("Domanda 19");
    const summary = summarizeApplicationConversation([{ role: "user", content: "Dove carico la cover?" }, { role: "assistant", content: "Nel pannello sinistro." }]);
    expect(summary).toContain("Dove carico la cover?");
    expect(summary).toContain("Nel pannello sinistro.");
  });

  it("usa SmolLM2 quando è pronto senza perdere la memoria", async () => {
    runtime.ready = true;
    runtime.generator.mockResolvedValue([{ generated_text: "Usa il controllo Sfondo immagine nel pannello sinistro." }]);
    const memory = updateApplicationAssistantMemory(emptyApplicationAssistantMemory, "Come carico la cover?", "Dal pannello sinistro.");
    const reply = await answerApplicationQuestion("E lo sfondo?", [], context, undefined, memory);
    expect(reply).toEqual({ content: "Usa il controllo Sfondo immagine nel pannello sinistro.", source: "local-llm" });
    const conversation = runtime.generator.mock.calls[0]?.[0] as { role: string; content: string }[];
    expect(conversation.some((message) => message.content.includes("Come carico la cover?"))).toBe(true);
  });

  it("interrompe l'attesa e usa il fallback se una generazione locale si blocca", async () => {
    vi.useFakeTimers();
    runtime.ready = true;
    runtime.generator.mockReturnValue(new Promise(() => undefined));
    const pendingReply = answerApplicationQuestion("Come esporto?", [], context);
    await vi.advanceTimersByTimeAsync(15_100);
    await expect(pendingReply).resolves.toMatchObject({ source: "knowledge-base" });
  });

  it("scarta risposte senza senso o non supportate dalla knowledge base", async () => {
    expect(isGroundedApplicationAnswer("Usa il controllo Sfondo immagine nel pannello sinistro.", "Il controllo Sfondo immagine è disponibile nel pannello sinistro.")).toBe(true);
    expect(isGroundedApplicationAnswer("Le giraffe quantistiche aprono il portale arcobaleno nel cloud lunare.", "Carica lo sfondo dal pannello Scena.")).toBe(false);
    runtime.ready = true;
    runtime.generator.mockResolvedValue([{ generated_text: "Le giraffe quantistiche aprono il portale arcobaleno nel cloud lunare." }]);
    await expect(answerApplicationQuestion("Come cambio lo sfondo?", [], context)).resolves.toMatchObject({ source: "knowledge-base" });
  });
});
