import type { RhythmBallProject } from "@rbs/project-schema";

type PixelsSubSettings = RhythmBallProject["animation"]["pixelsSub"];
type SubtitleCue = RhythmBallProject["subtitles"]["cues"][number];

export interface PixelsSubFrameInput {
  timeSeconds: number;
  audioPulse: number;
  rhythmPulse: number;
  spectrumBands: readonly number[];
  rhythmHits: readonly PixelsSubRhythmHit[];
  image: CanvasImageSource | null;
  cues: readonly SubtitleCue[];
  settings: PixelsSubSettings;
}

export interface PixelsSubRhythmHit {
  timeSeconds: number;
  strength: number;
  type: "kick" | "snare";
}

export interface PixelsSubRhythmState {
  hitIndex: number;
  type: "kick" | "snare";
  strength: number;
  impulse: number;
}

export interface PixelsSubImageRect { x: number; y: number; width: number; height: number }
interface CueEnvelope { progress: number; visibility: number }
interface PixelTextCell { x: number; y: number; alpha: number }
interface PixelTextLayout { cells: PixelTextCell[]; unit: number; minX: number; maxX: number }

const textLayouts = new Map<string, PixelTextLayout>();
const TAU = Math.PI * 2;

export const PIXELS_SUB_FONT_FAMILIES = ["Pixelify Sans", "Press Start 2P", "Silkscreen", "VT323", "Tiny5", "Jersey 10"] as const;

export function clearPixelsSubTextLayoutCache(): void { textLayouts.clear(); }

export function pixelsSubFontWeight(fontFamily: string): number { return fontFamily === "Pixelify Sans" ? 700 : 400; }

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function smoothstep(value: number): number { const x = clamp01(value); return x * x * (3 - 2 * x); }
function hash(x: number, y: number, seed = 0): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function imageDimensions(image: CanvasImageSource): { width: number; height: number } {
  const source = image as CanvasImageSource & {
    naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number;
  };
  return {
    width: Math.max(1, source.naturalWidth ?? source.videoWidth ?? source.width ?? 1),
    height: Math.max(1, source.naturalHeight ?? source.videoHeight ?? source.height ?? 1)
  };
}

export function resolvePixelsSubImageRect(
  frameWidth: number,
  frameHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  inset: number
): PixelsSubImageRect {
  const safeInset = Math.max(.025, Math.min(.16, inset));
  const availableWidth = frameWidth * (1 - safeInset * 2);
  const availableHeight = frameHeight * (1 - safeInset * 2);
  const scale = Math.min(availableWidth / Math.max(1, sourceWidth), availableHeight / Math.max(1, sourceHeight));
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height };
}

export function resolvePixelsSubCueEnvelope(timeSeconds: number, cue: Pick<SubtitleCue, "startSeconds" | "endSeconds">): CueEnvelope {
  const duration = Math.max(.08, cue.endSeconds - cue.startSeconds);
  const progress = clamp01((timeSeconds - cue.startSeconds) / duration);
  const edge = Math.min(.16, Math.max(.055, .1 / duration));
  return { progress, visibility: Math.min(smoothstep(progress / edge), smoothstep((1 - progress) / edge)) };
}

export function activePixelsSubCue(timeSeconds: number, cues: readonly SubtitleCue[]): SubtitleCue | null {
  return cues.find((cue) => timeSeconds >= cue.startSeconds && timeSeconds <= cue.endSeconds) ?? null;
}

export function resolvePixelsSubRhythmState(timeSeconds: number, hits: readonly PixelsSubRhythmHit[]): PixelsSubRhythmState | null {
  let winner: PixelsSubRhythmState | null = null;
  hits.forEach((hit, hitIndex) => {
    const duration = hit.type === "kick" ? .3 : .22;
    const age = timeSeconds - hit.timeSeconds;
    if (age < 0 || age > duration) return;
    const progress = clamp01(age / duration);
    const attack = smoothstep(progress / .2);
    const release = smoothstep((1 - progress) / .8);
    const impulse = clamp01(hit.strength) * Math.min(attack, release);
    if (!winner || impulse > winner.impulse) winner = { hitIndex, type: hit.type, strength: clamp01(hit.strength), impulse };
  });
  return winner;
}

