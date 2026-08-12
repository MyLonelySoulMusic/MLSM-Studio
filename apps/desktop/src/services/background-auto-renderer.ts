import type { RhythmBallProject } from "@rbs/project-schema";
import { activeBackgroundAutoSubtitleCue, renderBackgroundAutoSubtitle, type BackgroundAutoSubtitleCue, type BackgroundAutoProSubtitleSettings } from "./background-auto-subtitles";

export type BackgroundAutoSettings = RhythmBallProject["animation"]["backgroundAuto"];
export interface BackgroundAutoRenderOptions {
  canvas: HTMLCanvasElement;
  image?: CanvasImageSource | null;
  settings: BackgroundAutoSettings;
  timeSeconds: number;
  spectrumBands: readonly number[];
  audioPulse: number;
  stereoLeftBands?: readonly number[];
  stereoRightBands?: readonly number[];
  stereoLeftPulse?: number;
  stereoRightPulse?: number;
  subtitleCues?: readonly BackgroundAutoSubtitleCue[];
  proSubtitlesSettings?: BackgroundAutoProSubtitleSettings;
  seed?: number;
}
export interface BackgroundAutoCoverTransform { scale: number; offsetX: number; offsetY: number; drawWidth: number; drawHeight: number }
export interface BackgroundAutoCanvasBox { x: number; y: number; width: number; height: number; centerX: number; centerY: number }
export interface ResolvedBackgroundAutoEffect { effect: BackgroundAutoSettings["effects"][number]; detection: BackgroundAutoSettings["detections"][number]; effectIndex: number; detectionIndex: number; palette: readonly string[]; color: string }
export interface BackgroundAutoOutputDimensions { width: number; height: number }

const BACKGROUND_AUTO_MIN_DIMENSION = 64;
const BACKGROUND_AUTO_MAX_DIMENSION = 7680;
const BACKGROUND_AUTO_RATIO_PIXEL_TOLERANCE = 1;

function colorAt(palette: readonly string[], index: number): string { return palette[index % Math.max(1, palette.length)] ?? "#63f0d1"; }
function detectionPalette(settings: BackgroundAutoSettings, detection: BackgroundAutoSettings["detections"][number]): readonly string[] {
  return detection.palette && detection.palette.length === 3 ? detection.palette : settings.palette;
}
export function backgroundAutoCoverTransform(sourceWidth: number, sourceHeight: number, width: number, height: number): BackgroundAutoCoverTransform {
  const safeSourceWidth = Math.max(1, sourceWidth); const safeSourceHeight = Math.max(1, sourceHeight);
  const scale = Math.max(width / safeSourceWidth, height / safeSourceHeight); const drawWidth = safeSourceWidth * scale; const drawHeight = safeSourceHeight * scale;
  return { scale, offsetX: (width - drawWidth) / 2, offsetY: (height - drawHeight) / 2, drawWidth, drawHeight };
}

/** Draws the whole source without cropping. Empty space is left for the
 * caller's background fill, which keeps portrait and ultrawide sources safe
 * inside arbitrary output canvases. */
export function backgroundAutoContainTransform(sourceWidth: number, sourceHeight: number, width: number, height: number): BackgroundAutoCoverTransform {
  const safeSourceWidth = Math.max(1, sourceWidth); const safeSourceHeight = Math.max(1, sourceHeight);
  const scale = Math.min(width / safeSourceWidth, height / safeSourceHeight); const drawWidth = safeSourceWidth * scale; const drawHeight = safeSourceHeight * scale;
  return { scale, offsetX: (width - drawWidth) / 2, offsetY: (height - drawHeight) / 2, drawWidth, drawHeight };
}

function clampEvenDimension(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Background Auto resolution is invalid.");
  const rounded = Math.round(value / 2) * 2;
  return Math.max(BACKGROUND_AUTO_MIN_DIMENSION, Math.min(BACKGROUND_AUTO_MAX_DIMENSION, rounded));
}

/** Returns true when one uniform source scale can explain both output axes.
 * H.264 requires even dimensions, so independently rounding an odd source can
 * move either axis by one pixel without changing the intended composition. */
