import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, open } = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true, convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));

import { chooseLongCatInput, chooseLongCatOutputDirectory, longCatVideoPreviewUrl, startLongCatVideoJob } from "./longcat-video-native";

describe("longcat-video-native", () => {
  beforeEach(() => { invoke.mockReset(); open.mockReset(); });

  it("invia al backend il contratto discriminato text-to-video", async () => {
    const request = { mode: "textToVideo" as const, prompt: "A cat", negativePrompt: "blur", outputDirectory: "/output", width: 832, height: 480, numFrames: 93, numInferenceSteps: 16, guidanceScale: 1, seed: 42, useDistill: true, enableCompile: false };
    invoke.mockResolvedValue({ jobId: "lc-1", mode: request.mode, status: "queued", progress: 0, message: null, result: null, error: null });
    await startLongCatVideoJob(request);
    expect(invoke).toHaveBeenCalledWith("longcat_video_start_job", { request });
  });

  it("usa picker filtrati e converte il risultato locale per la preview", async () => {
    open.mockResolvedValueOnce("/input/start.png").mockResolvedValueOnce("/output");
    await expect(chooseLongCatInput("imageToVideo")).resolves.toBe("/input/start.png");
    await expect(chooseLongCatOutputDirectory()).resolves.toBe("/output");
    expect(open.mock.calls[0]?.[0]).toMatchObject({ multiple: false, filters: [{ extensions: ["png", "jpg", "jpeg", "webp"] }] });
    expect(longCatVideoPreviewUrl("/output/video.mp4")).toBe("asset:/output/video.mp4");
  });
});
