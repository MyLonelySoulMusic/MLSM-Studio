import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false, convertFileSrc: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
import { cancelLongCatVideoJob, chooseLongCatOutputDirectory, getLongCatVideoCapabilities, getLongCatVideoJob, startLongCatVideoJob } from "./longcat-video-native";

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("LongCat Video browser bridge", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());

  it("usa il servizio locale anche fuori da Tauri", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(response({ ready: true, platformSupported: true, runtimeReady: true, repositoryReady: true, checkpointReady: true, cudaReady: true, gpuName: "RTX", revision: "abc", reason: null, setupCommand: "npm run longcat-video:setup" }))
      .mockResolvedValueOnce(response({ jobId: "lc-1", mode: "textToVideo", status: "queued", progress: 0, message: null, result: null, error: null }, 202))
      .mockResolvedValueOnce(response({ jobId: "lc-1", mode: "textToVideo", status: "running", progress: .5, message: null, result: null, error: null }))
      .mockResolvedValueOnce(response({ jobId: "lc-1", mode: "textToVideo", status: "cancelled", progress: .5, message: null, result: null, error: null }));
    await expect(getLongCatVideoCapabilities()).resolves.toMatchObject({ desktop: false, ready: true });
    const request = { mode: "textToVideo" as const, prompt: "cat", negativePrompt: "", outputDirectory: "mlsm-browser-download", width: 832, height: 480, numFrames: 93, numInferenceSteps: 16, guidanceScale: 1, seed: 42, useDistill: true, enableCompile: false };
    await startLongCatVideoJob(request); await getLongCatVideoJob("lc-1"); await cancelLongCatVideoJob("lc-1");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["http://127.0.0.1:8766/health", "http://127.0.0.1:8766/jobs", "http://127.0.0.1:8766/jobs/lc-1", "http://127.0.0.1:8766/jobs/lc-1"]);
    await expect(chooseLongCatOutputDirectory()).resolves.toBe("mlsm-browser-download");
  });
});