function preservesBackgroundAutoScale(sourceWidth: number, sourceHeight: number, width: number, height: number): boolean {
  const tolerance = BACKGROUND_AUTO_RATIO_PIXEL_TOLERANCE + Number.EPSILON;
  const minimumWidthScale = (width - tolerance) / sourceWidth;
  const maximumWidthScale = (width + tolerance) / sourceWidth;
  const minimumHeightScale = (height - tolerance) / sourceHeight;
  const maximumHeightScale = (height + tolerance) / sourceHeight;
  return Math.max(minimumWidthScale, minimumHeightScale) <= Math.min(maximumWidthScale, maximumHeightScale);
}

export function backgroundAutoRatioLabel(sourceWidth: number, sourceHeight: number): string {
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return "source";
  const gcd = (left: number, right: number): number => right ? gcd(right, left % right) : Math.abs(left);
  const divisor = gcd(sourceWidth, sourceHeight) || 1;
  return `${sourceWidth / divisor}:${sourceHeight / divisor}`;
}

/** Validates and normalizes a requested output. UI presets are generated from
 * this same ratio, while direct callers cannot accidentally reintroduce a
 * global 16:9 canvas for a portrait source. */
export function backgroundAutoOutputDimensions(sourceWidth: number, sourceHeight: number, requestedWidth: number, requestedHeight: number): BackgroundAutoOutputDimensions {
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) throw new Error("Background Auto source dimensions must be positive.");
  if (!Number.isFinite(requestedWidth) || !Number.isFinite(requestedHeight) || requestedWidth <= 0 || requestedHeight <= 0) throw new Error("Background Auto resolution must be positive.");
  const width = clampEvenDimension(requestedWidth); const height = clampEvenDimension(requestedHeight);
  if (!preservesBackgroundAutoScale(sourceWidth, sourceHeight, width, height)) throw new Error(`Resolution ${width}×${height} does not preserve the ${backgroundAutoRatioLabel(sourceWidth, sourceHeight)} source ratio.`);
  return { width, height };
}

export function backgroundAutoResolutionOptions(sourceWidth: number, sourceHeight: number): { value: string; label: string }[] {
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return [];
  const ratio = backgroundAutoRatioLabel(sourceWidth, sourceHeight); const options = new Map<string, string>();
  const minimumScale = Math.max(BACKGROUND_AUTO_MIN_DIMENSION / sourceWidth, BACKGROUND_AUTO_MIN_DIMENSION / sourceHeight);
  const maximumScale = Math.min(BACKGROUND_AUTO_MAX_DIMENSION / sourceWidth, BACKGROUND_AUTO_MAX_DIMENSION / sourceHeight);
  if (minimumScale > maximumScale) return [];
  for (const scale of [.5, .75, 1, 1.5, 2]) {
    const safeScale = Math.max(minimumScale, Math.min(scale, maximumScale));
    if (safeScale <= 0) continue;
    let dimensions: BackgroundAutoOutputDimensions;
    try { dimensions = backgroundAutoOutputDimensions(sourceWidth, sourceHeight, sourceWidth * safeScale, sourceHeight * safeScale); } catch { continue; }
    const value = `${dimensions.width}x${dimensions.height}`;
    options.set(value, `${dimensions.width} × ${dimensions.height} (${ratio} · ${safeScale === 1 ? "native" : `${Math.round(safeScale * 100)}%`})`);
  }
  return [...options].map(([value, label]) => ({ value, label }));
}

export function mapBackgroundAutoBoxToCanvas(bbox: BackgroundAutoSettings["detections"][number]["bbox"], transform: BackgroundAutoCoverTransform): BackgroundAutoCanvasBox {
  const x = transform.offsetX + bbox.x * transform.drawWidth; const y = transform.offsetY + bbox.y * transform.drawHeight;
  const width = bbox.width * transform.drawWidth; const height = bbox.height * transform.drawHeight;
  return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
}

export function normalizeBackgroundAutoProjectSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
}

/** Legacy projects do not carry an opacity field. Keep those effects visibly
 * strong while clamping editor values before they reach Canvas2D. */
