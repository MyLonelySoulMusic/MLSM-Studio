/** The small, deliberately finite set of shadow treatments exposed for stills. */
export const videoEditorImageShadowStyles = ["drop", "glow", "long"] as const;
export type VideoEditorImageShadowStyle = typeof videoEditorImageShadowStyles[number];

/**
 * Shadow values are normalized to the composition. Keeping the values independent
 * of preview size makes the DOM preview and the offline canvas render identical.
 */
export interface VideoEditorImageShadow {
  enabled: boolean;
  style: VideoEditorImageShadowStyle;
  color: string;
  opacity: number;
  blur: number;
  distance: number;
  angle: number;
}

export const defaultVideoEditorImageShadow: VideoEditorImageShadow = {
  enabled: false,
  style: "drop",
  color: "#000000",
  opacity: .5,
  blur: .045,
  distance: .035,
  angle: 135
};

export interface VideoEditorImageShadowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Mirrors object-fit for an image source in a composition-sized layer. */
export function videoEditorImageShadowGeometry(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: "cover" | "contain" | "fill"
): VideoEditorImageShadowGeometry {
  const width = Math.max(1, targetWidth);
  const height = Math.max(1, targetHeight);
  const sourceRatio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : width / height;
  const targetRatio = width / height;
  if (fit === "fill" || !Number.isFinite(sourceRatio) || sourceRatio <= 0) return { x: 0, y: 0, width, height };
  if (fit === "contain") {
    if (sourceRatio > targetRatio) {
      const fittedHeight = width / sourceRatio;
      return { x: 0, y: (height - fittedHeight) / 2, width, height: fittedHeight };
    }
    const fittedWidth = height * sourceRatio;
    return { x: (width - fittedWidth) / 2, y: 0, width: fittedWidth, height };
  }
  if (sourceRatio > targetRatio) {
    const fittedWidth = height * sourceRatio;
    return { x: (width - fittedWidth) / 2, y: 0, width: fittedWidth, height };
  }
  const fittedHeight = width / sourceRatio;
  return { x: 0, y: (height - fittedHeight) / 2, width, height: fittedHeight };
}

function normalizedShadow(shadow: VideoEditorImageShadow): VideoEditorImageShadow {
  return {
    ...defaultVideoEditorImageShadow,
    ...shadow,
    opacity: Math.max(0, Math.min(1, Number.isFinite(shadow.opacity) ? shadow.opacity : defaultVideoEditorImageShadow.opacity)),
    blur: Math.max(0, Math.min(.4, Number.isFinite(shadow.blur) ? shadow.blur : defaultVideoEditorImageShadow.blur)),
    distance: Math.max(0, Math.min(.5, Number.isFinite(shadow.distance) ? shadow.distance : defaultVideoEditorImageShadow.distance)),
    angle: Number.isFinite(shadow.angle) ? shadow.angle : defaultVideoEditorImageShadow.angle
  };
}

function shadowOffset(shadow: VideoEditorImageShadow, width: number, height: number): { x: number; y: number } {
  const radians = (shadow.angle * Math.PI) / 180;
  const distance = shadow.distance * Math.min(width, height);
  return { x: Math.cos(radians) * distance, y: Math.sin(radians) * distance };
}

/** Stable stops shared by DOM SVG, CSS fallback and Canvas long shadows. */
export const videoEditorImageLongShadowStops = [.125, .25, .375, .5, .625, .75, .875, 1] as const;

export interface VideoEditorImageShadowPrimitive {
  offsetX: number;
  offsetY: number;
  blur: number;
}

export interface VideoEditorImageShadowPaint {
  enabled: boolean;
  color: string;
  opacity: number;
  primitives: readonly VideoEditorImageShadowPrimitive[];
}

/**
 * Resolves the complete shadow paint once. Every renderer consumes these exact
 * vectors and blur radii, preventing the DOM and Canvas implementations from
 * silently assigning different meanings to angle, distance or style.
 */
