import { describe, expect, it } from "vitest";
import { getUpscalerSourceFile, registerUpscalerSourceFile } from "./upscaler-source-file";

describe("Upscaler source file runtime", () => {
  it("mantiene il File video originale disponibile per l'upload frame-per-frame", () => {
    const file = new File([new Uint8Array([0, 1, 2, 3])], "source.mp4", { type: "video/mp4" });
    registerUpscalerSourceFile("blob:source-video", file);
    expect(getUpscalerSourceFile("blob:source-video")).toBe(file);
    expect(getUpscalerSourceFile("blob:another-video")).toBeNull();
  });
});

