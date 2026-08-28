import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCommentsInvasionRuntime, useCommentsInvasionStore } from "./comments-invasion-store";

class LoadedImage {
  naturalWidth = 960;
  naturalHeight = 260;
  width = 960;
  height = 260;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
}

function screenshot(name: string, relativePath = name): File {
  const file = new File([name], name, { type: "image/png", lastModified: 10 });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

describe("Comments Invasion runtime assets", () => {
  const revoke = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("Image", LoadedImage);
    vi.stubGlobal("URL", { createObjectURL: vi.fn((file: File) => `blob:${file.name}`), revokeObjectURL: revoke });
    resetCommentsInvasionRuntime(); revoke.mockClear();
  });
  afterEach(() => { resetCommentsInvasionRuntime(); vi.unstubAllGlobals(); });

  it("ordina naturalmente la cartella, filtra i file e rifiuta i duplicati", async () => {
    const result = await useCommentsInvasionStore.getState().addFiles([
      screenshot("commento-10.png", "set/commento-10.png"),
      new File(["x"], "note.txt", { type: "text/plain" }),
      screenshot("commento-2.png", "set/commento-2.png")
    ]);
    expect(result).toEqual({ added: 2, rejected: 1 });
    expect(useCommentsInvasionStore.getState().assets.map((asset) => asset.name)).toEqual(["commento-2.png", "commento-10.png"]);
    expect(await useCommentsInvasionStore.getState().addFiles([screenshot("commento-2.png", "set/commento-2.png")])).toEqual({ added: 0, rejected: 1 });
  });

  it("revoca ogni URL quando si rimuove o si cambia area", async () => {
    await useCommentsInvasionStore.getState().addFiles([screenshot("uno.png"), screenshot("due.png")]);
    const first = useCommentsInvasionStore.getState().assets[0]!;
    useCommentsInvasionStore.getState().removeAsset(first.id);
    expect(revoke).toHaveBeenCalledWith(first.url);
    resetCommentsInvasionRuntime();
    expect(revoke).toHaveBeenCalledWith("blob:due.png");
    expect(useCommentsInvasionStore.getState().assets).toEqual([]);
  });
});