export function videoEditorImageShadowPaint(
  shadow: VideoEditorImageShadow,
  width: number,
  height: number
): VideoEditorImageShadowPaint {
  const value = normalizedShadow(shadow);
  const enabled = value.enabled && value.opacity > 0;
  if (!enabled) return { enabled: false, color: value.color || "#000000", opacity: value.opacity, primitives: [] };
  const offset = shadowOffset(value, width, height);
  const blur = value.blur * Math.min(width, height);
  const primitives = value.style === "glow"
    ? [
        { offsetX: 0, offsetY: 0, blur: Math.max(1, blur * 1.8) },
        { offsetX: 0, offsetY: 0, blur: Math.max(1, blur * .7) }
      ]
    : value.style === "long"
      ? videoEditorImageLongShadowStops.map((stop) => ({ offsetX: offset.x * stop, offsetY: offset.y * stop, blur: blur * .35 }))
      : [{ offsetX: offset.x, offsetY: offset.y, blur }];
  return { enabled, color: value.color || "#000000", opacity: value.opacity, primitives };
}

/** CSS filter used by the reusable DOM caster. The image's own alpha is the mask. */
export function videoEditorImageShadowCssFilter(shadow: VideoEditorImageShadow, width: number, height: number): string {
  const paint = videoEditorImageShadowPaint(shadow, width, height);
  if (!paint.enabled) return "none";
  const alpha = paint.opacity;
  const color = paint.color;
  const colorWithAlpha = color.startsWith("#") && color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`
    : color.startsWith("#") && color.length === 7
      ? `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`
    : color;
  return paint.primitives.map((primitive) => `drop-shadow(${primitive.offsetX.toFixed(2)}px ${primitive.offsetY.toFixed(2)}px ${primitive.blur.toFixed(2)}px ${colorWithAlpha})`).join(" ");
}

export interface VideoEditorImageShadowCanvasTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/**
 * Paints only the shadow caster. It intentionally does not apply an alpha mask:
 * transparent pixels in the original image cast the shadow, while the shadow may
 * extend outside the image silhouette. The caller paints the image afterwards.
 */
export function drawVideoEditorImageShadow(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  geometry: VideoEditorImageShadowGeometry,
  shadow: VideoEditorImageShadow,
  width: number,
  height: number,
  transform: VideoEditorImageShadowCanvasTransform = { x: 0, y: 0, scale: 1, rotation: 0 },
  alpha = 1
): void {
  const paint = videoEditorImageShadowPaint(shadow, width, height);
  if (!paint.enabled || alpha <= 0) return;
  let drawGeometry = geometry;
  const draw = (primitive: VideoEditorImageShadowPrimitive) => {
    context.shadowColor = paint.color;
    context.shadowBlur = primitive.blur;
    context.shadowOffsetX = primitive.offsetX;
    context.shadowOffsetY = primitive.offsetY;
    context.drawImage(source, drawGeometry.x, drawGeometry.y, drawGeometry.width, drawGeometry.height);
  };
  context.save();
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = Math.max(0, Math.min(1, alpha * paint.opacity));
  const transformed = transform.x !== 0 || transform.y !== 0 || transform.scale !== 1 || transform.rotation !== 0;
  if (transformed) {
    context.translate(width / 2 + transform.x * width / 2, height / 2 + transform.y * height / 2);
    context.rotate(transform.rotation * Math.PI / 180);
    context.scale(transform.scale, transform.scale);
    drawGeometry = { ...geometry, x: geometry.x - width / 2, y: geometry.y - height / 2 };
  }
  for (const primitive of paint.primitives) draw(primitive);
  // `CanvasRenderingContext2D` paints the source and its shadow together. The
  // source is removed from this isolated caster surface before the surface is
  // composited, leaving only pixels outside the original alpha silhouette.
  context.globalCompositeOperation = "destination-out";
  context.globalAlpha = 1;
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.drawImage(source, drawGeometry.x, drawGeometry.y, drawGeometry.width, drawGeometry.height);
  context.restore();
}
