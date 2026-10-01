import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StereoAnalysisEngine } from "./analysis-engine";

interface Tap {
  port: { onmessage: ((event: { data: { enabled: boolean } }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
let Processor: new () => Tap;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("sampleRate", 48000);
  vi.stubGlobal("AudioWorkletProcessor", class { port = { onmessage: null, postMessage: vi.fn() }; });
  vi.stubGlobal("registerProcessor", (_name: string, value: new () => Tap) => { Processor = value; });
  await import("./pcm-tap.worklet");
});
afterEach(() => vi.unstubAllGlobals());

function run(right: "different" | "silent" | "absent" | "inverted") {
  const tap = new Processor(), engine = new StereoAnalysisEngine(48000, { fftSize: 2048, smoothing: 0, peakHold: 2 });
  for (let block = 0; block < 32; block++) {
    const l = Float32Array.from({ length: 128 }, (_, i) => .3 * Math.sin(2 * Math.PI * 997 * (block * 128 + i) / 48000));
    const r = Float32Array.from(l, (x, i) => right === "silent" ? 0 : right === "inverted" ? -x : .2 * Math.sin(2 * Math.PI * 2003 * (block * 128 + i) / 48000));
    const output = [new Float32Array(128), new Float32Array(128)];
    tap.process([right === "absent" ? [l] : [l, r]], [output]);
    expect(output[0]).toEqual(l);
    expect(output[1]).toEqual(right === "absent" ? l : r);
  }
  for (const [message] of tap.port.postMessage.mock.calls) if (message.pcm) engine.push(message.pcm);
  return { frame: engine.snapshot(), tap };
}

describe("PCM capture through the actual worklet", () => {
  it("preserves two different signals through to the stereo analyzers", () => {
    const { frame } = run("different");
    expect(Math.abs(frame.correlation)).toBeLessThan(.03);
    expect(frame.width).toBeGreaterThan(45);
    expect(frame.spectrumLeft.indexOf(Math.max(...frame.spectrumLeft))).not.toBe(frame.spectrumRight.indexOf(Math.max(...frame.spectrumRight)));
  });
  it("does not invent a right channel when a stereo signal is hard-panned left", () => {
    const { frame } = run("silent");
    expect(frame.peak[1]).toBe(-Infinity);
    expect(frame.width).toBeCloseTo(50);
  });
  it("preserves opposite phase", () => {
    expect(run("inverted").frame.correlation).toBeCloseTo(-1);
  });
  it("duplicates only a physically absent second channel", () => {
    expect(run("absent").frame.width).toBe(0);
  });
});
