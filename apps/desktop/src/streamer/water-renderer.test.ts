import { afterEach, describe, expect, it, vi } from "vitest";
import { createGpuWaterRenderer, createSoftwareWaterRenderer } from "./water-renderer";

afterEach(() => vi.restoreAllMocks());

describe("Water rendering resources", () => {
  it("bounds GPU resolution, passes both impacts together and releases resources", () => {
    const gl = {
      createProgram: () => ({}), createBuffer: () => ({}), createShader: () => ({}),
      shaderSource: vi.fn(), compileShader() {}, getShaderParameter: () => true,
      attachShader() {}, linkProgram() {}, getProgramParameter: () => true,
      useProgram() {}, bindBuffer() {}, bufferData() {}, getAttribLocation: () => 0,
      enableVertexAttribArray() {}, vertexAttribPointer() {}, getUniformLocation: (name: unknown, key: string) => key,
      uniform1f: vi.fn(), uniform1i: vi.fn(), uniform2f: vi.fn(), uniform4fv: vi.fn(),
      viewport: vi.fn(), drawArrays: vi.fn(), clearColor() {}, clear: vi.fn(),
      deleteShader: vi.fn(), deleteBuffer: vi.fn(), deleteProgram: vi.fn()
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl as unknown as WebGLRenderingContext);
    const canvas = document.createElement("canvas"), renderer = createGpuWaterRenderer(canvas, true)!;
    renderer.resize(3000, 4000);
    expect(canvas.width * canvas.height).toBeLessThan(1_002_000);
    renderer.draw(1, [{ x: 10, y: 20, born: .2, strength: 1 }, { x: 30, y: 40, born: .2, strength: 1.4 }]);
    expect(gl.uniform1i).toHaveBeenCalledWith("count", 2);
    expect(gl.drawArrays).toHaveBeenCalledOnce();
    const data = gl.uniform4fv.mock.calls[0]?.[1] as Float32Array;
    expect(Array.from(data.slice(0, 6))).toEqual([10, 20, Math.fround(.2), 1, 30, 40]);
    renderer.dispose();
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteBuffer).toHaveBeenCalledOnce();
    expect(gl.deleteProgram).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(1);
  });
  it("renders a combined wave field with bounded software buffers and clears it", () => {
    let image: ImageData;
    const context = {
      createImageData: (width: number, height: number) => { image = { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData; return image; },
      putImageData: vi.fn(), clearRect: vi.fn()
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const canvas = document.createElement("canvas"), renderer = createSoftwareWaterRenderer(canvas, true)!;
    renderer.resize(2000, 2000);
    expect(canvas.width * canvas.height).toBeLessThan(24_300);
    renderer.draw(1, [{ x: 1000, y: 1000, born: 0, strength: 1 }, { x: 1200, y: 1000, born: .1, strength: 1 }]);
    expect(image!.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(context.putImageData).toHaveBeenCalledOnce();
    renderer.clear();
    expect(context.clearRect).toHaveBeenCalledOnce();
    renderer.dispose();
    expect(canvas.width).toBe(1);
  });
  it("returns a safe fallback signal when graphics contexts are unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const canvas = document.createElement("canvas");
    expect(createGpuWaterRenderer(canvas, false)).toBeNull();
    expect(createSoftwareWaterRenderer(canvas, false)).toBeNull();
  });
});
