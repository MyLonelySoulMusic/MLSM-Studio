import { expect, it } from 'vitest';
import { exportOptions } from './export-options';
it('suggests the maximum source resolution in the output aspect and preserves fractional FPS', () => {
  const info = [
    { id: 'a', name: 'game', width: 3840, height: 2160, fps: 59.94 },
    { id: 'r', name: 'reaction', width: 1080, height: 1920, fps: 29.97 },
  ];
  const options = exportOptions(info, '9:16');
  expect(options.resolutions.find(item => item.recommended)).toMatchObject({ width: 2160, height: 3840 });
  expect(options.suggestedFps).toBe(59.94);
  expect(options.fps).toContain(59.94);
  expect(exportOptions(info, '16:9').resolutions.find(item => item.recommended)).toMatchObject({ width: 3840, height: 2160 });
});
it('includes nonstandard dimensions with even output sizes and uses explicit fallback for missing metadata', () => {
  const options = exportOptions([{ id: 'a', name: 'a', width: 1701, height: 957, fps: 47.5 }], '16:9');
  const suggested = options.resolutions.find(item => item.recommended)!;
  expect(suggested.width % 2).toBe(0); expect(suggested.height % 2).toBe(0);
  expect(options.fps).toContain(47.5);
  const fallback = exportOptions([], '9:16');
  expect(fallback.maxFps).toBe(0);
  expect(fallback.suggestedFps).toBe(30);
  expect(fallback.resolutions.find(item => item.recommended)?.value).toBe('1080x1920');
});
