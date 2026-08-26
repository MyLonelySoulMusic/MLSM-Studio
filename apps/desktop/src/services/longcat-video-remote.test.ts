import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), invoke: vi.fn() }));
vi.mock("@gradio/client", () => ({ Client: { connect: mocks.connect }, handle_file: (file: File) => file }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => true, convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import {
  LONGCAT_COLAB_NOTEBOOK_URL,
  checkLongCatRemoteEndpoints,
  createLongCatRemoteEndpoint,
  normalizeLongCatRemoteEndpoint,
  openLongCatColabNotebook,
  parseLongCatRemoteEndpoint,
  startRemoteLongCatVideoJob
} from "./longcat-video-remote";

const capability = { protocolVersion: 1, service: "mlsm-longcat-remote", ready: true, busy: false, gpuName: "A100", revision: "abc", reason: null, modes: ["textToVideo"], limits: { maxInputBytes: 1, maxFrames: 257, maxActiveJobs: 1 } };
const endpoint = { id: "one", label: "Colab 1", url: "https://one.gradio.live/#mlsm-token=secret-one", enabled: true };

describe("longcat-video-remote", () => {
  beforeEach(() => { mocks.connect.mockReset(); mocks.invoke.mockReset(); });

  it("usa il notebook approvato e richiede il token nel link completo", async () => {
    expect(LONGCAT_COLAB_NOTEBOOK_URL).toBe("https://colab.research.google.com/drive/1-Dcjc4S6GCLhbN4N8qujhzzWBFyG6Bz0?usp=sharing");
    expect(parseLongCatRemoteEndpoint(endpoint.url)).toEqual({ baseUrl: "https://one.gradio.live", token: "secret-one" });
    expect(normalizeLongCatRemoteEndpoint(endpoint.url)).toBe("https://one.gradio.live");
    expect(() => createLongCatRemoteEndpoint("https://one.gradio.live", 0)).toThrow(/token/i);
    mocks.invoke.mockResolvedValue(undefined);
    await openLongCatColabNotebook();
    expect(mocks.invoke).toHaveBeenCalledWith("longcat_video_open_colab");
  });

  it("verifica tutti gli endpoint attivi in parallelo", async () => {
    let releaseFirst!: () => void; let releaseSecond!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const started: string[] = [];
    mocks.connect.mockImplementation(async (url: string) => ({
      close: vi.fn(),
      predict: vi.fn(async () => { started.push(url); await (url.includes("one") ? first : second); return { data: [capability] }; })
    }));
    const pending = checkLongCatRemoteEndpoints([endpoint, { ...endpoint, id: "two", label: "Colab 2", url: "https://two.gradio.live#mlsm-token=secret-two" }]);
    await vi.waitFor(() => expect(started).toHaveLength(2));
    releaseSecond(); releaseFirst();
    await expect(pending).resolves.toMatchObject([{ ok: true }, { ok: true }]);
  });

  it("invia al Colab il contratto remoto senza percorsi locali", async () => {
    const predict = vi.fn().mockResolvedValue({ data: [{ jobId: "lcr-1", mode: "textToVideo", status: "queued", progress: 0, message: null, result: null, error: null }] });
    mocks.connect.mockResolvedValue({ predict, close: vi.fn() });
    await startRemoteLongCatVideoJob(endpoint, { mode: "textToVideo", prompt: "A cat", negativePrompt: "", outputDirectory: "/private/output", width: 832, height: 480, numFrames: 93, numInferenceSteps: 16, guidanceScale: 1, seed: 42, useDistill: true, enableCompile: false });
    const args = predict.mock.calls[0]?.[1] as unknown[];
    expect(predict.mock.calls[0]?.[0]).toBe("/longcat_start");
    expect(args[0]).toBe("secret-one");
    expect(JSON.parse(String(args[1]))).not.toHaveProperty("outputDirectory");
    expect(args[2]).toBeNull();
  });
});
