import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundAutoPanel } from "./BackgroundAutoPanel";
import { useProjectStore } from "../store/project-store";
import { detectBackgroundObjects, type BackgroundAutoDetectionResult } from "../services/background-auto-detection";

vi.mock("../services/background-auto-detection", () => ({ detectBackgroundObjects: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function result(label: string): BackgroundAutoDetectionResult {
  return {
    detections: [{ id: `det-${label}`, label, alias: label, score: .9, bbox: { x: .1, y: .1, width: .5, height: .5 }, isPerson: false, paletteMode: "auto", palette: ["#111111", "#222222", "#333333"] }],
    palette: ["#111111", "#222222", "#333333"],
    personCount: 0,
    sourceWidth: 1200,
    sourceHeight: 800,
  };
}

describe("BackgroundAutoPanel", () => {
  beforeEach(() => {
    vi.mocked(detectBackgroundObjects).mockReset();
    useProjectStore.getState().newProject();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("persists the Circular Spectrum opacity slider", () => {
    render(<BackgroundAutoPanel />);
    const effect = useProjectStore.getState().project.animation.backgroundAuto.effects[0]!;
    const slider = screen.getByRole("slider", { name: "Opacity for Circular Spectrum 1" });
    expect(slider).toHaveValue("0.9");
    fireEvent.change(slider, { target: { value: "0.25" } });
    expect(useProjectStore.getState().project.animation.backgroundAuto.effects.find((candidate) => candidate.id === effect.id)?.opacity).toBe(.25);
  });

  it("ignores blank manual geometry inputs and clamps finite out-of-range values", () => {
    render(<BackgroundAutoPanel />);
    const effect = useProjectStore.getState().project.animation.backgroundAuto.effects[0]!;
    fireEvent.change(screen.getByRole("combobox", { name: "Placement for Circular Spectrum 1" }), { target: { value: "manual" } });
    const centerX = screen.getByRole("spinbutton", { name: "Center X for Circular Spectrum 1" });
    const centerY = screen.getByRole("spinbutton", { name: "Center Y for Circular Spectrum 1" });
    const diameter = screen.getByRole("spinbutton", { name: "Diameter for Circular Spectrum 1" });
    fireEvent.change(centerX, { target: { value: "" } });
    fireEvent.change(centerY, { target: { value: "" } });
    fireEvent.change(diameter, { target: { value: "" } });
    expect(useProjectStore.getState().project.animation.backgroundAuto.effects.find((candidate) => candidate.id === effect.id)).toMatchObject({ centerX: .5, centerY: .5, diameter: .42 });
    fireEvent.change(centerX, { target: { value: "-3" } });
    fireEvent.change(centerY, { target: { value: "4" } });
    fireEvent.change(diameter, { target: { value: "2" } });
    expect(useProjectStore.getState().project.animation.backgroundAuto.effects.find((candidate) => candidate.id === effect.id)).toMatchObject({ centerX: 0, centerY: 1, diameter: 1 });
  });

  it("aborts superseded detections and ignores their late progress and result", async () => {
    const first = deferred<BackgroundAutoDetectionResult>();
    const second = deferred<BackgroundAutoDetectionResult>();
    vi.mocked(detectBackgroundObjects).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    useProjectStore.getState().updateBackgroundAuto({ imageUrl: "data:image/png;base64,current" });
    render(<BackgroundAutoPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Detect again" }));
    const firstOptions = vi.mocked(detectBackgroundObjects).mock.calls[0]![1]!;
    act(() => firstOptions.onProgress?.("First run progress"));
    expect(screen.getByText("First run progress")).toBeInTheDocument();

    useProjectStore.getState().updateBackgroundAuto({ detectionThreshold: .42 });
    fireEvent.click(screen.getByRole("button", { name: "Detect again" }));
    const secondOptions = vi.mocked(detectBackgroundObjects).mock.calls[1]![1]!;
    expect(firstOptions.signal?.aborted).toBe(true);
    expect(secondOptions.signal?.aborted).toBe(false);
    expect(secondOptions.threshold).toBe(.42);

    act(() => {
      firstOptions.onProgress?.("Stale progress");
      secondOptions.onProgress?.("Current progress");
    });
    expect(screen.queryByText("Stale progress")).not.toBeInTheDocument();
    expect(screen.getByText("Current progress")).toBeInTheDocument();

    await act(async () => { second.resolve(result("current")); await second.promise; });
    expect(useProjectStore.getState().project.animation.backgroundAuto.detections[0]?.label).toBe("current");
    await act(async () => { first.resolve(result("stale")); await first.promise; });
    expect(useProjectStore.getState().project.animation.backgroundAuto.detections[0]?.label).toBe("current");
    expect(screen.getByText("1 object detected")).toBeInTheDocument();
  });

  it("ignores superseded FileReader completions and errors and aborts detection on a new import", async () => {
    const readers: ControlledFileReader[] = [];
    class ControlledFileReader {
      result: string | ArrayBuffer | null = null;
      onload: FileReader["onload"] = null;
      onerror: FileReader["onerror"] = null;
      readAsDataURL(file: Blob) { void file; readers.push(this); }
      load(value: string) {
        this.result = value;
        this.onload?.call(this as unknown as FileReader, new ProgressEvent("load") as ProgressEvent<FileReader>);
      }
      fail() {
        this.onerror?.call(this as unknown as FileReader, new ProgressEvent("error") as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal("FileReader", ControlledFileReader);
    const firstDetection = deferred<BackgroundAutoDetectionResult>();
    const secondDetection = deferred<BackgroundAutoDetectionResult>();
    vi.mocked(detectBackgroundObjects).mockReturnValueOnce(firstDetection.promise).mockReturnValueOnce(secondDetection.promise);
    render(<BackgroundAutoPanel />);
    const input = screen.getByLabelText("Upload Auto Detector image");
    const upload = (name: string) => fireEvent.change(input, { target: { files: [new File([name], `${name}.png`, { type: "image/png" })] } });

    upload("a");
    upload("b");
    expect(readers).toHaveLength(2);
    await act(async () => { readers[1]!.load("data:image/png;base64,b"); });
    await waitFor(() => expect(detectBackgroundObjects).toHaveBeenCalledTimes(1));
    expect(useProjectStore.getState().project.animation.backgroundAuto.imageUrl).toBe("data:image/png;base64,b");
    await act(async () => { readers[0]!.load("data:image/png;base64,a"); });
    expect(detectBackgroundObjects).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().project.animation.backgroundAuto.imageUrl).toBe("data:image/png;base64,b");

    const firstOptions = vi.mocked(detectBackgroundObjects).mock.calls[0]![1]!;
    upload("c");
    expect(firstOptions.signal?.aborted).toBe(true);
    upload("d");
    await act(async () => { readers[3]!.load("data:image/png;base64,d"); });
    await waitFor(() => expect(detectBackgroundObjects).toHaveBeenCalledTimes(2));
    await act(async () => { readers[2]!.fail(); });
    expect(screen.queryByText("Unable to read the image file.")).not.toBeInTheDocument();

    await act(async () => { secondDetection.resolve(result("d")); await secondDetection.promise; });
    await act(async () => { firstDetection.resolve(result("b")); await firstDetection.promise; });
    expect(useProjectStore.getState().project.animation.backgroundAuto.imageUrl).toBe("data:image/png;base64,d");
    expect(useProjectStore.getState().project.animation.backgroundAuto.detections[0]?.label).toBe("d");
  });

  it("aborts an active detection when unmounted", () => {
    vi.mocked(detectBackgroundObjects).mockReturnValue(new Promise(() => {}));
    useProjectStore.getState().updateBackgroundAuto({ imageUrl: "data:image/png;base64,current" });
    const view = render(<BackgroundAutoPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Detect again" }));
    const signal = vi.mocked(detectBackgroundObjects).mock.calls[0]![1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
