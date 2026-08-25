import { afterEach, describe, expect, it, vi } from "vitest";
import { useUpscalerBatchStore } from "./upscaler-batch-store";
import type { UpscalerBatchItem } from "../services/upscaler-batch";

function item(id = "a"): UpscalerBatchItem {
  return { id, file: new File([id], `${id}.jpg`), url: `blob:${id}`, thumbnailUrl: `blob:${id}-thumb`, name: `${id}.jpg`, sourceWidth: 10, sourceHeight: 10, target: { width: 20, height: 20 }, outputName: `${id}.png`, selected: true, status: "queued", progress: 0, error: null };
}

describe("upscaler batch runtime store", () => {
  afterEach(() => { useUpscalerBatchStore.getState().resetForProjectReplacement(); vi.restoreAllMocks(); });

  it("revokes runtime blob URLs when clearing the pool", () => {
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    useUpscalerBatchStore.setState({ items: [item()] });
    useUpscalerBatchStore.getState().clear();
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:a", "blob:a-thumb"]); expect(useUpscalerBatchStore.getState().items).toHaveLength(0);
  });

  it("force-resets running, importing, and single-operation owners at a project boundary", () => {
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const controller = new AbortController(); const abort = vi.spyOn(controller, "abort");
    const epoch = useUpscalerBatchStore.getState().projectEpoch;
    useUpscalerBatchStore.setState({ items: [{ ...item(), status: "processing", progress: .5 }], previewItemId: "a", running: true, importing: true, singleOperations: 2, controller });
    useUpscalerBatchStore.getState().resetForProjectReplacement();
    expect(abort).toHaveBeenCalledOnce();
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:a", "blob:a-thumb"]);
    expect(useUpscalerBatchStore.getState()).toMatchObject({ items: [], previewItemId: null, projectEpoch: epoch + 1, running: false, importing: false, singleOperations: 0, controller: null, batchOwner: null, importOwner: null });
  });

  it("aborts and invalidates an in-flight import when a project is replaced", () => {
    const owner = useUpscalerBatchStore.getState().beginImport();
    expect(owner).not.toBeNull();
    useUpscalerBatchStore.getState().resetForProjectReplacement();
    expect(owner!.controller.signal.aborted).toBe(true);
    expect(useUpscalerBatchStore.getState().isImportActive(owner!)).toBe(false);
    expect(useUpscalerBatchStore.getState().endImport(owner!)).toBe(false);
    expect(useUpscalerBatchStore.getState().importing).toBe(false);
  });

  it("does not mutate the queue while running", () => {
    useUpscalerBatchStore.setState({ items: [item()] });
    const owner = useUpscalerBatchStore.getState().startBatch({} as never)!;
    useUpscalerBatchStore.getState().setSelected("a", false); useUpscalerBatchStore.getState().removeItem("a");
    expect(useUpscalerBatchStore.getState().items).toHaveLength(1); expect(useUpscalerBatchStore.getState().items[0]?.selected).toBe(true);
    useUpscalerBatchStore.getState().cancelBatch(owner); useUpscalerBatchStore.getState().finishBatch(owner);
  });

  it("revokes source and thumbnail ownership exactly once when an item is removed", () => {
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    useUpscalerBatchStore.setState({ items: [item()] });
    useUpscalerBatchStore.getState().removeItem("a");
    useUpscalerBatchStore.getState().removeItem("a");
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:a", "blob:a-thumb"]);
  });

  it("does not start batch work while a single preview/export operation owns the runtime", () => {
    useUpscalerBatchStore.setState({ items: [item()] });
    const singleOwner = useUpscalerBatchStore.getState().beginSingleOperation();
    expect(singleOwner).not.toBeNull();
    expect(useUpscalerBatchStore.getState().startBatch({} as never)).toBeNull();
    expect(useUpscalerBatchStore.getState().endSingleOperation(singleOwner!)).toBe(true);
    const batchOwner = useUpscalerBatchStore.getState().startBatch({} as never);
    expect(batchOwner?.controller).toBeInstanceOf(AbortController);
    useUpscalerBatchStore.getState().cancelBatch(batchOwner!); useUpscalerBatchStore.getState().finishBatch(batchOwner!);
  });

  it("keeps the queue locked until an explicit import owner ends", () => {
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    useUpscalerBatchStore.setState({ items: [item()] });
    const owner = useUpscalerBatchStore.getState().beginImport();
    expect(owner).not.toBeNull();
    expect(useUpscalerBatchStore.getState().startBatch({} as never)).toBeNull();
    useUpscalerBatchStore.getState().clear();
    expect(useUpscalerBatchStore.getState().items).toHaveLength(1);
    expect(revoke).not.toHaveBeenCalled();
    useUpscalerBatchStore.getState().endImport(owner!);
    useUpscalerBatchStore.getState().clear();
    expect(revoke).toHaveBeenCalledWith("blob:a");
  });

  it("does not let a stale import owner unlock a newer import", () => {
    const first = useUpscalerBatchStore.getState().beginImport()!;
    useUpscalerBatchStore.getState().endImport(first);
    const second = useUpscalerBatchStore.getState().beginImport()!;
    expect(useUpscalerBatchStore.getState().endImport(first)).toBe(false);
    expect(useUpscalerBatchStore.getState().importing).toBe(true);
    expect(useUpscalerBatchStore.getState().endImport(second)).toBe(true);
    expect(useUpscalerBatchStore.getState().importing).toBe(false);
  });

  it("aborts the previous import when a picker transaction supersedes it", () => {
    const first = useUpscalerBatchStore.getState().beginImport()!;
    const second = useUpscalerBatchStore.getState().beginImport(true)!;
    expect(first.controller.signal.aborted).toBe(true);
    expect(second.id).toBeGreaterThan(first.id);
    expect(useUpscalerBatchStore.getState().isImportActive(first)).toBe(false);
    expect(useUpscalerBatchStore.getState().isImportActive(second)).toBe(true);
    expect(useUpscalerBatchStore.getState().endImport(first)).toBe(false);
    expect(useUpscalerBatchStore.getState().importing).toBe(true);
    expect(useUpscalerBatchStore.getState().endImport(second)).toBe(true);
  });

  it("does not let an old batch finally or controller affect a new project batch", () => {
    useUpscalerBatchStore.setState({ items: [item("old")] });
    const oldOwner = useUpscalerBatchStore.getState().startBatch({} as never)!;
    useUpscalerBatchStore.getState().resetForProjectReplacement();
    expect(oldOwner.controller.signal.aborted).toBe(true);
    useUpscalerBatchStore.setState({ items: [item("new")] });
    const newOwner = useUpscalerBatchStore.getState().startBatch({} as never)!;

    expect(useUpscalerBatchStore.getState().finishBatch(oldOwner)).toBe(false);
    expect(useUpscalerBatchStore.getState().cancelBatch(oldOwner)).toBe(false);
    expect(useUpscalerBatchStore.getState()).toMatchObject({ running: true, controller: newOwner.controller, batchOwner: newOwner });
    expect(newOwner.controller.signal.aborted).toBe(false);
    expect(useUpscalerBatchStore.getState().cancelBatch(newOwner)).toBe(true);
    expect(newOwner.controller.signal.aborted).toBe(true);
    expect(useUpscalerBatchStore.getState().finishBatch(newOwner)).toBe(true);
  });

  it("makes single-operation completion exact and idempotent across project epochs", () => {
    const oldOwner = useUpscalerBatchStore.getState().beginSingleOperation()!;
    useUpscalerBatchStore.getState().resetForProjectReplacement();
    const newOwner = useUpscalerBatchStore.getState().beginSingleOperation()!;

    expect(useUpscalerBatchStore.getState().endSingleOperation(oldOwner)).toBe(false);
    expect(useUpscalerBatchStore.getState().singleOperations).toBe(1);
    expect(useUpscalerBatchStore.getState().endSingleOperation(newOwner)).toBe(true);
    expect(useUpscalerBatchStore.getState().endSingleOperation(newOwner)).toBe(false);
    expect(useUpscalerBatchStore.getState().singleOperations).toBe(0);
  });
});
