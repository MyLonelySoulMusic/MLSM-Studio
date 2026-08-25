import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";

const generatePythonUpscaledVideo = vi.hoisted(() => vi.fn());
vi.mock("./upscaler-python-client", () => ({ generatePythonUpscaledVideo }));

import { exportUpscaledVideo } from "./upscaler-video-exporter";

describe("upscaler video exporter target resolution", () => {
  beforeEach(() => {
    generatePythonUpscaledVideo.mockClear();
    generatePythonUpscaledVideo.mockResolvedValue({
      blob: new Blob(["video"], { type: "video/mp4" }),
      status: { totalFrames: 1, currentFrame: 1, encodedFrameCount: 1, durationSeconds: 1, tempDirectory: "temp", originalFramesDirectory: "originals" }
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:result") });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  it("raddrizza un target 16:9 stale usando la larghezza e il rapporto della sorgente", async () => {
    const upscalerSettings = { ...createProject().animation.upscaler, sourceWidth: 1440, sourceHeight: 1080, finalWidth: 3840, finalHeight: 2160, lockAspectRatio: true };
    await exportUpscaledVideo({ projectName: "stale", quality: "maximum", sourceVideoUrl: "blob:source", upscalerSettings }, new AbortController().signal, vi.fn());
    expect(generatePythonUpscaledVideo.mock.calls[0]?.[0]).toMatchObject({ settings: { finalWidth: 3840, finalHeight: 2880 } });
  });

  it("conserva il target custom quando il rapporto è sbloccato", async () => {
    const upscalerSettings = { ...createProject().animation.upscaler, sourceWidth: 1440, sourceHeight: 1080, finalWidth: 3000, finalHeight: 1200, lockAspectRatio: false };
    await exportUpscaledVideo({ projectName: "custom", quality: "maximum", sourceVideoUrl: "blob:source", upscalerSettings }, new AbortController().signal, vi.fn());
    expect(generatePythonUpscaledVideo.mock.calls[0]?.[0]).toMatchObject({ settings: { finalWidth: 3000, finalHeight: 1200 } });
  });

  it("usa le dimensioni effettive restituite dal backend per risultato e nome file", async () => {
    generatePythonUpscaledVideo.mockResolvedValueOnce({
      blob: new Blob(["video"], { type: "video/mp4" }),
      status: { totalFrames: 2, currentFrame: 2, encodedFrameCount: 2, durationSeconds: 1, tempDirectory: "temp", originalFramesDirectory: "originals", effectiveWidth: 3000, effectiveHeight: 1688 }
    });
    const settings = { ...createProject().animation.upscaler, sourceWidth: 1920, sourceHeight: 1080, finalWidth: 3840, finalHeight: 2160 };
    const result = await exportUpscaledVideo({ projectName: "effective", quality: "maximum", sourceVideoUrl: "blob:source", upscalerSettings: settings }, new AbortController().signal, vi.fn());
    expect(result).toMatchObject({ width: 3000, height: 1688, fileName: "effective-upscaled-3000x1688.mp4" });
  });

  it("propaga la telemetria concorrente di tutti gli endpoint remoti", async () => {
    const endpointActivity = [{ url: "https://one.gradio.live", state: "busy" as const, activeFrame: "frame-1.png", completed: 4, failures: 0 }];
    generatePythonUpscaledVideo.mockImplementationOnce(async ({ onStatus }) => {
      onStatus({ id: "job", phase: "upscaling", phaseLabel: "1/1 endpoint", progress: .4, currentFrame: 4, totalFrames: 10, tempDirectory: "temp", originalFramesDirectory: "originals", upscaledFramesDirectory: "outputs", activeEndpoints: [endpointActivity[0]!.url], endpointActivity });
      return { blob: new Blob(["video"]), status: { id: "job", phase: "ready", phaseLabel: "done", progress: 1, currentFrame: 10, totalFrames: 10, encodedFrameCount: 10, durationSeconds: 1, tempDirectory: "temp", originalFramesDirectory: "originals", upscaledFramesDirectory: "outputs" } };
    });
    const progress = vi.fn();
    await exportUpscaledVideo({ projectName: "parallel", quality: "maximum", sourceVideoUrl: "blob:source", upscalerSettings: createProject().animation.upscaler }, new AbortController().signal, progress);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ activeEndpoints: ["https://one.gradio.live"], endpointActivity }));
  });

  it("rifiuta un artifact che il backend non ha ricomposto frame per frame", async () => {
    generatePythonUpscaledVideo.mockResolvedValueOnce({
      blob: new Blob(["video"], { type: "video/mp4" }),
      status: { totalFrames: 30, currentFrame: 30, encodedFrameCount: 25, durationSeconds: 1, tempDirectory: "temp", originalFramesDirectory: "originals" }
    });
    await expect(exportUpscaledVideo({ projectName: "invalid", quality: "maximum", sourceVideoUrl: "blob:source", upscalerSettings: createProject().animation.upscaler }, new AbortController().signal, vi.fn())).rejects.toThrow("ricomposti 25/30 frame");
  });
});
