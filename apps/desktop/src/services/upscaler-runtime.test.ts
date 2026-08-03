import { describe, expect, it } from "vitest";
import { chooseUpscalerBackend, effectiveUpscalerBackend, upscalerModels } from "./upscaler-runtime";

describe("upscaler runtime", () => {
  it("espone tutti i modelli richiesti e le varianti ufficiali leggere", () => {
    expect(upscalerModels.map((model) => model.id)).toEqual(expect.arrayContaining(["canvas", "RealESRGAN_x4plus", "RealESRGAN_x2plus", "RealESRNet_x4plus", "RealESRGAN_x4plus_anime_6B", "realesr-general-x4v3", "realesr-animevideov3"]));
    expect(upscalerModels.every((model) => model.pros && model.cons && model.bestFor)).toBe(true);
    const canvas = upscalerModels.find((model) => model.id === "canvas"); expect(canvas).toMatchObject({ nativeScale: 1 }); expect(canvas?.modelUrl).toBeUndefined();
    expect(upscalerModels.filter((model) => model.webExecutable && model.id !== "canvas").every((model) => model.modelUrl?.endsWith(".onnx"))).toBe(true);
    expect(upscalerModels.find((model) => model.id === "RealESRGAN_x4plus")?.modelSizeMb).toBeGreaterThan(60);
  });
  it("preferisce CUDA, poi Apple Silicon, WebGPU e infine CPU", () => {
    expect(chooseUpscalerBackend({ platform: "win", architecture: "x86_64", appleSilicon: false, cuda: true, webgpu: true, gpuName: "RTX" })).toBe("cuda");
    expect(chooseUpscalerBackend({ platform: "mac", architecture: "aarch64", appleSilicon: true, cuda: false, webgpu: true, gpuName: "Apple M3" })).toBe("metal");
    expect(chooseUpscalerBackend({ platform: "linux", architecture: "x86_64", appleSilicon: false, cuda: false, webgpu: true, gpuName: "AMD" })).toBe("webgpu");
    expect(chooseUpscalerBackend({ platform: "linux", architecture: "x86_64", appleSilicon: false, cuda: false, webgpu: false, gpuName: null })).toBe("cpu");
  });
  it("rispetta la selezione manuale", () => {
    const hardware = { platform: "mac", architecture: "aarch64", appleSilicon: true, cuda: false, webgpu: true, gpuName: "M2", recommendedBackend: "metal" as const };
    expect(effectiveUpscalerBackend("auto", hardware)).toBe("metal");
    expect(effectiveUpscalerBackend("cpu", hardware)).toBe("cpu");
  });
});
