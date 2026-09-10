import { normalizeBivioSettings, type BivioSettings, type BivioColors } from "./settings";

const TAU = Math.PI * 2;
export const BIVIO_FONT = "MLSM Protest Revolution";
let fontPromise: Promise<void> | undefined;
let fontReady = false;

export function ensureBivioFont(): Promise<void> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const face = new FontFace(BIVIO_FONT, 'url("/fonts/protest-revolution.ttf")');
      await face.load();
      document.fonts.add(face);
      fontReady = true;
    })().catch((error: unknown) => { fontPromise = undefined; throw error; });
  }
  return fontPromise;
}

const fract = (n: number) => n - Math.floor(n);
const noise = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
const smooth = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };

/** Integer route laps AND integer gait cycles: arbitrary song durations close exactly.
 * No accumulated delta time, reverse movement, audio analysis, or physics workers.
 */
export function bivioLoopClock(timeSeconds: number, durationSeconds: number, pace = 1) {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 24;
  const time = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
  const normalizedTime = fract(time / duration);
  const laps = Math.max(1, Math.round(duration * Math.max(.5, Math.min(1.5, pace)) / 18));
  const strides = Math.max(laps, Math.round(duration * Math.max(.5, Math.min(1.5, pace)) * 1.25));
  return { route: normalizedTime * laps, gait: normalizedTime * strides, laps, strides, duration };
}

export interface BivioWalker { id: number; side: "left" | "right"; progress: number; x: number; y: number; scale: number; gait: number; heading: number; opacity: number; }

function routePoint(t: number, right: boolean) {
  // Cubic routes start and finish outside the poster. Resetting there is invisible.
  const p = right ? [[491, 1510], [430, 968], [496, 812], [826, 731]] : [[268, 1510], [537, 962], [104, 782], [-105, 724]];
  const u = 1 - t;
  return { x: u ** 3 * p[0]![0]! + 3 * u * u * t * p[1]![0]! + 3 * u * t * t * p[2]![0]! + t ** 3 * p[3]![0]!, y: u ** 3 * p[0]![1]! + 3 * u * u * t * p[1]![1]! + 3 * u * t * t * p[2]![1]! + t ** 3 * p[3]![1]! };
}

export function bivioRouteHeading(progress: number, right: boolean): number {
  const start = routePoint(Math.max(0, progress - .001), right);
  const end = routePoint(Math.min(1, progress + .001), right);
  const heading = Math.atan2(end.x - start.x, start.y - end.y);
  // The nearly straight approach reads as a back view. Ease into the side view
  // as the actual path turns; no abrupt pose switch at the fork.
  const sideView = smooth((Math.abs(heading) - .24) / .9);
  return heading * sideView;
}

export interface BivioJoint { x: number; y: number; }
export interface BivioLeg { hip: BivioJoint; knee: BivioJoint; ankle: BivioJoint; }

export function bivioLegPose(gait: number, heading: number, side: -1 | 1): BivioLeg {
  const phase = gait + (side === 1 ? Math.PI : 0);
  const thigh = Math.sin(phase) * .38;
  const flexion = Math.max(0, Math.sin(phase)) * .85;
  const shin = thigh - flexion;
  const hipY = -48 + Math.cos(gait * 2) * .7;
  const project = (forward: number, height: number): BivioJoint => ({
    x: side * 8 * Math.cos(heading) + forward * Math.sin(heading),
    y: height + forward * Math.cos(heading) * .16,
  });
  const kneeForward = Math.sin(thigh) * 24;
  const kneeHeight = hipY + Math.cos(thigh) * 24;
  return {
    hip: project(0, hipY),
    knee: project(kneeForward, kneeHeight),
    ankle: project(kneeForward + Math.sin(shin) * 24, kneeHeight + Math.cos(shin) * 24),
  };
}

export function bivioWalkers(timeSeconds: number, durationSeconds: number, settings: BivioSettings): BivioWalker[] {
  const clock = bivioLoopClock(timeSeconds, durationSeconds, settings.pace);
  const count = Math.round(Math.max(12, Math.min(60, settings.crowdCount)));
  const walkers: BivioWalker[] = [];
  for (let index = 0; index < count; index += 1) {
    const progress = fract(index / count + clock.route);
    const point = routePoint(progress, false);
    const lane = ((index % 3) - 1) * (62 * (1 - progress) + 8);
    walkers.push({ id: index, side: "left", progress, x: point.x + lane, y: point.y + lane * .13, scale: 1.04 - progress * .81, gait: fract(clock.gait + noise(index) * 2) * TAU, heading: bivioRouteHeading(progress, false), opacity: 1 });
  }
  // Exactly one solo, travelling forward on the other branch. As with the
  // crowd, its route wraps only beyond the frame, never by reversing direction.
  const soloProgress = fract(.64 + clock.route);
  const solo = routePoint(soloProgress, true);
  walkers.push({ id: count, side: "right", progress: soloProgress, x: solo.x, y: solo.y, scale: 1.04 - soloProgress * .81, gait: fract(clock.gait) * TAU, heading: bivioRouteHeading(soloProgress, true), opacity: 1 });
  return walkers.sort((a, b) => a.y - b.y);
}