export function resolvePixelsSubSwapTarget(axis: number, axisLength: number, crossAxis: number, state: PixelsSubRhythmState): number {
  const span = state.type === "kick" ? 4 : 2;
  const pairLength = span * 2;
  const pairIndex = Math.floor(axis / pairLength);
  const local = axis - pairIndex * pairLength;
  const target = local < span ? axis + span : axis - span;
  if (target < 0 || target >= axisLength) return axis;
  const seed = 31 + state.hitIndex * 5 + (state.type === "snare" ? 2 : 0);
  return hash(crossAxis, pairIndex, seed) < .12 + state.strength * .34 ? target : axis;
}

export function resolvePixelsSubPaletteWeights(frequency: number): [number, number, number] {
  const value = clamp01(frequency);
  const weights = [
    .18 + (1 - value) * .52,
    .18 + (1 - Math.abs(value - .5) * 2) * .34,
    .18 + value * .52
  ] as const;
  const total = weights[0] + weights[1] + weights[2];
  return [weights[0] / total, weights[1] / total, weights[2] / total];
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const previous = lines.at(-1);
    const candidate = previous ? `${previous} ${word}` : word;
    if (previous && context.measureText(candidate).width > maxWidth) lines.push(word);
    else if (previous) lines[lines.length - 1] = candidate;
    else lines.push(word);
  }
  return lines;
}

