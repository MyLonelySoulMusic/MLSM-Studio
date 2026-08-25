import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import type { UpscalerBatchItem } from "../services/upscaler-batch";

const renderThumbnail = vi.hoisted(() => vi.fn());
vi.mock("../services/upscaler-renderer", () => ({
  renderUpscalerThumbnail: renderThumbnail,
  resolveUpscalerPreviewSize: () => ({ width: 192, height: 96 })
}));

import { UpscalerBatchThumbnail } from "./UpscalerBatchThumbnail";

describe("UpscalerBatchThumbnail", () => {
  afterEach(() => { cleanup(); renderThumbnail.mockReset(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("mounts the reduced decoder lazily and redraws live adjustments only while visible", async () => {
    let intersectionCallback!: IntersectionObserverCallback; const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { intersectionCallback = callback; }
      observe() { /* captured through callback */ }
      disconnect() { disconnect(); }
      unobserve() { /* unused */ }
      takeRecords() { return []; }
      root = null; rootMargin = ""; thresholds = [];
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const item: UpscalerBatchItem = { id: "photo", file: new File(["x"], "photo.jpg"), url: "blob:full-resolution", thumbnailUrl: "blob:thumbnail-256", name: "photo.jpg", sourceWidth: 4000, sourceHeight: 2000, target: { width: 8000, height: 4000 }, outputName: "photo.png", selected: true, status: "queued", progress: 0, error: null };
    const initial = createProject().animation.upscaler;
    const { container, rerender, unmount } = render(<UpscalerBatchThumbnail item={item} settings={initial} />);
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe(""); expect(renderThumbnail).not.toHaveBeenCalled();
    rerender(<UpscalerBatchThumbnail item={item} settings={{ ...initial, adjustments: { ...initial.adjustments, contrast: 10 } }} />);
    expect(renderThumbnail).not.toHaveBeenCalled();
    act(() => intersectionCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(image.getAttribute("src")).toBe("blob:thumbnail-256");
    Object.defineProperties(image, { complete: { configurable: true, value: true }, naturalWidth: { configurable: true, value: 256 }, naturalHeight: { configurable: true, value: 128 } });
    fireEvent.load(image);
    await waitFor(() => expect(renderThumbnail).toHaveBeenCalledOnce());
    act(() => intersectionCallback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(image.getAttribute("src")).toBe("");
    rerender(<UpscalerBatchThumbnail item={item} settings={{ ...initial, adjustments: { ...initial.adjustments, contrast: 20 } }} />);
    await act(async () => undefined);
    expect(renderThumbnail).toHaveBeenCalledOnce();
    unmount(); expect(disconnect).toHaveBeenCalledOnce();
  });
});
