import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { cloneUpscalerSettings, createUpscalerBatchItems, resolveUpscalerBatchTarget, runUpscalerBatch, type UpscalerBatchItem } from "./upscaler-batch";
import { canvasImageSourceSize } from "./canvas-image-source";

function item(id: string, selected = true): UpscalerBatchItem {
  return { id, file: new File([id], `${id}.jpg`, { type: "image/jpeg" }), url: `blob:${id}`, name: `${id}.jpg`, sourceWidth: 1000, sourceHeight: 500, target: { width: 2000, height: 1000 }, outputName: `${id}.png`, selected, status: "queued", progress: 0, error: null };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("upscaler batch", () => {
  it("generates bounded thumbnails sequentially and closes every full-resolution bitmap", async () => {
    const events: string[] = [];
    vi.stubGlobal("createImageBitmap", vi.fn(async (file: File) => {
      events.push(`decode:${file.name}`);
      return { width: 4000, height: 2000, close: () => events.push(`close:${file.name}`) };
    }));
    const drawImage = vi.fn(); vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["thumbnail"], { type: "image/webp" })));
    const urls = ["blob:one-source", "blob:one-thumb", "blob:two-source", "blob:two-thumb"];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => urls.shift()!) });
    const result = await createUpscalerBatchItems([new File(["one"], "one.jpg", { type: "image/jpeg" }), new File(["two"], "two.jpg", { type: "image/jpeg" })], createProject().animation.upscaler);
    expect(events).toEqual(["decode:one.jpg", "close:one.jpg", "decode:two.jpg", "close:two.jpg"]);
    expect(drawImage.mock.calls.map((call) => call.slice(1))).toEqual([[0, 0, 256, 128], [0, 0, 256, 128]]);
    expect(result.items.map(({ url, thumbnailUrl, sourceWidth, sourceHeight }) => ({ url, thumbnailUrl, sourceWidth, sourceHeight }))).toEqual([
      { url: "blob:one-source", thumbnailUrl: "blob:one-thumb", sourceWidth: 4000, sourceHeight: 2000 },
      { url: "blob:two-source", thumbnailUrl: "blob:two-thumb", sourceWidth: 4000, sourceHeight: 2000 }
    ]);
  });

  it("aborts a stale import immediately, drains its decoder, and never overlaps the replacement decode", async () => {
    const events: string[] = [];
    let resolveFirst!: (bitmap: { width: number; height: number; close: () => void }) => void;
    const createBitmap = vi.fn((file: File) => {
      events.push(`decode:${file.name}`);
      if (file.name === "first.jpg") return new Promise<{ width: number; height: number; close: () => void }>((resolve) => { resolveFirst = resolve; });
      return Promise.resolve({ width: 800, height: 400, close: () => events.push(`close:${file.name}`) });
    });
    vi.stubGlobal("createImageBitmap", createBitmap);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["thumbnail"], { type: "image/webp" })));
    const createUrl = vi.fn().mockReturnValueOnce("blob:first-source").mockReturnValueOnce("blob:second-source").mockReturnValueOnce("blob:second-thumb");
    const revoke = vi.fn(); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const controller = new AbortController();
    const stale = createUpscalerBatchItems([new File(["first"], "first.jpg", { type: "image/jpeg" })], createProject().animation.upscaler, { signal: controller.signal });
    await Promise.resolve(); await Promise.resolve();
    expect(createBitmap).toHaveBeenCalledTimes(1);

    controller.abort();
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    expect(revoke).toHaveBeenCalledWith("blob:first-source");
    const replacement = createUpscalerBatchItems([new File(["second"], "second.jpg", { type: "image/jpeg" })], createProject().animation.upscaler);
    await Promise.resolve(); await Promise.resolve();
    expect(createBitmap).toHaveBeenCalledTimes(1);

    resolveFirst({ width: 1600, height: 800, close: () => events.push("close:first.jpg") });
    const result = await replacement;
    expect(result.items.map((entry) => entry.name)).toEqual(["second.jpg"]);
    expect(events).toEqual(["decode:first.jpg", "close:first.jpg", "decode:second.jpg", "close:second.jpg"]);
  });

  it("deep-copies nested adjustments for a session snapshot", () => {
    const settings = createProject().animation.upscaler; const snapshot = cloneUpscalerSettings(settings);
    snapshot.adjustments.contrast = 81;
    expect(settings.adjustments.contrast).toBe(0);
    expect(snapshot.adjustments).not.toBe(settings.adjustments);
  });

  it("resolves a per-image locked target and shared unlocked target", () => {
    const settings = createProject().animation.upscaler;
    expect(resolveUpscalerBatchTarget(1000, 500, { ...settings, lockAspectRatio: true, scale: 2 })).toEqual({ width: 2000, height: 1000 });
    expect(resolveUpscalerBatchTarget(1000, 500, { ...settings, lockAspectRatio: false, finalWidth: 1536, finalHeight: 1024 })).toEqual({ width: 1536, height: 1024 });
  });

  it("processes selected items sequentially and continues after a file error", async () => {
    const close = vi.fn(); vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 320, height: 180, close })));
    const drawImage = vi.fn(); vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const order: string[] = []; const updates: string[] = [];
    const dimensions: Array<{ width: number; height: number }> = [];
    const result = await runUpscalerBatch({ items: [item("one"), item("two"), item("three")], settings: createProject().animation.upscaler, exportImage: async ({ source, sourceName }) => { dimensions.push(canvasImageSourceSize(source)); const name = sourceName ?? "unknown"; order.push(name); if (name === "two.jpg") throw new Error("broken"); return { blob: new Blob(["png"]), fileName: name, width: 1, height: 1, aiEnhancedSource: null }; }, onUpdate: (update) => updates.push(`${update.itemId}:${update.status}`) });
    expect(order).toEqual(["one.jpg", "two.jpg", "three.jpg"]);
    expect(dimensions).toEqual([{ width: 320, height: 180 }, { width: 320, height: 180 }, { width: 320, height: 180 }]); expect(drawImage).toHaveBeenCalledTimes(3); expect(close).toHaveBeenCalledTimes(3);
    expect(result.completed).toEqual(["one", "three"]); expect(result.failed).toEqual(["two"]); expect(updates).toContain("two:error");
  });

  it("does not start a new item after abort", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 320, height: 180, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const controller = new AbortController(); const order: string[] = [];
    const result = await runUpscalerBatch({ items: [item("one"), item("two")], settings: createProject().animation.upscaler, signal: controller.signal, exportImage: async ({ sourceName }) => { const name = sourceName ?? "unknown"; order.push(name); controller.abort(); return { blob: new Blob(["png"]), fileName: name, width: 1, height: 1, aiEnhancedSource: null }; } });
    expect(order).toEqual(["one.jpg"]); expect(result.completed).toEqual([]); expect(result.cancelled).toEqual(["one", "two"]);
  });

  it("publishes target and output name in the same processing update", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 320, height: 180, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const processing: Array<{ target?: { width: number; height: number }; outputName?: string }> = [];
    await runUpscalerBatch({ items: [item("one")], settings: { ...createProject().animation.upscaler, scale: 3, lockAspectRatio: true }, exportImage: async () => ({ blob: new Blob(["png"]), fileName: "one.png", width: 1, height: 1, aiEnhancedSource: null }), onUpdate: (update) => { if (update.status === "processing" && update.progress === 0) processing.push(update); } });
    expect(processing).toEqual([{ itemId: "one", status: "processing", progress: 0, error: null, target: { width: 3000, height: 1500 }, outputName: "one-upscaled-3000x1500.png" }]);
  });

  it("falls back to the DOM image decoder when createImageBitmap rejects the file", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("codec unsupported")));
    const images: Array<{ onload: (() => void) | null }> = [];
    vi.stubGlobal("Image", class { naturalWidth = 640; naturalHeight = 360; onload: (() => void) | null = null; onerror: (() => void) | null = null; private value = ""; constructor() { images.push(this); } set src(value: string) { this.value = value; queueMicrotask(() => this.onload?.()); } get src() { return this.value; } });
    let exportedSource: CanvasImageSource | null = null;
    const exportImage = vi.fn(async ({ source }: { source: CanvasImageSource }) => { exportedSource = source; return { blob: new Blob(["png"]), fileName: "one.png", width: 1, height: 1, aiEnhancedSource: null }; });
    await runUpscalerBatch({ items: [item("one")], settings: createProject().animation.upscaler, exportImage });
    expect(exportImage).toHaveBeenCalledOnce();
    expect(exportedSource).toBe(images[0]);
  });

  it("keeps readable images and reports corrupt files individually", async () => {
    const urls = ["blob:good", "blob:broken"]; const createUrl = vi.fn(() => urls.shift()!); const revoke = vi.fn(); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const images: Array<{ naturalWidth: number; naturalHeight: number; onload: (() => void) | null; onerror: (() => void) | null; src: string }> = [];
    vi.stubGlobal("Image", class { naturalWidth = 640; naturalHeight = 360; onload: (() => void) | null = null; onerror: (() => void) | null = null; private value = ""; constructor() { images.push(this); } set src(value: string) { this.value = value; queueMicrotask(() => value.includes("broken") ? this.onerror?.() : this.onload?.()); } get src() { return this.value; } });
    const result = await createUpscalerBatchItems([new File(["ok"], "good.jpg", { type: "image/jpeg" }), new File(["bad"], "broken.jpg", { type: "image/jpeg" })], createProject().animation.upscaler);
    expect(result.items.map((entry) => entry.name)).toEqual(["good.jpg"]); expect(result.failures).toEqual([{ name: "broken.jpg", error: "Immagine non leggibile." }]);
    expect(revoke).toHaveBeenCalledWith("blob:broken"); expect(revoke).not.toHaveBeenCalledWith("blob:good"); expect(images).toHaveLength(2);
  });

  it.each(["", "application/octet-stream"])("accepts a supported image extension with generic MIME %s", async (type) => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:photo") });
    vi.stubGlobal("Image", class { naturalWidth = 640; naturalHeight = 360; onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
    const result = await createUpscalerBatchItems([new File(["ok"], "photo.jpg", { type })], createProject().animation.upscaler);
    expect(result.items.map((entry) => entry.name)).toEqual(["photo.jpg"]);
    expect(result.failures).toEqual([]);
  });

  it("rejects videos, discordant MIME, and unknown files without creating object URLs", async () => {
    const createUrl = vi.fn(); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
    const result = await createUpscalerBatchItems([
      new File(["video"], "clip.mp4", { type: "video/mp4" }),
      new File(["fake"], "fake.jpg", { type: "video/mp4" }),
      new File(["unknown"], "unknown.bin", { type: "application/octet-stream" })
    ], createProject().animation.upscaler);
    expect(result.items).toEqual([]);
    expect(result.failures).toEqual([
      { name: "clip.mp4", error: "Il batch Upscaler accetta solo immagini." },
      { name: "fake.jpg", error: "MIME video/mp4 non coerente con .jpg." },
      { name: "unknown.bin", error: "Estensione .bin non supportata." }
    ]);
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("preserves earlier items when createObjectURL fails on a later file", async () => {
    const createUrl = vi.fn().mockReturnValueOnce("blob:first").mockImplementationOnce(() => { throw new Error("object URL unavailable"); });
    const revoke = vi.fn(); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    vi.stubGlobal("Image", class { naturalWidth = 640; naturalHeight = 360; onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
    const result = await createUpscalerBatchItems([
      new File(["one"], "first.jpg", { type: "image/jpeg" }),
      new File(["two"], "second.png", { type: "image/png" })
    ], createProject().animation.upscaler);
    expect(result.items.map((entry) => ({ name: entry.name, url: entry.url }))).toEqual([{ name: "first.jpg", url: "blob:first" }]);
    expect(result.failures).toEqual([{ name: "second.png", error: "object URL unavailable" }]);
    expect(revoke).not.toHaveBeenCalled();
  });
});
