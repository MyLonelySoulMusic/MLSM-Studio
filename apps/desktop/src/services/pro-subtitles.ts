import type { RhythmBallProject } from "@rbs/project-schema";
import { subtitleFontWeight } from "./subtitle-fonts";

export type ProSubtitleCue = RhythmBallProject["subtitles"]["cues"][number];
export type ProSubtitleSettings = RhythmBallProject["animation"]["proSubtitles"];
export type ProSubtitleCueStyle = ProSubtitleSettings["cueStyles"][number];
export type ProSubtitleWordStyle = ProSubtitleCueStyle["wordStyles"][number];
export type ProSubtitleAnimation = ProSubtitleCueStyle["animation"];

export const PRO_SUBTITLE_ANIMATIONS = [
  "wordRush",
  "letterOrbit",
  "perspectiveFlip",
  "kineticStack",
  "maskReveal",
  "elasticScale",
  "trackingSweep",
  "cinematicDrift",
  "depthZoom",
  "letterCascade",
  "waveAssembly",
  "splitSlide",
  "radialBurst",
  "verticalRoll",
  "fullFrameOrbit",
  "editorialGrid",
  "focusCarousel"
] as const satisfies readonly ProSubtitleAnimation[];

export const proSubtitleAnimationOptions = [
  { id: "wordRush", label: "Ingresso d’impatto", detail: "Le parole attraversano la scena con entrate alternate e uscita fluida." },
  { id: "letterOrbit", label: "Orbita tipografica", detail: "I singoli caratteri orbitano e si ricompongono nella parola." },
  { id: "perspectiveFlip", label: "Flip prospettico", detail: "Rotazione prospettica pulita con profondità simulata." },
  { id: "kineticStack", label: "Stack cinetico", detail: "Le parole si impilano con movimento verticale ritmato." },
  { id: "maskReveal", label: "Rivelazione a maschera", detail: "Il testo emerge attraverso una maschera orizzontale precisa." },
  { id: "elasticScale", label: "Scala elastica", detail: "Ingresso elastico controllato, senza rimbalzi eccessivi." },
  { id: "trackingSweep", label: "Tracking dinamico", detail: "La spaziatura dei caratteri converge durante l’ingresso." },
  { id: "cinematicDrift", label: "Deriva cinematografica", detail: "Movimento lento, elegante e adatto alle frasi più lunghe." },
  { id: "depthZoom", label: "Zoom di profondità", detail: "La parola attraversa la scena su un asse prospettico e si ferma con precisione." },
  { id: "letterCascade", label: "Cascata di lettere", detail: "I caratteri entrano sfalsati, ruotano e si ricompongono senza perdere leggibilità." },
  { id: "waveAssembly", label: "Onda tipografica", detail: "Le lettere si assemblano lungo un’onda morbida e musicale." },
  { id: "splitSlide", label: "Split editoriale", detail: "Le due metà della parola scorrono da direzioni opposte e si saldano al centro." },
  { id: "radialBurst", label: "Esplosione radiale", detail: "I caratteri convergono da una composizione circolare con energia controllata." },
  { id: "verticalRoll", label: "Roll tridimensionale", detail: "Rotazione verticale simulata con passaggio prospettico a tutto schermo." },
  { id: "fullFrameOrbit", label: "Orbita full-frame", detail: "I glifi percorrono l’intero title-safe e si ricompongono senza uscire dal fotogramma." },
  { id: "editorialGrid", label: "Griglia editoriale", detail: "Le parole occupano la pagina in una composizione magazine ad alto impatto." },
  { id: "focusCarousel", label: "Parola protagonista", detail: "Una parola alla volta domina la scena mentre le altre costruiscono una cornice dinamica." }
] as const satisfies readonly { id: ProSubtitleAnimation; label: string; detail: string }[];

export interface ProSubtitleWordToken {
  index: number;
  text: string;
  breakBefore: boolean;
}

interface ParsedCue {
  startSeconds: number;
  endSeconds: number;
  text: string;
  sourceIndex: number;
}

export interface ProSubtitleWordLayout {
  index: number;
  text: string;
  lineIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  animation: ProSubtitleAnimation;
}

export interface ProSubtitleLineLayout {
  index: number;
  y: number;
  width: number;
  height: number;
  wordIndices: number[];
}

export interface ProSubtitleLayout {
  width: number;
  height: number;
  baseFontSize: number;
  safeRect: { x: number; y: number; width: number; height: number };
  bounds: { x: number; y: number; width: number; height: number };
  lines: ProSubtitleLineLayout[];
  words: ProSubtitleWordLayout[];
}

export interface ProSubtitleLayoutOptions {
  cue: Pick<ProSubtitleCue, "text"> & Partial<Pick<ProSubtitleCue, "startSeconds" | "endSeconds">>;
  style: ProSubtitleCueStyle;
  width: number;
  height: number;
  titleSafe: number;
  /**
   * Optional composition region used when two subtitle cues overlap. The
   * renderer intersects this region with the global title-safe rectangle.
   */
  region?: { x: number; y: number; width: number; height: number };
}

export interface ProSubtitleWordPose {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  tracking: number;
  reveal: number;
}

export interface ProSubtitleFrameTiming {
  /**
   * Absolute project time. When both values are supplied, `progress` wins.
   */
  timeSeconds?: number;
  /**
   * Normalized cue-local time, useful for thumbnails and deterministic export.
   */
  progress?: number;
  /**
   * Required only for context-like test/export targets that do not expose a canvas.
   */
  width?: number;
  height?: number;
  clear?: boolean;
  layoutRegion?: { x: number; y: number; width: number; height: number };
}

export interface ProSubtitleRenderResult {
  active: boolean;
  progress: number;
  layout: ProSubtitleLayout | null;
  renderedAnimation: ProSubtitleAnimation | null;
  paintBounds: ProSubtitlePaintBounds[];
}

export interface ProSubtitleResolvedShadow {
  enabled: boolean;
  color: string;
  paletteIndex: 0 | 1 | 2 | null;
}

export interface ProSubtitlePaintBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const minimumCueDuration = .04;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function unit(value: number): number {
  return clamp(value, 0, 1);
}

function smoothstep(value: number): number {
  const phase = unit(value);
  return phase * phase * (3 - 2 * phase);
}

function easeOutCubic(value: number): number {
  return 1 - (1 - unit(value)) ** 3;
}

function easeOutBack(value: number): number {
  const phase = unit(value);
  const overshoot = 1.70158;
  return 1 + (overshoot + 1) * (phase - 1) ** 3 + overshoot * (phase - 1) ** 2;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function timestampSeconds(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,3}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/.test(normalized)) return null;
  const pieces = normalized.split(":");
  const seconds = Number(pieces.at(-1));
  const minutes = Number(pieces.at(-2));
  const hours = pieces.length === 3 ? Number(pieces[0]) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite) || seconds < 0 || seconds >= 60 || minutes < 0 || pieces.length === 3 && minutes >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function timestampRange(line: string): { startSeconds: number; endSeconds: number } | null {
  const arrow = line.indexOf("-->");
  if (arrow < 0) return null;
  const left = line.slice(0, arrow).trim();
  const right = line.slice(arrow + 3).trim().split(/\s+/)[0] ?? "";
  const startSeconds = timestampSeconds(left);
  const endSeconds = timestampSeconds(right);
  if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) return null;
  return { startSeconds, endSeconds };
}

