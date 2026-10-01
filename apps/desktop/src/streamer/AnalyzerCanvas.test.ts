import { describe, expect, it } from "vitest";
import { analyzerPalette } from "./AnalyzerCanvas";

describe("analyzerPalette", () => {
  it("uses a dark canvas with light text and a white right channel at night", () => {
    const palette = analyzerPalette("night");
    expect(palette.background).toBe("#15151b");
    expect(palette.secondary).toBe("#f7f3f6");
    expect(palette.muted).toBe("#bbb3bd");
  });

  it("keeps the light canvas and dark right channel during the day", () => {
    const palette = analyzerPalette("day");
    expect(palette.background).toBe("#f9f7f9");
    expect(palette.secondary).toBe("#151215");
  });
});
