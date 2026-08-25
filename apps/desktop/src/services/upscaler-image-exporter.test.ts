import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";

const generateAi = vi.hoisted(() => vi.fn()); const render = vi.hoisted(() => vi.fn());
vi.mock("./upscaler-ai", () => ({ generateAiUpscalerPreview: generateAi }));
vi.mock("./upscaler-renderer", () => ({ createUpscalerFrameRenderer: vi.fn(() => render) }));

import { exportUpscalerImage, upscalerImageFileName } from "./upscaler-image-exporter";

describe("upscaler image exporter", () => {
  afterEach(() => { generateAi.mockReset(); render.mockReset(); vi.restoreAllMocks(); });

  it("uses canonical PNG naming", () => expect(upscalerImageFileName("folder/holiday.jpg", 2000, 1000)).toBe("holiday-upscaled-2000x1000.png"));

  it("does not reinfer when an AI source is supplied", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(blob));
    const settings = { ...createProject().animation.upscaler, model: "RealESRNet_x4plus" as const, sourceName: "input.jpg", finalWidth: 2000, finalHeight: 1000 };
    const enhanced = document.createElement("canvas");
    const result = await exportUpscalerImage({ source: document.createElement("canvas"), settings, aiEnhancedSource: enhanced });
    expect(generateAi).not.toHaveBeenCalled(); expect(render).toHaveBeenCalledOnce(); expect(result.fileName).toBe("input-upscaled-2000x1000.png");
  });
});

