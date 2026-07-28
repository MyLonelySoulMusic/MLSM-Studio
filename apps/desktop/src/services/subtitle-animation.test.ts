import { describe, expect, it } from "vitest";
import { calculateSubtitleLayout } from "./subtitle-layout";
import { resolveSubtitleAnimation } from "./subtitle-animation";

describe("subtitle animations", () => {
  const layout = calculateSubtitleLayout({ verticalFovDegrees: 43, viewportAspect: 9 / 16, distance: 8 });

  it("fornisce cinque pose distinte e sempre visibili", () => {
    const animations = ["ledFall", "cinematicFade", "wordPop", "karaokeGlow", "slideUp"] as const;
    const poses = animations.map((animation) => resolveSubtitleAnimation(animation, .5, layout, 1));
    expect(new Set(poses.map((pose) => `${pose.y.toFixed(2)}:${pose.scale.toFixed(2)}`)).size).toBe(animations.length);
    expect(poses.every((pose) => pose.opacity > 0 && pose.opacity <= 1)).toBe(true);
  });
});
