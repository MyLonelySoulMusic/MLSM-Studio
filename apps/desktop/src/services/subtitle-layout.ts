export interface SubtitleLayoutInput {
  verticalFovDegrees: number;
  viewportAspect: number;
  distance: number;
  textureAspect?: number;
}

export interface SubtitleLayout {
  width: number;
  height: number;
  startY: number;
  safeWidth: number;
  safeTop: number;
}

/**
 * Keeps camera-attached subtitles inside a title-safe area. Portrait video gets
 * slightly wider side margins because even short phrases fill its narrow frame.
 */
export function calculateSubtitleLayout({
  verticalFovDegrees,
  viewportAspect,
  distance,
  textureAspect = 4
}: SubtitleLayoutInput): SubtitleLayout {
  const aspect = Math.max(.1, viewportAspect);
  const depth = Math.max(.1, distance);
  const halfHeight = Math.tan(verticalFovDegrees * Math.PI / 360) * depth;
  const visibleWidth = halfHeight * 2 * aspect;
  const portrait = aspect < 1;
  const safeWidth = visibleWidth * (portrait ? .8 : .86);
  const width = Math.min(portrait ? 3.15 : 8.6, safeWidth);
  const height = width / Math.max(1, textureAspect);
  const safeTop = halfHeight * (portrait ? .8 : .84);

  return {
    width,
    height,
    startY: safeTop - height / 2,
    safeWidth,
    safeTop
  };
}