function buildPixelTextLayout(
  text: string,
  frameWidth: number,
  frameHeight: number,
  imageRect: PixelsSubImageRect,
  positionY: number,
  fontFamily: string
): PixelTextLayout | null {
  // Pixel fonts already contain a real square grid. Keeping a 1:1 logical
  // canvas at 1080p avoids the destructive second downsampling used before.
  const unit = Math.max(1, Math.round(frameWidth / 1080));
  const logicalWidth = Math.ceil(frameWidth / unit);
  const logicalHeight = Math.ceil(frameHeight / unit);
  const key = [text, fontFamily, logicalWidth, logicalHeight, imageRect.width.toFixed(1), imageRect.height.toFixed(1), positionY].join(":");
  const cached = textLayouts.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = logicalWidth;
  canvas.height = logicalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  const logicalImageWidth = imageRect.width / unit;
  const logicalImageHeight = imageRect.height / unit;
  let fontSize = Math.max(7, Math.min(logicalImageWidth * .082, logicalImageHeight * .06));
  let lines: string[] = [];
  const fontWeight = pixelsSubFontWeight(fontFamily);
  do {
    context.font = `${fontWeight} ${fontSize}px "${fontFamily}", monospace`;
    lines = wrapLines(context, text, logicalImageWidth * .84);
    if (lines.length <= 3) break;
    fontSize *= .9;
  } while (fontSize > 5);

  context.font = `${fontWeight} ${fontSize}px "${fontFamily}", monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#fff";
  const lineHeight = fontSize * 1.08;
  const centerY = (imageRect.y + imageRect.height * positionY / 100) / unit;
  const startY = centerY - (lines.length - 1) * lineHeight / 2;
  lines.forEach((line, index) => context.fillText(line, logicalWidth / 2, startY + index * lineHeight));

  const data = context.getImageData(0, 0, logicalWidth, logicalHeight).data;
  const cells: PixelTextCell[] = [];
  let minX = logicalWidth;
  let maxX = 0;
  for (let y = 0; y < logicalHeight; y += 1) for (let x = 0; x < logicalWidth; x += 1) {
    const alpha = (data[(y * logicalWidth + x) * 4 + 3] ?? 0) / 255;
    if (alpha < .34) continue;
    cells.push({ x, y, alpha: 1 });
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  const layout = { cells, unit, minX, maxX };
  textLayouts.set(key, layout);
  if (textLayouts.size > 100) textLayouts.delete(textLayouts.keys().next().value ?? key);
  return layout;
}

function drawPixelText(
  context: CanvasRenderingContext2D,
  layout: PixelTextLayout,
  color: string,
  opacity: number,
  offsetX: number,
  offsetY: number,
  reveal: number
): void {
  if (opacity <= .001) return;
  const revealX = layout.minX + (layout.maxX - layout.minX + 1) * clamp01(reveal);
  context.fillStyle = color;
  context.globalAlpha = opacity;
  for (const cell of layout.cells) {
    if (cell.x > revealX) continue;
    context.globalAlpha = opacity * cell.alpha;
    context.fillRect(Math.round(cell.x * layout.unit + offsetX), Math.round(cell.y * layout.unit + offsetY), layout.unit + 1, layout.unit + 1);
  }
}

function drawPixelField(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  imageRect: PixelsSubImageRect,
  input: PixelsSubFrameInput
): void {
  const { settings, timeSeconds } = input;
  const cell = Math.max(3, Math.round(settings.pixelSize * width / 1080));
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const protectedLeft = imageRect.x;
  const protectedRight = imageRect.x + imageRect.width;
  const protectedTop = imageRect.y;
  const protectedBottom = imageRect.y + imageRect.height;
  const pulse = Math.sqrt(clamp01(input.audioPulse));
  const rhythmState = resolvePixelsSubRhythmState(timeSeconds, input.rhythmHits);
  const rhythmicImpulse = Math.max(clamp01(input.rhythmPulse), rhythmState?.impulse ?? 0);
  const slowTime = timeSeconds * settings.flowSpeed;
  const bands = input.spectrumBands.length ? input.spectrumBands : [0];

  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const x = column * cell;
    const y = row * cell;
    const centerX = x + cell / 2;
    const centerY = y + cell / 2;
    if (centerX > protectedLeft && centerX < protectedRight && centerY > protectedTop && centerY < protectedBottom) continue;

    const onLeft = centerX <= protectedLeft;
    const onRight = centerX >= protectedRight;
    const sideZone = onLeft || onRight;
    const spectrumPosition = sideZone ? centerY / height : centerX / width;
    const bandIndex = Math.min(bands.length - 1, Math.max(0, Math.floor(spectrumPosition * bands.length)));
    const band = clamp01(bands[bandIndex] ?? 0);
    const neighborBand = clamp01(bands[Math.min(bands.length - 1, bandIndex + 1)] ?? band);
    const frequency = clamp01(band * .72 + neighborBand * .28);
    const energy = clamp01(.14 + frequency * settings.audioReactivity * .72 + pulse * .12 + rhythmicImpulse * .16);
    const phase = hash(column, row, 4) * TAU;
    const breathing = .5 + .5 * Math.sin(slowTime * (.72 + hash(column, row, 2) * .22) + phase);

    // Frequencies affect only density and palette distribution. The field
    // always occupies the whole frame around the image and never grows like
    // an equalizer bar.
    const density = .62 + energy * .32;
    let presence = smoothstep((density - hash(column, row, 8)) * 7 + .5);
    const ownSwapAxis = sideZone ? row : column;
    const swapAxisTarget = rhythmState
      ? sideZone
        ? resolvePixelsSubSwapTarget(row, rows, column, rhythmState)
        : resolvePixelsSubSwapTarget(column, columns, row, rhythmState)
      : ownSwapAxis;
    if (rhythmState && swapAxisTarget !== ownSwapAxis) presence = Math.max(presence, smoothstep(rhythmState.impulse) * .98);
    const adjacentToImage = onLeft
      ? protectedLeft - centerX <= cell * 1.15
      : onRight
        ? centerX - protectedRight <= cell * 1.15
        : centerY <= protectedTop
          ? protectedTop - centerY <= cell * 1.15
          : centerY - protectedBottom <= cell * 1.15;
    if (adjacentToImage) presence = Math.max(.94, presence);
    if (presence <= .01) continue;

    const direction = onLeft ? -1 : onRight ? 1 : 0;
    const motion = .16 + rhythmicImpulse * .58;
    const driftX = Math.sin(slowTime * .9 + row * .23 + phase) * cell * motion + direction * breathing * cell * .24;
    const driftY = Math.cos(slowTime * .62 + column * .17 + phase) * cell * motion * .58;
    const size = cell * (.79 + breathing * .09);
    const paletteWeights = resolvePixelsSubPaletteWeights(frequency);
    const paletteSelector = hash(column, row, 3);
    const colorIndex = paletteSelector < paletteWeights[0] ? 0 : paletteSelector < paletteWeights[0] + paletteWeights[1] ? 1 : 2;

    let drawX = centerX - size / 2 + driftX;
    let drawY = centerY - size / 2 + driftY;
    if (rhythmState && rhythmState.impulse > .01 && swapAxisTarget !== ownSwapAxis) {
      const swapAmount = smoothstep(rhythmState.impulse);
      if (sideZone) {
        const delta = swapAxisTarget - row;
        drawY += delta * cell * swapAmount;
        drawX += Math.sign(delta) * Math.sin(Math.PI * swapAmount) * cell * (rhythmState.type === "kick" ? .72 : .48);
      } else {
        const delta = swapAxisTarget - column;
        drawX += delta * cell * swapAmount;
        drawY += Math.sign(delta) * Math.sin(Math.PI * swapAmount) * cell * (rhythmState.type === "kick" ? .72 : .48);
      }
    }
    if (onLeft) drawX = adjacentToImage ? protectedLeft - size : Math.min(drawX, protectedLeft - size);
    else if (onRight) drawX = adjacentToImage ? protectedRight : Math.max(drawX, protectedRight);
    else if (centerY <= protectedTop) drawY = adjacentToImage ? protectedTop - size : Math.min(drawY, protectedTop - size);
    else drawY = adjacentToImage ? protectedBottom : Math.max(drawY, protectedBottom);

    // A hard one-pixel keyline keeps even dark palette cells legible. The
    // overwhelming majority of the field remains opaque and square-edged.
    const outline = Math.max(1, Math.round(width / 1080));
    context.globalAlpha = presence * .52;
    context.fillStyle = settings.palette[(colorIndex + 1) % 3] ?? settings.palette[0];
    context.fillRect(Math.round(drawX - outline), Math.round(drawY - outline), Math.ceil(size + outline * 2), Math.ceil(size + outline * 2));
    context.globalAlpha = presence > .7 ? .98 : .3 + presence * .94;
    context.fillStyle = settings.palette[colorIndex] ?? settings.palette[1];
    context.fillRect(Math.round(drawX), Math.round(drawY), Math.ceil(size), Math.ceil(size));

    if (settings.trailStrength > .02 && energy > .34 && hash(column, row, 11) > .82) {
      context.globalAlpha = settings.trailStrength * energy * presence * .18;
      context.fillStyle = settings.palette[(colorIndex + 2) % 3] ?? settings.palette[0];
      context.fillRect(Math.round(drawX - driftX * .72), Math.round(drawY - driftY * .72), Math.ceil(size * .55), Math.ceil(size * .55));
    }
  }
}

export function renderPixelsSubFrame(canvas: HTMLCanvasElement, input: PixelsSubFrameInput): { activeCueId: string | null } {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return { activeCueId: null };
  const { width, height } = canvas;
  const { settings, timeSeconds } = input;
  const source = input.image ? imageDimensions(input.image) : { width: width * .72, height: height * .72 };
  const imageRect = resolvePixelsSubImageRect(width, height, source.width, source.height, settings.imageInset);

  context.globalAlpha = 1;
  context.fillStyle = settings.palette[0];
  context.fillRect(0, 0, width, height);
  drawPixelField(context, width, height, imageRect, input);

  if (input.image) {
    context.save();
    context.globalAlpha = 1;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(input.image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    context.restore();
  }

  const cue = activePixelsSubCue(timeSeconds, input.cues);
  if (cue) {
    const envelope = resolvePixelsSubCueEnvelope(timeSeconds, cue);
    const layout = buildPixelTextLayout(cue.text, width, height, imageRect, settings.subtitlePositionY, settings.subtitleFontFamily);
    if (layout) {
      const enterReveal = smoothstep(clamp01(envelope.progress / .12));
      const lift = (1 - envelope.visibility) * layout.unit * 2;
      const shadowOffset = settings.subtitleShadowOffset * width / 1080;
      if (settings.subtitleShadowEnabled) {
        drawPixelText(context, layout, settings.subtitleShadowColor, envelope.visibility * .94, shadowOffset, shadowOffset + lift, enterReveal);
      }
      drawPixelText(context, layout, settings.palette[settings.subtitleColorIndex] ?? settings.palette[1], envelope.visibility, 0, lift, enterReveal);
    }
  }

  context.globalAlpha = 1;
  return { activeCueId: cue?.id ?? null };
}
