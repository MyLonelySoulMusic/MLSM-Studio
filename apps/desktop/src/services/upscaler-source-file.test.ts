import { afterEach, describe, expect, it, vi } from "vitest";
import { clearUpscalerSourceFile, getUpscalerSourceFile, getUpscalerSourceFileOwner, registerUpscalerSourceFile } from "./upscaler-source-file";

describe("Upscaler source file runtime", () => {
  afterEach(() => {
    const owner = getUpscalerSourceFileOwner();
    if (owner) clearUpscalerSourceFile(owner);
    vi.restoreAllMocks();
  });

  it("mantiene il File video originale disponibile per l'upload frame-per-frame", () => {
    const file = new File([new Uint8Array([0, 1, 2, 3])], "source.mp4", { type: "video/mp4" });
    registerUpscalerSourceFile("blob:source-video", file);
    expect(getUpscalerSourceFile("blob:source-video")).toBe(file);
    expect(getUpscalerSourceFile("blob:another-video")).toBeNull();
  });

  it("clears only the exact active owner and revokes it idempotently", () => {
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const first = registerUpscalerSourceFile("blob:first", new File(["first"], "first.jpg"));
    const secondFile = new File(["second"], "second.jpg");
    const second = registerUpscalerSourceFile("blob:second", secondFile);

    expect(clearUpscalerSourceFile(first)).toBeNull();
    expect(getUpscalerSourceFile("blob:second")).toBe(secondFile);
    expect(revoke).not.toHaveBeenCalled();
    expect(clearUpscalerSourceFile(second)).toBe("blob:second");
    expect(clearUpscalerSourceFile(second)).toBeNull();
    expect(getUpscalerSourceFile("blob:second")).toBeNull();
    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:second");
  });
});
