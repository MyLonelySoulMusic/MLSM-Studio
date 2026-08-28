import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFrameBoosterSourceFile, registerFrameBoosterSourceFile } from "../services/frame-booster-source-file";
import type { FrameInterpolationRequest } from "../services/frame-interpolation-client";
import { useProjectStore } from "../store/project-store";

const frameInterpolationJob = vi.hoisted(() => vi.fn());
const chooseUpscalerVideoSaveTarget = vi.hoisted(() => vi.fn());
const saveUpscalerVideoArtifact = vi.hoisted(() => vi.fn());
vi.mock("../services/frame-interpolation-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/frame-interpolation-client")>();
  return { ...actual, frameInterpolationJob };
});
vi.mock("../services/upscaler-video-artifact", () => ({ chooseUpscalerVideoSaveTarget, saveUpscalerVideoArtifact }));

import { FrameBoosterPreview } from "./FrameBoosterPreview";

describe("FrameBoosterPreview", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    clearFrameBoosterSourceFile();
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:frame-booster-result") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    chooseUpscalerVideoSaveTarget.mockResolvedValue({ kind: "download" });
    saveUpscalerVideoArtifact.mockResolvedValue({ bytes: 4, destination: "source-boosted.mp4" });
  });

  afterEach(() => {
    cleanup();
    clearFrameBoosterSourceFile();
    frameInterpolationJob.mockReset();
    chooseUpscalerVideoSaveTarget.mockReset();
    saveUpscalerVideoArtifact.mockReset();
    vi.restoreAllMocks();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("termina la fase dopo AbortError e riabilita immediatamente un nuovo boost", async () => {
    const sourceUrl = "blob:frame-booster-cancel";
    const file = new File([new Uint8Array([0, 1, 2, 3])], "source.mp4", { type: "video/mp4" });
    registerFrameBoosterSourceFile(sourceUrl, file);
    useProjectStore.getState().updateFrameBooster({ sourceUrl, sourceName: file.name, sourceWidth: 1280, sourceHeight: 720, sourceDurationSeconds: 2 });
    frameInterpolationJob.mockImplementationOnce((options: FrameInterpolationRequest) => new Promise((_resolve, reject) => {
      options.onStatus?.({ id: "job-cancel", phase: "interpolating", progress: .25, stageProgress: .25, currentFrame: 15, totalFrames: 60, indeterminate: false });
      options.signal.addEventListener("abort", () => reject(new DOMException("Operazione annullata", "AbortError")), { once: true });
    }));

    render(<FrameBoosterPreview />);
    const boost = screen.getByRole("button", { name: "Boost frames" });
    fireEvent.click(boost);
    const cancel = await screen.findByRole("button", { name: "Annulla" });
    expect(boost).toBeDisabled();

    fireEvent.click(cancel);

    await waitFor(() => expect(screen.getByText("cancelled")).toBeInTheDocument());
    expect(boost).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Annulla" })).not.toBeInTheDocument();
  });

  it("salva il risultato verificato dalla toolbar senza rieseguire il boost", async () => {
    const sourceUrl = "blob:frame-booster-source";
    const file = new File([new Uint8Array([0, 1, 2, 3])], "source.mp4", { type: "video/mp4" });
    const blob = new Blob([new Uint8Array([4, 5, 6, 7])], { type: "video/mp4" });
    registerFrameBoosterSourceFile(sourceUrl, file);
    useProjectStore.getState().updateFrameBooster({ sourceUrl, sourceName: file.name, sourceWidth: 1280, sourceHeight: 720, sourceDurationSeconds: 2, method: "motion" });
    frameInterpolationJob.mockResolvedValue({
      blob,
      status: {
        id: "job-ready", phase: "ready", phaseLabel: "Interpolazione completata", progress: 1, stageProgress: 1,
        currentFrame: 117, totalFrames: 117, indeterminate: false, targetFps: 60, backend: "ffmpeg-minterpolate", resultPath: "/tmp/job/interpolated.mp4",
        source: { frameCount: 60, fps: 30, durationSeconds: 2, width: 1280, height: 720, hasAudio: true },
        output: { frameCount: 117, fps: 60, durationSeconds: 1.95, width: 1280, height: 720, hasAudio: true }
      }
    });

    render(<FrameBoosterPreview />);
    fireEvent.click(screen.getByRole("button", { name: "Boost frames" }));
    await screen.findByText(/Video interpolato e verificato/);
    expect(frameInterpolationJob).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("frame-booster:export"));
    await waitFor(() => expect(saveUpscalerVideoArtifact).toHaveBeenCalledWith(
      { kind: "download" },
      expect.objectContaining({ blob, fileName: "source-boosted.mp4", resultPath: "/tmp/job/interpolated.mp4" })
    ));
    expect(frameInterpolationJob).toHaveBeenCalledTimes(1);
  });

  it("annulla il job della sorgente precedente e avvia subito quella nuova", async () => {
    const firstUrl = "blob:frame-booster-a";
    const secondUrl = "blob:frame-booster-b";
    const first = new File(["a"], "a.mp4", { type: "video/mp4" });
    const second = new File(["b"], "b.mp4", { type: "video/mp4" });
    registerFrameBoosterSourceFile(firstUrl, first);
    registerFrameBoosterSourceFile(secondUrl, second);
    useProjectStore.getState().updateFrameBooster({ sourceUrl: firstUrl, sourceName: first.name, sourceWidth: 640, sourceHeight: 360, sourceDurationSeconds: 1, method: "motion" });
    let firstSignal: AbortSignal | null = null;
    frameInterpolationJob
      .mockImplementationOnce((options: FrameInterpolationRequest) => new Promise((_resolve, reject) => {
        firstSignal = options.signal;
        options.signal.addEventListener("abort", () => reject(new DOMException("Operazione annullata", "AbortError")), { once: true });
      }))
      .mockResolvedValueOnce({
        blob: new Blob(["result-b"], { type: "video/mp4" }),
        status: { id: "job-b", phase: "ready", progress: 1, stageProgress: 1, currentFrame: 57, totalFrames: 57, indeterminate: false, targetFps: 60, backend: "ffmpeg", source: { frameCount: 30, fps: 30, durationSeconds: 1, width: 640, height: 360, hasAudio: false }, output: { frameCount: 57, fps: 60, durationSeconds: .95, width: 640, height: 360, hasAudio: false } }
      });

    render(<FrameBoosterPreview />);
    fireEvent.click(screen.getByRole("button", { name: "Boost frames" }));
    await screen.findByRole("button", { name: "Annulla" });
    useProjectStore.getState().updateFrameBooster({ sourceUrl: secondUrl, sourceName: second.name, sourceWidth: 640, sourceHeight: 360, sourceDurationSeconds: 1 });
    await waitFor(() => expect(firstSignal?.aborted).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Boost frames" }));
    await screen.findByText(/Video interpolato e verificato/);
    expect(frameInterpolationJob).toHaveBeenCalledTimes(2);
    expect(frameInterpolationJob.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ blob: second, fileName: "b.mp4" }));
  });

  it("non espone né salva un risultato privo dell’audit completo", async () => {
    const sourceUrl = "blob:frame-booster-no-audit";
    const file = new File(["source"], "unsafe.mp4", { type: "video/mp4" });
    registerFrameBoosterSourceFile(sourceUrl, file);
    useProjectStore.getState().updateFrameBooster({ sourceUrl, sourceName: file.name, sourceWidth: 640, sourceHeight: 360, sourceDurationSeconds: 1, method: "motion" });
    frameInterpolationJob.mockResolvedValue({
      blob: new Blob(["unverified"], { type: "video/mp4" }),
      status: { id: "job-no-audit", phase: "ready", progress: 1, stageProgress: 1, currentFrame: 57, totalFrames: 57, indeterminate: false, targetFps: 60 }
    });
    render(<FrameBoosterPreview />);
    fireEvent.click(screen.getByRole("button", { name: "Boost frames" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("audit completo");
    expect(screen.queryByRole("button", { name: "Salva video" })).not.toBeInTheDocument();
  });
});
