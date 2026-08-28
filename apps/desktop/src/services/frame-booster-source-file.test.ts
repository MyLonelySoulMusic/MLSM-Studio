import { describe, expect, it, vi } from "vitest";
import { clearFrameBoosterSourceFile, frameBoosterSourceFileCount, getFrameBoosterSourceFile, registerFrameBoosterSourceFile, releaseFrameBoosterSourceFile, resetFrameBoosterRuntimeForProjectReplacement } from "./frame-booster-source-file";

describe("Frame Booster source registry", () => {
  it("is isolated and supports replacement/clear", () => {
    clearFrameBoosterSourceFile(); const first = new File(["a"], "a.mp4", { type: "video/mp4" }); const second = new File(["b"], "b.mp4", { type: "video/mp4" });
    registerFrameBoosterSourceFile("blob:a", first); expect(getFrameBoosterSourceFile("blob:a")).toBe(first); registerFrameBoosterSourceFile("blob:a", second); expect(getFrameBoosterSourceFile("blob:a")).toBe(second); clearFrameBoosterSourceFile("blob:a"); expect(getFrameBoosterSourceFile("blob:a")).toBeNull();
  });

  it("revokes owned URLs exactly when released or at a project boundary", () => {
    const revoke = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const first = new File(["a"], "a.mp4", { type: "video/mp4" });
    const second = new File(["b"], "b.mp4", { type: "video/mp4" });
    registerFrameBoosterSourceFile("blob:a", first);
    registerFrameBoosterSourceFile("blob:b", second);
    releaseFrameBoosterSourceFile("blob:a");
    releaseFrameBoosterSourceFile("blob:a");
    resetFrameBoosterRuntimeForProjectReplacement();
    expect(revoke.mock.calls).toEqual([["blob:a"], ["blob:b"]]);
    expect(frameBoosterSourceFileCount()).toBe(0);
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });
});
