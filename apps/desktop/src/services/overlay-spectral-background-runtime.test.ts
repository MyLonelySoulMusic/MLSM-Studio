import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearOverlaySpectralBackground, getOverlaySpectralBackground, registerOverlaySpectralBackground, releaseOverlaySpectralBackground } from "./overlay-spectral-background-runtime";

describe("Overlay Spectral background runtime", () => {
  const create = vi.fn<(file: File) => string>();
  const revoke = vi.fn<(url: string) => void>();

  beforeEach(() => {
    create.mockReset(); revoke.mockReset();
    create.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    clearOverlaySpectralBackground(); revoke.mockClear();
  });
  afterEach(() => clearOverlaySpectralBackground());

  it("sostituisce e revoca una sola volta il video precedente", () => {
    const first = registerOverlaySpectralBackground("project", new File(["a"], "a.mp4", { type: "video/mp4" }));
    const second = registerOverlaySpectralBackground("project", new File(["b"], "b.mp4", { type: "video/mp4" }));
    expect(revoke).toHaveBeenCalledWith("blob:first");
    expect(getOverlaySpectralBackground()).toBe(second);
    expect(releaseOverlaySpectralBackground(first)).toBe(false);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(releaseOverlaySpectralBackground(second)).toBe(true);
    expect(revoke).toHaveBeenLastCalledWith("blob:second");
    clearOverlaySpectralBackground();
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
