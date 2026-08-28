import type { CommentsInvasionSettings } from "@rbs/project-schema";

export interface CommentsInvasionImage {
  id: string;
  index: number;
  width: number;
  height: number;
  image: CanvasImageSource;
}

export interface CommentsInvasionFrameInput {
  timeSeconds: number;
  videoFrame: CanvasImageSource | null;
  comments: readonly CommentsInvasionImage[];
  totalComments: number;
  settings: CommentsInvasionSettings;
  seed?: number;
}

export interface CommentsInvasionPlacement { x: number; y: number; width: number; height: number; rotation: number; }
export interface CommentsInvasionStampTransform { alpha: number; scale: number; impact: number; }
export interface CommentsInvasionExitTransform { alpha: number; scale: number; offsetX: number; offsetY: number; rotation: number; }
export interface CommentsInvasionLifetime { appearance: number; exitStart: number; end: number; }

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const easeOutCubic = (value: number) => 1 - (1 - clamp01(value)) ** 3;
const hash = (value: number) => {
  const sine = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return sine - Math.floor(sine);
};

export function commentsInvasionAppearanceTime(index: number, settings: CommentsInvasionSettings): number {
  return Math.max(0, settings.initialDelaySeconds) + Math.max(0, index) * Math.max(.15, settings.intervalSeconds);
}

export function commentsInvasionLifetime(index: number, count: number, settings: CommentsInvasionSettings): CommentsInvasionLifetime {
  const appearance = commentsInvasionAppearanceTime(index, settings);
  const exitDuration = Math.max(.08, settings.exitDurationSeconds);
  const naturalEnd = appearance + Math.max(.08, settings.impactDurationSeconds) + Math.max(.25, settings.holdDurationSeconds) + exitDuration;
  const replacementIndex = index + Math.max(1, settings.maxVisible);
  const replacementTime = replacementIndex < count ? commentsInvasionAppearanceTime(replacementIndex, settings) : Number.POSITIVE_INFINITY;
  const end = Math.min(naturalEnd, replacementTime);
  return { appearance, exitStart: Math.max(appearance, end - Math.min(exitDuration, Math.max(0, end - appearance))), end };
}

export function commentsInvasionVisibleIndices(timeSeconds: number, count: number, settings: CommentsInvasionSettings): number[] {
  if (count <= 0 || timeSeconds < settings.initialDelaySeconds) return [];
  const latest = Math.min(count - 1, Math.floor((timeSeconds - settings.initialDelaySeconds) / Math.max(.15, settings.intervalSeconds)));
  if (latest < 0) return [];
  const firstCandidate = Math.max(0, latest - Math.max(1, settings.maxVisible));
  const visible: number[] = [];
  for (let index = firstCandidate; index <= latest; index += 1) {
    const lifetime = commentsInvasionLifetime(index, count, settings);
    if (timeSeconds >= lifetime.appearance && timeSeconds < lifetime.end) visible.push(index);
  }
  return visible;
}

export function commentsInvasionStampTransform(ageSeconds: number, durationSeconds: number, intensity: number): CommentsInvasionStampTransform {
  const progress = clamp01(ageSeconds / Math.max(.08, durationSeconds));
  if (progress >= 1) return { alpha: 1, scale: 1, impact: 0 };
  const strength = Math.max(.25, Math.min(2, intensity));
  if (progress < .58) {
    const phase = easeOutCubic(progress / .58);
    return { alpha: clamp01(progress * 5), scale: mix(1 + .58 * strength, .9, phase), impact: (1 - progress / .58) * strength };
  }
  const settle = (progress - .58) / .42;
  return { alpha: 1, scale: mix(.9, 1, 1 - Math.cos(settle * Math.PI / 2)), impact: 0 };
}

export function commentsInvasionExitTransform(progressValue: number, animation: CommentsInvasionSettings["exitAnimation"], direction = 1): CommentsInvasionExitTransform {
  const progress = easeOutCubic(progressValue); const side = direction < 0 ? -1 : 1;
  if (animation === "shrink") return { alpha: 1 - progress, scale: 1 - progress * .82, offsetX: 0, offsetY: 0, rotation: 0 };
  if (animation === "slide-up") return { alpha: 1 - progress, scale: 1, offsetX: 0, offsetY: -progress * 1.25, rotation: 0 };
  if (animation === "slide-side") return { alpha: 1 - progress, scale: 1, offsetX: side * progress * 1.35, offsetY: 0, rotation: side * progress * .08 };
  if (animation === "spin") return { alpha: 1 - progress, scale: 1 - progress * .28, offsetX: 0, offsetY: -progress * .16, rotation: side * progress * Math.PI * .9 };
  return { alpha: 1 - progress, scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };
}

const slots: ReadonlyArray<readonly [number, number]> = [
  [.04, .06], [.58, .09], [.08, .4], [.55, .43], [.29, .72], [.31, .23],
  [.04, .72], [.61, .68], [.36, .51], [.18, .12], [.68, .3], [.12, .57]
];