function stroke(ctx: CanvasRenderingContext2D, points: number[], color: string, width: number) {
  ctx.beginPath(); ctx.moveTo(points[0]!, points[1]!);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 40, size / 40);
  ctx.beginPath(); ctx.moveTo(0, 13); ctx.bezierCurveTo(-42, -11, -15, -33, 0, -12); ctx.bezierCurveTo(15, -38, 39, -12, 0, 13);
  ctx.strokeStyle = color; ctx.lineWidth = 3.5; ctx.lineJoin = "round"; ctx.stroke(); ctx.restore();
}

function drawWalker(ctx: CanvasRenderingContext2D, walker: BivioWalker, colors: BivioColors, shadow = false) {
  const bob = Math.cos(walker.gait * 2) * .7;
  const facing = Math.sin(walker.heading);
  const bodyWidth = .55 + Math.cos(walker.heading) * .45;
  ctx.save(); ctx.translate(walker.x, walker.y); ctx.scale(walker.scale, walker.scale);
  if (shadow) { ctx.transform(1, -.42, .37, .18, 0, 0); ctx.globalAlpha = .14; }
  const color = shadow ? colors.shadows : walker.side === "left" ? colors.crowd : colors.solo;
  // Sagittal knee flexion projects vertically from behind, and becomes visible
  // from the side as the figure turns with the route. Never splay legs sideways.
  const hipY = -48 + bob;
  for (const side of [-1, 1] as const) {
    const { hip, knee, ankle } = bivioLegPose(walker.gait, walker.heading, side);
    stroke(ctx, [hip.x, hip.y, knee.x, knee.y, ankle.x, ankle.y], color, 7.5);
    stroke(ctx, [ankle.x, ankle.y, ankle.x + facing * 3.5, ankle.y], color, 5);
  }
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(-17 * bodyWidth, -84 + bob); ctx.quadraticCurveTo(0, -92 + bob, 17 * bodyWidth, -84 + bob); ctx.lineTo(13 * bodyWidth, hipY); ctx.quadraticCurveTo(0, hipY + 5, -13 * bodyWidth, hipY); ctx.closePath(); ctx.fill();
  for (const side of [-1, 1] as const) {
    const swing = Math.sin(walker.gait + (side === -1 ? Math.PI : 0));
    const shoulder = side * 16 * bodyWidth;
    stroke(ctx, [shoulder, -79 + bob, shoulder + side * 3 * bodyWidth + swing * facing * 6, -61 + bob, shoulder + side * 3 * bodyWidth + swing * facing * 13, -43 + bob - Math.abs(swing) * 3], color, 6);
  }
  ctx.beginPath(); ctx.ellipse(facing, -102 + bob, 8.5 - Math.abs(facing), 11, 0, 0, TAU); ctx.fill();
  stroke(ctx, [0, -93 + bob, 0, -84 + bob], color, 7);
  ctx.restore();
}

function road(ctx: CanvasRenderingContext2D) {
  ctx.beginPath(); ctx.moveTo(100, 1320); ctx.bezierCurveTo(250, 1120, 251, 920, -80, 761);
  ctx.lineTo(-80, 697); ctx.bezierCurveTo(143, 742, 301, 800, 389, 927);
  ctx.bezierCurveTo(463, 827, 596, 774, 800, 714); ctx.lineTo(800, 791);
  ctx.bezierCurveTo(562, 822, 495, 972, 590, 1320); ctx.closePath();
}

function tint(color: string, target: number, amount: number) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16);
    return Math.round(value + (target - value) * amount);
  });
  return `rgb(${channels.join(",")})`;
}

