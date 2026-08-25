export interface CanvasImageSourceSize {
  width: number;
  height: number;
}

function positiveDimension(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/**
 * Reads intrinsic dimensions structurally instead of relying on `instanceof`.
 * ImageBitmap and DOM sources can originate in another realm (or a worker), in
 * which case realm-specific constructor checks are false even though the source
 * is a valid CanvasImageSource.
 */
export function canvasImageSourceSize(source: CanvasImageSource): CanvasImageSourceSize {
  const candidate = source as unknown as Record<string, unknown>;
  const width = positiveDimension(candidate.naturalWidth) ?? positiveDimension(candidate.videoWidth) ?? positiveDimension(candidate.width);
  const height = positiveDimension(candidate.naturalHeight) ?? positiveDimension(candidate.videoHeight) ?? positiveDimension(candidate.height);
  if (!width || !height) throw new Error("Dimensioni della sorgente immagine non disponibili.");
  return { width, height };
}
