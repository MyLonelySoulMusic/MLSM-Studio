import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ capabilities: vi.fn(), start: vi.fn(), get: vi.fn(), cancel: vi.fn(), input: vi.fn(), output: vi.fn() }));
const remote = vi.hoisted(() => ({ check: vi.fn(), start: vi.fn(), get: vi.fn(), cancel: vi.fn(), materialize: vi.fn(), openColab: vi.fn() }));
vi.mock("../services/longcat-video-native", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/longcat-video-native")>(),
  getLongCatVideoCapabilities: native.capabilities, startLongCatVideoJob: native.start, getLongCatVideoJob: native.get,
  cancelLongCatVideoJob: native.cancel, chooseLongCatInput: native.input, chooseLongCatOutputDirectory: native.output,
  longCatVideoPreviewUrl: (path: string) => `asset:${path}`
}));
vi.mock("../services/longcat-video-remote", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/longcat-video-remote")>(),
  checkLongCatRemoteEndpoints: remote.check, startRemoteLongCatVideoJob: remote.start,
  getRemoteLongCatVideoJob: remote.get, cancelRemoteLongCatVideoJob: remote.cancel,
  materializeRemoteLongCatResult: remote.materialize, openLongCatColabNotebook: remote.openColab
}));

import { LongCatVideoWorkspace } from "./LongCatVideoWorkspace";

const ready = { desktop: true, ready: true, platformSupported: true, runtimeReady: true, repositoryReady: true, checkpointReady: true, cudaReady: true, gpuName: "RTX", revision: "abc", reason: null, setupCommand: "npm run longcat-video:setup" };

describe("LongCatVideoWorkspace", () => {
  beforeEach(() => { localStorage.clear(); native.capabilities.mockReset().mockResolvedValue(ready); native.start.mockReset(); native.get.mockReset(); native.cancel.mockReset(); native.input.mockReset(); native.output.mockReset(); remote.check.mockReset(); remote.start.mockReset(); remote.get.mockReset(); remote.cancel.mockReset(); remote.materialize.mockReset(); remote.openColab.mockReset().mockResolvedValue(undefined); });
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

  it("non apre Colab automaticamente e lo apre solo dopo il clic dell’utente", async () => {
    native.capabilities.mockResolvedValue({ ...ready, ready: false, cudaReady: false, reason: "CUDA assente" });
    render(<LongCatVideoWorkspace />);
    expect(await screen.findByText("CUDA locale non disponibile")).toBeInTheDocument();
    expect(remote.openColab).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apri Colab" }));
    await waitFor(() => expect(remote.openColab).toHaveBeenCalledOnce());
  });

  it("aggiunge schede Colab, verifica in parallelo e avvia il backend selezionato", async () => {
    native.output.mockResolvedValue("/output");
    remote.check.mockImplementation(async (endpoints) => endpoints.map((endpoint: { id: string }) => ({
      endpoint, ok: true,
      capabilities: { protocolVersion: 1, service: "mlsm-longcat-remote", ready: true, busy: false, gpuName: "A100", revision: "abc", reason: null, modes: ["textToVideo"], limits: { maxInputBytes: 1, maxFrames: 257, maxActiveJobs: 1 } }
    })));
    remote.start.mockResolvedValue({ jobId: "lcr-1", mode: "textToVideo", status: "completed", progress: 1, message: "ok", result: { mode: "textToVideo", path: "remote", width: 832, height: 480, frames: 93, fps: 15, durationSeconds: 6.2, seed: 42 }, error: null });
    remote.materialize.mockImplementation(async (_endpoint, job) => ({ ...job, result: { ...job.result, path: "/output/remote.mp4" } }));
    render(<LongCatVideoWorkspace />); await screen.findByText("La GPU è pronta");
    fireEvent.click(screen.getByRole("tab", { name: "Google Colab" }));
    fireEvent.change(screen.getByLabelText("Link endpoint Colab"), { target: { value: "https://one.gradio.live#mlsm-token=secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi" }));
    fireEvent.click(screen.getByRole("button", { name: "Verifica tutti gli endpoint attivi" }));
    expect(await screen.findAllByText("A100 pronta")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Scegli destinazione" })); await screen.findByText("/output");
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "A neon cat" } });
    fireEvent.click(screen.getByRole("button", { name: "Genera video" }));
    await waitFor(() => expect(remote.start).toHaveBeenCalledWith(expect.objectContaining({ label: "Colab 1" }), expect.objectContaining({ mode: "textToVideo", outputDirectory: "/output" }), expect.any(AbortSignal)));
    await screen.findByText("remote.mp4");
  });
});
