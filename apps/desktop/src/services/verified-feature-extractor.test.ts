import { describe, expect, it, vi } from "vitest";
import { featureRows, verifiedFeatureExtractor } from "./verified-feature-extractor";
import type { LocalFeatureExtractor } from "./local-model-runtime";

function engine(collapsed = false): LocalFeatureExtractor {
  return Object.assign(vi.fn(async (texts: string | string[]) => {
    const rows = (Array.isArray(texts) ? texts : [texts]).map((_, i) => collapsed ? [1, 0, 0] : [[1, 0, 0], [0.8, 0.6, 0], [0, 0, 1]][i]!);
    return { dims: [rows.length, 3], data: rows.flat(), tolist: () => rows };
  }), { dispose: vi.fn(async () => undefined) });
}

describe("verified embedding engine", () => {
  it("keeps a healthy WebGPU engine", async () => {
    const gpu = engine();
    const create = vi.fn(async () => gpu);
    const result = await verifiedFeatureExtractor(create, true, "MiniLM", vi.fn());
    expect(create.mock.calls).toEqual([["webgpu"]]);
    expect(result).toBe(gpu);
    expect(result.embeddingSpace).toContain("webgpu:verified-v1");
  });
  it("rejects collapsed vectors and retries using browser-supported WASM", async () => {
    const gpu = engine(true); const wasm = engine();
    const create = vi.fn(async (device: string) => device === "webgpu" ? gpu : wasm);
    const result = await verifiedFeatureExtractor(create, true, "MiniLM", vi.fn());
    expect(create.mock.calls).toEqual([["webgpu"], ["wasm"]]);
    expect(gpu.dispose).toHaveBeenCalledOnce();
    expect(result.embeddingSpace).toContain("wasm:verified-v1");
  });
  it("uses wasm without a GPU and stops if its vectors also collapse", async () => {
    const create = vi.fn(async () => engine(true));
    await expect(verifiedFeatureExtractor(create, false, "MiniLM", vi.fn())).rejects.toThrow("Associazione interrotta");
    expect(create.mock.calls).toEqual([["wasm"]]);
  });
  it("rejects invalid shapes, zero and nonfinite vectors", () => {
    for (const rows of [[[0, 0]], [[NaN, 1]], [[[1], [0]]]]) {
      expect(() => featureRows({ dims: [1, 2], data: [], tolist: () => rows }, 1)).toThrow("Embedding non valido");
    }
  });
});