function decodeCueText(lines: readonly string[]): string {
  const joined = lines.join("\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/^\{\\an\d\}\s*/i, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#(?:39|x27);/gi, "'")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .join("\n")
    .trim();
  return [...joined].slice(0, 500).join("");
}

function scanTimedCues(serialized: string): ParsedCue[] {
  const source = serialized.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const parsed: ParsedCue[] = [];
  let lineIndex = 0;
  let sourceIndex = 0;

  if (/^\s*WEBVTT(?:[ \t].*)?$/i.test(lines[0] ?? "")) lineIndex = 1;

  while (lineIndex < lines.length) {
    const current = (lines[lineIndex] ?? "").trim();
    if (!current) {
      lineIndex += 1;
      continue;
    }
    if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/i.test(current)) {
      lineIndex += 1;
      while (lineIndex < lines.length && (lines[lineIndex] ?? "").trim()) lineIndex += 1;
      continue;
    }

    let timingIndex = lineIndex;
    let range = timestampRange(lines[timingIndex] ?? "");
    if (!range && lineIndex + 1 < lines.length) {
      timingIndex = lineIndex + 1;
      range = timestampRange(lines[timingIndex] ?? "");
    }
    if (!range) {
      lineIndex += 1;
      continue;
    }

    lineIndex = timingIndex + 1;
    const textLines: string[] = [];
    while (lineIndex < lines.length) {
      const candidate = lines[lineIndex] ?? "";
      if (!candidate.trim()) break;
      if (timestampRange(candidate)) break;
      if (lineIndex + 1 < lines.length && timestampRange(lines[lineIndex + 1] ?? "") && /^\s*(?:\d+|[A-Za-z][\w.-]*)\s*$/.test(candidate)) break;
      textLines.push(candidate);
      lineIndex += 1;
    }
    const text = decodeCueText(textLines);
    if (text) parsed.push({ ...range, text, sourceIndex: sourceIndex++ });
  }
  return parsed;
}

