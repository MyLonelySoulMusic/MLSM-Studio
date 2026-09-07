import { beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ generator: vi.fn(), remote: vi.fn(), sync: vi.fn() }));
vi.mock("./local-model-runtime", () => ({
  preferredLocalAssistantModel: "qwen2.5-0.5b-instruct", preferredLocalAssistantLabel: "Qwen2.5 0.5B",
  isLocalTextGeneratorReady: () => true, getLocalTextGenerator: async () => runtime.generator,
  runLocalTextGeneration: (generator: (input: unknown, options: unknown) => Promise<unknown>, input: unknown, options: unknown) => generator(input, options),
  localGeneratedAnswer: (output: { generated_text?: string }[]) => output[0]?.generated_text ?? ""
}));
vi.mock("./studio-settings", () => ({ requestRemoteAnswer: runtime.remote }));
vi.mock("./assistant-page-source", () => ({ getAssistantPageSource: async () => ({ revision: "test-v1", text: "SOURCE Toolbar.tsx: button Esporta calls onExport", files: ["Toolbar.tsx"] }) }));
vi.mock("./assistant-vector-store", () => ({ retrieveAssistantVectors: async () => [], syncAssistantSource: runtime.sync }));

import { answerApplicationQuestion, emptyApplicationAssistantMemory, summarizeApplicationConversation, updateApplicationAssistantMemory } from "./application-assistant";
const context = { modeId: "walkingCube", modeLabel: "Cube Animation", aspectRatio: "9:16", hasAudio: true, analysisReady: true };

describe("Lonely Bot provider routing", () => {
  beforeEach(() => { runtime.generator.mockReset(); runtime.remote.mockReset(); runtime.sync.mockReset().mockResolvedValue(true); });

  it("uses the selected API and supplies actual page code and controls", async () => {
    runtime.remote.mockResolvedValue({ content: "Premi Esporta per aprire le impostazioni video.", source: "openai", model: "gpt-4.1" });
    const reply = await answerApplicationQuestion("Come esporto?", [], { ...context, pageDetails: "button: Esporta" });
    expect(reply).toMatchObject({ source: "openai", model: "gpt-4.1", knowledgeUpdated: true });
    expect(runtime.generator).not.toHaveBeenCalled();
    const prompt = JSON.stringify(runtime.remote.mock.calls[0]);
    expect(prompt).toContain("button: Esporta");
    expect(prompt).toContain("calls onExport");
  });

  it("Home overview and greetings also use the LLM, not static guide answers", async () => {
    runtime.remote.mockResolvedValue({ content: "Ciao! Da questa Home puoi scegliere l’area di lavoro.", source: "nvidia", model: "moonshotai/kimi-k3" });
    for (const question of ["Ciao", "Cosa c'è in questa pagina?"]) {
      const reply = await answerApplicationQuestion(question, [], { ...context, screen: "areas", modeLabel: "Home" });
      expect(reply.source).toBe("nvidia");
    }
    expect(runtime.remote).toHaveBeenCalledTimes(2);
  });

  it.each(["HTTP 401", "HTTP 429", "timeout", "invalid JSON", "offline"])("falls back locally on %s without replacing the generated answer with a guide", async (error) => {
    runtime.remote.mockRejectedValue(new Error(error));
    runtime.generator.mockResolvedValue([{ generated_text: "Puoi decidere il formato del filmato dal controllo di esportazione." }]);
    const reply = await answerApplicationQuestion("Come esporto?", [], context);
    expect(reply).toMatchObject({ source: "local-llm", providerError: error, content: expect.stringContaining("decidere il formato") });
    expect(JSON.stringify(runtime.generator.mock.calls[0])).toContain("calls onExport");
    expect(runtime.generator).toHaveBeenCalledTimes(1);
    expect(runtime.generator.mock.calls[0]?.[1]).toMatchObject({ max_new_tokens: 220 });
  });

  it("reports both providers unavailable honestly", async () => {
    runtime.remote.mockRejectedValue(new Error("offline"));
    runtime.generator.mockRejectedValue(new Error("no local runtime"));
    await expect(answerApplicationQuestion("Come esporto?", [], context)).resolves.toMatchObject({ source: "unavailable" });
  });

  it("keeps bounded conversation memory", () => {
    let memory = emptyApplicationAssistantMemory;
    for (let i = 0; i < 20; i++) memory = updateApplicationAssistantMemory(memory, "Domanda " + i + "x".repeat(180), "Risposta " + i + "y".repeat(280));
    expect(memory.summary.length).toBeLessThanOrEqual(1800);
    expect(memory.summary).toContain("Domanda 19");
    expect(summarizeApplicationConversation([{ role: "user", content: "Cover?" }, { role: "assistant", content: "Pannello sinistro" }])).toContain("Cover?");
  });
});
