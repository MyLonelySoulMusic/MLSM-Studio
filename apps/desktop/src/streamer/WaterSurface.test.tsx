import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFrame } from "./analysis-engine";
import type { StreamerAudioRuntime } from "./streamer-audio";

const state = vi.hoisted(() => {
  const renderer = () => ({ resize: vi.fn(), draw: vi.fn(), clear: vi.fn(), dispose: vi.fn() });
  const gpu = renderer(), software = renderer();
  return { gpu, software, createGpu: vi.fn(() => gpu as typeof gpu | null), createSoftware: vi.fn(() => software) };
});
vi.mock("./water-renderer", () => ({ createGpuWaterRenderer: state.createGpu, createSoftwareWaterRenderer: state.createSoftware }));
import { WaterSurface } from "./WaterSurface";

let reduced = false, frameCallback: FrameRequestCallback | undefined;
const disconnect = vi.fn();
const bounds = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) });
function runtime() { return { frame: null, receivedAt: 0 } as unknown as StreamerAudioRuntime; }
function view(input: StreamerAudioRuntime) {
  return render(<div><WaterSurface runtime={input} theme="night" resetKey="track:system" /><canvas data-ripple-source="stereo" /><canvas data-ripple-source="peaks" /></div>);
}
function feed(input: StreamerAudioRuntime, sequence: number, width = 5, level = -25) {
  input.frame = { sequence, elapsed: sequence / 30, width, peak: [level, level], truePeak: [level, level] } as AnalysisFrame;
  input.receivedAt = sequence / 30 * 1000;
  act(() => frameCallback?.(input.receivedAt));
}

beforeEach(() => {
  reduced = false; frameCallback = undefined; vi.clearAllMocks();
  state.createGpu.mockReturnValue(state.gpu);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frameCallback = callback; return 1; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect = disconnect; });
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    return this.getAttribute("data-ripple-source") === "stereo" ? bounds(30, 60, 100, 120)
      : this.getAttribute("data-ripple-source") === "peaks" ? bounds(150, 20, 50, 100) : bounds(10, 10, 240, 200);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Shared water surface lifecycle", () => {
  it("passes both widget origins into the same renderer, including correct coordinates", () => {
    const input = runtime(); view(input);
    for (let i = 1; i <= 5; i++) feed(input, i);
    feed(input, 6, 60, -5);
    expect(state.gpu.draw).toHaveBeenCalledOnce();
    const impacts = state.gpu.draw.mock.calls[0]?.[1] as unknown as Array<{ x: number; y: number }>;
    expect(impacts).toHaveLength(2);
    expect(impacts[0]).toMatchObject({ x: 70, y: 107.6 });
    expect(impacts[1]).toMatchObject({ x: 165, y: 60 });
  });
  it("does not draw a missing/removed origin and does not duplicate an analysis frame", () => {
    const input = runtime(), mounted = view(input);
    mounted.container.querySelector('[data-ripple-source="stereo"]')?.remove();
    for (let i = 1; i <= 5; i++) feed(input, i);
    feed(input, 6, 60, -25);
    expect(state.gpu.draw).not.toHaveBeenCalled();
  });
  it("uses software when GPU acceleration is unavailable and frees it on unmount", () => {
    state.createGpu.mockReturnValue(null);
    const mounted = view(runtime());
    expect(state.createSoftware).toHaveBeenCalledOnce();
    expect(mounted.container.querySelector(".sav-water-software")).toHaveStyle({ display: "block" });
    mounted.unmount();
    expect(state.software.dispose).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
  it("falls back without touching audio if the GPU context is lost", () => {
    const mounted = view(runtime());
    fireEvent(mounted.container.querySelector(".sav-water-surface")!, new Event("webglcontextlost", { cancelable: true }));
    expect(state.gpu.dispose).toHaveBeenCalledOnce();
    expect(state.createSoftware).toHaveBeenCalledOnce();
    mounted.unmount();
    expect(state.software.dispose).toHaveBeenCalledOnce();
  });
  it("allocates no graphics resources with reduced motion and resets on track change", () => {
    reduced = true; const input = runtime(), mounted = view(input);
    expect(state.createGpu).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    mounted.unmount(); reduced = false;
    const active = view(input);
    active.rerender(<div><WaterSurface runtime={input} theme="night" resetKey="next:system" /></div>);
    expect(state.gpu.dispose).toHaveBeenCalledOnce();
    expect(state.createGpu).toHaveBeenCalledTimes(2);
  });
});
