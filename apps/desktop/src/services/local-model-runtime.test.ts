import { describe, expect, it } from "vitest";
import { localModelErrorMessage, modelProgressMessage, remoteModelRepository } from "./local-model-runtime";

describe("runtime modelli locali", () => {
  it("risolve Whisper e Qwen verso repository ONNX remoti espliciti", () => {
    expect(remoteModelRepository("whisper-tiny_timestamped")).toBe("onnx-community/whisper-tiny_timestamped");
    expect(remoteModelRepository("whisper-base_timestamped")).toBe("onnx-community/whisper-base_timestamped");
    expect(remoteModelRepository("whisper-medium_timestamped")).toBe("onnx-community/whisper-medium_timestamped");
    expect(remoteModelRepository("qwen2.5-0.5b-instruct")).toBe("onnx-community/Qwen2.5-0.5B-Instruct");
    expect(remoteModelRepository("detr-resnet-50")).toBe("Xenova/detr-resnet-50");
  });

  it("rifiuta identificatori non dichiarati", () => {
    expect(() => remoteModelRepository("modello-sconosciuto")).toThrow("Unsupported local model");
  });

  it("distingue il caricamento dalla cache da un download reale", () => {
    const event = { status: "progress", file: "onnx/encoder_model_quantized.onnx", progress: 42 };
    expect(modelProgressMessage("whisper-base_timestamped", event, new Set(["onnx/encoder_model_quantized.onnx"]))).toContain("Loading from cache");
    expect(modelProgressMessage("whisper-base_timestamped", event, new Set())).toContain("Initial download");
  });

  it("explains HTML and invalid JSON model responses", () => {
    expect(localModelErrorMessage(new Error("Unexpected token '<', \"<!DOCTYPE html>\" is not valid JSON"))).toMatch(/HTML or invalid JSON/);
    expect(localModelErrorMessage(new TypeError("fetch failed"))).toMatch(/model download failed.*network/i);
    expect(localModelErrorMessage(new Error("Unexpected token 'e', \"fetch failed\" is not valid JSON"))).toMatch(/model download failed.*network/i);
    expect(localModelErrorMessage(new Error("network unavailable"))).toBe("network unavailable");
  });
});
