import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  ready: false,
  warm: vi.fn(),
  generator: vi.fn()
}));

vi.mock("./local-model-runtime", () => ({
  preferredLocalAssistantModel: "qwen2.5-0.5b-instruct",
  preferredLocalAssistantLabel: "Qwen2.5 0.5B",
  isLocalTextGeneratorReady: () => runtime.ready,
  warmLocalTextGenerator: runtime.warm,
  getLocalTextGenerator: async () => runtime.generator,
  runLocalTextGeneration: (generator: (input: unknown, options: unknown) => Promise<unknown>, input: unknown, options: unknown, timeoutMs: number) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout modello locale")), timeoutMs);
    generator(input, options).then((result) => { clearTimeout(timer); resolve(result); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  }),
  localGeneratedAnswer: (output: { generated_text?: string }[]) => output[0]?.generated_text ?? ""
}));

import { APPLICATION_ASSISTANT_SYSTEM_PROMPT, answerApplicationQuestion, emptyApplicationAssistantMemory, isGroundedApplicationAnswer, summarizeApplicationConversation, updateApplicationAssistantMemory } from "./application-assistant";

const context = { modeId: "walkingCube", modeLabel: "Cube Animation", aspectRatio: "9:16", hasAudio: true, analysisReady: true };

describe("application assistant runtime", () => {
  beforeEach(() => { vi.useRealTimers(); runtime.ready = false; runtime.warm.mockReset(); runtime.generator.mockReset(); });

  it("usa la knowledge base se il modello non riesce ancora a generare", async () => {
    runtime.generator.mockRejectedValue(new Error("modello non pronto"));
    const reply = await answerApplicationQuestion("Come cambio lo sfondo?", [], context);
    expect(reply.source).toBe("knowledge-base");
    expect(reply.fallbackReason).toBe("model-error");
    expect(reply.content.length).toBeGreaterThan(40);
  });

  it("gestisce saluti e small talk localmente senza invocare Qwen o guide casuali", async () => {
    const reply = await answerApplicationQuestion("Ehi, tutto bene?", [], { ...context, modeId: "instrumentalFalling", modeLabel: "Instrumental Falling" });
    expect(reply).toMatchObject({ source: "built-in", content: expect.stringContaining("Tutto bene") });
    expect(reply.content).not.toContain("biglia");
    expect(runtime.generator).not.toHaveBeenCalled();
  });

  it("usa un prompt base vincolato all'interfaccia reale", () => {
    expect(APPLICATION_ASSISTANT_SYSTEM_PROMPT).toContain("Non inventare pulsanti");
    expect(APPLICATION_ASSISTANT_SYSTEM_PROMPT).toContain("memoria riassunta");
    expect(APPLICATION_ASSISTANT_SYSTEM_PROMPT).toContain("Rispondi in italiano");
    expect(APPLICATION_ASSISTANT_SYSTEM_PROMPT).toContain("NON_DOCUMENTATO");
    expect(APPLICATION_ASSISTANT_SYSTEM_PROMPT).toContain("Se l'utente saluta");
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

  it("usa Qwen quando è pronto senza perdere la memoria", async () => {
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
    await vi.advanceTimersByTimeAsync(20_100);
    await expect(pendingReply).resolves.toMatchObject({ source: "knowledge-base", fallbackReason: "model-timeout" });
  });

  it("scarta risposte senza senso o non supportate dalla knowledge base", async () => {
    expect(isGroundedApplicationAnswer("Usa il controllo Sfondo immagine nel pannello sinistro.", "Il controllo Sfondo immagine è disponibile nel pannello sinistro.")).toBe(true);
    expect(isGroundedApplicationAnswer("Le giraffe quantistiche aprono il portale arcobaleno nel cloud lunare.", "Carica lo sfondo dal pannello Scena.")).toBe(false);
    runtime.ready = true;
    runtime.generator.mockResolvedValue([{ generated_text: "Le giraffe quantistiche aprono il portale arcobaleno nel cloud lunare." }]);
    await expect(answerApplicationQuestion("Come cambio lo sfondo?", [], context)).resolves.toMatchObject({ source: "knowledge-base", fallbackReason: "response-rejected" });
  });
});
