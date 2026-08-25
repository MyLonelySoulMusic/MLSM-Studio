import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { useUpscalerBatchStore } from "../store/upscaler-batch-store";

const createItems = vi.hoisted(() => vi.fn());
const runBatch = vi.hoisted(() => vi.fn().mockResolvedValue({ completed: [], failed: [], cancelled: [] }));
const chooseOutput = vi.hoisted(() => vi.fn());
vi.mock("../services/upscaler-batch", async () => {
  const actual = await vi.importActual<typeof import("../services/upscaler-batch")>("../services/upscaler-batch");
  return { ...actual, createUpscalerBatchItems: createItems, runUpscalerBatch: runBatch };
});
vi.mock("../services/upscaler-batch-output", () => ({ chooseUpscalerBatchOutputSink: chooseOutput }));

import { UpscalerBatchPanel } from "./UpscalerBatchPanel";

describe("UpscalerBatchPanel", () => {
  afterEach(() => { cleanup(); useUpscalerBatchStore.getState().resetForProjectReplacement(); createItems.mockReset(); runBatch.mockReset(); runBatch.mockResolvedValue({ completed: [], failed: [], cancelled: [] }); chooseOutput.mockReset(); vi.restoreAllMocks(); });

  it("accepts a multiple-image input and lists the imported target", async () => {
    createItems.mockResolvedValue({ items: [{ id: "photo", file: new File(["x"], "photo.jpg", { type: "image/jpeg" }), url: "blob:photo", name: "photo.jpg", sourceWidth: 1200, sourceHeight: 800, target: { width: 2400, height: 1600 }, outputName: "photo-upscaled-2400x1600.png", selected: true, status: "queued", progress: 0, error: null }], failures: [] });
    render(<UpscalerBatchPanel settings={createProject().animation.upscaler} />);
    const input = screen.getByLabelText("Aggiungi altre foto al batch Upscaler");
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("photo.jpg")).toBeInTheDocument());
    expect(screen.getByText("1200 × 800 → 2400 × 1600")).toBeInTheDocument();
    expect(screen.getByText("Output: photo-upscaled-2400x1600.png")).toBeInTheDocument();
    expect(screen.getByText("Regolazioni live · AI nella preview principale")).toBeInTheDocument();
  });

  it("lets Space toggle the checkbox without changing the gallery preview", () => {
    useUpscalerBatchStore.setState({ items: [{ id: "photo", file: new File(["x"], "photo.jpg"), url: "blob:photo", thumbnailUrl: null, name: "photo.jpg", sourceWidth: 100, sourceHeight: 50, target: { width: 200, height: 100 }, outputName: "photo.png", selected: true, status: "queued", progress: 0, error: null }], previewItemId: null });
    const { container } = render(<UpscalerBatchPanel settings={createProject().animation.upscaler} />);
    const checkbox = screen.getByRole("checkbox", { name: "Seleziona photo.jpg" });
    fireEvent.keyDown(checkbox, { key: " ", code: "Space" });
    expect(checkbox).not.toBeChecked();
    expect(useUpscalerBatchStore.getState().previewItemId).toBeNull();
    expect(container.querySelector("article")).not.toHaveAttribute("tabindex");
  });

  it("ignores clear during a pending import, then revokes URLs after completion", async () => {
    let resolveImport!: (value: unknown) => void; const pending = new Promise((resolve) => { resolveImport = resolve; }); createItems.mockReturnValue(pending);
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    render(<UpscalerBatchPanel settings={createProject().animation.upscaler} />);
    fireEvent.change(screen.getByLabelText("Aggiungi altre foto al batch Upscaler"), { target: { files: [new File(["x"], "late.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(screen.getByLabelText("Aggiungi altre foto al batch Upscaler")).toBeDisabled());
    expect(screen.getByRole("button", { name: "Importazione…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Svuota" }));
    resolveImport({ items: [{ id: "late", file: new File(["x"], "late.jpg"), url: "blob:late", name: "late.jpg", sourceWidth: 10, sourceHeight: 10, target: { width: 20, height: 20 }, outputName: "late.png", selected: true, status: "queued", progress: 0, error: null }], failures: [] });
    await pending; await waitFor(() => expect(useUpscalerBatchStore.getState().items).toHaveLength(1)); expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Svuota" }));
    expect(useUpscalerBatchStore.getState().items).toHaveLength(0); expect(revoke).toHaveBeenCalledWith("blob:late");
  });

  it("keeps valid imports visible while summarizing per-file failures", async () => {
    createItems.mockResolvedValue({ items: [{ id: "good", file: new File(["x"], "good.jpg"), url: "blob:good", name: "good.jpg", sourceWidth: 100, sourceHeight: 50, target: { width: 200, height: 100 }, outputName: "good-upscaled-200x100.png", selected: true, status: "queued", progress: 0, error: null }], failures: [{ name: "broken.jpg", error: "Immagine non leggibile." }] });
    render(<UpscalerBatchPanel settings={{ ...createProject().animation.upscaler, scale: 2 }} />);
    fireEvent.change(screen.getByLabelText("Aggiungi altre foto al batch Upscaler"), { target: { files: [new File(["x"], "good.jpg"), new File(["x"], "broken.jpg")] } });
    await waitFor(() => expect(screen.getByText("good.jpg")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("1 file non importati"); expect(screen.getByRole("alert")).toHaveTextContent("broken.jpg: Immagine non leggibile.");
  });

  it("synchronizes target dimensions and output name after settings change", async () => {
    createItems.mockResolvedValue({ items: [{ id: "photo", file: new File(["x"], "photo.jpg"), url: "blob:photo", name: "photo.jpg", sourceWidth: 100, sourceHeight: 50, target: { width: 200, height: 100 }, outputName: "photo-upscaled-200x100.png", selected: true, status: "queued", progress: 0, error: null }], failures: [] });
    const initial = { ...createProject().animation.upscaler, scale: 2, lockAspectRatio: true };
    const { rerender } = render(<UpscalerBatchPanel settings={initial} />);
    fireEvent.change(screen.getByLabelText("Aggiungi altre foto al batch Upscaler"), { target: { files: [new File(["x"], "photo.jpg")] } });
    await waitFor(() => expect(screen.getByText("Output: photo-upscaled-200x100.png")).toBeInTheDocument());
    rerender(<UpscalerBatchPanel settings={{ ...initial, scale: 3 }} />);
    await waitFor(() => expect(screen.getByText("Output: photo-upscaled-300x150.png")).toBeInTheDocument());
  });

  it("snapshots current settings and queue atomically after a pending destination picker", async () => {
    runBatch.mockResolvedValueOnce({ completed: [], failed: [], cancelled: [] });
    let resolvePicker!: (sink: { label: string; write: ReturnType<typeof vi.fn> }) => void;
    chooseOutput.mockImplementationOnce(() => new Promise((resolve) => { resolvePicker = resolve; }));
    const initial = { ...createProject().animation.upscaler, scale: 2, lockAspectRatio: true };
    useUpscalerBatchStore.setState({ items: [{ id: "photo", file: new File(["x"], "photo.jpg"), url: "blob:photo", name: "photo.jpg", sourceWidth: 100, sourceHeight: 50, target: { width: 200, height: 100 }, outputName: "photo-upscaled-200x100.png", selected: true, status: "queued", progress: 0, error: null }] });
    const { rerender } = render(<UpscalerBatchPanel settings={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Elabora selezionate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Scelta destinazione…" })).toBeDisabled());
    const changed = { ...initial, scale: 3 };
    rerender(<UpscalerBatchPanel settings={changed} />);
    act(() => resolvePicker({ label: "Test", write: vi.fn() }));
    await waitFor(() => expect(runBatch).toHaveBeenCalledOnce());
    expect(runBatch.mock.calls[0]?.[0].settings).toMatchObject({ scale: 3 });
    expect(runBatch.mock.calls[0]?.[0].items[0]).toMatchObject({ target: { width: 300, height: 150 }, outputName: "photo-upscaled-300x150.png" });
  });

  it("ignores a destination picker that resolves across project replacement", async () => {
    let resolvePicker!: (sink: { label: string; write: ReturnType<typeof vi.fn> }) => void;
    chooseOutput.mockImplementationOnce(() => new Promise((resolve) => { resolvePicker = resolve; }));
    useUpscalerBatchStore.setState({ items: [{ id: "old", file: new File(["old"], "old.jpg"), url: "blob:old", name: "old.jpg", sourceWidth: 100, sourceHeight: 50, target: { width: 200, height: 100 }, outputName: "old.png", selected: true, status: "queued", progress: 0, error: null }] });
    render(<UpscalerBatchPanel settings={createProject().animation.upscaler} />);
    fireEvent.click(screen.getByRole("button", { name: "Elabora selezionate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Scelta destinazione…" })).toBeDisabled());

    act(() => {
      useUpscalerBatchStore.getState().resetForProjectReplacement();
      useUpscalerBatchStore.setState({ items: [{ id: "new", file: new File(["new"], "new.jpg"), url: "blob:new", name: "new.jpg", sourceWidth: 80, sourceHeight: 40, target: { width: 160, height: 80 }, outputName: "new.png", selected: true, status: "queued", progress: 0, error: null }] });
    });
    act(() => resolvePicker({ label: "Old project folder", write: vi.fn() }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Elabora selezionate" })).toBeEnabled());
    expect(runBatch).not.toHaveBeenCalled();
    expect(screen.queryByText("Old project folder")).not.toBeInTheDocument();
    expect(useUpscalerBatchStore.getState().items.map((item) => item.name)).toEqual(["new.jpg"]);
  });

  it("clears an installed output sink at the project boundary", async () => {
    chooseOutput.mockResolvedValueOnce({ label: "Project A folder", write: vi.fn() });
    useUpscalerBatchStore.setState({ items: [{ id: "photo", file: new File(["x"], "photo.jpg"), url: "blob:photo", name: "photo.jpg", sourceWidth: 100, sourceHeight: 50, target: { width: 200, height: 100 }, outputName: "photo.png", selected: true, status: "queued", progress: 0, error: null }] });
    render(<UpscalerBatchPanel settings={createProject().animation.upscaler} />);
    fireEvent.click(screen.getByRole("button", { name: "Elabora selezionate" }));
    expect(await screen.findByText("Project A folder")).toBeInTheDocument();
    await waitFor(() => expect(useUpscalerBatchStore.getState().running).toBe(false));

    act(() => useUpscalerBatchStore.getState().resetForProjectReplacement());
    await waitFor(() => expect(screen.queryByText("Project A folder")).not.toBeInTheDocument());
  });

  it("reports a non-abort destination error without replacing the current sink", async () => {
    chooseOutput.mockResolvedValueOnce({ label: "Working folder", write: vi.fn() }).mockRejectedValueOnce(new Error("Picker non disponibile"));
    useUpscalerBatchStore.setState({ items: [{ id: "photo", file: new File(["x"], "photo.jpg"), url: "blob:photo", name: "photo.jpg", sourceWidth: 100, sourceHeight: 50, target: { width: 200, height: 100 }, outputName: "photo.png", selected: true, status: "queued", progress: 0, error: null }] });
    render(<UpscalerBatchPanel settings={createProject().animation.upscaler} />);
    fireEvent.click(screen.getByRole("button", { name: "Elabora selezionate" }));
    expect(await screen.findByText("Working folder")).toBeInTheDocument();
    await waitFor(() => expect(useUpscalerBatchStore.getState().running).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Cambia" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Picker non disponibile");
    expect(screen.getByText("Working folder")).toBeInTheDocument();
    expect(chooseOutput).toHaveBeenCalledTimes(2);
  });

  it("ignores a picker rejection that arrives after unmount", async () => {
    let rejectPicker!: (error: Error) => void;
    chooseOutput.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPicker = reject; }));
    useUpscalerBatchStore.setState({ items: [{ id: "photo", file: new File(["x"], "photo.jpg"), url: "blob:photo", name: "photo.jpg", sourceWidth: 100, sourceHeight: 50, target: { width: 200, height: 100 }, outputName: "photo.png", selected: true, status: "queued", progress: 0, error: null }] });
    const { unmount } = render(<UpscalerBatchPanel settings={createProject().animation.upscaler} />);
    fireEvent.click(screen.getByRole("button", { name: "Elabora selezionate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Scelta destinazione…" })).toBeDisabled());

    unmount();
    await act(async () => { rejectPicker(new Error("late picker failure")); await Promise.resolve(); });
    expect(useUpscalerBatchStore.getState().outputNotice).toBeNull();
    expect(runBatch).not.toHaveBeenCalled();
  });
});
