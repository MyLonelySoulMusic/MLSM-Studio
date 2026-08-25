import { describe, expect, it } from "vitest";
import { createFrameInterpolationFormData } from "./frame-interpolation-client";

describe("Frame Booster interpolation request", () => {
  it("sends only the multiplier so the server derives FPS from ffprobe", () => {
    const form = createFrameInterpolationFormData({
      blob: new Blob(["video"]), fileName: "phone.mp4", method: "rife",
      sourceFps: 30, targetFps: 60, targetMultiplier: 2, device: "mps", precision: "fp32",
    }, "client-1");
    expect(form.get("target_multiplier")).toBe("2");
    expect(form.has("target_fps")).toBe(false);
    expect(form.has("source_fps")).toBe(false);
  });

  it("sends direct target FPS when multiplier mode is not selected", () => {
    const form = createFrameInterpolationFormData({
      blob: new Blob(["video"]), fileName: "source.mp4", method: "motion",
      sourceFps: 29.97, targetFps: 59.94,
    }, "client-2");
    expect(form.get("target_fps")).toBe("59.94");
    expect(form.get("source_fps")).toBe("29.97");
    expect(form.has("target_multiplier")).toBe(false);
  });
});
