import { describe, expect, it } from "vitest";
import { calculateSubtitleLayout } from "./subtitle-layout";

describe("subtitle layout", () => {
  it("mantiene tutta la texture nella title-safe area 9:16", () => {
    const layout = calculateSubtitleLayout({
      verticalFovDegrees: 43,
      viewportAspect: 9 / 16,
      distance: 8
    });

    expect(layout.width).toBeLessThanOrEqual(layout.safeWidth);
    expect(layout.startY + layout.height / 2).toBeLessThanOrEqual(layout.safeTop);
    expect(layout.width).toBeLessThan(3.2);
  });

  it("usa una dimensione maggiore ma sicura nel formato 16:9", () => {
    const portrait = calculateSubtitleLayout({
      verticalFovDegrees: 43,
      viewportAspect: 9 / 16,
      distance: 8
    });
    const landscape = calculateSubtitleLayout({
      verticalFovDegrees: 43,
      viewportAspect: 16 / 9,
      distance: 8
    });

    expect(landscape.width).toBeGreaterThan(portrait.width);
    expect(landscape.width).toBeLessThanOrEqual(landscape.safeWidth);
  });
});
