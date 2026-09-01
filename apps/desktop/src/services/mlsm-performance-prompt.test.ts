import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ generator: vi.fn() }));

vi.mock("./local-model-runtime", () => ({
  preferredLocalAssistantModel: "qwen2.5-0.5b-instruct",
  getLocalTextGenerator: async () => runtime.generator,
  runLocalTextGeneration: (generator: (input: unknown, options: unknown) => Promise<unknown>, input: unknown, options: unknown) => generator(input, options),
  localGeneratedAnswer: (output: { generated_text?: string }[]) => output[0]?.generated_text ?? ""
}));

import {
  DEFAULT_VOCAL_PERFORMANCE_PROMPT_TEMPLATE,
  createPerformancePromptPlan,
  generateVocalPerformancePromptWithLocalLlm,
  renderDefaultVocalPerformancePrompt,
  renderVocalPerformancePromptExtension,
  splitPerformancePromptPlan
} from "./mlsm-performance-prompt";

const fallen = `1
00:00:00,000 --> 00:00:02,720
The fallen

2
00:00:04,340 --> 00:00:07,360
Still loves me
`;

describe("MLSM vocal performance prompt", () => {
  beforeEach(() => runtime.generator.mockReset());

  it("mantiene il template con placeholder internamente ma li elimina tutti dal risultato", () => {
    expect(DEFAULT_VOCAL_PERFORMANCE_PROMPT_TEMPLATE).toContain("<SINGING_DURATION_1>");
    const prompt = renderDefaultVocalPerformancePrompt(createPerformancePromptPlan(fallen));
    expect(prompt).toContain("For the first 2.72 seconds");
    expect(prompt).toContain("The fallen");
    expect(prompt).toContain("stops singing completely for 1.62 seconds");
    expect(prompt).toContain("Still loves me");
    expect(prompt).toContain("approximately 3.02 seconds");
    expect(prompt).toContain("No instruments, no backing track");
    expect(prompt).not.toMatch(/[<>]/u);
  });

  it("normalizza lo spezzone sull'inizio della prima frase", () => {
    const serialized = `WEBVTT

00:00:01.000 --> 00:00:02.000
One

00:00:03.000 --> 00:00:04.500
Two

    00:00:05.000 --> 00:00:06.000
    Three`;
    const prompt = renderDefaultVocalPerformancePrompt(createPerformancePromptPlan(serialized));
    expect(prompt).not.toContain("the subject remains silent");
    expect(prompt).toContain("One");
    expect(prompt).toContain("Two");
    expect(prompt).toContain("Three");
    expect(prompt).not.toMatch(/[<>]/u);
  });

  it("divide 25 secondi in due prompt da 15 e 10 secondi con tempi locali", () => {
    const serialized = `1
00:00:00,000 --> 00:00:10,000
Opening line

2
00:00:10,000 --> 00:00:20,000
These exact words continue across the extension boundary naturally

3
00:00:21,000 --> 00:00:25,000
Final line`;
    const extensions = splitPerformancePromptPlan(createPerformancePromptPlan(serialized));
    expect(extensions).toHaveLength(2);
    expect(extensions.map((extension) => extension.durationSeconds)).toEqual([15, 10]);
    expect(extensions[0]?.plan.durationSeconds).toBe(15);
    expect(extensions[1]?.plan.durationSeconds).toBe(10);
    expect(extensions[0]?.plan.cues.at(-1)?.endSeconds).toBe(15);
    expect(extensions[1]?.plan.cues[0]?.startSeconds).toBe(0);
    const firstPrompt = renderVocalPerformancePromptExtension(extensions[0]!);
    const secondPrompt = renderVocalPerformancePromptExtension(extensions[1]!);
    expect(firstPrompt).toContain("video extension 1 of 2");
    expect(firstPrompt).toContain("lasts exactly 15 seconds");
    expect(secondPrompt).toContain("video extension 2 of 2");
    expect(secondPrompt).toContain("lasts exactly 10 seconds");
    expect(secondPrompt).toContain("Continue directly and seamlessly from the final frame");
    expect(firstPrompt).not.toMatch(/[<>]/u);
    expect(secondPrompt).not.toMatch(/[<>]/u);
  });

  it("misura un estratto con timecode assoluti dalla sua origine reale", () => {
    const serialized = `1
00:01:30,000 --> 00:01:40,000
Opening line

2
00:01:40,000 --> 00:01:50,000
The performance continues

3
00:01:51,000 --> 00:01:55,000
Final line`;
    const plan = createPerformancePromptPlan(serialized);
    const extensions = splitPerformancePromptPlan(plan);
    expect(plan.durationSeconds).toBe(25);
    expect(plan.cues[0]).toMatchObject({ startSeconds: 0, endSeconds: 10 });
    expect(plan.cues[2]).toMatchObject({ startSeconds: 21, endSeconds: 25 });
    expect(extensions.map((extension) => extension.durationSeconds)).toEqual([15, 10]);
  });

  it("rifiuta oltre 25 secondi reali anche con timecode assoluti", () => {
    expect(() => createPerformancePromptPlan(`1\n00:01:30,000 --> 00:01:55,001\nToo long`)).toThrow(/massimo 25 secondi/u);
  });

  it("rifiuta timeline oltre il massimo di 25 secondi", () => {
    expect(() => createPerformancePromptPlan(`1\n00:00:00,000 --> 00:00:25,500\nToo long`)).toThrow(/massimo 25 secondi/u);
  });

  it("rifiuta blocchi sovrapposti perché una singola voce non può rispettarli", () => {
    expect(() => createPerformancePromptPlan(`1\n00:00:00,000 --> 00:00:02,000\nOne\n\n2\n00:00:01,500 --> 00:00:03,000\nTwo`)).toThrow(/sovrappongono/u);
  });

  it("esegue tre passaggi LLM ma ricompone parole e tempi in modo deterministico", async () => {
    runtime.generator
      .mockResolvedValueOnce([{ generated_text: "Use restrained eye contact, controlled breathing, and subtle shoulder movement while keeping the performance grounded and emotionally tense." }])
      .mockResolvedValueOnce([{ generated_text: "Maintain restrained eye contact and controlled breathing, then let the expression intensify naturally while all motion stays realistic and continuous." }])
      .mockResolvedValueOnce([{ generated_text: "Keep the gaze anchored to the microphone with controlled breathing and minimal movement, then build emotional intensity through the eyes, jaw, and posture without breaking cinematic continuity." }]);
    const result = await generateVocalPerformancePromptWithLocalLlm({ plan: createPerformancePromptPlan(fallen), sceneRequest: "Parte trattenuto e poi diventa intenso." });
    expect(runtime.generator).toHaveBeenCalledTimes(3);
    expect(result.passesCompleted).toBe(3);
    expect(result.prompt).toContain("Keep the gaze anchored");
    expect(result.prompt).toContain("For the first 2.72 seconds");
    expect(result.prompt).toContain("Still loves me");
    expect(result.prompt).not.toMatch(/[<>]/u);
    const firstConversation = runtime.generator.mock.calls[0]?.[0] as { content: string }[];
    expect(firstConversation.some((message) => message.content.includes('"exactLyrics":"The fallen"'))).toBe(true);
  });
});
