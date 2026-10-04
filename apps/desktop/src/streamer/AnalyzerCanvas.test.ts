import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzerPalette, AnalyzerCanvas } from "./AnalyzerCanvas";
import type { StreamerAudioRuntime } from "./streamer-audio";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

  it("does not restart analyzers or erase their histories when water is toggled", () => {
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect = disconnect; });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const runtime = { frame: null, receivedAt: 0 } as StreamerAudioRuntime;
    const mounted = render(createElement(AnalyzerCanvas, { kind: "loudness", runtime, language: "en", theme: "night", water: false }));
    mounted.rerender(createElement(AnalyzerCanvas, { kind: "loudness", runtime, language: "en", theme: "night", water: true }));
    expect(disconnect).not.toHaveBeenCalled();
    expect(context).toHaveBeenCalledTimes(2); // Main canvas + existing history strip.
    mounted.unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
});