function uniqueCueId(cue: ParsedCue, index: number, used: Set<string>): string {
  const milliseconds = `${Math.round(cue.startSeconds * 1000)}:${Math.round(cue.endSeconds * 1000)}`;
  const base = `pro-subtitle-${String(index + 1).padStart(4, "0")}-${stableHash(`${milliseconds}:${cue.text}`).toString(36)}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

/**
 * Parses both SubRip and WebVTT into the common project cue shape.
 * Invalid blocks are ignored; a non-empty file with no valid cue is rejected.
 */
export function parseProSubtitleFile(serialized: string, durationSeconds?: number): ProSubtitleCue[] {
  if (!serialized.trim()) return [];
  const maximum = typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : Number.POSITIVE_INFINITY;
  const parsed = scanTimedCues(serialized).flatMap((cue) => {
    if (cue.endSeconds <= 0 || cue.startSeconds >= maximum) return [];
    const startSeconds = clamp(cue.startSeconds, 0, maximum);
    const endSeconds = clamp(cue.endSeconds, 0, maximum);
    if (endSeconds - startSeconds < minimumCueDuration) return [];
    return [{ ...cue, startSeconds, endSeconds }];
  }).sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds || left.sourceIndex - right.sourceIndex);

  if (!parsed.length) throw new Error("Il file non contiene sottotitoli SRT o WebVTT con timestamp validi.");
  const used = new Set<string>();
  return parsed.map((cue, index) => ({
    id: uniqueCueId(cue, index, used),
    startSeconds: cue.startSeconds,
    endSeconds: cue.endSeconds,
    text: cue.text,
    confidence: 1,
    verified: true,
    manual: true
  }));
}

export function tokenizeProSubtitleWords(text: string): ProSubtitleWordToken[] {
  const tokens: ProSubtitleWordToken[] = [];
  for (const [lineIndex, line] of text.replace(/\r\n?/g, "\n").split("\n").entries()) {
    const words = line.match(/\S+/gu) ?? [];
    for (const [wordIndex, word] of words.entries()) {
      tokens.push({ index: tokens.length, text: word, breakBefore: lineIndex > 0 && wordIndex === 0 });
    }
  }
  return tokens;
}

function validAnimation(value: unknown): value is ProSubtitleAnimation {
  return typeof value === "string" && (PRO_SUBTITLE_ANIMATIONS as readonly string[]).includes(value);
}

export function resolveProSubtitlePaletteColor(
  palette: readonly [string, string, string],
  cueIndex: number,
  wordIndex: number
): string {
  const pattern = [0, 1, 0, 2] as const;
  const paletteIndex = pattern[(wordIndex + cueIndex) % pattern.length] ?? 0;
  return palette[paletteIndex] || palette[0] || "#ffffff";
}

export function deterministicProSubtitleAnimation(index: number, seed = "ProSubtitles"): ProSubtitleAnimation {
  const offset = stableHash(seed) % PRO_SUBTITLE_ANIMATIONS.length;
  const stride = 5;
  return PRO_SUBTITLE_ANIMATIONS[(offset + Math.max(0, Math.floor(index)) * stride) % PRO_SUBTITLE_ANIMATIONS.length]!;
}

const IMPACT_ANIMATIONS = [
  "wordRush", "depthZoom", "elasticScale", "splitSlide", "radialBurst"
] as const satisfies readonly ProSubtitleAnimation[];
const CHARACTER_ANIMATIONS = [
  "letterOrbit", "letterCascade", "waveAssembly", "trackingSweep", "radialBurst"
] as const satisfies readonly ProSubtitleAnimation[];
const STRUCTURED_ANIMATIONS = [
  "kineticStack", "maskReveal", "perspectiveFlip", "splitSlide", "verticalRoll"
] as const satisfies readonly ProSubtitleAnimation[];
const CINEMATIC_ANIMATIONS = [
  "cinematicDrift", "maskReveal", "trackingSweep", "waveAssembly", "perspectiveFlip"
] as const satisfies readonly ProSubtitleAnimation[];
const FULL_FRAME_ANIMATIONS = [
  "fullFrameOrbit", "editorialGrid", "focusCarousel"
] as const satisfies readonly ProSubtitleAnimation[];

function fullFrameAnimationCandidates(
  cue: Pick<ProSubtitleCue, "text" | "startSeconds" | "endSeconds">
): ProSubtitleAnimation[] {
  const words = tokenizeProSubtitleWords(cue.text);
  const glyphCount = [...cue.text.replace(/\s/gu, "")].length;
  const duration = Math.max(minimumCueDuration, cue.endSeconds - cue.startSeconds);
  const charactersPerSecond = glyphCount / duration;
  if (!words.length || words.length > 6 || charactersPerSecond > 16.5 || duration < .62) return [];
  const candidates: ProSubtitleAnimation[] = [];
  if (words.length <= 4 && glyphCount <= 30) candidates.push("fullFrameOrbit");
  if (words.length >= 2 && words.length <= 6 && glyphCount <= 58) candidates.push("editorialGrid");
  if (words.length <= 5 && glyphCount <= 50) candidates.push("focusCarousel");
  return candidates;
}

function resolveFullFrameAnimation(
  requested: ProSubtitleAnimation,
  cue: Pick<ProSubtitleCue, "text"> & Partial<Pick<ProSubtitleCue, "startSeconds" | "endSeconds">>
): ProSubtitleAnimation {
  if (!(FULL_FRAME_ANIMATIONS as readonly string[]).includes(requested)) return requested;
  const completeCue = {
    text: cue.text,
    startSeconds: cue.startSeconds ?? 0,
    endSeconds: cue.endSeconds ?? 2
  };
  if (fullFrameAnimationCandidates(completeCue).includes(requested)) return requested;
  return stableHash(`${requested}:${cue.text}`) % 2 === 0 ? "trackingSweep" : "cinematicDrift";
}

function pickDirectedAnimation(
  pool: readonly ProSubtitleAnimation[],
  cue: Pick<ProSubtitleCue, "id" | "text" | "startSeconds" | "endSeconds">,
  cueIndex: number,
  previous?: ProSubtitleAnimation
): ProSubtitleAnimation {
  const seed = stableHash(`${cue.id}:${cue.text}:${Math.round(cue.startSeconds * 1000)}:${cueIndex}`);
  let position = seed % pool.length;
  if (pool[position] === previous && pool.length > 1) position = (position + 1) % pool.length;
  return pool[position]!;
}

/**
 * Automatic motion director. It uses reading time, phrase length, punctuation
 * and explicit line breaks to choose an animation family, then makes a stable
 * deterministic choice inside that family. This keeps repeated previews and
 * exports identical while avoiding the mechanical "preset carousel" effect.
 */
export function directProSubtitleAnimation(
  cue: Pick<ProSubtitleCue, "id" | "text" | "startSeconds" | "endSeconds">,
  cueIndex: number,
  previous?: ProSubtitleAnimation
): ProSubtitleAnimation {
  const words = tokenizeProSubtitleWords(cue.text);
  const duration = Math.max(minimumCueDuration, cue.endSeconds - cue.startSeconds);
  const charactersPerSecond = cue.text.replace(/\s/gu, "").length / duration;
  const emphatic = /[!?…]\s*$/u.test(cue.text) || words.some((word) => (
    word.text.length >= 3 && word.text === word.text.toLocaleUpperCase()
  ));
  const fullFrameCandidates = fullFrameAnimationCandidates(cue);
  const directionSeed = stableHash(`${cue.id}:${cue.text}:${cueIndex}`);

  if (fullFrameCandidates.length && (emphatic || directionSeed % 4 === 0)) {
    return pickDirectedAnimation(fullFrameCandidates, cue, cueIndex, previous);
  }

  if (words.length <= 2 || duration <= .9 || charactersPerSecond >= 18) {
    return pickDirectedAnimation(IMPACT_ANIMATIONS, cue, cueIndex, previous);
  }
  if (words.length >= 9 || duration >= 3.4 || charactersPerSecond <= 5.5) {
    return pickDirectedAnimation(CINEMATIC_ANIMATIONS, cue, cueIndex, previous);
  }
  if (cue.text.includes("\n")) {
    return pickDirectedAnimation(STRUCTURED_ANIMATIONS, cue, cueIndex, previous);
  }
  if (emphatic) {
    return pickDirectedAnimation(
      cueIndex % 2 === 0 ? IMPACT_ANIMATIONS : CHARACTER_ANIMATIONS,
      cue,
      cueIndex,
      previous
    );
  }
  const family = [CHARACTER_ANIMATIONS, STRUCTURED_ANIMATIONS, CINEMATIC_ANIMATIONS, IMPACT_ANIMATIONS][cueIndex % 4]!;
  return pickDirectedAnimation(family, cue, cueIndex, previous);
}

function emphasisWordIndex(tokens: readonly ProSubtitleWordToken[]): number {
  if (!tokens.length) return -1;
  let winner = tokens.length - 1;
  let score = -Infinity;
  for (const token of tokens) {
    const stripped = token.text.replace(/[^\p{L}\p{N}]/gu, "");
    const uppercase = stripped.length >= 3 && stripped === stripped.toLocaleUpperCase();
    const current = stripped.length + (uppercase ? 5 : 0) + (/[!?…]$/u.test(token.text) ? 3 : 0);
    if (current >= score) {
      score = current;
      winner = token.index;
    }
  }
  return winner;
}

/**
 * Reconciles styles by visible-word index. Removed words drop their styles,
 * existing indices retain manual overrides, and newly added words receive the palette.
 */
export function reconcileProSubtitleWordStyles(
  text: string,
  styles: readonly ProSubtitleWordStyle[],
  palette: readonly [string, string, string],
  cueIndex = 0
): ProSubtitleWordStyle[] {
  const count = tokenizeProSubtitleWords(text).length;
  const byIndex = new Map<number, ProSubtitleWordStyle>();
  for (const style of styles) {
    const index = Math.floor(Number(style.index));
    if (Number.isFinite(index) && index >= 0 && index < count) byIndex.set(index, style);
  }
  return Array.from({ length: count }, (_, index) => {
    const source = byIndex.get(index);
    const sourceScale = source?.fontSizeScale;
    return {
      index,
      color: source?.color.trim() || resolveProSubtitlePaletteColor(palette, cueIndex, index),
      fontSizeScale: clamp(typeof sourceScale === "number" && Number.isFinite(sourceScale) ? sourceScale : 1, .45, 2.2),
      animation: validAnimation(source?.animation) ? source.animation : null
    };
  });
}

export function resolveProSubtitleCueStyle(cue: ProSubtitleCue, settings: ProSubtitleSettings, cueIndex = 0): ProSubtitleCueStyle {
  const source = settings.cueStyles.find((style) => style.cueId === cue.id);
  const animation = source && validAnimation(source.animation)
    ? source.animation
    : settings.autoVaryAnimations
      ? directProSubtitleAnimation(cue, cueIndex)
      : settings.defaultAnimation;
  const fontFamilyAutomatic = source?.fontFamilyAutomatic !== false;
  const fontSizeAutomatic = source?.fontSizeAutomatic !== false;
  const positionAutomatic = source?.positionAutomatic !== false;
  const opacityAutomatic = source?.opacityAutomatic !== false;
  const fontFamily = fontFamilyAutomatic
    ? settings.defaultFontFamily
    : source?.fontFamily.trim() || settings.defaultFontFamily;
  const sourceFontSize = fontSizeAutomatic ? settings.defaultFontSize : source?.fontSize;
  const sourcePositionX = positionAutomatic ? settings.positionX : source?.positionX;
  const sourcePositionY = positionAutomatic ? settings.positionY : source?.positionY;
  const sourceOpacity = opacityAutomatic ? settings.opacity : source?.opacity;
  return {
    cueId: cue.id,
    animation,
    animationAutomatic: source?.animationAutomatic ?? true,
    fontFamily,
    fontFamilyAutomatic,
    fontSize: Math.round(clamp(typeof sourceFontSize === "number" && Number.isFinite(sourceFontSize) ? sourceFontSize : settings.defaultFontSize, 24, 260)),
    fontSizeAutomatic,
    positionX: clamp(typeof sourcePositionX === "number" && Number.isFinite(sourcePositionX) ? sourcePositionX : settings.positionX, 0, 100),
    positionY: clamp(typeof sourcePositionY === "number" && Number.isFinite(sourcePositionY) ? sourcePositionY : settings.positionY, 0, 100),
    positionAutomatic,
    opacity: clamp(typeof sourceOpacity === "number" && Number.isFinite(sourceOpacity) ? sourceOpacity : settings.opacity, 0, 1),
    opacityAutomatic,
    shadowEnabled: source?.shadowEnabled ?? settings.shadowEnabled,
    shadowColor: source?.shadowColor.trim() || settings.shadowColor,
    wordStyles: reconcileProSubtitleWordStyles(cue.text, source?.wordStyles ?? [], settings.palette, cueIndex)
  };
}

export function assignProSubtitleCueStyles(
  cues: readonly ProSubtitleCue[],
  settings: ProSubtitleSettings,
  existingStyles: readonly ProSubtitleCueStyle[] = settings.cueStyles
): ProSubtitleCueStyle[] {
  const mergedSettings: ProSubtitleSettings = { ...settings, cueStyles: [...existingStyles] };
  let previous: ProSubtitleAnimation | undefined;
  return cues.map((cue, index) => {
    const source = existingStyles.find((style) => style.cueId === cue.id);
    const resolved = resolveProSubtitleCueStyle(cue, mergedSettings, index);
    const animation = settings.autoVaryAnimations && (!source || source.animationAutomatic)
      ? directProSubtitleAnimation(cue, index, previous)
      : resolved.animation;
    const tokens = tokenizeProSubtitleWords(cue.text);
    const emphasisIndex = source ? -1 : emphasisWordIndex(tokens);
    const wordStyles = resolved.wordStyles.map((wordStyle) => (
      wordStyle.index !== emphasisIndex
        ? wordStyle
        : {
            ...wordStyle,
            color: settings.palette[2],
            fontSizeScale: Math.max(wordStyle.fontSizeScale, tokens.length <= 2 ? 1.28 : 1.16)
          }
    ));
    previous = animation;
    return { ...resolved, animation, wordStyles };
  });
}

/**
 * Changes the automatic direction without rebuilding cue styles. Manual cue
 * animations and every typography/word override remain untouched.
 */
export function retargetProSubtitleAutomaticAnimations(
  cues: readonly ProSubtitleCue[],
  settings: ProSubtitleSettings,
  autoVaryAnimations: boolean
): ProSubtitleCueStyle[] {
  let previous: ProSubtitleAnimation | undefined;
  return cues.map((cue, index) => {
    const style = resolveProSubtitleCueStyle(cue, settings, index);
    if (!style.animationAutomatic) {
      previous = style.animation;
      return style;
    }
    const animation = autoVaryAnimations
      ? directProSubtitleAnimation(cue, index, previous)
      : settings.defaultAnimation;
    previous = animation;
    return {
      ...style,
      animation
    };
  });
}

/**
 * Resolves a word shadow against the three palette slots. A word using the
 * exact color of a palette slot inherits that slot's shadow toggle and color;
 * manually colored words fall back to their cue-level shadow.
 */
export function resolveProSubtitleWordShadow(
  wordColor: string,
  style: Pick<ProSubtitleCueStyle, "shadowEnabled" | "shadowColor">,
  settings: Pick<ProSubtitleSettings, "palette" | "paletteShadowEnabled" | "paletteShadowColors">
): ProSubtitleResolvedShadow {
  const normalizedColor = wordColor.trim().toLowerCase();
  const matchedIndex = settings.palette.findIndex((color) => (
    Boolean(normalizedColor) && color.trim().toLowerCase() === normalizedColor
  ));
  if (matchedIndex >= 0 && matchedIndex <= 2) {
    const paletteIndex = matchedIndex as 0 | 1 | 2;
    return {
      enabled: settings.paletteShadowEnabled[paletteIndex],
      color: settings.paletteShadowColors[paletteIndex].trim() || style.shadowColor,
      paletteIndex
    };
  }
  return {
    enabled: style.shadowEnabled,
    color: style.shadowColor,
    paletteIndex: null
  };
}

interface MeasuredWord {
  token: ProSubtitleWordToken;
  style: ProSubtitleWordStyle;
  animation: ProSubtitleAnimation;
  width: number;
  height: number;
  fontSize: number;
  gapBefore: number;
}

interface MeasuredLine {
  words: MeasuredWord[];
  width: number;
  height: number;
}

function safeFontFamily(value: string): string {
  return value.replace(/["\\\n\r]/g, "").trim() || "sans-serif";
}

function fontDeclaration(fontFamily: string, fontSize: number): string {
  return `${subtitleFontWeight(fontFamily)} ${Math.max(1, fontSize).toFixed(2)}px "${safeFontFamily(fontFamily)}", Inter, Arial, sans-serif`;
}

function measureLines(
  context: CanvasRenderingContext2D,
  tokens: readonly ProSubtitleWordToken[],
  style: ProSubtitleCueStyle,
  safeWidth: number,
  baseFontSize: number
): MeasuredLine[] {
  const styleByIndex = new Map(style.wordStyles.map((wordStyle) => [wordStyle.index, wordStyle]));
  const lines: MeasuredLine[] = [];
  let line: MeasuredLine = { words: [], width: 0, height: 0 };
  const finishLine = () => {
    if (line.words.length) lines.push(line);
    line = { words: [], width: 0, height: 0 };
  };

  for (const token of tokens) {
    const wordStyle = styleByIndex.get(token.index) ?? { index: token.index, color: "#ffffff", fontSizeScale: 1, animation: null };
    const fontSize = baseFontSize * clamp(wordStyle.fontSizeScale, .45, 2.2);
    context.font = fontDeclaration(style.fontFamily, fontSize);
    const width = Math.max(1, context.measureText(token.text).width);
    const height = fontSize * 1.16;
    const gap = line.words.length ? baseFontSize * .26 : 0;
    if (token.breakBefore && line.words.length || line.words.length && line.width + gap + width > safeWidth) finishLine();
    const gapBefore = line.words.length ? baseFontSize * .26 : 0;
    const measured: MeasuredWord = {
      token,
      style: wordStyle,
      animation: wordStyle.animation ?? style.animation,
      width,
      height,
      fontSize,
      gapBefore
    };
    line.words.push(measured);
    line.width += gapBefore + width;
    line.height = Math.max(line.height, height);
  }
  finishLine();
  return lines;
}

function measuredHeight(lines: readonly MeasuredLine[], baseFontSize: number): number {
  if (!lines.length) return 0;
  return lines.reduce((sum, line) => sum + line.height, 0) + (lines.length - 1) * baseFontSize * .18;
}

/**
 * Produces a centered, title-safe multi-line layout. The requested font size is
 * preserved when possible and reduced only enough to fit the complete phrase.
 */
export function layoutProSubtitleCue(context: CanvasRenderingContext2D, options: ProSubtitleLayoutOptions): ProSubtitleLayout {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const titleSafe = clamp(options.titleSafe, .02, .3);
  const marginX = width * titleSafe;
  const marginY = height * titleSafe;
  const globalSafeRect = {
    x: marginX,
    y: marginY,
    width: Math.max(1, width - marginX * 2),
    height: Math.max(1, height - marginY * 2)
  };
  const requestedRegion = options.region;
  const regionLeft = requestedRegion ? clamp(requestedRegion.x, globalSafeRect.x, globalSafeRect.x + globalSafeRect.width) : globalSafeRect.x;
  const regionTop = requestedRegion ? clamp(requestedRegion.y, globalSafeRect.y, globalSafeRect.y + globalSafeRect.height) : globalSafeRect.y;
  const regionRight = requestedRegion
    ? clamp(requestedRegion.x + Math.max(1, requestedRegion.width), regionLeft, globalSafeRect.x + globalSafeRect.width)
    : globalSafeRect.x + globalSafeRect.width;
  const regionBottom = requestedRegion
    ? clamp(requestedRegion.y + Math.max(1, requestedRegion.height), regionTop, globalSafeRect.y + globalSafeRect.height)
    : globalSafeRect.y + globalSafeRect.height;
  const safeRect = {
    x: regionLeft,
    y: regionTop,
    width: Math.max(1, regionRight - regionLeft),
    height: Math.max(1, regionBottom - regionTop)
  };
  const tokens = tokenizeProSubtitleWords(options.cue.text);
  const resolutionScale = Math.min(width, height) / 1080;
  const requestedFontSize = clamp(options.style.fontSize, 6, 260) * resolutionScale;
  if (!tokens.length) return { width, height, baseFontSize: requestedFontSize, safeRect, bounds: { x: width / 2, y: height / 2, width: 0, height: 0 }, lines: [], words: [] };

  context.save();
  // Canvas shadows extend beyond the measured glyph box. Reserving this space
  // up-front prevents a title that technically fits from losing its glow at
  // the edge in either the WebGL preview texture or an alpha export.
  const shadowReserve = Math.min(
    safeRect.width * .08,
    safeRect.height * .08,
    Math.max(2, requestedFontSize * .34)
  );
  const contentRect = {
    x: safeRect.x + shadowReserve,
    y: safeRect.y + shadowReserve,
    width: Math.max(1, safeRect.width - shadowReserve * 2),
    height: Math.max(1, safeRect.height - shadowReserve * 2)
  };
  let baseFontSize = requestedFontSize;
  let measured = measureLines(context, tokens, options.style, contentRect.width, baseFontSize);
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const maximumLineWidth = Math.max(0, ...measured.map((line) => line.width));
    const totalHeight = measuredHeight(measured, baseFontSize);
    const ratio = Math.min(1, contentRect.width / Math.max(1, maximumLineWidth), contentRect.height / Math.max(1, totalHeight));
    if (ratio >= .995) break;
    baseFontSize = Math.max(.5, baseFontSize * Math.max(.25, ratio) * .975);
    measured = measureLines(context, tokens, options.style, contentRect.width, baseFontSize);
  }

  const totalHeight = measuredHeight(measured, baseFontSize);
  let cursorY = contentRect.y + (contentRect.height - totalHeight) / 2;
  const words: ProSubtitleWordLayout[] = [];
  const lines: ProSubtitleLineLayout[] = [];

  for (const [lineIndex, line] of measured.entries()) {
    const lineCenterY = cursorY + line.height / 2;
    let cursorX = contentRect.x + (contentRect.width - line.width) / 2;
    const wordIndices: number[] = [];
    for (const word of line.words) {
      cursorX += word.gapBefore;
      const x = cursorX + word.width / 2;
      words.push({
        index: word.token.index,
        text: word.token.text,
        lineIndex,
        x,
        y: lineCenterY,
        width: word.width,
        height: word.height,
        fontSize: word.fontSize,
        color: word.style.color,
        animation: word.animation
      });
      wordIndices.push(word.token.index);
      cursorX += word.width;
    }
    lines.push({ index: lineIndex, y: lineCenterY, width: line.width, height: line.height, wordIndices });
    cursorY += line.height + baseFontSize * .18;
  }

  let left = words.length ? Math.min(...words.map((word) => word.x - word.width / 2)) : width / 2;
  let right = words.length ? Math.max(...words.map((word) => word.x + word.width / 2)) : width / 2;
  let top = words.length ? Math.min(...words.map((word) => word.y - word.height / 2)) : height / 2;
  let bottom = words.length ? Math.max(...words.map((word) => word.y + word.height / 2)) : height / 2;
  const desiredCenterX = contentRect.x + contentRect.width * clamp(options.style.positionX, 0, 100) / 100;
  const desiredCenterY = contentRect.y + contentRect.height * clamp(options.style.positionY, 0, 100) / 100;
  const desiredOffsetX = desiredCenterX - (left + right) / 2;
  const desiredOffsetY = desiredCenterY - (top + bottom) / 2;
  const offsetX = clamp(desiredOffsetX, contentRect.x - left, contentRect.x + contentRect.width - right);
  const offsetY = clamp(desiredOffsetY, contentRect.y - top, contentRect.y + contentRect.height - bottom);
  for (const word of words) {
    word.x += offsetX;
    word.y += offsetY;
  }
  for (const line of lines) line.y += offsetY;
  left += offsetX;
  right += offsetX;
  top += offsetY;
  bottom += offsetY;
  context.restore();
  return { width, height, baseFontSize, safeRect, bounds: { x: left, y: top, width: right - left, height: bottom - top }, lines, words };
}

/**
 * Resolves the motion envelope independently from Canvas, making preview and
 * offline export use exactly the same deterministic animation.
 */
export function resolveProSubtitleWordPose(
  animation: ProSubtitleAnimation,
  progress: number,
  wordIndex: number,
  wordCount: number,
  viewportWidth: number,
  viewportHeight: number,
  fontSize = 100
): ProSubtitleWordPose {
  const phase = unit(progress);
  const count = Math.max(1, wordCount);
  const normalizedIndex = clamp(wordIndex, 0, count - 1) / count;
  const enterDelay = normalizedIndex * .11;
  const exitDelay = (1 - normalizedIndex) * .045;
  const enterLinear = unit((phase - enterDelay) / .2);
  const exitLinear = unit((1 - phase - exitDelay) / .16);
  const enter = easeOutCubic(enterLinear);
  const exit = smoothstep(exitLinear);
  const opacity = unit(Math.min(enterLinear * 1.8, exitLinear * 1.7));
  const direction = wordIndex % 2 === 0 ? -1 : 1;
  const leaving = 1 - exit;

  if (animation === "wordRush") return {
    x: direction * (1 - enter) * viewportWidth * .72 - direction * leaving * viewportWidth * .34,
    y: direction * (1 - enter) * fontSize * .18,
    scaleX: .82 + enter * .18,
    scaleY: .94 + enter * .06,
    rotation: direction * (1 - enter) * .12,
    opacity,
    tracking: 0,
    reveal: Math.min(enter, exit)
  };
  if (animation === "letterOrbit") return {
    x: -direction * leaving * viewportWidth * .18,
    y: -leaving * viewportHeight * .08,
    scaleX: 1,
    scaleY: 1,
    rotation: direction * leaving * .08,
    opacity,
    tracking: 0,
    reveal: Math.min(enter, exit)
  };
  if (animation === "perspectiveFlip") {
    const flip = Math.max(.035, Math.abs(Math.cos((1 - enter) * Math.PI / 2 + leaving * Math.PI / 2)));
    return {
      x: direction * (1 - enter) * fontSize * .55,
      y: (1 - enter) * fontSize * .24,
      scaleX: flip,
      scaleY: .76 + enter * .24,
      rotation: direction * (1 - enter) * .08,
      opacity,
      tracking: 0,
      reveal: Math.min(enter, exit)
    };
  }
  if (animation === "kineticStack") return {
    x: direction * (1 - enter) * viewportWidth * .09,
    y: direction * (1 - enter) * viewportHeight * .26 + leaving * viewportHeight * .12,
    scaleX: .9 + enter * .1,
    scaleY: .9 + enter * .1,
    rotation: direction * (1 - enter) * .06,
    opacity,
    tracking: 0,
    reveal: Math.min(enter, exit)
  };
  if (animation === "maskReveal") return {
    x: leaving * direction * fontSize * .4,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: exit,
    tracking: 0,
    reveal: Math.min(enter, exit)
  };
  if (animation === "elasticScale") {
    const elastic = Math.max(.08, easeOutBack(enterLinear));
    return {
      x: 0,
      y: (1 - enter) * fontSize * .18 - leaving * fontSize * .16,
      scaleX: elastic * (.82 + exit * .18),
      scaleY: elastic * (.82 + exit * .18),
      rotation: direction * (1 - enter) * .045,
      opacity,
      tracking: 0,
      reveal: Math.min(enter, exit)
    };
  }
  if (animation === "trackingSweep") return {
    x: direction * (1 - enter) * viewportWidth * .14 - direction * leaving * viewportWidth * .08,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity,
    tracking: (1 - enter) * fontSize * .42 + leaving * fontSize * .18,
    reveal: Math.min(enter, exit)
  };
  if (animation === "depthZoom") {
    const depthScale = 1 + (1 - enter) * 2.4 + leaving * 1.65;
    return {
      x: direction * (1 - enter) * fontSize * .34 - direction * leaving * viewportWidth * .035,
      y: (1 - enter) * fontSize * .2 - leaving * fontSize * .12,
      scaleX: depthScale,
      scaleY: depthScale,
      rotation: direction * (1 - enter) * .035,
      opacity: unit(opacity * (enterLinear < .12 ? enterLinear / .12 : 1)),
      tracking: 0,
      reveal: Math.min(enter, exit)
    };
  }
  if (animation === "letterCascade" || animation === "waveAssembly" || animation === "radialBurst") return {
    x: -direction * leaving * viewportWidth * .08,
    y: leaving * direction * fontSize * .2,
    scaleX: 1,
    scaleY: 1,
    rotation: direction * leaving * .025,
    opacity,
    tracking: 0,
    reveal: Math.min(enter, exit)
  };
  if (animation === "splitSlide") return {
    x: 0,
    y: leaving * direction * fontSize * .14,
    scaleX: .96 + enter * .04,
    scaleY: .96 + enter * .04,
    rotation: 0,
    opacity,
    tracking: 0,
    reveal: Math.min(enter, exit)
  };
  if (animation === "verticalRoll") {
    const rollScale = Math.max(.045, Math.abs(Math.cos((1 - enter) * Math.PI / 2 + leaving * Math.PI / 2)));
    return {
      x: direction * (1 - enter) * fontSize * .18,
      y: direction * (1 - enter) * viewportHeight * .2 - leaving * direction * viewportHeight * .1,
      scaleX: .9 + enter * .1,
      scaleY: rollScale,
      rotation: direction * (1 - enter) * .025,
      opacity,
      tracking: 0,
      reveal: Math.min(enter, exit)
    };
  }
  if ((FULL_FRAME_ANIMATIONS as readonly string[]).includes(animation)) return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity,
    tracking: 0,
    reveal: Math.min(enter, exit)
  };
  return {
    x: (1 - enter) * viewportWidth * .08 - leaving * viewportWidth * .05,
    y: (1 - enter) * fontSize * .42 + (phase - .5) * fontSize * .08 - leaving * fontSize * .28,
    scaleX: .94 + enter * .06,
    scaleY: .94 + enter * .06,
    rotation: direction * (1 - enter) * .018,
    opacity,
    tracking: 0,
    reveal: Math.min(enter, exit)
  };
}

function applyWordPaint(
  context: CanvasRenderingContext2D,
  word: ProSubtitleWordLayout,
  style: ProSubtitleCueStyle,
  settings: ProSubtitleSettings,
  opacity: number
): void {
  const shadow = resolveProSubtitleWordShadow(word.color, style, settings);
  context.globalAlpha *= unit(opacity);
  context.font = fontDeclaration(style.fontFamily, word.fontSize);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = word.color;
  context.shadowColor = shadow.enabled ? shadow.color : "rgba(0,0,0,0)";
  context.shadowBlur = shadow.enabled ? Math.max(4, word.fontSize * .14) : 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = shadow.enabled ? Math.max(2, word.fontSize * .055) : 0;
}

interface SafeTextPlacement {
  word: ProSubtitleWordLayout;
  x: number;
  y: number;
  rotation: number;
  bounds: ProSubtitlePaintBounds;
}

function shadowPaintPadding(
  word: ProSubtitleWordLayout,
  style: ProSubtitleCueStyle,
  settings: ProSubtitleSettings
): { x: number; top: number; bottom: number } {
  const shadow = resolveProSubtitleWordShadow(word.color, style, settings);
  if (!shadow.enabled) return { x: 1, top: 1, bottom: 1 };
  const blurReach = Math.max(4, word.fontSize * .14) * 2;
  const offsetY = Math.max(2, word.fontSize * .055);
  return { x: blurReach + 1, top: blurReach + 1, bottom: blurReach + offsetY + 1 };
}

function rotatedHalfExtents(word: ProSubtitleWordLayout, rotation: number): { x: number; y: number } {
  const cosine = Math.abs(Math.cos(rotation));
  const sine = Math.abs(Math.sin(rotation));
  return {
    x: cosine * word.width / 2 + sine * word.height / 2,
    y: sine * word.width / 2 + cosine * word.height / 2
  };
}

function scaledDisplayWord(word: ProSubtitleWordLayout, scale: number, text = word.text, width = word.width): ProSubtitleWordLayout {
  const safeScale = Math.max(.02, scale);
  return {
    ...word,
    text,
    width: width * safeScale,
    height: word.height * safeScale,
    fontSize: word.fontSize * safeScale
  };
}

/**
 * Fits and clamps a transformed word against the title-safe rectangle,
 * including the effective Canvas shadow. The function deliberately changes
 * the font size rather than applying a Canvas scale so preview and export have
 * identical glyph metrics and glow reach.
 */
function constrainSafeTextPlacement(
  word: ProSubtitleWordLayout,
  desiredX: number,
  desiredY: number,
  desiredScale: number,
  rotation: number,
  safeRect: ProSubtitleLayout["safeRect"],
  style: ProSubtitleCueStyle,
  settings: ProSubtitleSettings,
  text = word.text,
  sourceWidth = word.width
): SafeTextPlacement {
  let displayWord = scaledDisplayWord(word, desiredScale, text, sourceWidth);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const half = rotatedHalfExtents(displayWord, rotation);
    const padding = shadowPaintPadding(displayWord, style, settings);
    const availableWidth = Math.max(1, safeRect.width - padding.x * 2);
    const availableHeight = Math.max(1, safeRect.height - padding.top - padding.bottom);
    const fit = Math.min(1, availableWidth / Math.max(1, half.x * 2), availableHeight / Math.max(1, half.y * 2));
    if (fit >= .999) break;
    displayWord = scaledDisplayWord(displayWord, fit, text, displayWord.width);
  }
  const half = rotatedHalfExtents(displayWord, rotation);
  const padding = shadowPaintPadding(displayWord, style, settings);
  const left = safeRect.x + half.x + padding.x;
  const right = safeRect.x + safeRect.width - half.x - padding.x;
  const top = safeRect.y + half.y + padding.top;
  const bottom = safeRect.y + safeRect.height - half.y - padding.bottom;
  const x = left <= right ? clamp(desiredX, left, right) : safeRect.x + safeRect.width / 2;
  const y = top <= bottom ? clamp(desiredY, top, bottom) : safeRect.y + safeRect.height / 2;
  return {
    word: displayWord,
    x,
    y,
    rotation,
    bounds: {
      x: x - half.x - padding.x,
      y: y - half.y - padding.top,
      width: half.x * 2 + padding.x * 2,
      height: half.y * 2 + padding.top + padding.bottom
    }
  };
}

function paintSafeText(
  context: CanvasRenderingContext2D,
  placement: SafeTextPlacement,
  style: ProSubtitleCueStyle,
  settings: ProSubtitleSettings,
  opacity: number
): ProSubtitlePaintBounds {
  context.save();
  context.translate(placement.x, placement.y);
  context.rotate(placement.rotation);
  applyWordPaint(context, placement.word, style, settings, opacity * style.opacity);
  context.fillText(placement.word.text, 0, 0);
  context.restore();
  return placement.bounds;
}

function glyphMetrics(context: CanvasRenderingContext2D, text: string): { glyph: string; width: number }[] {
  return [...text].map((glyph) => ({ glyph, width: Math.max(.5, context.measureText(glyph).width) }));
}

function fullFrameOpacity(progress: number): number {
  return unit(Math.min(progress / .075, (1 - progress) / .1));
}

function drawFullFrameOrbit(
  context: CanvasRenderingContext2D,
  layout: ProSubtitleLayout,
  style: ProSubtitleCueStyle,
  settings: ProSubtitleSettings,
  progress: number
): ProSubtitlePaintBounds[] {
  const glyphWords = layout.words.flatMap((word) => {
    context.save();
    context.font = fontDeclaration(style.fontFamily, word.fontSize);
    const glyphs = glyphMetrics(context, word.text);
    context.restore();
    const totalWidth = glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
    let cursorX = word.x - totalWidth / 2;
    return glyphs.map((glyph) => {
      const result = { word, glyph: glyph.glyph, width: glyph.width, finalX: cursorX + glyph.width / 2 };
      cursorX += glyph.width;
      return result;
    });
  });
  const count = Math.max(1, glyphWords.length);
  const safe = layout.safeRect;
  const orbitCenterX = safe.x + safe.width * (.5 + (style.positionX - 50) * .0012);
  const orbitCenterY = safe.y + safe.height * (.5 + (style.positionY - 50) * .0012);
  const settleIn = smoothstep(unit((progress - .18) / .34));
  const settleOut = smoothstep(unit((1 - progress) / .2));
  const settle = Math.min(settleIn, settleOut);
  const opacity = fullFrameOpacity(progress);
  const bounds: ProSubtitlePaintBounds[] = [];

  for (const [glyphIndex, glyphWord] of glyphWords.entries()) {
    const angle = glyphIndex / count * Math.PI * 2
      + (stableHash(`${glyphWord.word.index}:${glyphWord.glyph}`) % 1000) / 1000 * .22
      + progress * .48;
    const orbitX = orbitCenterX + Math.cos(angle) * safe.width * .445;
    const orbitY = orbitCenterY + Math.sin(angle) * safe.height * .425;
    const x = orbitX + (glyphWord.finalX - orbitX) * settle;
    const y = orbitY + (glyphWord.word.y - orbitY) * settle;
    const rotation = Math.sin(angle) * (1 - settle) * .28;
    const placement = constrainSafeTextPlacement(
      glyphWord.word,
      x,
      y,
      1 + (1 - settle) * .14,
      rotation,
      safe,
      style,
      settings,
      glyphWord.glyph,
      glyphWord.width
    );
    bounds.push(paintSafeText(context, placement, style, settings, opacity));
  }
  return bounds;
}

function editorialGridColumns(wordCount: number, safeRect: ProSubtitleLayout["safeRect"]): number {
  if (safeRect.width < safeRect.height * .78) return wordCount >= 4 ? 2 : 1;
  return Math.min(3, Math.max(1, Math.ceil(Math.sqrt(wordCount * safeRect.width / safeRect.height))));
}

function drawEditorialGrid(
  context: CanvasRenderingContext2D,
  layout: ProSubtitleLayout,
  style: ProSubtitleCueStyle,
  settings: ProSubtitleSettings,
  progress: number
): ProSubtitlePaintBounds[] {
  const safe = layout.safeRect;
  const columns = editorialGridColumns(layout.words.length, safe);
  const rows = Math.max(1, Math.ceil(layout.words.length / columns));
  const cellWidth = safe.width / columns;
  const cellHeight = safe.height / rows;
  const arrival = easeOutCubic(unit(progress / .24));
  const departure = smoothstep(unit((1 - progress) / .16));
  const visible = fullFrameOpacity(progress);
  const positionBiasX = (style.positionX - 50) / 50 * cellWidth * .14;
  const positionBiasY = (style.positionY - 50) / 50 * cellHeight * .14;

  return layout.words.map((word, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const targetX = safe.x + (column + .5) * cellWidth + positionBiasX;
    const targetY = safe.y + (row + .5) * cellHeight + positionBiasY;
    const direction = index % 2 === 0 ? -1 : 1;
    const enteringX = targetX + direction * cellWidth * .32;
    const enteringY = targetY + (row % 2 === 0 ? -1 : 1) * cellHeight * .16;
    const leaving = 1 - departure;
    const x = enteringX + (targetX - enteringX) * arrival - direction * leaving * cellWidth * .2;
    const y = enteringY + (targetY - enteringY) * arrival + leaving * cellHeight * .12;
    const scale = clamp(Math.min(cellWidth * .77 / Math.max(1, word.width), cellHeight * .54 / Math.max(1, word.height)), .48, 2.8);
    const rotation = direction * (1 - arrival + leaving) * .075;
    const placement = constrainSafeTextPlacement(word, x, y, scale, rotation, safe, style, settings);
    return paintSafeText(context, placement, style, settings, visible);
  });
}

function drawFocusCarousel(
  context: CanvasRenderingContext2D,
  layout: ProSubtitleLayout,
  style: ProSubtitleCueStyle,
  settings: ProSubtitleSettings,
  progress: number
): ProSubtitlePaintBounds[] {
  const safe = layout.safeRect;
  const count = Math.max(1, layout.words.length);
  const carouselProgress = unit((progress - .08) / .82) * Math.max(0, count - 1);
  const activeX = safe.x + safe.width * clamp(style.positionX, 0, 100) / 100;
  const activeY = safe.y + safe.height * clamp(style.positionY, 0, 100) / 100;
  const visible = fullFrameOpacity(progress);

  return layout.words.map((word, index) => {
    const angle = index / count * Math.PI * 2 - Math.PI / 2;
    const perimeterX = safe.x + safe.width / 2 + Math.cos(angle) * safe.width * .42;
    const perimeterY = safe.y + safe.height / 2 + Math.sin(angle) * safe.height * .4;
    const distance = Math.abs(index - carouselProgress);
    const focus = smoothstep(unit(1 - distance));
    const x = perimeterX + (activeX - perimeterX) * focus;
    const y = perimeterY + (activeY - perimeterY) * focus;
    const perimeterScale = clamp(Math.min(safe.width * .2 / Math.max(1, word.width), safe.height * .105 / Math.max(1, word.height)), .38, 1.05);
    const focusScale = clamp(Math.min(safe.width * .78 / Math.max(1, word.width), safe.height * .3 / Math.max(1, word.height)), .7, 3.4);
    const scale = perimeterScale + (focusScale - perimeterScale) * focus;
    const rotation = Math.sin(angle) * .09 * (1 - focus);
    const placement = constrainSafeTextPlacement(word, x, y, scale, rotation, safe, style, settings);
    return paintSafeText(context, placement, style, settings, visible * (.36 + focus * .64));
  });
}

function drawFullFrameAnimation(
  context: CanvasRenderingContext2D,
  animation: ProSubtitleAnimation,
  layout: ProSubtitleLayout,
  style: ProSubtitleCueStyle,
  settings: ProSubtitleSettings,
  progress: number
): ProSubtitlePaintBounds[] {
  if (animation === "fullFrameOrbit") return drawFullFrameOrbit(context, layout, style, settings, progress);
  if (animation === "editorialGrid") return drawEditorialGrid(context, layout, style, settings, progress);
  return drawFocusCarousel(context, layout, style, settings, progress);
}

function drawTrackedWord(context: CanvasRenderingContext2D, word: ProSubtitleWordLayout, tracking: number): void {
  const glyphs = glyphMetrics(context, word.text);
  const total = glyphs.reduce((sum, glyph) => sum + glyph.width, 0) + Math.max(0, glyphs.length - 1) * tracking;
  let x = -total / 2;
  for (const glyph of glyphs) {
    context.fillText(glyph.glyph, x + glyph.width / 2, 0);
    x += glyph.width + tracking;
  }
}

function drawOrbitWord(context: CanvasRenderingContext2D, word: ProSubtitleWordLayout, progress: number): void {
  const glyphs = glyphMetrics(context, word.text);
  const total = glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
  let x = -total / 2;
  for (const [glyphIndex, glyph] of glyphs.entries()) {
    const delay = glyphIndex / Math.max(1, glyphs.length) * .14;
    const arrival = easeOutCubic(unit((progress - delay) / .25));
    const direction = (word.index + glyphIndex) % 2 === 0 ? -1 : 1;
    const angle = direction * (1 - arrival) * Math.PI * 1.7 + glyphIndex * .52;
    const radius = Math.max(word.fontSize * 1.35, word.width * .34) * (1 - arrival);
    context.save();
    context.translate(x + glyph.width / 2 + Math.cos(angle) * radius, Math.sin(angle) * radius * .68);
    context.rotate(direction * (1 - arrival) * Math.PI * 1.3);
    context.globalAlpha *= unit(arrival * 1.7);
    context.fillText(glyph.glyph, 0, 0);
    context.restore();
    x += glyph.width;
  }
}

function drawCascadeWord(context: CanvasRenderingContext2D, word: ProSubtitleWordLayout, progress: number): void {
  const glyphs = glyphMetrics(context, word.text);
  const total = glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
  let x = -total / 2;
  for (const [glyphIndex, glyph] of glyphs.entries()) {
    const delay = glyphIndex / Math.max(1, glyphs.length) * .16;
    const arrival = easeOutCubic(unit((progress - delay) / .23));
    const direction = (word.index + glyphIndex) % 2 === 0 ? -1 : 1;
    context.save();
    context.translate(
      x + glyph.width / 2 + direction * (1 - arrival) * word.fontSize * .16,
      direction * (1 - arrival) * word.fontSize * 1.15
    );
    context.rotate(direction * (1 - arrival) * .62);
    context.globalAlpha *= unit(arrival * 1.8);
    context.fillText(glyph.glyph, 0, 0);
    context.restore();
    x += glyph.width;
  }
}

function drawWaveWord(context: CanvasRenderingContext2D, word: ProSubtitleWordLayout, progress: number): void {
  const glyphs = glyphMetrics(context, word.text);
  const total = glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
  let x = -total / 2;
  for (const [glyphIndex, glyph] of glyphs.entries()) {
    const delay = glyphIndex / Math.max(1, glyphs.length) * .1;
    const arrival = easeOutCubic(unit((progress - delay) / .28));
    const wave = Math.sin(glyphIndex * .9 - progress * Math.PI * 3);
    const y = wave * word.fontSize * (.72 * (1 - arrival) + .035 * arrival);
    context.save();
    context.translate(x + glyph.width / 2, y);
    context.rotate(wave * (1 - arrival) * .2);
    context.globalAlpha *= unit(arrival * 1.7);
    context.fillText(glyph.glyph, 0, 0);
    context.restore();
    x += glyph.width;
  }
}

function drawRadialWord(context: CanvasRenderingContext2D, word: ProSubtitleWordLayout, progress: number): void {
  const glyphs = glyphMetrics(context, word.text);
  const total = glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
  let x = -total / 2;
  for (const [glyphIndex, glyph] of glyphs.entries()) {
    const delay = glyphIndex / Math.max(1, glyphs.length) * .12;
    const arrival = easeOutCubic(unit((progress - delay) / .24));
    const angle = glyphIndex / Math.max(1, glyphs.length) * Math.PI * 2 + word.index * .7;
    const radius = (1 - arrival) * Math.max(word.width * .52, word.fontSize * 1.5);
    context.save();
    context.translate(
      x + glyph.width / 2 + Math.cos(angle) * radius,
      Math.sin(angle) * radius * .58
    );
    context.rotate((1 - arrival) * angle * .42);
    context.globalAlpha *= unit(arrival * 1.8);
    context.fillText(glyph.glyph, 0, 0);
    context.restore();
    x += glyph.width;
  }
}

function drawSplitWord(context: CanvasRenderingContext2D, word: ProSubtitleWordLayout, progress: number): void {
  const arrival = easeOutCubic(unit(progress / .22));
  const exit = smoothstep(unit((1 - progress) / .16));
  const leaving = 1 - exit;
  const direction = word.index % 2 === 0 ? -1 : 1;
  const offset = direction * ((1 - arrival) * word.width * .72 - leaving * word.width * .28);
  const halfHeight = word.height * .62;

  context.save();
  context.beginPath();
  context.rect(-word.width, -word.height, word.width * 2, word.height);
  context.clip();
  context.translate(offset, 0);
  context.fillText(word.text, 0, 0);
  context.restore();

  context.save();
  context.beginPath();
  context.rect(-word.width, 0, word.width * 2, halfHeight);
  context.clip();
  context.translate(-offset, 0);
  context.fillText(word.text, 0, 0);
  context.restore();
}

function drawMotionEcho(
  context: CanvasRenderingContext2D,
  word: ProSubtitleWordLayout,
  animation: ProSubtitleAnimation,
  progress: number
): void {
  if (animation !== "wordRush" && animation !== "depthZoom" && animation !== "verticalRoll") return;
  const direction = word.index % 2 === 0 ? -1 : 1;
  const envelope = Math.sin(unit(progress) * Math.PI);
  for (let echo = 2; echo >= 1; echo -= 1) {
    context.save();
    context.globalAlpha *= .055 * envelope * (3 - echo);
    context.translate(-direction * word.fontSize * echo * .055, word.fontSize * echo * .018);
    context.fillText(word.text, 0, 0);
    context.restore();
  }
}

function clearTransparentFrame(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.restore();
}

function isHtmlCanvasElement(target: CanvasRenderingContext2D | HTMLCanvasElement): target is HTMLCanvasElement {
  return typeof (target as HTMLCanvasElement).getContext === "function"
    && typeof (target as HTMLCanvasElement).width === "number"
    && typeof (target as HTMLCanvasElement).height === "number";
}

function resolveCanvasTarget(
  target: CanvasRenderingContext2D | HTMLCanvasElement,
  timing: ProSubtitleFrameTiming
): { context: CanvasRenderingContext2D; width: number; height: number } {
  if (isHtmlCanvasElement(target)) {
    const context = target.getContext("2d");
    if (!context) throw new Error("Canvas 2D non disponibile per il rendering ProSubtitles.");
    return {
      context,
      width: Math.max(1, timing.width ?? target.width),
      height: Math.max(1, timing.height ?? target.height)
    };
  }
  const canvas = target.canvas;
  const width = timing.width ?? canvas?.width;
  const height = timing.height ?? canvas?.height;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Il renderer ProSubtitles richiede width e height per un context senza canvas.");
  }
  return {
    context: target,
    width: Math.max(1, Number(width)),
    height: Math.max(1, Number(height))
  };
}

/**
 * Renders one transparent RGBA frame into either a canvas or its 2D context:
 *
 * `renderProSubtitleFrame(target, cue, style, settings, { timeSeconds })`
 *
 * `progress` can replace absolute time for thumbnails/offline export. The
 * renderer never paints a background; solid/video compositing is deliberately
 * left to preview and export so the exact same frame supports alpha output.
 */
export function renderProSubtitleFrame(
  target: CanvasRenderingContext2D | HTMLCanvasElement,
  cue: ProSubtitleCue,
  style: ProSubtitleCueStyle,
  settings: ProSubtitleSettings,
  timing: ProSubtitleFrameTiming = {}
): ProSubtitleRenderResult {
  const { context, width, height } = resolveCanvasTarget(target, timing);
  if (timing.clear !== false) clearTransparentFrame(context, width, height);
  const explicitProgress = typeof timing.progress === "number" && Number.isFinite(timing.progress);
  const explicitTime = typeof timing.timeSeconds === "number" && Number.isFinite(timing.timeSeconds);
  if (explicitTime && !explicitProgress && (timing.timeSeconds! < cue.startSeconds || timing.timeSeconds! >= cue.endSeconds)) {
    return { active: false, progress: 0, layout: null, renderedAnimation: null, paintBounds: [] };
  }
  const progress = explicitProgress
    ? unit(timing.progress!)
    : explicitTime
      ? unit((timing.timeSeconds! - cue.startSeconds) / Math.max(minimumCueDuration, cue.endSeconds - cue.startSeconds))
      : .5;
  const requestedFullFrameAnimation = [style.animation, ...style.wordStyles.map((wordStyle) => wordStyle.animation)]
    .find((animation): animation is ProSubtitleAnimation => (
      Boolean(animation) && (FULL_FRAME_ANIMATIONS as readonly string[]).includes(animation!)
    ));
  const renderedAnimation = requestedFullFrameAnimation
    ? resolveFullFrameAnimation(requestedFullFrameAnimation, cue)
    : style.animation;
  const renderStyle = requestedFullFrameAnimation && !(FULL_FRAME_ANIMATIONS as readonly string[]).includes(renderedAnimation)
    ? {
        ...style,
        animation: renderedAnimation,
        wordStyles: style.wordStyles.map((wordStyle) => ({
          ...wordStyle,
          animation: wordStyle.animation && (FULL_FRAME_ANIMATIONS as readonly string[]).includes(wordStyle.animation)
            ? null
            : wordStyle.animation
        }))
      }
    : style;
  const layout = layoutProSubtitleCue(context, {
    cue,
    style: renderStyle,
    width,
    height,
    titleSafe: settings.titleSafe,
    ...(timing.layoutRegion ? { region: timing.layoutRegion } : {})
  });
  if ((FULL_FRAME_ANIMATIONS as readonly string[]).includes(renderedAnimation)) {
    return {
      active: true,
      progress,
      layout,
      renderedAnimation,
      paintBounds: drawFullFrameAnimation(context, renderedAnimation, layout, renderStyle, settings, progress)
    };
  }
  const totalWords = Math.max(1, layout.words.length);

  for (const word of layout.words) {
    const pose = resolveProSubtitleWordPose(word.animation, progress, word.index, totalWords, width, height, word.fontSize);
    if (pose.opacity <= .001) continue;
    context.save();
    context.translate(word.x + pose.x, word.y + pose.y);
    context.rotate(pose.rotation);
    context.scale(pose.scaleX, pose.scaleY);
    applyWordPaint(context, word, renderStyle, settings, pose.opacity * renderStyle.opacity);
    drawMotionEcho(context, word, word.animation, progress);

    if (word.animation === "maskReveal") {
      const revealWidth = word.width * unit(pose.reveal);
      context.beginPath();
      context.rect(-word.width / 2, -word.height, revealWidth, word.height * 2);
      context.clip();
    }

    if (word.animation === "letterOrbit") drawOrbitWord(context, word, progress);
    else if (word.animation === "letterCascade") drawCascadeWord(context, word, progress);
    else if (word.animation === "waveAssembly") drawWaveWord(context, word, progress);
    else if (word.animation === "radialBurst") drawRadialWord(context, word, progress);
    else if (word.animation === "splitSlide") drawSplitWord(context, word, progress);
    else if (word.animation === "trackingSweep") drawTrackedWord(context, word, pose.tracking);
    else context.fillText(word.text, 0, 0);
    context.restore();
  }
  return { active: true, progress, layout, renderedAnimation, paintBounds: [] };
}

export interface ProSubtitleCompositionRenderResult {
  activeCueIds: string[];
  layouts: ProSubtitleLayout[];
}

/**
 * Draws every cue active at a timestamp. Overlapping cues receive independent
 * title-safe vertical regions, while normal cue boundaries use half-open
 * intervals so two contiguous phrases never produce a blank transition frame.
 */
export function renderProSubtitleCompositionFrame(
  target: CanvasRenderingContext2D | HTMLCanvasElement,
  cues: readonly ProSubtitleCue[],
  settings: ProSubtitleSettings,
  timing: Omit<ProSubtitleFrameTiming, "progress" | "layoutRegion"> & { timeSeconds: number }
): ProSubtitleCompositionRenderResult {
  const { context, width, height } = resolveCanvasTarget(target, timing);
  if (timing.clear !== false) clearTransparentFrame(context, width, height);
  const active = cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => timing.timeSeconds >= cue.startSeconds && timing.timeSeconds < cue.endSeconds);
  if (!active.length) return { activeCueIds: [], layouts: [] };

  const titleSafe = clamp(settings.titleSafe, .02, .3);
  const safeTop = height * titleSafe;
  const safeHeight = height * (1 - titleSafe * 2);
  const gap = active.length > 1 ? Math.min(height * .018, safeHeight * .04) : 0;
  const regionHeight = Math.max(1, (safeHeight - gap * (active.length - 1)) / active.length);
  const layouts: ProSubtitleLayout[] = [];

  for (const [position, { cue, index }] of active.entries()) {
    const result = renderProSubtitleFrame(
      context,
      cue,
      resolveProSubtitleCueStyle(cue, settings, index),
      settings,
      {
        ...timing,
        width,
        height,
        clear: false,
        layoutRegion: {
          x: width * titleSafe,
          y: safeTop + position * (regionHeight + gap),
          width: width * (1 - titleSafe * 2),
          height: regionHeight
        }
      }
    );
    if (result.layout) layouts.push(result.layout);
  }
  return { activeCueIds: active.map(({ cue }) => cue.id), layouts };
}