export function backgroundAutoEffectOpacity(opacity: number | undefined): number {
  return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity as number)) : .9;
}

export function backgroundAutoConfigurationError(settings: BackgroundAutoSettings): string | null {
  const detections = new Map(settings.detections.map((detection) => [detection.id, detection]));
  for (const effect of settings.effects) {
    if (!effect.enabled) continue;
    const detection = effect.detectionId ? detections.get(effect.detectionId) : undefined;
    if (!detection) return `The ${effect.label} effect is not associated with a detected object.`;
  }
  return null;
}

export function resolveBackgroundAutoEffects(settings: BackgroundAutoSettings): ResolvedBackgroundAutoEffect[] {
  return settings.effects.flatMap((effect, effectIndex) => {
    if (!effect.enabled) return [];
    const detectionIndex = settings.detections.findIndex((candidate) => candidate.id === effect.detectionId);
    const detection = settings.detections[detectionIndex];
    if (!detection) return [];
    const palette = effect.paletteMode === "auto" ? detectionPalette(settings, detection) : effect.palette;
    return [{ effect, detection, effectIndex, detectionIndex, palette, color: effect.paletteMode === "auto" ? colorAt(palette, effectIndex) : effect.color }];
  });
}

function drawCenterSpectrum(
  context: CanvasRenderingContext2D,
  bands: readonly number[],
  palette: readonly string[],
  radius: number,
  intensity: number,
  pulse: number,
  opacity: number
): void {
  const count = Math.max(8, Math.min(48, bands.length));
  const width = radius * 1.36 / count;
  const gap = Math.max(.7, width * .16);
  const baseline = radius * .035;
  const maxHeight = radius * .34;
  for (let index = 0; index < count; index += 1) {
    const sourceIndex = Math.floor(index / count * bands.length);
    const value = Math.max(0, Math.min(1, Number(bands[sourceIndex] ?? 0) || 0));
    const amplitude = Math.max(.035, Math.min(1, value * intensity * (.85 + pulse * .4)));
    const barHeight = maxHeight * amplitude;
    const x = -radius * .68 + index * width + gap / 2;
    context.fillStyle = colorAt(palette, index);
    context.globalAlpha = opacity * (.42 + amplitude * .5);
    context.fillRect(x, baseline - barHeight, Math.max(1, width - gap), barHeight);
    context.globalAlpha = opacity * (.28 + amplitude * .42);
    context.fillRect(x, baseline, Math.max(1, width - gap), barHeight * .72);
  }
}

function drawStereoSide(
  context: CanvasRenderingContext2D,
  bands: readonly number[],
  palette: readonly string[],
  radius: number,
  intensity: number,
  pulse: number,
  opacity: number,
  side: -1 | 1
): void {
  const count = Math.max(8, Math.min(32, bands.length));
  const inner = radius * .54;
  const available = radius * (.83 - .54);
  // The stereo stack must fit the circle at the bars' outermost X, not just
  // inside its square bounding box. Derive the usable vertical chord from the
  // same .96r clip used by the caller, then bias the complete stack slightly
  // below the fixed centre spectrum. This keeps all 32 sampled bands visible
  // even when the source supplies the full 48-band analysis.
  const clipRadius = radius * .96;
  const outer = inner + available;
  const chordHalfHeight = Math.sqrt(Math.max(0, clipRadius ** 2 - outer ** 2));
  const edgeInset = radius * .015;
  const safeHalfHeight = Math.max(0, chordHalfHeight - edgeInset);
  const stackCenterY = Math.min(radius * .08, safeHalfHeight * .2);
  const centeredHalfHeight = Math.max(0, safeHalfHeight - stackCenterY);
  const stackHeight = centeredHalfHeight * 2 * .94;
  const pitch = stackHeight / count;
  const barHeight = pitch * .72;
  const renderedHeight = (count - 1) * pitch + barHeight;
  const startY = stackCenterY - renderedHeight / 2;
  for (let index = 0; index < count; index += 1) {
    const sourceIndex = Math.floor(index / count * bands.length);
    const value = Math.max(0, Math.min(1, Number(bands[sourceIndex] ?? 0) || 0));
    const amplitude = Math.max(.035, Math.min(1, value * intensity * (.78 + pulse * .62)));
    const width = Math.max(1, available * amplitude);
    const y = startY + index * pitch;
    // Both channels grow away from the centre: right +.54r -> +.83r and
    // left -.54r -> -.83r. Keeping the inner edge fixed also makes unequal
    // channel energy immediately readable as a genuinely mirrored stereo pair.
    const x = side < 0 ? -inner - width : inner;
    context.fillStyle = colorAt(palette, index + (side < 0 ? 1 : 2));
    context.globalAlpha = opacity * (.34 + amplitude * .55);
    context.fillRect(Math.min(x, x + width), y, width, barHeight);
    // A compact pulse bead gives left/right channels a distinct beat marker
    // without borrowing the rotating radial geometry.
    if (index % 5 === 0 && amplitude > .14) {
      context.globalAlpha = opacity * .68 * amplitude;
      context.beginPath(); context.arc(side * radius * .7, y + barHeight / 2, Math.max(1.1, radius * .018 * amplitude), 0, Math.PI * 2); context.fill();
    }
  }
}

