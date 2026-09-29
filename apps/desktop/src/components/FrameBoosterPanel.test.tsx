import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFrameBoosterSourceFile, getFrameBoosterSourceFile, registerFrameBoosterSourceFile } from "../services/frame-booster-source-file";
import { useProjectStore } from "../store/project-store";

const { waitForFrameInterpolationHealth, probeFrameInterpolationSource } = vi.hoisted(() => ({
  waitForFrameInterpolationHealth: vi.fn(),
  probeFrameInterpolationSource: vi.fn(),
}));
type RuntimeDiagnosticPayload = {
  phase: "idle" | "probing" | "starting" | "waiting" | "ready" | "error";
  message: string;
  at: string;
  pid?: number;
  logPath?: string;
  recentLogs?: string[];
};
const runtimeDiagnostics = vi.hoisted(() => {
  let current: RuntimeDiagnosticPayload = {
    phase: "idle",
    message: "Runtime non ancora richiesto.",
    at: "2026-01-01T00:00:00.000Z",
  };
  const listeners = new Set<(diagnostic: RuntimeDiagnosticPayload) => void>();
  return {
    pythonUpscalerRuntimeDiagnostic: vi.fn(() => current),
    subscribePythonUpscalerRuntimeDiagnostic: vi.fn((listener: (diagnostic: RuntimeDiagnosticPayload) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit(next: Partial<RuntimeDiagnosticPayload>) {
      current = { ...current, ...next };
      listeners.forEach((listener) => listener(current));
    },
    reset() {
      current = {
        phase: "idle",
        message: "Runtime non ancora richiesto.",
        at: "2026-01-01T00:00:00.000Z",
      };
      listeners.clear();
    },
    listenerCount: () => listeners.size,
  };
});
vi.mock("../services/upscaler-python-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/upscaler-python-client")>();
  return {
    ...actual,
    pythonUpscalerRuntimeDiagnostic: runtimeDiagnostics.pythonUpscalerRuntimeDiagnostic,
    subscribePythonUpscalerRuntimeDiagnostic: runtimeDiagnostics.subscribePythonUpscalerRuntimeDiagnostic,
  };
});
const shutdownAreaPythonServices = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../services/frame-interpolation-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/frame-interpolation-client")>();
  return { ...actual, waitForFrameInterpolationHealth, probeFrameInterpolationSource };
});
vi.mock("../services/python-service-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/python-service-lifecycle")>();
  return { ...actual, shutdownAreaPythonServices };
});

import { FrameBoosterPanel } from "./FrameBoosterPanel";