function drawPaper(ctx: CanvasRenderingContext2D, grain: number, colors: BivioColors) {
  ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, 720, 1280);
  const light = ctx.createRadialGradient(362, 392, 80, 360, 580, 880);
  light.addColorStop(0, colors.paper); light.addColorStop(1, tint(colors.paper, 0, .055)); ctx.fillStyle = light; ctx.fillRect(0, 0, 720, 1280);
  // Intentional inkwork at the edges leaves the typography's safe zone clean.
  for (let side = 0; side < 2; side += 1) {
    ctx.save(); if (side) { ctx.translate(720, 0); ctx.scale(-1, 1); }
    for (let index = 0; index < 38; index += 1) {
      const y = 952 + noise(index + side * 44) * 388;
      const x = noise(index + 22) * 102;
      ctx.globalAlpha = .25 + noise(index + 9) * .7;
      ctx.beginPath(); ctx.moveTo(-70, y + 180); ctx.lineTo(x, y);
      ctx.lineTo(x + 35 + noise(index) * 66, y - 98); ctx.lineTo(x + noise(index + 6) * 12, y + 30); ctx.closePath();
      ctx.fillStyle = index % 6 === 0 ? colors.accentInk : colors.ink; ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  road(ctx); ctx.fillStyle = colors.road; ctx.fill(); ctx.strokeStyle = colors.roadEdges; ctx.lineWidth = 4.5; ctx.stroke();
  // Separate, finer strokes retain the hand-inked reference without noisy outlines.
  ctx.save(); ctx.globalAlpha = .48; ctx.translate(4, -3); road(ctx); ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  for (let i = 0; i < 1000; i += 1) {
    const x = noise(i * 3 + 71) * 720; const y = noise(i * 3 + 73) * 1280;
    const edge = Math.min(x, 720 - x);
    if (edge > 25 && y > 60 && y < 695) continue;
    if (y > 720 && x > 145 && x < 600 && i % 5) continue;
    ctx.globalAlpha = grain * (.1 + noise(i + 5) * .38);
    ctx.fillStyle = i % 13 === 0 ? colors.accentInk : colors.ink;
    ctx.beginPath(); ctx.arc(x, y, .25 + noise(i + 33) ** 5 * 3.8, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Sharp editorial corner strokes.
  stroke(ctx, [-30, 79, 78, 45, 180, 23], colors.ink, 3);
  stroke(ctx, [-10, 86, 131, 56], colors.accentInk, 2);
  stroke(ctx, [559, 27, 745, -14], colors.ink, 6);
  stroke(ctx, [646, 68, 744, 12], colors.ink, 2);
}

function drawSign(ctx: CanvasRenderingContext2D, colors: BivioColors) {
  ctx.save(); ctx.translate(18, 0);
  ctx.save(); ctx.globalAlpha = .14; stroke(ctx, [362, 812, 288, 843], colors.shadows, 13); ctx.restore();
  stroke(ctx, [359, 326, 363, 815], colors.signpost, 8);
  stroke(ctx, [357, 326, 360, 810], tint(colors.signpost, 255, .35), 1.7);
  ctx.beginPath(); ctx.moveTo(351, 350); ctx.lineTo(321, 352); ctx.lineTo(321, 338); ctx.lineTo(291, 375); ctx.lineTo(321, 410); ctx.lineTo(321, 394); ctx.lineTo(351, 391); ctx.closePath(); ctx.fillStyle = colors.leftArrow; ctx.fill();
  ctx.beginPath(); ctx.moveTo(368, 342); ctx.lineTo(402, 339); ctx.lineTo(402, 326); ctx.lineTo(435, 358); ctx.lineTo(403, 395); ctx.lineTo(403, 382); ctx.lineTo(368, 385); ctx.closePath(); ctx.fillStyle = colors.rightArrow; ctx.fill();
  stroke(ctx, [324, 365, 341, 382], colors.cross, 4); stroke(ctx, [324, 382, 341, 363], colors.cross, 4);
  heart(ctx, 391, 362, 23, colors.arrowHeart);
  stroke(ctx, [370, 350, 404, 347, 422, 357], tint(colors.rightArrow, 255, .35), 1.2);
  stroke(ctx, [299, 376, 318, 401], tint(colors.leftArrow, 255, .35), 1);
  for (let i = 0; i < 45; i += 1) {
    const angle = noise(i + 755) * TAU;
    const r = noise(i + 822) * 29;
    ctx.globalAlpha = .8; stroke(ctx, [363, 814, 363 + Math.cos(angle) * r, 814 + Math.sin(angle) * r * .5], colors.signpost, .8 + noise(i) * 2.5);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Wrap without squeezing glyphs; explicit poster lines stay user-controlled. */
export function wrapBivioText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.toLocaleUpperCase().split("\n")) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

function textBlock(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, height: number, maxSize: number, color: string, underline: string | null) {
  if (!text.trim()) return;
  ctx.font = `${maxSize}px "${BIVIO_FONT}", "Impact", sans-serif`;
  const paragraphs = text.toLocaleUpperCase().split("\n");
  const lines = paragraphs.length > 1 ? paragraphs : wrapBivioText(text, width, (line) => ctx.measureText(line).width);
  const spacing = Math.min(maxSize * 1.15, height / Math.max(1, lines.length));
  ctx.save(); ctx.beginPath(); ctx.rect(x - 3, y - 3, width + 6, height + 6); ctx.clip();
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = color;
  for (const [index, line] of lines.entries()) {
    let size = Math.min(maxSize, spacing / 1.08);
    ctx.font = `${size}px "${BIVIO_FONT}", "Impact", sans-serif`;
    const measuredWidth = ctx.measureText(line).width;
    if (measuredWidth > width) size *= width / measuredWidth;
    ctx.font = `${size}px "${BIVIO_FONT}", "Impact", sans-serif`;
    const baseline = y + spacing * .83 + index * spacing;
    ctx.fillText(line, x + width / 2, baseline);
    if (underline && line && index % 2 === 0) {
      const lineWidth = Math.min(width, ctx.measureText(line).width * .85);
      stroke(ctx, [x + (width - lineWidth) / 2, baseline + 5, x + (width + lineWidth) / 2, baseline + 1], underline, 1.5);
    }
  }
  ctx.restore();
}

interface BivioFrame { timeSeconds: number; durationSeconds: number; settings: BivioSettings; }
const backdrops = new WeakMap<HTMLCanvasElement, { key: string; canvas: HTMLCanvasElement }>();

function background(ctx: CanvasRenderingContext2D, settings: BivioSettings) {
  const colors = settings.colors;
  drawPaper(ctx, settings.grain, colors);
  textBlock(ctx, settings.leftText, 24, 90, 275, 585, 55, colors.leftText, colors.underlines);
  const headline = settings.rightText.split("\n");
  if (headline.length > 1 && headline[0]!.length <= 8 && headline[0]!.trim()) {
    textBlock(ctx, headline[0]!, 472, 95, 215, 155, 149, colors.rightText, null);
    textBlock(ctx, headline.slice(1).join("\n"), 463, 266, 235, 308, 67, colors.rightText, null);
  } else textBlock(ctx, settings.rightText, 463, 119, 235, 455, 87, colors.rightText, null);
  textBlock(ctx, settings.rightCaption, 457, 603, 234, 104, 47, colors.rightCaption, null);
  heart(ctx, 564, 730, 43, colors.heart);
  drawSign(ctx, colors);
}

export function renderBivioFrame(canvas: HTMLCanvasElement, frame: BivioFrame): void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx || !canvas.width || !canvas.height) return;
  const settings = normalizeBivioSettings(frame.settings);
  const key = JSON.stringify([canvas.width, canvas.height, settings.leftText, settings.rightText, settings.rightCaption, settings.grain, settings.colors, fontReady]);
  let cache = backdrops.get(canvas);
  if (!cache || cache.key !== key) {
    const layer = canvas.ownerDocument.createElement("canvas"); layer.width = canvas.width; layer.height = canvas.height;
    const context = layer.getContext("2d", { alpha: false });
    if (!context) return;
    context.scale(layer.width / 720, layer.height / 1280); background(context, settings);
    cache = { key, canvas: layer }; backdrops.set(canvas, cache);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cache.canvas, 0, 0);
  ctx.save(); ctx.scale(canvas.width / 720, canvas.height / 1280);
  // Static road hatching anchors the figures' actual forward displacement.
  ctx.save(); road(ctx); ctx.clip();
  for (let index = 0; index < 16; index += 1) {
    const t = index / 16;
    const point = routePoint(.31 + t * .61, true);
    ctx.globalAlpha = .13 * smooth(t * 9) * smooth((1 - t) * 9);
    stroke(ctx, [point.x + 19, point.y + 14, point.x + 28, point.y + 11], settings.colors.roadEdges, .8);
  }
  ctx.restore();
  const walkers = bivioWalkers(frame.timeSeconds, frame.durationSeconds, settings);
  for (const walker of walkers) drawWalker(ctx, walker, settings.colors, true);
  for (const walker of walkers) drawWalker(ctx, walker, settings.colors);
  ctx.restore();
}
