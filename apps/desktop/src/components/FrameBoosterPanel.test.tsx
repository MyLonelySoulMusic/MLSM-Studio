import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFrameBoosterSourceFile, getFrameBoosterSourceFile, registerFrameBoosterSourceFile } from "../services/frame-booster-source-file";
import { useProjectStore } from "../store/project-store";

const waitForFrameInterpolationHealth = vi.hoisted(() => vi.fn());
vi.mock("../services/frame-interpolation-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/frame-interpolation-client")>();
  return { ...actual, waitForFrameInterpolationHealth };
});

import { FrameBoosterPanel } from "./FrameBoosterPanel";

describe("FrameBoosterPanel", () => {
  const ffmpegCapabilities = {
    ffmpeg: true, jobs: true
  };

  beforeEach(() => {
    useProjectStore.getState().newProject();
    clearFrameBoosterSourceFile();
    waitForFrameInterpolationHealth.mockResolvedValue(null);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:new-video") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    clearFrameBoosterSourceFile();
    waitForFrameInterpolationHealth.mockReset();
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
    fireEvent.change(screen.getByLabelText("Carica video Frame Booster"), { target: { files: [next] } });
    expect(useProjectStore.getState().project.animation.frameBooster.sourceName).toBe("new.mp4");
    expect(getFrameBoosterSourceFile("blob:new-video")).toBe(next);
    expect(getFrameBoosterSourceFile("blob:old-video")).toBeNull();
    expect(screen.getByText("Video caricato. Rilevamento dei metadati in corso…")).toBeVisible();
    expect(metadataVideo.load).toHaveBeenCalled();
    metadataVideo.onloadedmetadata?.();

    await waitFor(() => expect(useProjectStore.getState().project.animation.frameBooster.sourceWidth).toBe(1920));
    expect(screen.queryByText("Video caricato. Rilevamento dei metadati in corso…")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:old-video");
  });

  it("keeps the selected video usable when browser metadata fails", async () => {
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

    await waitFor(() => expect(screen.getByText("Video caricato. I dettagli tecnici verranno rilevati dal backend prima dell’elaborazione.")).toBeVisible());
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

  it("adopts health after the StrictMode cleanup and second setup used by the real app", async () => {
    waitForFrameInterpolationHealth.mockResolvedValue(ffmpegCapabilities);

    render(<StrictMode><FrameBoosterPanel /></StrictMode>);

    await waitFor(() => expect(screen.getByText("Pronto")).toBeVisible());
    expect(screen.getByText("FFmpeg pronto")).toBeVisible();
    expect(screen.queryByText("Avvio…")).not.toBeInTheDocument();
    expect(waitForFrameInterpolationHealth).toHaveBeenCalledTimes(2);
  });
});