export function commentsInvasionPlacement(canvasWidth: number, canvasHeight: number, imageWidth: number, imageHeight: number, index: number, settings: CommentsInvasionSettings, seed = 0): CommentsInvasionPlacement {
  const margin = Math.min(canvasWidth, canvasHeight) * Math.max(0, settings.safeArea);
  const desiredWidth = canvasWidth * settings.commentScale;
  const scale = Math.min(desiredWidth / Math.max(1, imageWidth), canvasHeight * .34 / Math.max(1, imageHeight));
  const width = Math.min(canvasWidth - margin * 2, imageWidth * scale); const height = Math.min(canvasHeight - margin * 2, imageHeight * scale);
  const slot = slots[(index * 5 + Math.abs(Math.round(seed))) % slots.length]!;
  const jitterX = (hash(index + seed * .013) - .5) * .06; const jitterY = (hash(index * 1.7 + seed * .021) - .5) * .05;
  const x = margin + clamp01(slot[0] + jitterX) * Math.max(0, canvasWidth - margin * 2 - width);
  const y = margin + clamp01(slot[1] + jitterY) * Math.max(0, canvasHeight - margin * 2 - height);
  const rotation = (hash(index * 3.17 + seed * .07) * 2 - 1) * settings.rotationDegrees * Math.PI / 180;
  return { x, y, width, height, rotation };
}

export function fitCommentsInvasionPreview(containerWidth: number, containerHeight: number, sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const ratio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 9 / 16;
  const width = Math.min(Math.max(0, containerWidth), Math.max(0, containerHeight) * ratio);
  return { width, height: ratio > 0 ? width / ratio : 0 };
}

function sourceDimensions(source: CanvasImageSource): { width: number; height: number } {
  const candidate = source as CanvasImageSource & { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  return { width: candidate.videoWidth ?? candidate.naturalWidth ?? candidate.width ?? 1, height: candidate.videoHeight ?? candidate.naturalHeight ?? candidate.height ?? 1 };
}

function drawVideo(context: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number, fit: CommentsInvasionSettings["videoFit"]): void {
  const dimensions = sourceDimensions(source); const scale = fit === "cover" ? Math.max(width / dimensions.width, height / dimensions.height) : Math.min(width / dimensions.width, height / dimensions.height);
  const drawWidth = dimensions.width * scale; const drawHeight = dimensions.height * scale;
  context.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2); context.beginPath(); context.moveTo(x + r, y); context.arcTo(x + width, y, x + width, y + height, r); context.arcTo(x + width, y + height, x, y + height, r); context.arcTo(x, y + height, x, y, r); context.arcTo(x, y, x + width, y, r); context.closePath();
}

export function renderCommentsInvasionFrame(canvas: HTMLCanvasElement, input: CommentsInvasionFrameInput): void {
  const context = canvas.getContext("2d", { alpha: false }); if (!context) return;
  const width = canvas.width; const height = canvas.height; context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1; context.fillStyle = input.settings.backgroundColor; context.fillRect(0, 0, width, height);
  if (input.videoFrame) drawVideo(context, input.videoFrame, width, height, input.settings.videoFit);
  const visible = new Set(commentsInvasionVisibleIndices(input.timeSeconds, input.totalComments, input.settings));
  for (const comment of input.comments) {
    const index = comment.index; if (!visible.has(index)) continue;
    const lifetime = commentsInvasionLifetime(index, input.totalComments, input.settings); const age = input.timeSeconds - lifetime.appearance; const stamp = commentsInvasionStampTransform(age, input.settings.impactDurationSeconds, input.settings.impactIntensity); const placement = commentsInvasionPlacement(width, height, comment.width, comment.height, index, input.settings, input.seed);
    const exitProgress = input.timeSeconds <= lifetime.exitStart ? 0 : (input.timeSeconds - lifetime.exitStart) / Math.max(.001, lifetime.end - lifetime.exitStart);
    const exit = commentsInvasionExitTransform(exitProgress, input.settings.exitAnimation, hash(index + (input.seed ?? 0)) < .5 ? -1 : 1);
    const centerX = placement.x + placement.width / 2; const centerY = placement.y + placement.height / 2;
    context.save(); context.translate(exit.offsetX * placement.width, exit.offsetY * placement.height); context.translate(centerX, centerY); context.rotate(placement.rotation * Math.min(1, Math.max(0, age / Math.max(.08, input.settings.impactDurationSeconds))) + exit.rotation); context.scale(stamp.scale * exit.scale, stamp.scale * exit.scale); context.translate(-centerX, -centerY); context.globalAlpha = stamp.alpha * exit.alpha;
    context.shadowColor = `rgba(0,0,0,${.48 + stamp.impact * .14})`; context.shadowBlur = Math.max(6, Math.min(width, height) * (.012 + stamp.impact * .018)); context.shadowOffsetY = Math.min(width, height) * (.008 + stamp.impact * .006);
    roundedRect(context, placement.x, placement.y, placement.width, placement.height, Math.min(width, height) * .012); context.clip(); context.drawImage(comment.image, placement.x, placement.y, placement.width, placement.height); context.restore();
    if (stamp.impact > .02) {
      context.save(); context.globalAlpha = Math.min(.7, stamp.impact * .5); context.strokeStyle = "rgba(255,255,255,.95)"; context.lineWidth = Math.max(2, Math.min(width, height) * .004); const spread = Math.min(width, height) * .018 * stamp.impact; roundedRect(context, placement.x - spread, placement.y - spread, placement.width + spread * 2, placement.height + spread * 2, Math.min(width, height) * .016); context.stroke(); context.restore();
    }
  }
  context.restore();
}