describe("FrameBoosterPanel", () => {
  const ffmpegCapabilities = {
    ffmpeg: true, jobs: true
  };

  beforeEach(() => {
    useProjectStore.getState().newProject();
    clearFrameBoosterSourceFile();
    runtimeDiagnostics.reset();
    waitForFrameInterpolationHealth.mockResolvedValue(null);
    probeFrameInterpolationSource.mockResolvedValue({ frameCount: 75, fps: 29.97, durationSeconds: 2.5, width: 1920, height: 1080, hasAudio: true });
    shutdownAreaPythonServices.mockResolvedValue(undefined);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:new-video") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    clearFrameBoosterSourceFile();
    waitForFrameInterpolationHealth.mockReset();
    probeFrameInterpolationSource.mockReset();
    runtimeDiagnostics.pythonUpscalerRuntimeDiagnostic.mockClear();
    runtimeDiagnostics.subscribePythonUpscalerRuntimeDiagnostic.mockClear();
    shutdownAreaPythonServices.mockReset();
    vi.restoreAllMocks();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("adopts the source immediately and enriches it when metadata arrives", async () => {
    const previous = new File(["old"], "old.mp4", { type: "video/mp4" });
    registerFrameBoosterSourceFile("blob:old-video", previous);
    useProjectStore.getState().updateFrameBooster({ sourceUrl: "blob:old-video", sourceName: previous.name, sourceWidth: 320, sourceHeight: 180, sourceDurationSeconds: 1 });
    render(<FrameBoosterPanel />);
    expect(screen.getByLabelText("Carica video Frame Booster")).toBeVisible();
    expect(screen.getByLabelText("Metodo Frame Booster")).toBeVisible();
    expect(screen.getByLabelText("Target Frame Booster")).toBeVisible();

    const originalCreateElement = document.createElement.bind(document);
    const metadataVideo = {
      preload: "", muted: false, src: "", duration: 2.5, videoWidth: 1920, videoHeight: 1080,
      onloadedmetadata: null as (() => void) | null,
      onerror: null as (() => void) | null,
      load: vi.fn(), removeAttribute: vi.fn()
    };
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => tagName === "video"
      ? metadataVideo as unknown as HTMLVideoElement
      : originalCreateElement(tagName, options)) as typeof document.createElement);
    const next = new File(["new"], "new.mp4", { type: "video/mp4" });
    const picker = screen.getByLabelText("Carica video Frame Booster") as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [next] } });
    expect(useProjectStore.getState().project.animation.frameBooster.sourceName).toBe("new.mp4");
    expect(getFrameBoosterSourceFile("blob:new-video")).toBe(next);
    expect(getFrameBoosterSourceFile("blob:old-video")).toBeNull();
    expect(picker.files?.[0]).toBe(next);
    expect(screen.getByText("Video caricato. Rilevamento dei metadati in corso…")).toBeVisible();
    expect(metadataVideo.load).toHaveBeenCalled();
    metadataVideo.onloadedmetadata?.();

    await waitFor(() => expect(useProjectStore.getState().project.animation.frameBooster.sourceWidth).toBe(1920));
    await waitFor(() => expect(useProjectStore.getState().project.animation.frameBooster.sourceFps).toBe(29.97));
    expect(screen.getByText(/1920 × 1080 · 2.50 s · 29.97 fps/)).toBeVisible();
    expect(screen.getByText(/Metadati rilevati · 29.97 fps · 75 frame · audio presente/)).toBeVisible();
    expect(probeFrameInterpolationSource).toHaveBeenCalledWith(next, expect.any(AbortSignal));
    expect(screen.queryByText("Video caricato. Rilevamento dei metadati in corso…")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:old-video");
  });

  it("keeps the selected video usable when browser metadata fails", async () => {
    probeFrameInterpolationSource.mockRejectedValueOnce(new Error("Rilevamento FPS non riuscito: backend offline"));
    const originalCreateElement = document.createElement.bind(document);
    const metadataVideo = {
      preload: "", muted: false, src: "", duration: Number.NaN, videoWidth: 0, videoHeight: 0,
      onloadedmetadata: null as (() => void) | null, onerror: null as (() => void) | null,
      load: vi.fn(), removeAttribute: vi.fn()
    };
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => tagName === "video"
      ? metadataVideo as unknown as HTMLVideoElement
      : originalCreateElement(tagName, options)) as typeof document.createElement);
    const file = new File(["video"], "webkit.mov", { type: "video/quicktime" });
    render(<FrameBoosterPanel />);
    fireEvent.change(screen.getByLabelText("Carica video Frame Booster"), { target: { files: [file] } });
    metadataVideo.onerror?.();

    await waitFor(() => expect(screen.getByText("Rilevamento FPS non riuscito: backend offline")).toBeVisible());
    expect(useProjectStore.getState().project.animation.frameBooster.sourceName).toBe("webkit.mov");
    expect(getFrameBoosterSourceFile("blob:new-video")).toBe(file);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:new-video");
  });

  it("offers the three FFmpeg methods and explains when to use each one", async () => {
    waitForFrameInterpolationHealth.mockResolvedValue(ffmpegCapabilities);

    render(<FrameBoosterPanel />);

    await waitFor(() => expect(screen.getByText("FFmpeg pronto")).toBeVisible());
    expect(screen.getByText("Pronto")).toBeVisible();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(expect.arrayContaining(["Motion AOBMC · FFmpeg", "Motion OBMC bidirezionale · FFmpeg", "Frame blend · FFmpeg"]));
    expect(screen.queryByText(/RIFE/i)).not.toBeInTheDocument();
    expect(screen.getByText("Ricostruisce il movimento")).toBeVisible();
    expect(screen.getByText(/persone o oggetti in movimento/)).toBeVisible();

    fireEvent.change(screen.getByLabelText("Metodo Frame Booster"), { target: { value: "motion-obmc" } });
    expect(screen.getByText("Movimento bidirezionale OBMC")).toBeVisible();
    expect(screen.getByText(/mc_mode=obmc e me_mode=bidir/)).toBeVisible();
    expect(useProjectStore.getState().project.animation.frameBooster.method).toBe("motion-obmc");

    fireEvent.change(screen.getByLabelText("Metodo Frame Booster"), { target: { value: "blend" } });
    expect(screen.getByText("Fonde i fotogrammi vicini")).toBeVisible();
    expect(screen.getByText(/inquadrature quasi statiche/)).toBeVisible();
    expect(screen.getByText(/scie o immagini doppie/)).toBeVisible();
  });

  it("shows startup instead of a false verification error while health is pending", () => {
    waitForFrameInterpolationHealth.mockReturnValue(new Promise(() => undefined));
    render(<FrameBoosterPanel />);
    expect(screen.getByText("Avvio…")).toBeVisible();
    expect(screen.getByText("Avvio del runtime…")).toBeVisible();
    expect(screen.queryByText("Da verificare")).not.toBeInTheDocument();
  });

  it("shows live startup messages, elapsed time, log path and recent backend logs", async () => {
    waitForFrameInterpolationHealth.mockReturnValue(new Promise(() => undefined));
    render(<FrameBoosterPanel />);

    runtimeDiagnostics.emit({
      phase: "starting",
      message: "Import Torch/OpenCV in corso…",
      at: "2026-01-01T00:00:03.000Z",
      pid: 8124,
      logPath: "C:\\MLSM\\logs\\upscaler.log",
      recentLogs: ["[python] avvio", "[python] import torch"],
    });

    await waitFor(() => expect(screen.getAllByText("Import Torch/OpenCV in corso…").length).toBeGreaterThan(0));
    expect(screen.getByText(/Avvio del backend · \d+ s/)).toBeVisible();
    expect(screen.getAllByText("C:\\MLSM\\logs\\upscaler.log").length).toBeGreaterThan(0);
    expect(screen.getByText("Log recenti (2)")).toBeVisible();
    expect(screen.getByText((content) => content.includes("[python] import torch"))).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Avanzamento avvio backend" })).toBeInTheDocument();
  });

  it("adopts health after the StrictMode cleanup and second setup used by the real app", async () => {
    waitForFrameInterpolationHealth.mockResolvedValue(ffmpegCapabilities);

    render(<StrictMode><FrameBoosterPanel /></StrictMode>);

    await waitFor(() => expect(screen.getByText("Pronto")).toBeVisible());
    expect(screen.getByText("FFmpeg pronto")).toBeVisible();
    expect(screen.queryByText("Avvio…")).not.toBeInTheDocument();
    expect(waitForFrameInterpolationHealth).toHaveBeenCalledTimes(2);
  });

  it("keeps failure logs readable after startup ends without inventing a 60-second wait", async () => {
    runtimeDiagnostics.emit({ phase: "error", message: "ModuleNotFoundError: torch", recentLogs: ["Traceback: runtime import failed"], logPath: "logs/upscaler-vite.log" });
    waitForFrameInterpolationHealth.mockResolvedValue(null);
    render(<FrameBoosterPanel />);
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(screen.getAllByText("ModuleNotFoundError: torch").length).toBeGreaterThan(0);
    expect(screen.getByText("Traceback: runtime import failed")).toBeInTheDocument();
    expect(screen.queryByText(/non è partito entro 60 secondi/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Riprova backend" })).toBeEnabled();
  });

  it("stops the owned Python runtime when leaving Frame Booster", () => {
    const view = render(<FrameBoosterPanel />);

    expect(runtimeDiagnostics.listenerCount()).toBe(1);
    view.unmount();

    expect(shutdownAreaPythonServices).toHaveBeenCalledTimes(1);
    expect(runtimeDiagnostics.listenerCount()).toBe(0);
    runtimeDiagnostics.emit({ phase: "ready", message: "Backend pronto", at: "2026-01-01T00:00:04.000Z" });
    expect(runtimeDiagnostics.listenerCount()).toBe(0);
  });
});
