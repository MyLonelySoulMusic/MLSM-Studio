import { describe, expect, it } from "vitest";
import { clampTimelineHeight, DEFAULT_TIMELINE_HEIGHT, MIN_TIMELINE_HEIGHT, parseTimelineHeight } from "./timeline-layout";

describe("timeline layout", () => {
  it("mantiene la timeline ridimensionabile senza coprire il workspace", () => {
    expect(clampTimelineHeight(360, 1080)).toBe(360);
    expect(clampTimelineHeight(20, 1080)).toBe(MIN_TIMELINE_HEIGHT);
    expect(clampTimelineHeight(900, 680)).toBe(376);
  });

  it("ripristina un valore persistito valido o il default", () => {
    expect(parseTimelineHeight("320", 900)).toBe(320);
    expect(parseTimelineHeight("not-a-number", 900)).toBe(DEFAULT_TIMELINE_HEIGHT);
    expect(parseTimelineHeight(null, 900)).toBe(DEFAULT_TIMELINE_HEIGHT);
  });
});
