import type { RhythmBallProject } from "@rbs/project-schema";
import { subtitleFontWeight } from "./subtitle-fonts";

/**
 * Background Auto subtitles intentionally have their own small compositor.
 * Pro Subtitles owns the full-frame title-safe renderer; this renderer only
 * borrows its persisted cue/style/typesetting settings and keeps every word
 * inside the detected object's circular mask.
 */
export type BackgroundAutoSubtitleCue = RhythmBallProject["subtitles"]["cues"][number];
export type BackgroundAutoProSubtitleSettings = RhythmBallProject["animation"]["proSubtitles"];
export type BackgroundAutoEffectPalette = readonly string[];

export interface BackgroundAutoSubtitleRenderOptions {
  context: CanvasRenderingContext2D;
  cue: BackgroundAutoSubtitleCue;
  settings: BackgroundAutoProSubtitleSettings;
  palette: BackgroundAutoEffectPalette;
  centerX: number;
  centerY: number;
  radius: number;
  timeSeconds: number;
  opacity: number;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

function words(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n").flatMap((line) => line.trim().split(/\s+/u)).filter(Boolean);
}

function hash(value: string): number {
  let result = 2_166_136_261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16_777_619);
  return result >>> 0;
}

function fontFamily(value: string): string {
  return value.replace(/["\\\n\r]/g, "").trim() || "sans-serif";
}

function measure(context: CanvasRenderingContext2D, text: string, font: string, fallback: number): number {
  context.font = font;
  const measured = context.measureText(text).width;
  return Number.isFinite(measured) && measured > 0 ? measured : Math.max(1, text.length * fallback);
}

function styleForCue(cue: BackgroundAutoSubtitleCue, settings: BackgroundAutoProSubtitleSettings) {
  const source = settings.cueStyles.find((candidate) => candidate.cueId === cue.id);
  return {
    fontFamily: source?.fontFamilyAutomatic === false ? source.fontFamily : settings.defaultFontFamily,
    fontSize: source?.fontSizeAutomatic === false ? source.fontSize : settings.defaultFontSize,
    positionX: source?.positionAutomatic === false ? source.positionX : settings.positionX,
    positionY: source?.positionAutomatic === false ? source.positionY : settings.positionY,
    opacity: source?.opacityAutomatic === false ? source.opacity : settings.opacity,
    shadowEnabled: source?.shadowEnabled ?? settings.shadowEnabled,
    shadowColor: source?.shadowColor?.trim() || settings.shadowColor
  };
}

interface BackgroundAutoSubtitleLayout {
  font: string;
  fontSize: number;
  lines: string[][];
  lineHeight: number;
}

function wrapBackgroundAutoSubtitle(
  context: CanvasRenderingContext2D,
  cueWords: readonly string[],
  font: string,
  fontSize: number,
  maxWidth: number
): string[][] {
  const lines: string[][] = [[]];
  let currentWidth = 0;
  const spaceWidth = measure(context, " ", font, fontSize * .28);
  for (const word of cueWords) {
    const wordWidth = measure(context, word, font, fontSize * .56);
    const spacing = currentWidth ? spaceWidth : 0;
    if (currentWidth + spacing + wordWidth > maxWidth && lines.at(-1)?.length) {
      lines.push([]);
      currentWidth = 0;
    }
    lines.at(-1)!.push(word);
    currentWidth += (currentWidth ? spaceWidth : 0) + wordWidth;
  }
  return lines;
}

function fitBackgroundAutoSubtitle(
  context: CanvasRenderingContext2D,
  cueWords: readonly string[],
  family: string,
  requestedFontSize: number,
  radius: number
): BackgroundAutoSubtitleLayout {
  const maxWidth = Math.max(12, radius * 1.42);
  const maxHeight = Math.max(8, radius * 1.35);
  const weight = subtitleFontWeight(family);
  let fontSize = clamp(requestedFontSize, .25, 260);
  let font = "";
  let lines: string[][] = [];
  let lineHeight = 0;

  // Reflow the complete cue after every shrink. This deliberately has no
  // maximum line/word count: even an unusually long phrase remains complete.
  for (let attempt = 0; attempt < 96; attempt += 1) {
    font = `${weight} ${fontSize.toFixed(2)}px "${fontFamily(family)}", Inter, Arial, sans-serif`;
    lines = wrapBackgroundAutoSubtitle(context, cueWords, font, fontSize, maxWidth);
    lineHeight = fontSize * 1.06;
    const widestLine = lines.reduce((widest, line) => Math.max(widest, measure(context, line.join(" "), font, fontSize * .56)), 0);
    if (widestLine <= maxWidth && lines.length * lineHeight <= maxHeight) break;
    fontSize *= .88;
  }
  return { font, fontSize, lines, lineHeight };
}

/** Draws one active cue. Returns false for inactive or empty cues. */
export function renderBackgroundAutoSubtitle(options: BackgroundAutoSubtitleRenderOptions): boolean {
  const { context, cue, settings, palette, centerX, centerY, radius, timeSeconds } = options;
  if (!(timeSeconds >= cue.startSeconds && timeSeconds < cue.endSeconds)) return false;
  const cueWords = words(cue.text);
  if (!cueWords.length || radius <= 0) return false;

  const style = styleForCue(cue, settings);
  const duration = Math.max(.04, cue.endSeconds - cue.startSeconds);
  const progress = clamp((timeSeconds - cue.startSeconds) / duration, 0, 1);
  const fadeIn = clamp(progress / .08, 0, 1);
  const fadeOut = clamp((1 - progress) / .24, 0, 1);
  const alpha = clamp((style.opacity ?? settings.opacity) * options.opacity * fadeIn * fadeOut, 0, 1);
  if (alpha <= .001) return false;

  const layout = fitBackgroundAutoSubtitle(context, cueWords, style.fontFamily, Number(style.fontSize) || settings.defaultFontSize, radius);
  const { font, fontSize, lines, lineHeight } = layout;
  const positionX = clamp(Number(style.positionX) || 50, 0, 100);
  const positionY = clamp(Number(style.positionY) || 50, 0, 100);
  const horizontalOffset = (positionX - 50) / 50 * radius * .2;
  const verticalOffset = (positionY - 50) / 50 * radius * .2;
  const baseY = centerY + radius * .42 + verticalOffset - progress * radius * .74;
  const cueOffset = hash(cue.id) % Math.max(1, palette.length);
  let wordIndex = 0;

  context.save();
  try {
    context.beginPath();
    context.arc(centerX, centerY, Math.max(1, radius * .92), 0, Math.PI * 2);
    if (typeof context.clip === "function") context.clip();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = font;
    context.globalAlpha = alpha;
    if (style.shadowEnabled) {
      context.shadowColor = style.shadowColor;
      context.shadowBlur = Math.max(1, radius * .045);
      context.shadowOffsetX = 0;
      context.shadowOffsetY = Math.max(1, radius * .022);
    }
    for (const [lineIndex, line] of lines.entries()) {
      const lineText = line.join(" ");
      const lineWidth = measure(context, lineText, font, fontSize * .56);
      let cursor = centerX + horizontalOffset - lineWidth / 2;
      for (const word of line) {
        const width = measure(context, word, font, fontSize * .56);
        const x = cursor + width / 2;
        const normalized = line.length <= 1 ? .5 : (x - (centerX + horizontalOffset)) / Math.max(1, lineWidth) + .5;
        const curveY = Math.sin(clamp(normalized, 0, 1) * Math.PI) * radius * .105;
        const y = baseY + (lineIndex - (lines.length - 1) / 2) * lineHeight - curveY;
        const rotation = -(.18 - normalized * .36) - progress * .12;
        // Background Auto always owns subtitle colour. Pro Subtitle word colour
        // overrides are intentionally remapped to the detected effect palette.
        const color = palette[(cueOffset + wordIndex) % Math.max(1, palette.length)] || palette[0] || "#ffffff";
        context.save();
        context.translate(x, y);
        context.rotate(rotation);
        context.fillStyle = color;
        context.fillText(word, 0, 0);
        context.restore();
        cursor += width + measure(context, " ", font, fontSize * .28);
        wordIndex += 1;
      }
    }
  } finally {
    context.restore();
  }
  return true;
}

/** Selects exactly one active cue with stable ordering independent of input
 * arrival order. The original index is the final tie-breaker for duplicate ids. */
export function activeBackgroundAutoSubtitleCue(cues: readonly BackgroundAutoSubtitleCue[], timeSeconds: number): BackgroundAutoSubtitleCue | null {
  return cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => timeSeconds >= cue.startSeconds && timeSeconds < cue.endSeconds)
    .sort((left, right) => (
      left.cue.startSeconds - right.cue.startSeconds
      || left.cue.endSeconds - right.cue.endSeconds
      || left.cue.id.localeCompare(right.cue.id)
      || left.index - right.index
    ))[0]?.cue ?? null;
}
