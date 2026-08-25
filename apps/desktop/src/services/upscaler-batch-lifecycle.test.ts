import { afterEach, describe, expect, it, vi } from "vitest";
import { useUpscalerBatchStore } from "../store/upscaler-batch-store";
import { resetUpscalerRuntimeForProjectReplacement, UPSCALER_PROJECT_REPLACED_EVENT } from "./upscaler-batch-lifecycle";
import { getUpscalerSourceFile, registerUpscalerSourceFile } from "./upscaler-source-file";

describe("upscaler project lifecycle", () => {
  afterEach(() => {
    resetUpscalerRuntimeForProjectReplacement();
    vi.restoreAllMocks();
  });

  it("notifies preview owners before discarding the runtime pool", () => {
    const listener = vi.fn(() => expect(useUpscalerBatchStore.getState().items).toHaveLength(1));
    window.addEventListener(UPSCALER_PROJECT_REPLACED_EVENT, listener, { once: true });
    useUpscalerBatchStore.setState({ items: [{ id: "photo", file: new File(["x"], "photo.jpg"), url: "blob:photo", thumbnailUrl: null, name: "photo.jpg", sourceWidth: 10, sourceHeight: 5, target: { width: 20, height: 10 }, outputName: "photo.png", selected: true, status: "queued", progress: 0, error: null }], previewItemId: "photo" });
    resetUpscalerRuntimeForProjectReplacement();
    expect(listener).toHaveBeenCalledOnce();
    expect(useUpscalerBatchStore.getState()).toMatchObject({ items: [], previewItemId: null });
  });

  it("releases a shared single/batch URL exactly once and makes repeated reset idempotent", () => {
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const file = new File(["photo"], "photo.jpg");
    registerUpscalerSourceFile("blob:shared", file);
    useUpscalerBatchStore.setState({ items: [{ id: "photo", file, url: "blob:shared", thumbnailUrl: "blob:thumb", name: "photo.jpg", sourceWidth: 10, sourceHeight: 5, target: { width: 20, height: 10 }, outputName: "photo.png", selected: true, status: "queued", progress: 0, error: null }] });

    resetUpscalerRuntimeForProjectReplacement();
    resetUpscalerRuntimeForProjectReplacement();

    expect(getUpscalerSourceFile("blob:shared")).toBeNull();
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:shared", "blob:thumb"]);
  });
});
