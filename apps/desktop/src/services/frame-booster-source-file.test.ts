import { describe, expect, it } from "vitest";
import { clearFrameBoosterSourceFile, getFrameBoosterSourceFile, registerFrameBoosterSourceFile } from "./frame-booster-source-file";

describe("Frame Booster source registry", () => {
  it("is isolated and supports replacement/clear", () => {
    clearFrameBoosterSourceFile(); const first = new File(["a"], "a.mp4", { type: "video/mp4" }); const second = new File(["b"], "b.mp4", { type: "video/mp4" });
    registerFrameBoosterSourceFile("blob:a", first); expect(getFrameBoosterSourceFile("blob:a")).toBe(first); registerFrameBoosterSourceFile("blob:a", second); expect(getFrameBoosterSourceFile("blob:a")).toBe(second); clearFrameBoosterSourceFile("blob:a"); expect(getFrameBoosterSourceFile("blob:a")).toBeNull();
  });
});
