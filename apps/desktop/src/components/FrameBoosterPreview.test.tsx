import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFrameBoosterSourceFile, registerFrameBoosterSourceFile } from "../services/frame-booster-source-file";
import type { FrameInterpolationRequest } from "../services/frame-interpolation-client";
import { useProjectStore } from "../store/project-store";

const frameInterpolationJob = vi.hoisted(() => vi.fn());
vi.mock("../services/frame-interpolation-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/frame-interpolation-client")>();
  return { ...actual, frameInterpolationJob };
});

import { FrameBoosterPreview } from "./FrameBoosterPreview";

describe("FrameBoosterPreview", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    clearFrameBoosterSourceFile();
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    clearFrameBoosterSourceFile();
    frameInterpolationJob.mockReset();
    vi.restoreAllMocks();
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
});