/** Deterministic Canvas2D renderer shared by preview and offline export. It does
 * not mutate settings and derives particle positions from stable ids/time. */
export function renderBackgroundAutoFrame(options: BackgroundAutoRenderOptions): void {
  const { canvas, image, settings } = options; const width = Math.max(1, canvas.width); const height = Math.max(1, canvas.height); const context = canvas.getContext("2d"); if (!context) return;
  context.save();
  try {
    // Background Auto must keep source pixels faithful. The palette only fills
    // contain letterbox areas and the no-image fallback.
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, width, height); context.fillStyle = settings.palette[0] ?? "#070b18"; context.fillRect(0, 0, width, height);
    let transform = backgroundAutoContainTransform(width, height, width, height);
    if (image) {
      const sourceWidth = image instanceof HTMLImageElement ? image.naturalWidth : Number((image as { width?: number }).width ?? width); const sourceHeight = image instanceof HTMLImageElement ? image.naturalHeight : Number((image as { height?: number }).height ?? height);
      transform = backgroundAutoContainTransform(sourceWidth, sourceHeight, width, height); context.drawImage(image, transform.offsetX, transform.offsetY, transform.drawWidth, transform.drawHeight);
    } else {
      const gradient = context.createLinearGradient(0, 0, width, height); gradient.addColorStop(0, settings.palette[0]); gradient.addColorStop(.52, settings.palette[1]); gradient.addColorStop(1, settings.palette[2]); context.fillStyle = gradient; context.fillRect(0, 0, width, height);
    }
    const bands = options.spectrumBands.length ? options.spectrumBands : Array.from({ length: 48 }, () => 0);
    const leftBands = options.stereoLeftBands?.length ? options.stereoLeftBands : bands;
    const rightBands = options.stereoRightBands?.length ? options.stereoRightBands : bands;
    const pulse = Math.max(0, Math.min(1, options.audioPulse));
    const leftPulse = Math.max(0, Math.min(1, options.stereoLeftPulse ?? pulse));
    const rightPulse = Math.max(0, Math.min(1, options.stereoRightPulse ?? pulse));
    resolveBackgroundAutoEffects(settings).forEach(({ effect, detection, effectIndex, detectionIndex, palette: effectPalette, color: effectColor }) => {
      const box = mapBackgroundAutoBoxToCanvas(detection.bbox, transform);
      const centerX = box.centerX; const centerY = box.centerY;
      const baseRadius = Math.max(18, Math.max(box.width, box.height) * .38 * effect.scale);
      // Rotation speed is expressed in revolutions per second. The static
      // offset keeps multiple detections visually distinct; with speed zero
      // the angle is intentionally independent of time.
      const rotationSpeed = Number.isFinite(effect.rotationSpeed) ? Math.max(0, Math.min(1, effect.rotationSpeed)) : .08;
      const rotation = options.timeSeconds * rotationSpeed * Math.PI * 2 + detectionIndex * .43 + effectIndex * .17;
      const effectOpacity = backgroundAutoEffectOpacity(effect.opacity);
      const centerSpectrumEnabled = effect.centerSpectrumEnabled ?? true;
      const stereoSidesEnabled = effect.stereoSidesEnabled ?? true;
      const subtitlesEnabled = effect.subtitlesEnabled ?? false;
      const peaks: { x: number; y: number; value: number; index: number }[] = [];

      // The radial ring is the only layer that follows the effect rotation.
      // Center and stereo layers intentionally use a fresh unrotated save so
      // that a rotating ring never tilts the horizontal/left-right bands.
      context.save();
      context.translate(centerX, centerY); context.rotate(rotation); context.globalCompositeOperation = "source-over";
      context.globalAlpha = effectOpacity;
      context.beginPath(); context.arc(0, 0, baseRadius, 0, Math.PI * 2); context.strokeStyle = effectColor; context.globalAlpha = effectOpacity; context.lineWidth = Math.max(1, width / 500); context.stroke();
      bands.forEach((value, bandIndex) => {
        const amplitude = Math.max(0, Math.min(1, Number(value) || 0)) * effect.intensity * (.74 + pulse * .5); const angle = bandIndex / bands.length * Math.PI * 2; const radius = baseRadius + amplitude * baseRadius * .52;
        const x = Math.cos(angle) * radius; const y = Math.sin(angle) * radius; peaks.push({ x, y, value: amplitude, index: bandIndex });
        context.strokeStyle = colorAt(effectPalette, bandIndex); context.globalAlpha = effectOpacity * (.38 + Math.min(.58, amplitude)); context.lineWidth = Math.max(1.2, width / 360 * (1 + amplitude * 1.8)); context.beginPath(); context.moveTo(Math.cos(angle) * baseRadius, Math.sin(angle) * baseRadius); context.lineTo(x, y); context.stroke();
      });
      if (effect.collisionParticles) {
        peaks.filter((peak) => peak.value > .64).slice(0, 16).forEach((peak, particleIndex) => {
          const phase = (particleIndex * 1.73 + effectIndex * .91 + detectionIndex * .37 + (options.seed ?? 0) * .0001); const particleRadius = 3 + ((Math.sin(phase) + 1) / 2) * 8; const drift = ((options.timeSeconds * (18 + particleIndex * 2) + phase * 23) % 42) - 21;
          context.globalAlpha = effectOpacity * .72 * Math.min(1, peak.value); context.fillStyle = colorAt(effectPalette, peak.index + particleIndex); context.beginPath(); context.arc(peak.x + Math.cos(phase) * drift, peak.y + Math.sin(phase) * drift, particleRadius, 0, Math.PI * 2); context.fill();
        });
      }
      context.restore();

      context.save();
      try {
        context.translate(centerX, centerY);
        context.globalCompositeOperation = "source-over";
        context.globalAlpha = effectOpacity;
        context.beginPath(); context.arc(0, 0, baseRadius * .96, 0, Math.PI * 2); if (typeof context.clip === "function") context.clip();
        if (centerSpectrumEnabled) drawCenterSpectrum(context, bands, effectPalette, baseRadius, effect.intensity, pulse, effectOpacity);
        if (stereoSidesEnabled) {
          drawStereoSide(context, leftBands, effectPalette, baseRadius, effect.intensity, leftPulse, effectOpacity, -1);
          drawStereoSide(context, rightBands, effectPalette, baseRadius, effect.intensity, rightPulse, effectOpacity, 1);
        }
        if (subtitlesEnabled && options.subtitleCues?.length && options.proSubtitlesSettings) {
          const cue = activeBackgroundAutoSubtitleCue(options.subtitleCues, options.timeSeconds);
          if (cue) renderBackgroundAutoSubtitle({ context, cue, settings: options.proSubtitlesSettings, palette: effectPalette, centerX: 0, centerY: 0, radius: baseRadius, timeSeconds: options.timeSeconds, opacity: effectOpacity });
        }
      } finally {
        context.restore();
      }
    });
  } finally {
    context.restore();
  }
}
