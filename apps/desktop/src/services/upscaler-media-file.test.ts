import { describe, expect, it, vi } from "vitest";
import { classifyUpscalerMediaFile, readUpscalerMediaMetadata } from "./upscaler-media-file";

describe("Upscaler media file policy", () => {
  it.each([
    ["photo.jpg", "image/jpeg", "image"],
    ["photo.jpg", "", "image"],
    ["photo.jpg", "application/octet-stream", "image"],
    ["clip.mp4", "video/mp4", "video"],
    ["clip.mov", "", "video"],
    ["clip.webm", "application/octet-stream", "video"]
  ] as const)("classifies %s with MIME %s as %s", (name, type, expectedKind) => {
    expect(classifyUpscalerMediaFile(new File(["x"], name, { type }))).toMatchObject({ supported: true, kind: expectedKind });
  });

  it.each([
    ["photo.jpg", "video/mp4", "mime-extension-mismatch"],
    ["clip.mp4", "image/jpeg", "mime-extension-mismatch"],
    ["photo.png", "image/jpeg", "mime-extension-mismatch"],
    ["unknown.bin", "application/octet-stream", "unsupported-extension"],
    ["photo.jpg", "text/plain", "unsupported-mime"]
  ] as const)("rejects %s with MIME %s", (name, type, expectedReason) => {
    expect(classifyUpscalerMediaFile(new File(["x"], name, { type }))).toMatchObject({ supported: false, reason: expectedReason });
  });

  it("uses the shared classification to choose the video metadata decoder", async () => {
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      const element = createElement(tagName, options);
      if (tagName === "video") {
        Object.defineProperty(element, "videoWidth", { configurable: true, value: 1920 });
        Object.defineProperty(element, "videoHeight", { configurable: true, value: 1080 });
        Object.defineProperty(element, "duration", { configurable: true, value: 4.5 });
        queueMicrotask(() => element.onloadedmetadata?.(new Event("loadedmetadata")));
      }
      return element;
    });
    await expect(readUpscalerMediaMetadata(new File(["x"], "clip.m4v", { type: "application/octet-stream" }), "blob:clip")).resolves.toEqual({ kind: "video", width: 1920, height: 1080, duration: 4.5 });
  });

  it("rejects unknown input before attempting either decoder", async () => {
    const createElement = vi.spyOn(document, "createElement");
    const OriginalImage = Image;
    const imageConstructor = vi.fn(function ImageStub() { return new OriginalImage(); });
    vi.stubGlobal("Image", imageConstructor);
    await expect(readUpscalerMediaMetadata(new File(["x"], "unknown.bin", { type: "application/octet-stream" }), "blob:unknown")).rejects.toThrow("Estensione .bin non supportata.");
    expect(createElement).not.toHaveBeenCalledWith("video");
    expect(imageConstructor).not.toHaveBeenCalled();
  });
});
