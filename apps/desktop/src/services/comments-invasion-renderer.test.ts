import { createProject } from "@rbs/project-schema";
import { describe, expect, it } from "vitest";
import { commentsInvasionAppearanceTime, commentsInvasionExitTransform, commentsInvasionLifetime, commentsInvasionPlacement, commentsInvasionStampTransform, commentsInvasionVisibleIndices, fitCommentsInvasionPreview } from "./comments-invasion-renderer";

const settings = createProject().animation.commentsInvasion;

describe("Comments Invasion renderer", () => {
  it("mantiene esattamente gli ultimi cinque commenti", () => {
    expect(commentsInvasionVisibleIndices(.59, 12, settings)).toEqual([]);
    expect(commentsInvasionVisibleIndices(.6, 12, settings)).toEqual([0]);
    const sixthTime = commentsInvasionAppearanceTime(5, settings);
    expect(commentsInvasionVisibleIndices(sixthTime, 12, settings)).toEqual([1, 2, 3, 4, 5]);
    expect(commentsInvasionVisibleIndices(999, 12, settings)).toEqual([]);
  });

  it("mantiene il commento dopo l'ingresso e applica l'uscita scelta", () => {
    const lifetime = commentsInvasionLifetime(11, 12, settings);
    expect(commentsInvasionVisibleIndices(lifetime.exitStart - .01, 12, settings)).toContain(11);
    expect(commentsInvasionVisibleIndices(lifetime.end + .01, 12, settings)).not.toContain(11);
    expect(commentsInvasionExitTransform(.5, "fade").alpha).toBeLessThan(1);
    expect(commentsInvasionExitTransform(.5, "shrink").scale).toBeLessThan(1);
    expect(commentsInvasionExitTransform(.5, "slide-up").offsetY).toBeLessThan(0);
    expect(commentsInvasionExitTransform(.5, "slide-side", -1).offsetX).toBeLessThan(0);
    expect(commentsInvasionExitTransform(.5, "spin").rotation).toBeGreaterThan(0);
  });

  it("produce un impatto forte e poi si assesta senza cambiare il layout", () => {
    const entry = commentsInvasionStampTransform(0, settings.impactDurationSeconds, 1.5);
    const settled = commentsInvasionStampTransform(1, settings.impactDurationSeconds, 1.5);
    expect(entry.scale).toBeGreaterThan(1.5);
    expect(entry.impact).toBeGreaterThan(1);
    expect(settled).toEqual({ alpha: 1, scale: 1, impact: 0 });
    expect(commentsInvasionPlacement(1080, 1920, 900, 240, 4, settings, 42)).toEqual(commentsInvasionPlacement(1080, 1920, 900, 240, 4, settings, 42));
  });

  it("contiene commenti verticali e orizzontali nel margine sicuro", () => {
    for (const dimensions of [[1080, 1920], [1920, 1080], [1080, 1080]] as const) {
      const placement = commentsInvasionPlacement(dimensions[0], dimensions[1], 1200, 360, 7, settings, 9);
      const margin = Math.min(...dimensions) * settings.safeArea;
      expect(placement.x).toBeGreaterThanOrEqual(margin - .001);
      expect(placement.y).toBeGreaterThanOrEqual(margin - .001);
      expect(placement.x + placement.width).toBeLessThanOrEqual(dimensions[0] - margin + .001);
      expect(placement.y + placement.height).toBeLessThanOrEqual(dimensions[1] - margin + .001);
    }
    expect(fitCommentsInvasionPreview(1000, 500, 9, 16)).toEqual({ width: 281.25, height: 500 });
    expect(fitCommentsInvasionPreview(500, 1000, 16, 9)).toEqual({ width: 500, height: 281.25 });
  });
});
