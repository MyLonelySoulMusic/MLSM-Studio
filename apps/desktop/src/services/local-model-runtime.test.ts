import { describe, expect, it } from "vitest";
import { remoteModelRepository } from "./local-model-runtime";

describe("runtime modelli locali", () => {
  it("risolve Whisper e SmolLM2 verso repository ONNX remoti espliciti", () => {
    expect(remoteModelRepository("whisper-tiny_timestamped")).toBe("onnx-community/whisper-tiny_timestamped");
    expect(remoteModelRepository("whisper-base_timestamped")).toBe("onnx-community/whisper-base_timestamped");
    expect(remoteModelRepository("whisper-medium_timestamped")).toBe("onnx-community/whisper-medium_timestamped");
    expect(remoteModelRepository("smollm2-135m-instruct")).toBe("onnx-community/SmolLM2-135M-Instruct-ONNX");
  });

  it("rifiuta identificatori non dichiarati", () => {
    expect(() => remoteModelRepository("modello-sconosciuto")).toThrow("Modello locale non supportato");
  });
});
