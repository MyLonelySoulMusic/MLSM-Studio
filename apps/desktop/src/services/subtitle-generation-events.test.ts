import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  transcriber: vi.fn(),
  transcriberModels: [] as string[],
  generator: vi.fn()
}));

vi.mock("./local-model-runtime", () => ({
  getLocalTranscriber: async (model: string, progress?: (message: string) => void) => {
    runtime.transcriberModels.push(model);
    progress?.("Whisper pronto · cache locale persistente");
    return runtime.transcriber;
  },
  getLocalTextGenerator: async (_model: string, progress?: (message: string) => void) => {
    progress?.("Download iniziale qwen2.5-0.5b-instruct · 100%");
    return runtime.generator;
  },
  runLocalTextGeneration: (generator: (input: unknown, options: unknown) => Promise<unknown>, input: unknown, options: unknown) => generator(input, options),
  localGeneratedAnswer: (output: { generated_text?: string }[]) => output[0]?.generated_text ?? ""
}));

import { generateSubtitles, reviseSubtitlesWithAgentInstruction, transcribeTimestampedAudio, type SubtitleGenerationEvent } from "./subtitle-generation";

describe("smart subtitle generation events", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    runtime.transcriber.mockReset();
    runtime.transcriberModels.length = 0;
    runtime.generator.mockReset();
  });

  it("pubblica output Whisper e dialogo completo dei tre agenti", async () => {
    runtime.transcriber.mockResolvedValue({
      text: "Hello world stay tonight",
      chunks: [
        { text: "Hello", timestamp: [0, .3] },
        { text: "world", timestamp: [.31, .7] },
        { text: "stay", timestamp: [1.2, 1.5] },
        { text: "tonight", timestamp: [1.51, 2] }
      ]
    });
    runtime.generator.mockImplementation(async (conversation: { content: string }[]) => {
      const instruction = conversation.at(-1)?.content ?? "";
      if (instruction.includes("INCARICO Coordinatore")) return [{ generated_text: JSON.stringify({ verdict: "APPROVE", notes: "Testo e timing coerenti." }) }];
      return [{ generated_text: JSON.stringify({ status: "OK", notes: "Controllo completato." }) }];
    });
    const events: SubtitleGenerationEvent[] = [];
    const cues = await generateSubtitles("blob:audio", 3, {
      lyrics: "[Verse]\nHello world\n[Instrumental]\n[Chorus]\nStay tonight",
      maxWords: 3,
      language: "en",
      whisperModel: "whisper-base_timestamped",
      llmEnabled: true,
      llmModel: "qwen2.5-0.5b-instruct",
      llmPasses: 5,
      onEvent: (event) => events.push(event)
    }, vi.fn());

    const output = events.find((event) => event.type === "whisper-output");
    expect(output?.type === "whisper-output" ? output.document.transcript : "").toBe("Hello world stay tonight");
    const agentEvents = events.filter((event) => event.type === "agent");
    expect(new Set(agentEvents.map((event) => event.type === "agent" ? event.agentId : ""))).toEqual(new Set(["transcript-editor", "timing-director", "quality-supervisor"]));
    expect(agentEvents.some((event) => event.type === "agent" && event.state === "thinking")).toBe(true);
    expect(agentEvents.some((event) => event.type === "agent" && event.state === "answered" && event.message.includes("APPROVE"))).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: "stage", stage: "final", progress: 96 }));
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.every((cue) => cue.verified)).toBe(true);
  });

  it("scarta risposte ripetitive del modello e termina con rapporti deterministici", async () => {
    runtime.transcriber.mockResolvedValue({
      text: "Hello world stay tonight",
      chunks: [
        { text: "Hello world", timestamp: [0, .7] },
        { text: "stay tonight", timestamp: [1.2, 2] }
      ]
    });
    runtime.generator.mockResolvedValue([{ generated_text: `JSON ${"Optimize ".repeat(80)}` }]);
    const events: SubtitleGenerationEvent[] = [];
    const cues = await generateSubtitles("blob:audio", 3, {
      lyrics: "[Verse]\nHello world\n[Instrumental]\nStay tonight",
      maxWords: 3,
      language: "en",
      whisperModel: "whisper-base_timestamped",
      llmEnabled: true,
      llmModel: "qwen2.5-0.5b-instruct",
      llmPasses: 5,
      onEvent: (event) => events.push(event)
    }, vi.fn());

    const answers = events.filter((event) => event.type === "agent" && event.state === "answered");
    expect(answers).toHaveLength(5);
    expect(answers.some((event) => event.type === "agent" && event.message.includes("Controllo deterministico"))).toBe(true);
    expect(answers.every((event) => event.type !== "agent" || !event.message.includes("Optimize"))).toBe(true);
    expect(runtime.generator).toHaveBeenCalledTimes(2);
    expect(cues.every((cue) => cue.verified)).toBe(true);
  });

  it("applica alla timeline soltanto le correzioni strutturate richieste dall’utente", async () => {
    runtime.generator.mockResolvedValue([{
      generated_text: JSON.stringify({
        reply: "Ho corretto la parola indicata mantenendo il sincronismo.",
        changes: [{ action: "replace", cue: 1, text: "Empty streets" }]
      })
    }]);
    const events: SubtitleGenerationEvent[] = [];
    const original = [
      { id: "one", startSeconds: .4, endSeconds: 1.2, text: "Emty streets", confidence: .8, verified: false, manual: false },
      { id: "two", startSeconds: 1.5, endSeconds: 2.4, text: "in the rain", confidence: .9, verified: false, manual: false }
    ];
    const result = await reviseSubtitlesWithAgentInstruction(
      original,
      "Correggi il refuso nel primo blocco.",
      "transcript-editor",
      "qwen2.5-0.5b-instruct",
      "Empty streets in the rain",
      { preferredWords: 5, maxCueDuration: 4, maxCharsPerLine: 34, maxReadingSpeed: 20 },
      vi.fn(),
      (event) => events.push(event)
    );

    expect(result.changedCount).toBe(1);
    expect(result.cues[0]).toMatchObject({ text: "Empty streets", startSeconds: .4, endSeconds: 1.2 });
    expect(result.cues[1]).toMatchObject({ text: "in the rain", startSeconds: 1.5, endSeconds: 2.4 });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "agent", agentId: "transcript-editor", state: "thinking", interactive: true }),
      expect.objectContaining({ type: "agent", agentId: "transcript-editor", state: "answered", interactive: true })
    ]));
  });

  it("rifiuta piani agentici non validi senza alterare testo o timestamp", async () => {
    runtime.generator.mockResolvedValue([{ generated_text: `Optimize ${"Optimize ".repeat(60)}` }]);
    const original = [{ id: "one", startSeconds: 2, endSeconds: 3, text: "Testo originale", confidence: .8, verified: false, manual: false }];
    const result = await reviseSubtitlesWithAgentInstruction(
      original,
      "Sistemalo.",
      "quality-supervisor",
      "qwen2.5-0.5b-instruct",
      "",
      undefined,
      vi.fn()
    );
    expect(result.changedCount).toBe(0);
    expect(result.cues[0]).toMatchObject({ text: "Testo originale", startSeconds: 2, endSeconds: 3 });
  });

  it("valida retime, merge e split senza creare sovrapposizioni", async () => {
    runtime.generator.mockResolvedValue([{
      generated_text: JSON.stringify({
        reply: "Ho rifinito il montaggio richiesto.",
        changes: [
          { action: "retime", cue: 1, start: .3, end: .85 },
          { action: "merge", cue: 1 },
          { action: "split", cue: 3, after_word: 2 }
        ]
      })
    }]);
    const result = await reviseSubtitlesWithAgentInstruction(
      [
        { id: "one", startSeconds: .4, endSeconds: .9, text: "one two", confidence: .9, verified: false, manual: false },
        { id: "two", startSeconds: 1, endSeconds: 1.5, text: "three four", confidence: .9, verified: false, manual: false },
        { id: "three", startSeconds: 2, endSeconds: 3, text: "five six seven eight", confidence: .9, verified: false, manual: false }
      ],
      "Anticipa leggermente il primo blocco, unisci i primi due e dividi il terzo dopo six.",
      "timing-director",
      "qwen2.5-0.5b-instruct",
      "one two three four five six seven eight",
      undefined,
      vi.fn()
    );
    expect(result.changedCount).toBe(3);
    expect(result.cues.map((cue) => cue.text)).toEqual(["one two three four", "five six", "seven eight"]);
    expect(result.cues[0]).toMatchObject({ startSeconds: .3, endSeconds: 1.5 });
    expect(result.cues.every((cue, index) => index === 0 || cue.startSeconds >= result.cues[index - 1]!.endSeconds)).toBe(true);
  });

  it("recupera la parte iniziale dai timestamp Whisper invece di chiedere un piano impossibile al LLM", async () => {
    const events: SubtitleGenerationEvent[] = [];
    const result = await reviseSubtitlesWithAgentInstruction(
      [{ id: "current", startSeconds: 1.4, endSeconds: 2.2, text: "under neon", confidence: .9, verified: true, manual: false }],
      "Manca la parte iniziale del brano",
      "all",
      "qwen2.5-0.5b-instruct",
      "Empty streets under neon",
      undefined,
      vi.fn(),
      (event) => events.push(event),
      {
        exactWordTimeline: [
          { text: "Emty", start: .2, end: .5, confidence: .8 },
          { text: "streets", start: .55, end: .9, confidence: .9 },
          { text: "under", start: 1.4, end: 1.7, confidence: .9 },
          { text: "neon", start: 1.72, end: 2.1, confidence: .9 }
        ]
      }
    );

    expect(result.changedCount).toBe(1);
    expect(result.summary).toContain("Apertura recuperata");
    expect(result.cues.map((cue) => cue.text)).toEqual(["Empty streets", "under neon"]);
    expect(result.cues[0]!.endSeconds).toBeLessThan(result.cues[1]!.startSeconds);
    expect(runtime.generator).not.toHaveBeenCalled();
    const answers = events.filter((event) => event.type === "agent" && event.state === "answered");
    expect(answers).toHaveLength(3);
    expect(answers.every((event) => event.type !== "agent" || !event.message.includes("Risposta non valida"))).toBe(true);
  });

  it("spiega perché l’apertura non può essere inserita quando mancano timestamp reali", async () => {
    const events: SubtitleGenerationEvent[] = [];
    const original = [{ id: "current", startSeconds: 0, endSeconds: 1, text: "first available line", confidence: .8, verified: false, manual: false }];
    const result = await reviseSubtitlesWithAgentInstruction(
      original,
      "Manca l'inizio",
      "all",
      "qwen2.5-0.5b-instruct",
      "missing opening first available line",
      undefined,
      vi.fn(),
      (event) => events.push(event)
    );

    expect(result.changedCount).toBe(0);
    expect(result.cues.map((cue) => cue.text)).toEqual(["first available line"]);
    expect(result.summary).toContain("Whisper non ha fornito");
    const answers = events
      .filter((event): event is Extract<SubtitleGenerationEvent, { type: "agent" }> => event.type === "agent" && event.state === "answered")
      .map((event) => event.message);
    expect(answers).toEqual(expect.arrayContaining([
      expect.stringContaining("non contengono parole iniziali"),
      expect.stringContaining("timestamp vocali affidabili"),
      expect.stringContaining("Nessuna modifica applicata")
    ]));
    expect(runtime.generator).not.toHaveBeenCalled();
  });

  it("rianalizza automaticamente l’audio iniziale quando il JSON Whisper corrente non contiene l’apertura", async () => {
    const samples = new Float32Array(160_000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal("AudioContext", class {
      async decodeAudioData(): Promise<{ length: number; sampleRate: number; numberOfChannels: number; getChannelData: () => Float32Array }> {
        return { length: samples.length, sampleRate: 16_000, numberOfChannels: 1, getChannelData: () => samples };
      }
      async close(): Promise<void> { return undefined; }
    });
    runtime.transcriber.mockResolvedValue({
      text: "missing opening current line",
      chunks: [
        { text: "missing", timestamp: [.2, .5] },
        { text: "opening", timestamp: [.55, .9] },
        { text: "current", timestamp: [2, 2.3] },
        { text: "line", timestamp: [2.31, 2.6] }
      ]
    });
    const result = await reviseSubtitlesWithAgentInstruction(
      [{ id: "current", startSeconds: 2, endSeconds: 2.8, text: "current line", confidence: .9, verified: true, manual: false }],
      "È stata saltata l'introduzione",
      "all",
      "qwen2.5-0.5b-instruct",
      "missing opening current line",
      undefined,
      vi.fn(),
      undefined,
      {
        audioUrl: "blob:audio",
        durationSeconds: 10,
        whisperModel: "whisper-base_timestamped",
        language: "en"
      }
    );

    expect(runtime.transcriber).toHaveBeenCalledWith(expect.any(Float32Array), expect.objectContaining({ return_timestamps: "word", force_full_sequences: false, language: "en" }));
    expect(result.cues.map((cue) => cue.text)).toEqual(["missing opening", "current line"]);
    expect(result.summary).toContain("timestamp Whisper");
  });

  it("accetta l’ultima parola parziale di un master tagliato senza imporre una sequenza completa", async () => {
    runtime.transcriber.mockImplementation(async (_audio: string | Float32Array, options: Record<string, unknown>) => {
      if (options.force_full_sequences !== false) {
        throw new Error("Whisper did not predict an ending timestamp, which can happen if audio is cut off in the middle of a word.");
      }
      return {
        text: "The Fallen",
        chunks: [
          { text: "The", timestamp: [0, .24] },
          { text: "Fallen", timestamp: [.25, null] }
        ]
      };
    });

    const transcript = await transcribeTimestampedAudio("blob:master-window", 2.72, {
      language: "en",
      whisperModel: "whisper-medium_timestamped",
      phraseWords: 4
    }, vi.fn());

    expect(runtime.transcriber).toHaveBeenCalledWith("blob:master-window", expect.objectContaining({
      return_timestamps: "word",
      force_full_sequences: false
    }));
    expect(transcript.words.map((word) => word.text).join(" ")).toBe("The Fallen");
    expect(transcript.words.at(-1)?.end).toBeLessThanOrEqual(2.72);
  });

  it("riprova e usa soltanto timestamp parola per parola misurati nel flusso Lipsync", async () => {
    runtime.transcriber
      .mockResolvedValueOnce({ text: "I'm scared to be alone" })
      .mockResolvedValueOnce({
        text: "I'm scared to be alone",
        chunks: [
          { text: "I'm", timestamp: [0, .56] },
          { text: "scared", timestamp: [.56, .9] },
          { text: "to", timestamp: [.9, 1.28] },
          { text: "be", timestamp: [1.28, 1.68] },
          { text: "alone", timestamp: [1.68, 2.6] }
        ]
      });
    const progress = vi.fn();

    const transcript = await transcribeTimestampedAudio(new Float32Array(15 * 16_000), 15, {
      language: "en",
      whisperModel: "whisper-medium_timestamped",
      requireMeasuredWordTimestamps: true
    }, progress);

    expect(runtime.transcriber).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith(expect.stringContaining("primo passaggio privo di confini affidabili"));
    expect(transcript.words.map((word) => [word.text, word.start, word.end])).toEqual([
      ["I'm", 0, .56], ["scared", .56, .9], ["to", .9, 1.28], ["be", 1.28, 1.68], ["alone", 1.68, 2.6]
    ]);
  });

  it("riprova lo stesso Medium senza usare Whisper Base quando il primo passaggio restituisce 29.98 secondi", async () => {
    const brokenMedium = {
      text: "I'm scared to be alone",
      chunks: ["I'm", "scared", "to", "be", "alone"].map((text) => ({ text, timestamp: [29.98, 29.98] as [number, number] }))
    };
    runtime.transcriber
      .mockResolvedValueOnce(brokenMedium)
      .mockResolvedValueOnce({
        text: "I'm scared to be alone",
        chunks: [
          { text: "I'm", timestamp: [0, .32] },
          { text: "scared", timestamp: [.32, .68] },
          { text: "to", timestamp: [.68, 1.04] },
          { text: "be", timestamp: [1.04, 1.34] },
          { text: "alone", timestamp: [1.34, 2.02] }
        ]
      });
    const progress = vi.fn();

    const transcript = await transcribeTimestampedAudio(new Float32Array(15 * 16_000), 15, {
      language: "en",
      whisperModel: "whisper-medium_timestamped",
      requireMeasuredWordTimestamps: true
    }, progress);

    expect(runtime.transcriber).toHaveBeenCalledTimes(2);
    expect(runtime.transcriberModels).toEqual(["whisper-medium_timestamped"]);
    expect(progress).toHaveBeenCalledWith(expect.stringContaining("stesso modello"));
    expect(transcript.words.map((word) => word.text)).toEqual(["I'm", "scared", "to", "be", "alone"]);
    expect(transcript.words.map((word) => [word.start, word.end])).toEqual([[0, .32], [.32, .68], [.68, 1.04], [1.04, 1.34], [1.34, 2.02]]);
  });
});
