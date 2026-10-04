/** YouTube's 4:3 default thumbnails contain a letterboxed 16:9 frame.
 * Crop that frame first, then take its central square (never stretch it). */
export function artworkCrop(width: number, height: number, youtube: boolean) {
  if (!(width > 0 && height > 0)) return { width: 100, height: 100 };
  const letterboxed = youtube && Math.abs(width / height - 4 / 3) < .03;
  const side = Math.min(width, letterboxed ? width * 9 / 16 : height);
  return { width: width / side * 100, height: height / side * 100 };
}

export function initialArtworkSize(src: string): [number, number] {
  return /(?:hqdefault|sddefault|\/default)\.jpg(?:\?|$)/i.test(src) ? [480, 360] : [16, 9];
}
