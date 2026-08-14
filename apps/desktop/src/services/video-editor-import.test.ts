import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importVideoEditorAsset,
  registerVideoEditorFiles,
  videoEditorAcceptedFiles,
  videoEditorAssetKind,
  videoEditorSessionFile
} from "./video-editor-import";

describe("Video Editor · importazione immagini", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accetta PNG, WebP e JPG e mantiene il file originale con alpha", async () => {
    class FakeImage {
      naturalWidth = 640;
      naturalHeight = 480;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", FakeImage);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:original-alpha") });

    const files = [
      new File([new Uint8Array([0, 1, 2, 3])], "logo.png", { type: "image/png" }),
      new File([new Uint8Array([4, 5, 6])], "logo.webp", { type: "image/webp" }),
      new File([new Uint8Array([7, 8, 9])], "logo.jpg", { type: "image/jpeg" })
    ];
    expect(files.map(videoEditorAssetKind)).toEqual(["image", "image", "image"]);
    expect(videoEditorAcceptedFiles).toContain("image/*");
    expect(videoEditorAcceptedFiles).toContain(".webp");
    expect(videoEditorAcceptedFiles).toContain(".jpg");

    for (const file of files) {
      const imported = await importVideoEditorAsset(file);
      expect(imported.asset).toMatchObject({ kind: "image", durationSeconds: 0, width: 640, height: 480, url: "blob:original-alpha", thumbnailUrl: "blob:original-alpha" });
      // The transparent source is never rendered into a flattened thumbnail blob;
      // registration keeps the original bytes for preview/export.
      registerVideoEditorFiles(new Map([[imported.asset.id, imported.file]]));
      expect(videoEditorSessionFile(imported.asset.id)).toBe(file);
    }
  });
});
