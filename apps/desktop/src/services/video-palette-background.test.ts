import { expect, it, vi } from 'vitest';
import { drawPaletteBackground, lonelyPalette } from './video-palette-background';
it('maps the blurred scene from black through pink to white and expands it to the output', () => {
  const data = new Uint8ClampedArray([0,0,0,255,128,128,128,255,255,255,255,255]);
  const sample = { filter: '', drawImage: vi.fn(), getImageData: vi.fn(() => ({ data })), putImageData: vi.fn() };
  const scratch = { width: 0, height: 0, getContext: () => sample } as unknown as HTMLCanvasElement;
  const destination = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  const source = {} as CanvasImageSource;
  drawPaletteBackground(destination, source, 1920, 1080, 1080, 1920, { colors: lonelyPalette, intensity: 4 }, scratch);
  expect([...data.slice(0,4)]).toEqual([0,0,0,255]);
  expect([...data.slice(4,8)]).toEqual([237,89,156,255]);
  expect([...data.slice(8,12)]).toEqual([255,255,255,255]);
  expect(sample.drawImage).toHaveBeenCalledWith(source, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
  expect(destination.drawImage).toHaveBeenCalledWith(scratch, 0, 0, 1080, 1920);
});
it('supports a single chosen color without introducing original source hues', () => {
  const data = new Uint8ClampedArray([0,255,0,255]);
  const sample = { filter: '', drawImage: vi.fn(), getImageData: () => ({ data }), putImageData: vi.fn() };
  drawPaletteBackground({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D, {} as CanvasImageSource, 100, 100, 100, 100, { colors: ['#ed589c'], intensity: 1 }, { getContext: () => sample } as unknown as HTMLCanvasElement);
  expect([...data]).toEqual([237,88,156,255]);
});
