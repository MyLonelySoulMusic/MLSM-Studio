export const lonelyPalette = ['#000000', '#ed589c', '#ffffff'];
export interface PaletteBackground { colors: string[]; intensity: number }
/** Blur a small scene sample, then map its luminance through only the selected palette. */
export function drawPaletteBackground(context: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, settings: PaletteBackground, scratch: HTMLCanvasElement) {
  const w = 96, h = Math.max(1, Math.round(w * height / width));
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
  const ctx = scratch.getContext('2d', { willReadFrequently: true }); if (!ctx) return;
  const scale = Math.max(w / sourceWidth, h / sourceHeight) * 1.25;
  ctx.filter = `blur(${2 + settings.intensity * 2}px)`;
  ctx.drawImage(source, (w - sourceWidth * scale) / 2, (h - sourceHeight * scale) / 2, sourceWidth * scale, sourceHeight * scale);
  ctx.filter = 'none';
  const pixels = ctx.getImageData(0, 0, w, h);
  const colors = settings.colors.slice(0, 3).map(hex => [1,3,5].map(start => parseInt(hex.slice(start, start + 2), 16)));
  if (!colors.length) return;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const luminance = (.2126 * pixels.data[i]! + .7152 * pixels.data[i + 1]! + .0722 * pixels.data[i + 2]!) / 255;
    const position = luminance * (colors.length - 1), left = Math.floor(position), mix = position - left;
    for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] = Math.round(colors[left]![channel]! * (1 - mix) + colors[Math.min(left + 1, colors.length - 1)]![channel]! * mix);
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  context.drawImage(scratch, 0, 0, width, height);
}
