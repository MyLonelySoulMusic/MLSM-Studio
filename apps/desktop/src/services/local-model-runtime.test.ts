import { describe, expect, it } from "vitest";
import { modelProgressMessage, remoteModelRepository } from "./local-model-runtime";

describe("runtime modelli locali", () => {
  it("risolve Whisper e Qwen verso repository ONNX remoti espliciti", () => {
    expect(remoteModelRepository("whisper-tiny_timestamped")).toBe("onnx-community/whisper-tiny_timestamped");
    expect(remoteModelRepository("whisper-base_timestamped")).toBe("onnx-community/whisper-base_timestamped");
    expect(remoteModelRepository("whisper-medium_timestamped")).toBe("onnx-community/whisper-medium_timestamped");
    expect(remoteModelRepository("qwen2.5-0.5b-instruct")).toBe("onnx-community/Qwen2.5-0.5B-Instruct");
  });

  it("rifiuta identificatori non dichiarati", () => {
    expect(() => remoteModelRepository("modello-sconosciuto")).toThrow("Modello locale non supportato");
  });

  it("distingue il caricamento dalla cache da un download reale", () => {
    const event = { status: "progress", file: "onnx/encoder_model_quantized.onnx", progress: 42 };
    expect(modelProgressMessage("whisper-base_timestamped", event, new Set(["onnx/encoder_model_quantized.onnx"]))).toContain("Caricamento dalla cache");
    expect(modelProgressMessage("whisper-base_timestamped", event, new Set())).toContain("Download iniziale");
  });
});
