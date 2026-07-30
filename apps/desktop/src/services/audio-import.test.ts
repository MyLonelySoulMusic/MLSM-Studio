import { afterEach, describe, expect, it, vi } from "vitest";
import { importVideoFile } from "./audio-import";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("importVideoFile", () => {
  it("accetta un video guida silenzioso e usa la durata visiva", async () => {
    const originalCreateElement = document.createElement.bind(document);
    const fakeVideo = {
      duration: 12.5,
      preload: "",
      muted: false,
      playsInline: false,
      src: "",
      onloadedmetadata: null as null | (() => void),
      onerror: null as null | (() => void),
      removeAttribute: vi.fn(),
      load: vi.fn(function (this: typeof fakeVideo) {
        if (this.onloadedmetadata) queueMicrotask(() => this.onloadedmetadata?.());
      })
    };
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => (
      tagName.toLowerCase() === "video"
        ? fakeVideo as unknown as HTMLVideoElement
        : originalCreateElement(tagName)
    )) as typeof document.createElement);
    const createObjectURL = vi.fn(() => "blob:video-guide");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new ArrayBuffer(32));
    vi.stubGlobal("AudioContext", class {
      decodeAudioData(): Promise<AudioBuffer> { return Promise.reject(new Error("nessuna traccia audio")); }
      close(): Promise<void> { return Promise.resolve(); }
    });

    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const file = {
      name: "silent.mp4",
      type: "video/mp4",
      size: bytes.byteLength,
      arrayBuffer: vi.fn(async () => bytes.slice(0))
    } as unknown as File;
    const imported = await importVideoFile(file);

    expect(imported.metadata).toMatchObject({
      fileName: "silent.mp4",
      durationSeconds: 12.5,
      sampleRate: 48_000,
      channels: 1
    });
    expect(imported.waveform).toEqual([]);
    expect(imported.url).toBe("blob:video-guide");
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
