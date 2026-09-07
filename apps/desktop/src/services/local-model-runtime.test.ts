import { describe, expect, it } from "vitest";
import { configureLocalModelCpu, localModelErrorMessage, localModelMaximumCpuThreads, modelProgressMessage, remoteModelRepository } from "./local-model-runtime";

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

  it("limita il fallback WASM e lo sposta fuori dal thread dell'interfaccia", () => {
    const wasm: { numThreads?: number; proxy?: boolean } = {};
    const environment = { allowRemoteModels: true, allowLocalModels: false, useBrowserCache: true, localModelPath: "/models/", backends: { onnx: { wasm } } };
    expect(configureLocalModelCpu(environment, 12)).toBe(localModelMaximumCpuThreads);
    expect(wasm).toMatchObject({ numThreads: 2, proxy: true });
    expect(configureLocalModelCpu(environment, 2)).toBe(1);
    expect(wasm.numThreads).toBe(1);
  });
});
