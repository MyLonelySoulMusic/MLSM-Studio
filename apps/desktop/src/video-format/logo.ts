import type { FormatLogo } from './model';
export function logoLayout(logo: FormatLogo, aspect: '9:16' | '16:9') {
  const canvasRatio = aspect === '9:16' ? 9 / 16 : 16 / 9;
  const ratio = logo.width / logo.height;
  const width = Math.min(logo.size, ratio / canvasRatio * .9);
  const height = width * canvasRatio / ratio;
  const left = (1 - width) * logo.x, top = (1 - height) * logo.y;
  return { width, height, left, top, scale: width / Math.min(1, ratio / canvasRatio), x: (left + width / 2) * 2 - 1, y: (top + height / 2) * 2 - 1 };
}
