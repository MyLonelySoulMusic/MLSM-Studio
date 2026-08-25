import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ capabilities: vi.fn(), start: vi.fn(), get: vi.fn(), cancel: vi.fn(), input: vi.fn(), output: vi.fn() }));
vi.mock("../services/longcat-video-native", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/longcat-video-native")>(),
  getLongCatVideoCapabilities: native.capabilities, startLongCatVideoJob: native.start, getLongCatVideoJob: native.get,
  cancelLongCatVideoJob: native.cancel, chooseLongCatInput: native.input, chooseLongCatOutputDirectory: native.output,
  longCatVideoPreviewUrl: (path: string) => `asset:${path}`
}));

import { LongCatVideoWorkspace } from "./LongCatVideoWorkspace";

const ready = { desktop: true, ready: true, platformSupported: true, runtimeReady: true, repositoryReady: true, checkpointReady: true, cudaReady: true, gpuName: "RTX", revision: "abc", reason: null, setupCommand: "npm run longcat-video:setup" };

describe("LongCatVideoWorkspace", () => {
  beforeEach(() => { localStorage.clear(); native.capabilities.mockReset().mockResolvedValue(ready); native.start.mockReset(); native.get.mockReset(); native.cancel.mockReset(); native.input.mockReset(); native.output.mockReset(); });
  afterEach(cleanup);

  it("mostra le tre pipeline ufficiali e torna alla home", async () => {
    const onHome = vi.fn(); render(<LongCatVideoWorkspace onHome={onHome} />);
    expect(await screen.findByText("La GPU è pronta")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Text to Video" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Image to Video" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Video Continuation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Home" })); expect(onHome).toHaveBeenCalledOnce();
  });

  it("richiede sorgente e destinazione e avvia image-to-video", async () => {
    native.input.mockResolvedValue("/input/cat.png"); native.output.mockResolvedValue("/output");
    native.start.mockResolvedValue({ jobId: "lc-1", mode: "imageToVideo", status: "completed", progress: 1, message: "ok", result: { mode: "imageToVideo", path: "/output/cat.mp4", width: 832, height: 480, frames: 93, fps: 15, durationSeconds: 6.2, seed: 42 }, error: null });
    native.get.mockResolvedValue(native.start.mock.results[0]?.value);
    render(<LongCatVideoWorkspace />); await screen.findByText("La GPU è pronta");
    fireEvent.click(screen.getByRole("tab", { name: "Image to Video" }));
    fireEvent.click(screen.getByRole("button", { name: "Scegli file" })); await screen.findByText("cat.png");
    fireEvent.click(screen.getByRole("button", { name: "Scegli destinazione" })); await screen.findByText("/output");
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "A cat walking" } });
    fireEvent.click(screen.getByRole("button", { name: "Genera video" }));
    await waitFor(() => expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ mode: "imageToVideo", inputPath: "/input/cat.png", outputDirectory: "/output", prompt: "A cat walking", useDistill: true })));
  });
});
