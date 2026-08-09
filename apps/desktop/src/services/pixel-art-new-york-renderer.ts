import * as THREE from "three";
import type { RhythmBallProject } from "@rbs/project-schema";
import { pixelArtWalkCycleSeconds, pixelArtWalkSpeedPixelsPerSecond, resolvePixelArtNewYorkTimeline, resolvePixelArtWalkRig, solvePixelArtElbow, solvePixelArtKnee } from "./pixel-art-new-york";

type PixelArtSettings = RhythmBallProject["animation"]["pixelArt"];
const heroFaceSpriteUrl = new URL("../assets/pixel-art/nyc-hero-face-v6.png", import.meta.url).href;
const heroHoodieColor = "#08090e";

export interface PixelArtNewYorkFrame {
  timeSeconds: number;
  durationSeconds: number;
  rhythmPulse: number;
  audioPulse: number;
  bpm: number;
  spectrumBands?: readonly number[];
  stereoLeftBands?: readonly number[];
  stereoRightBands?: readonly number[];
  stereoWidth?: number;
}

interface PixelSceneData {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  environmentCanvas: HTMLCanvasElement;
  environmentContext: CanvasRenderingContext2D;
  transitionCanvas: HTMLCanvasElement;
  transitionContext: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  settings: PixelArtSettings;
  cover: HTMLImageElement | null;
  heroFace: HTMLImageElement | null;
  lastFrame: PixelArtNewYorkFrame;
}

interface RigPose {
  bob: number;
  torsoLean: number;
  headTilt: number;
  frontThigh: number;
  backThigh: number;
  frontKnee: number;
  backKnee: number;
  frontFootOffset?: number;
  backFootOffset?: number;
  frontFootLift?: number;
  backFootLift?: number;
  frontUpperArm: number;
  backUpperArm: number;
  frontForearm: number;
  backForearm: number;
}

interface CharacterStyle {
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  shoes: string;
  accent: string;
  hood?: boolean;
  headphones?: boolean;
  hairStyle?: "short" | "curls" | "bob" | "bun" | "cap" | "fringe";
  coat?: boolean;
  skirt?: boolean;
  portraitFeatures?: boolean;
  faceSprite?: HTMLImageElement;
}

interface Point { x: number; y: number; }

const crowdStyles: readonly CharacterStyle[] = [
  { skin: "#9b6049", hair: "#15101a", top: "#657aa6", bottom: "#252b42", shoes: "#d4d1ce", accent: "#d8a949", hairStyle: "short", coat: true },
  { skin: "#6f4435", hair: "#08090c", top: "#b15d7c", bottom: "#2a2138", shoes: "#ece6dc", accent: "#68d0c5", hairStyle: "curls" },
  { skin: "#c98261", hair: "#3b201c", top: "#58745d", bottom: "#171f29", shoes: "#c5a36a", accent: "#e8c052", hairStyle: "bun", skirt: true },
  { skin: "#d29b79", hair: "#bf7643", top: "#755c96", bottom: "#252334", shoes: "#e2e3ea", accent: "#72bade", hairStyle: "bob" },
  { skin: "#81533f", hair: "#0b0e12", top: "#9a674f", bottom: "#243244", shoes: "#d0c6b3", accent: "#d65065", hairStyle: "cap", coat: true },
  { skin: "#b8775d", hair: "#20151c", top: "#416a83", bottom: "#392b49", shoes: "#f0d7b3", accent: "#dc678f", hairStyle: "curls", skirt: true },
  { skin: "#5f3b31", hair: "#050608", top: "#7d8052", bottom: "#1c2230", shoes: "#afb5c5", accent: "#d18c45", hairStyle: "short" },
  { skin: "#e0a47e", hair: "#32201a", top: "#73515c", bottom: "#283047", shoes: "#e9e5dc", accent: "#58b6aa", hairStyle: "bun", coat: true }
];

function clampByte(value: number): number { return Math.max(0, Math.min(255, Math.round(value))); }

function parseHex(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return [Number.parseInt(normalized.slice(0, 2), 16), Number.parseInt(normalized.slice(2, 4), 16), Number.parseInt(normalized.slice(4, 6), 16)];
}

function shade(hex: string, factor: number): string {
  const [red, green, blue] = parseHex(hex);
  return `rgb(${clampByte(red * factor)},${clampByte(green * factor)},${clampByte(blue * factor)})`;
}

function mix(first: string, second: string, amount: number): string {
  const left = parseHex(first); const right = parseHex(second); const blend = Math.max(0, Math.min(1, amount));
  return `rgb(${clampByte(left[0] + (right[0] - left[0]) * blend)},${clampByte(left[1] + (right[1] - left[1]) * blend)},${clampByte(left[2] + (right[2] - left[2]) * blend)})`;
}

function alphaColor(hex: string, alpha: number): string {
  const [red, green, blue] = parseHex(hex);
  return `rgba(${red},${green},${blue},${Math.max(0, Math.min(1, alpha))})`;
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function pixelateEnvironment(context: CanvasRenderingContext2D, scratchCanvas: HTMLCanvasElement, scratchContext: CanvasRenderingContext2D, blockSize = 1): void {
  // La scena è già renderizzata a 180×320/320×180 e ingrandita con
  // NearestFilter. Un secondo dimezzamento della risoluzione produceva salti
  // di due pixel nel parallasse; il livello 1 conserva il pixel nativo.
  if (blockSize <= 1) return;
  const sourceCanvas = context.canvas; const reducedWidth = Math.ceil(sourceCanvas.width / blockSize); const reducedHeight = Math.ceil(sourceCanvas.height / blockSize);
  scratchContext.imageSmoothingEnabled = false; scratchContext.globalAlpha = 1; scratchContext.globalCompositeOperation = "copy"; scratchContext.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
  scratchContext.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, reducedWidth, reducedHeight);
  context.imageSmoothingEnabled = false; context.globalAlpha = 1; context.globalCompositeOperation = "copy";
  context.drawImage(scratchCanvas, 0, 0, reducedWidth, reducedHeight, 0, 0, sourceCanvas.width, sourceCanvas.height);
  context.globalCompositeOperation = "source-over";
}

function pixelRect(context: CanvasRenderingContext2D, color: string, x: number, y: number, width: number, height: number): void {
  context.fillStyle = color; context.fillRect(Math.round(x), Math.round(y), Math.ceil(width), Math.ceil(height));
}

function polygon(context: CanvasRenderingContext2D, color: string, points: readonly Point[]): void {
  if (points.length < 3) return;
  const vertices = points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
  const minimumY = Math.min(...vertices.map((point) => point.y));
  const maximumY = Math.max(...vertices.map((point) => point.y));
  context.fillStyle = color;
  for (let y = minimumY; y < maximumY; y += 1) {
    const scanY = y + .5; const intersections: number[] = [];
    for (let index = 0; index < vertices.length; index += 1) {
      const start = vertices[index]!; const end = vertices[(index + 1) % vertices.length]!;
      if ((start.y <= scanY && end.y > scanY) || (end.y <= scanY && start.y > scanY)) intersections.push(start.x + (scanY - start.y) * (end.x - start.x) / (end.y - start.y));
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = Math.ceil(intersections[index]!); const right = Math.floor(intersections[index + 1]!);
      if (right >= left) context.fillRect(left, y, right - left + 1, 1);
    }
  }
}

function hash(index: number): number {
  const value = Math.sin(index * 91.173 + 14.71) * 43_758.5453;
  return value - Math.floor(value);
}

function drawAtSubpixelX(context: CanvasRenderingContext2D, x: number, draw: (snappedX: number) => void): void {
  const snappedX = Math.round(x);
  context.save(); context.translate(x - snappedX, 0); draw(snappedX); context.restore();
}

function endPoint(start: Point, length: number, angle: number, facing: number): Point {
  return { x: start.x + Math.sin(angle) * length * facing, y: start.y + Math.cos(angle) * length };
}

function limb(context: CanvasRenderingContext2D, start: Point, length: number, thickness: number, angle: number, facing: number, color: string, outline = "#090a10"): Point {
  const end = endPoint(start, length, angle, facing); const dx = end.x - start.x; const dy = end.y - start.y; const magnitude = Math.max(.001, Math.hypot(dx, dy)); const px = -dy / magnitude; const py = dx / magnitude;
  const outer = thickness / 2 + 1; const inner = thickness / 2;
  polygon(context, outline, [{ x: start.x + px * outer, y: start.y + py * outer }, { x: end.x + px * outer, y: end.y + py * outer }, { x: end.x - px * outer, y: end.y - py * outer }, { x: start.x - px * outer, y: start.y - py * outer }]);
  polygon(context, color, [{ x: start.x + px * inner, y: start.y + py * inner }, { x: end.x + px * inner, y: end.y + py * inner }, { x: end.x - px * inner, y: end.y - py * inner }, { x: start.x - px * inner, y: start.y - py * inner }]);
  pixelRect(context, outline, end.x - outer, end.y - outer, outer * 2, outer * 2); pixelRect(context, color, end.x - inner, end.y - inner, inner * 2, inner * 2); return end;
}

function heroStyle(settings: PixelArtSettings, faceSprite?: HTMLImageElement | null): CharacterStyle {
  const style: CharacterStyle = { skin: "#ad7056", hair: "#08070a", top: heroHoodieColor, bottom: settings.pantsColor, shoes: "#d9d5d2", accent: settings.neonSecondary, hood: true, headphones: true, hairStyle: "fringe", portraitFeatures: true };
  return faceSprite ? { ...style, faceSprite } : style;
}

function idlePose(): RigPose {
  return { bob: 0, torsoLean: .035, headTilt: 0, frontThigh: .02, backThigh: -.03, frontKnee: .08, backKnee: .1, frontUpperArm: .03, backUpperArm: -.04, frontForearm: .08, backForearm: .06 };
}

function walkingPose(walkingElapsedSeconds: number, walking: boolean): RigPose {
  const rig = resolvePixelArtWalkRig(walkingElapsedSeconds, walking);
  return { bob: rig.bodyBob, torsoLean: rig.torsoLean, headTilt: Math.sin(rig.phaseRadians * 2) * .008, frontThigh: rig.frontThigh, backThigh: rig.backThigh, frontKnee: rig.frontKnee, backKnee: rig.backKnee, frontFootOffset: rig.frontFootOffset, backFootOffset: rig.backFootOffset, frontFootLift: rig.frontFootLift, backFootLift: rig.backFootLift, frontUpperArm: rig.frontArm, backUpperArm: rig.backArm, frontForearm: .1 + Math.max(0, -rig.frontArm) * .08, backForearm: .1 + Math.max(0, -rig.backArm) * .08 };
}

function drawHair(context: CanvasRenderingContext2D, center: Point, style: CharacterStyle, scale: number, facing: number): void {
  const size = 6 * scale; pixelRect(context, style.hair, center.x - size, center.y - size * 1.05, size * 2, size * .62);
  if (style.hairStyle === "curls") for (let index = 0; index < 5; index += 1) pixelRect(context, style.hair, center.x - size + index * 2.3 * scale, center.y - size * 1.18 + (index % 2) * scale, 3 * scale, 3 * scale);
  else if (style.hairStyle === "bob") pixelRect(context, style.hair, center.x - size * 1.05, center.y - size * .85, size * 2.1, size * 1.22);
  else if (style.hairStyle === "bun") pixelRect(context, style.hair, center.x - facing * size * .48 - size * .5, center.y - size * 1.48, size, size);
  else if (style.hairStyle === "cap") { pixelRect(context, style.hair, center.x - size, center.y - size * 1.2, size * 2, size * .5); pixelRect(context, style.accent, center.x + facing * size * .6, center.y - size * .92, size, 2 * scale); }
  else if (style.hairStyle === "fringe") {
    pixelRect(context, style.hair, center.x - size * 1.02, center.y - size * 1.16, size * 2.02, size * .72);
    for (let index = 0; index < 5; index += 1) { const lockX = center.x - size * .55 + index * 2.1 * scale; const lockHeight = (3 + index % 3 * 2) * scale; pixelRect(context, style.hair, lockX, center.y - size * .67, 2 * scale, lockHeight); }
    pixelRect(context, shade(style.hair, 1.5), center.x - size * .55, center.y - size * 1.03, 3 * scale, scale);
  }
}

function drawProfileHead(context: CanvasRenderingContext2D, center: Point, style: CharacterStyle, scale: number, facing: number, tilt: number): void {
  const outline = "#08090d"; const featureScale = style.portraitFeatures ? 1.14 : 1; const headWidth = 10 * scale * featureScale; const headHeight = 12 * scale * featureScale; const shifted = { x: center.x + Math.sin(tilt) * 2 * scale, y: center.y };
  if (style.faceSprite?.complete && style.faceSprite.naturalWidth > 0) {
    const hoodWidth = 18.5 * scale; const hoodHeight = 21 * scale; const hoodCenter = { x: shifted.x - facing * .7 * scale, y: shifted.y + .8 * scale };
    polygon(context, "#030409", [{ x: hoodCenter.x - hoodWidth * .5, y: hoodCenter.y - hoodHeight * .18 }, { x: hoodCenter.x - hoodWidth * .32, y: hoodCenter.y - hoodHeight * .48 }, { x: hoodCenter.x + facing * hoodWidth * .08, y: hoodCenter.y - hoodHeight * .55 }, { x: hoodCenter.x + hoodWidth * .48, y: hoodCenter.y - hoodHeight * .2 }, { x: hoodCenter.x + hoodWidth * .45, y: hoodCenter.y + hoodHeight * .37 }, { x: hoodCenter.x + facing * hoodWidth * .12, y: hoodCenter.y + hoodHeight * .52 }, { x: hoodCenter.x - hoodWidth * .4, y: hoodCenter.y + hoodHeight * .32 }]);
    polygon(context, "#10131b", [{ x: hoodCenter.x - hoodWidth * .42, y: hoodCenter.y - hoodHeight * .16 }, { x: hoodCenter.x - hoodWidth * .26, y: hoodCenter.y - hoodHeight * .4 }, { x: hoodCenter.x + facing * hoodWidth * .08, y: hoodCenter.y - hoodHeight * .47 }, { x: hoodCenter.x + hoodWidth * .39, y: hoodCenter.y - hoodHeight * .16 }, { x: hoodCenter.x + hoodWidth * .36, y: hoodCenter.y + hoodHeight * .29 }, { x: hoodCenter.x + facing * hoodWidth * .09, y: hoodCenter.y + hoodHeight * .42 }, { x: hoodCenter.x - hoodWidth * .34, y: hoodCenter.y + hoodHeight * .27 }]);
    const spriteSize = 20.5 * scale; context.save(); context.translate(Math.round(shifted.x + facing * .55 * scale), Math.round(shifted.y - .2 * scale)); context.rotate(tilt * .5); context.drawImage(style.faceSprite, Math.round(-spriteSize * .5), Math.round(-spriteSize * .5), Math.round(spriteSize), Math.round(spriteSize)); context.restore();
    context.save(); context.strokeStyle = "#020308"; context.lineWidth = Math.max(2, 2.4 * scale); context.beginPath(); context.arc(Math.round(shifted.x - facing * .6 * scale), Math.round(shifted.y - 1.5 * scale), 7.4 * scale, Math.PI * 1.08, Math.PI * 1.9); context.stroke(); context.strokeStyle = "#303541"; context.lineWidth = Math.max(1, .85 * scale); context.stroke(); context.restore();
    pixelRect(context, "#030409", shifted.x - facing * 8.2 * scale - 2.2 * scale, shifted.y - 3.2 * scale, 4.4 * scale, 7.4 * scale); pixelRect(context, "#202532", shifted.x - facing * 8.2 * scale - 1.4 * scale, shifted.y - 2.3 * scale, 2.8 * scale, 5.5 * scale); pixelRect(context, style.accent, shifted.x - facing * 8.2 * scale - .5 * scale, shifted.y - 1.7 * scale, scale, 4.1 * scale);
    polygon(context, "#030409", [{ x: shifted.x - 7.5 * scale, y: shifted.y + 7 * scale }, { x: shifted.x - 2 * scale, y: shifted.y + 8.8 * scale }, { x: shifted.x + 5.6 * scale, y: shifted.y + 7.2 * scale }, { x: shifted.x + 3.5 * scale, y: shifted.y + 10.2 * scale }, { x: shifted.x - 4.4 * scale, y: shifted.y + 10.4 * scale }]);
    return;
  }
  if (style.hood) {
    pixelRect(context, outline, shifted.x - headWidth * .72, shifted.y - headHeight * .64, headWidth * 1.42, headHeight * 1.25);
    pixelRect(context, shade(style.top, .48), shifted.x - headWidth * .62, shifted.y - headHeight * .58, headWidth * 1.22, headHeight * 1.12);
  }
  pixelRect(context, outline, shifted.x - headWidth * .43, shifted.y - headHeight * .43, headWidth * .82, headHeight * .91);
  pixelRect(context, style.skin, shifted.x - headWidth * .33, shifted.y - headHeight * .36, headWidth * .7, headHeight * .74);
  pixelRect(context, style.skin, shifted.x + facing * headWidth * .3 - (facing < 0 ? 2 * scale : 0), shifted.y - scale, 3 * scale, 3 * scale);
  drawHair(context, shifted, style, scale, facing);
  if (style.portraitFeatures) {
    pixelRect(context, "#21181a", shifted.x + facing * headWidth * .08 - scale / 2, shifted.y - headHeight * .2, 4 * scale, scale);
    pixelRect(context, "#e6d2be", shifted.x + facing * headWidth * .18 - scale / 2, shifted.y - headHeight * .11, 2 * scale, scale);
    pixelRect(context, "#8d8047", shifted.x + facing * headWidth * .24 - scale / 2, shifted.y - headHeight * .11, scale, scale);
    pixelRect(context, shade(style.skin, .55), shifted.x + facing * headWidth * .38 - scale / 2, shifted.y + headHeight * .02, 3 * scale, 2 * scale);
    pixelRect(context, "#7b3f48", shifted.x + facing * headWidth * .31 - scale / 2, shifted.y + headHeight * .22, 3 * scale, scale);
    pixelRect(context, shade(style.skin, .72), shifted.x - facing * headWidth * .23, shifted.y + headHeight * .12, 2 * scale, scale);
    pixelRect(context, "#bfc5ce", shifted.x - facing * headWidth * .31, shifted.y + headHeight * .14, scale, 2 * scale);
    pixelRect(context, shade(style.skin, .58), shifted.x + facing * headWidth * .02, shifted.y + headHeight * .34, 3 * scale, scale);
  } else {
    pixelRect(context, "#141218", shifted.x + facing * headWidth * .19 - scale / 2, shifted.y - headHeight * .12, scale, scale);
    pixelRect(context, shade(style.skin, .62), shifted.x + facing * headWidth * .33 - scale / 2, shifted.y + headHeight * .17, 2 * scale, scale);
  }
  if (style.headphones) {
    context.strokeStyle = "#08090e"; context.lineWidth = Math.max(2, 3 * scale); context.beginPath(); context.arc(Math.round(shifted.x), Math.round(shifted.y - scale), 7 * scale, Math.PI * 1.05, Math.PI * 1.95); context.stroke();
    context.strokeStyle = mix(style.accent, "#c7cbd6", .45); context.lineWidth = Math.max(1, 1.4 * scale); context.stroke();
    pixelRect(context, "#090a0f", shifted.x - facing * 7 * scale - 2 * scale, shifted.y - 3 * scale, 4 * scale, 7 * scale); pixelRect(context, style.accent, shifted.x - facing * 7 * scale - scale, shifted.y - 2 * scale, 2 * scale, 5 * scale);
  }
}

function drawLegIk(context: CanvasRenderingContext2D, hip: Point, foot: Point, scale: number, facing: number, color: string, shoes: string, tone = 1): void {
  const upperLength = 15 * scale; const lowerLength = 15 * scale; const knee = solvePixelArtKnee(hip, foot, upperLength, lowerLength, facing);
  const upperAngle = Math.atan2((knee.x - hip.x) * facing, knee.y - hip.y); const lowerAngle = Math.atan2((foot.x - knee.x) * facing, foot.y - knee.y);
  limb(context, hip, upperLength, 7 * scale, upperAngle, facing, shade(color, tone)); limb(context, knee, lowerLength, 6 * scale, lowerAngle, facing, shade(color, tone * .8));
  pixelRect(context, shade(color, Math.min(1.15, tone * 1.08)), knee.x + facing * scale, knee.y - 2 * scale, 2 * scale, 3 * scale);
  pixelRect(context, "#08090e", foot.x - 3 * scale, foot.y - 3 * scale, 11 * scale, 5 * scale); pixelRect(context, shoes, foot.x - 2 * scale, foot.y - 2 * scale, 9 * scale, 3 * scale); pixelRect(context, "#ffffff", foot.x + 4 * scale, foot.y, 3 * scale, scale);
}

function drawArmIk(context: CanvasRenderingContext2D, shoulder: Point, scale: number, facing: number, color: string, skin: string, swingAngle: number, flex: number, tone: number, drawHand: boolean): Point {
  const upperLength = 13 * scale; const lowerLength = 12 * scale; const reach = Math.max(17.5, 21.4 - Math.abs(flex) * 1.4) * scale; const targetAngle = swingAngle + flex * .08; const hand = endPoint(shoulder, reach, targetAngle, facing); const elbow = solvePixelArtElbow(shoulder, hand, upperLength, lowerLength, facing);
  const upperAngle = Math.atan2((elbow.x - shoulder.x) * facing, elbow.y - shoulder.y); const lowerAngle = Math.atan2((hand.x - elbow.x) * facing, hand.y - elbow.y);
  limb(context, shoulder, upperLength, 6.5 * scale, upperAngle, facing, shade(color, tone)); limb(context, elbow, lowerLength, 5.7 * scale, lowerAngle, facing, shade(color, tone * .82));
  pixelRect(context, shade(color, Math.min(1.08, tone * .94)), elbow.x - 2 * scale, elbow.y - 2 * scale, 4 * scale, 4 * scale);
  if (drawHand) { pixelRect(context, "#06070a", hand.x - 1.9 * scale, hand.y - 1.9 * scale, 3.8 * scale, 3.8 * scale); pixelRect(context, skin, hand.x - 1.4 * scale, hand.y - 1.4 * scale, 2.8 * scale, 2.8 * scale); }
  return hand;
}

function drawCharacter(context: CanvasRenderingContext2D, x: number, baseline: number, scale: number, facing: number, style: CharacterStyle, pose: RigPose): void {
  const outline = "#08090e"; const hip: Point = { x, y: baseline - 29 * scale - pose.bob * scale }; const torsoLean = pose.torsoLean * facing; const shoulder: Point = { x: hip.x + torsoLean * 20 * scale, y: hip.y - 21 * scale }; const neck: Point = { x: shoulder.x + torsoLean * 2 * scale, y: shoulder.y - 4 * scale };
  pixelRect(context, "#05060a", x - 12 * scale, baseline - 2 * scale, 24 * scale, 2 * scale);
  const backFoot: Point = { x: hip.x + (pose.backFootOffset ?? Math.sin(pose.backThigh) * 13) * scale * facing, y: baseline - (pose.backFootLift ?? Math.max(0, pose.backKnee - .08) * 5) * scale };
  drawLegIk(context, hip, backFoot, scale, facing, style.bottom, shade(style.shoes, .7), .65);
  const backArmStart = { x: shoulder.x - facing * 3 * scale, y: shoulder.y + 4 * scale }; drawArmIk(context, backArmStart, scale, facing, style.top, style.skin, pose.backUpperArm, pose.backForearm, .58, false);
  polygon(context, outline, [{ x: shoulder.x - 7.6 * scale, y: shoulder.y - 2 * scale }, { x: shoulder.x + 7.2 * scale, y: shoulder.y - scale }, { x: hip.x + 7.4 * scale, y: hip.y + 2 * scale }, { x: hip.x - 7.2 * scale, y: hip.y + 2 * scale }]);
  polygon(context, style.top, [{ x: shoulder.x - 6.7 * scale, y: shoulder.y - .7 * scale }, { x: shoulder.x + 6.3 * scale, y: shoulder.y }, { x: hip.x + 6.5 * scale, y: hip.y }, { x: hip.x - 6.3 * scale, y: hip.y }]);
  polygon(context, shade(style.top, 1.7), [{ x: shoulder.x + facing * scale, y: shoulder.y }, { x: shoulder.x + facing * 5.8 * scale, y: shoulder.y + scale }, { x: hip.x + facing * 5.8 * scale, y: hip.y }, { x: hip.x + facing * 3.6 * scale, y: hip.y }]);
  if (style.coat) { pixelRect(context, shade(style.top, .72), hip.x - 8 * scale, shoulder.y + 10 * scale, 16 * scale, 13 * scale); pixelRect(context, style.accent, hip.x - scale / 2, shoulder.y + scale, scale, 22 * scale); }
  if (style.skirt) polygon(context, shade(style.bottom, .82), [{ x: hip.x - 8 * scale, y: hip.y }, { x: hip.x + 8 * scale, y: hip.y }, { x: hip.x + 11 * scale, y: hip.y + 11 * scale }, { x: hip.x - 11 * scale, y: hip.y + 11 * scale }]);
  if (style.hood) { polygon(context, "#05060a", [{ x: shoulder.x - 7 * scale, y: shoulder.y - 5 * scale }, { x: shoulder.x + 3 * scale, y: shoulder.y - 6 * scale }, { x: shoulder.x + 5.5 * scale, y: shoulder.y + 4 * scale }, { x: shoulder.x - 5.5 * scale, y: shoulder.y + 6 * scale }]); pixelRect(context, "#171a23", hip.x - 5.5 * scale, hip.y - 5 * scale, 4 * scale, 1.5 * scale); pixelRect(context, "#171a23", hip.x + 2 * scale, hip.y - 5 * scale, 4 * scale, 1.5 * scale); }
  const frontFoot: Point = { x: hip.x + (pose.frontFootOffset ?? Math.sin(pose.frontThigh) * 13) * scale * facing, y: baseline - (pose.frontFootLift ?? Math.max(0, pose.frontKnee - .08) * 5) * scale };
  drawLegIk(context, hip, frontFoot, scale, facing, style.bottom, style.shoes, .92);
  const frontArmStart = { x: shoulder.x + facing * 4 * scale, y: shoulder.y + 4 * scale }; drawArmIk(context, frontArmStart, scale, facing, style.top, style.skin, pose.frontUpperArm, pose.frontForearm, .88, true);
  drawProfileHead(context, { x: neck.x + facing * .45 * scale, y: neck.y - 6 * scale }, style, scale, facing, pose.headTilt);
  if (style.hood) { pixelRect(context, "#646977", shoulder.x + facing * 1.2 * scale, shoulder.y + 3 * scale, .8 * scale, 12 * scale); pixelRect(context, style.accent, shoulder.x + facing * 1.1 * scale, shoulder.y + 14.5 * scale, 1.3 * scale, 1.3 * scale); }
}

function drawFrontHead(context: CanvasRenderingContext2D, center: Point, style: CharacterStyle, scale: number, tilt: number): void {
  const bobX = Math.sin(tilt) * scale;
  const hoodCenter = { x: center.x + bobX, y: center.y };
  pixelRect(context, "#030409", hoodCenter.x - 10 * scale, hoodCenter.y - 11 * scale, 20 * scale, 22 * scale);
  pixelRect(context, "#10131b", hoodCenter.x - 8.7 * scale, hoodCenter.y - 9.8 * scale, 17.4 * scale, 19.6 * scale);
  if (style.faceSprite?.complete && style.faceSprite.naturalWidth > 0) {
    context.save(); context.imageSmoothingEnabled = false;
    context.drawImage(style.faceSprite, Math.round(hoodCenter.x - 7.4 * scale), Math.round(hoodCenter.y - 7.5 * scale), Math.round(14.8 * scale), Math.round(15 * scale)); context.restore();
  } else {
    pixelRect(context, style.skin, hoodCenter.x - 6.4 * scale, hoodCenter.y - 6.5 * scale, 12.8 * scale, 13.2 * scale);
    pixelRect(context, style.hair, hoodCenter.x - 6.4 * scale, hoodCenter.y - 6.5 * scale, 12.8 * scale, 4.2 * scale);
    pixelRect(context, "#17131a", hoodCenter.x - 3.8 * scale, hoodCenter.y - .8 * scale, 1.4 * scale, 1.4 * scale);
    pixelRect(context, "#17131a", hoodCenter.x + 2.4 * scale, hoodCenter.y - .8 * scale, 1.4 * scale, 1.4 * scale);
    pixelRect(context, "#7b3f48", hoodCenter.x - 2 * scale, hoodCenter.y + 4 * scale, 4 * scale, scale);
  }
  context.save(); context.strokeStyle = "#05060a"; context.lineWidth = Math.max(2, 2.2 * scale); context.beginPath(); context.arc(hoodCenter.x, hoodCenter.y - scale, 8.6 * scale, Math.PI * 1.05, Math.PI * 1.95); context.stroke(); context.restore();
  pixelRect(context, "#090a0f", hoodCenter.x - 10.6 * scale, hoodCenter.y - 3.5 * scale, 3.3 * scale, 7 * scale);
  pixelRect(context, "#090a0f", hoodCenter.x + 7.3 * scale, hoodCenter.y - 3.5 * scale, 3.3 * scale, 7 * scale);
  pixelRect(context, style.accent, hoodCenter.x - 9.7 * scale, hoodCenter.y - 2.6 * scale, 1.5 * scale, 5.2 * scale);
  pixelRect(context, style.accent, hoodCenter.x + 8.2 * scale, hoodCenter.y - 2.6 * scale, 1.5 * scale, 5.2 * scale);
}

/** Front-view rig: contralateral arms, alternating leg depth and stable head. */
function drawFrontCharacter(context: CanvasRenderingContext2D, x: number, baseline: number, scale: number, style: CharacterStyle, pose: RigPose): void {
  const phase = Math.atan2(pose.frontFootOffset ?? 0, 5.8); const stride = Math.sin(phase);
  const bob = pose.bob * scale; const hipY = baseline - 29 * scale - bob; const shoulderY = hipY - 21 * scale;
  const leftForward = stride >= 0; const leftLift = (leftForward ? pose.frontFootLift : pose.backFootLift) ?? 0; const rightLift = (leftForward ? pose.backFootLift : pose.frontFootLift) ?? 0;
  const drawLeg = (side: -1 | 1, lift: number, forward: boolean) => {
    const hip = { x: x + side * 3.3 * scale, y: hipY }; const knee = { x: x + side * (3.8 + Math.abs(stride) * 1.2) * scale, y: hipY + (14.2 - lift * .18) * scale }; const foot = { x: x + side * (4.6 + Math.abs(stride) * 1.4) * scale, y: baseline - lift * scale };
    const tone = forward ? 1.06 : .68; const segment = (a: Point, b: Point, width: number, color: string) => { const angle = Math.atan2(b.x - a.x, b.y - a.y); limb(context, a, Math.hypot(b.x - a.x, b.y - a.y), width * scale, angle, 1, color); };
    segment(hip, knee, 6.6, shade(style.bottom, tone)); segment(knee, foot, 5.8, shade(style.bottom, tone * .86));
    pixelRect(context, "#08090e", foot.x - 4.4 * scale, foot.y - 2.8 * scale, 8.8 * scale, 4.4 * scale); pixelRect(context, style.shoes, foot.x - 3.6 * scale, foot.y - 2 * scale, 7.2 * scale, 2.7 * scale);
  };
  if (leftForward) drawLeg(1, rightLift, false); else drawLeg(-1, leftLift, false);
  const armSwing = stride * 2.8 * scale;
  const drawArm = (side: -1 | 1, forward: boolean) => { const shoulder = { x: x + side * 7 * scale, y: shoulderY + 3 * scale }; const elbow = { x: x + side * 9 * scale - armSwing * side, y: shoulderY + 14 * scale }; const hand = { x: x + side * 7.5 * scale - armSwing * side * 1.3, y: shoulderY + 25 * scale }; const tone = forward ? .98 : .6; const angleA = Math.atan2(elbow.x - shoulder.x, elbow.y - shoulder.y); const angleB = Math.atan2(hand.x - elbow.x, hand.y - elbow.y); limb(context, shoulder, Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y), 5.6 * scale, angleA, 1, shade(style.top, tone)); limb(context, elbow, Math.hypot(hand.x - elbow.x, hand.y - elbow.y), 4.8 * scale, angleB, 1, shade(style.top, tone * .88)); };
  drawArm(leftForward ? 1 : -1, false);
  polygon(context, "#05060a", [{ x: x - 8 * scale, y: shoulderY - scale }, { x: x + 8 * scale, y: shoulderY - scale }, { x: x + 6.8 * scale, y: hipY + 2 * scale }, { x: x - 6.8 * scale, y: hipY + 2 * scale }]);
  polygon(context, style.top, [{ x: x - 7 * scale, y: shoulderY }, { x: x + 7 * scale, y: shoulderY }, { x: x + 5.8 * scale, y: hipY }, { x: x - 5.8 * scale, y: hipY }]);
  pixelRect(context, "#242936", x - .7 * scale, shoulderY + 3 * scale, 1.4 * scale, 17 * scale);
  drawArm(leftForward ? -1 : 1, true);
  if (leftForward) drawLeg(-1, leftLift, true); else drawLeg(1, rightLift, true);
  drawFrontHead(context, { x, y: shoulderY - 9.5 * scale }, style, scale, pose.headTilt);
}

function drawBuilding(context: CanvasRenderingContext2D, x: number, ground: number, width: number, height: number, color: string, seed: number, neon: string): void {
  const top = ground - height; pixelRect(context, shade(color, .72), x, top, width, height); pixelRect(context, shade(color, 1.12), x + 2, top, 2, height); pixelRect(context, "#090b17", x + width - 3, top, 3, height);
  for (let row = 0; row < Math.floor(height / 15); row += 1) for (let column = 0; column < Math.floor(width / 13); column += 1) {
    const lit = hash(seed * 101 + row * 17 + column * 37) > .56; const windowColor = lit ? hash(seed + row + column) > .5 ? neon : "#d9aa5c" : "#0a0d18";
    pixelRect(context, windowColor, x + 7 + column * 13, top + 8 + row * 15, 5, 6);
  }
  if (seed % 3 === 0) for (let level = top + 22; level < ground - 12; level += 22) { pixelRect(context, "#111522", x + width - 14, level, 14, 2); pixelRect(context, "#111522", x + width - 12, level, 2, 9); }
}

function drawPixelMoon(context: CanvasRenderingContext2D, width: number, height: number, settings: PixelArtSettings): void {
  const centerX = Math.round(width * .78); const centerY = Math.round(height * .14); const radius = width < 220 ? 17 : 14;
  context.save();
  const halo = context.createRadialGradient(centerX, centerY, radius * .72, centerX, centerY, radius * 2.55);
  halo.addColorStop(0, alphaColor(settings.neonSecondary, .2)); halo.addColorStop(.35, alphaColor("#dbe7ff", .1)); halo.addColorStop(1, alphaColor(settings.neonSecondary, 0));
  context.fillStyle = halo; context.fillRect(centerX - radius * 2.6, centerY - radius * 2.6, radius * 5.2, radius * 5.2);

  context.beginPath(); context.arc(centerX, centerY, radius, 0, Math.PI * 2); context.clip();
  const body = context.createRadialGradient(centerX - radius * .38, centerY - radius * .44, radius * .08, centerX, centerY, radius * 1.12);
  body.addColorStop(0, mix("#fff7d8", settings.neonSecondary, .06)); body.addColorStop(.52, mix("#e0dfd5", settings.neonSecondary, .08)); body.addColorStop(1, mix("#9299a8", settings.neonSecondary, .08));
  context.fillStyle = body; context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);

  const maria = [
    { x: -.28, y: -.08, rx: .31, ry: .2, alpha: .18 },
    { x: .18, y: .28, rx: .36, ry: .22, alpha: .14 },
    { x: .27, y: -.38, rx: .18, ry: .12, alpha: .12 }
  ];
  for (const patch of maria) {
    context.beginPath(); context.ellipse(centerX + patch.x * radius, centerY + patch.y * radius, patch.rx * radius, patch.ry * radius, -.22, 0, Math.PI * 2);
    context.fillStyle = alphaColor("#5f6878", patch.alpha); context.fill();
  }

  const craters = [
    { x: -.42, y: -.34, radius: .19 },
    { x: .29, y: -.16, radius: .15 },
    { x: -.08, y: .35, radius: .22 },
    { x: .48, y: .39, radius: .1 },
    { x: -.52, y: .2, radius: .09 }
  ];
  for (const crater of craters) {
    const x = centerX + crater.x * radius; const y = centerY + crater.y * radius; const craterRadius = crater.radius * radius;
    context.beginPath(); context.ellipse(x, y, craterRadius, craterRadius * .72, -.28, 0, Math.PI * 2); context.fillStyle = alphaColor("#ffffff", .2); context.fill();
    context.beginPath(); context.ellipse(x + craterRadius * .12, y + craterRadius * .16, craterRadius * .78, craterRadius * .55, -.28, 0, Math.PI * 2); context.fillStyle = alphaColor("#555e6d", .32); context.fill();
    context.beginPath(); context.ellipse(x - craterRadius * .2, y - craterRadius * .2, craterRadius * .43, craterRadius * .2, -.28, 0, Math.PI * 2); context.fillStyle = alphaColor("#fff9e5", .28); context.fill();
  }

  const flecks = [[-.12, -.62], [.52, -.5], [-.68, -.05], [.06, .02], [.24, .56], [-.34, .6]] as const;
  for (const [x, y] of flecks) pixelRect(context, alphaColor("#fffdf0", .38), centerX + x * radius, centerY + y * radius, 1, 1);
  context.restore();

  context.save(); context.beginPath(); context.arc(centerX, centerY, radius, 0, Math.PI * 2); context.strokeStyle = alphaColor("#f7f5e8", .58); context.lineWidth = 1; context.stroke(); context.restore();
}

function drawStreet(context: CanvasRenderingContext2D, width: number, height: number, distance: number, settings: PixelArtSettings): number {
  const sidewalk = Math.round(height * .7); pixelRect(context, "#05060a", 0, 0, width, height);
  const sky = context.createLinearGradient(0, 0, 0, sidewalk); sky.addColorStop(0, "#03040b"); sky.addColorStop(.62, "#0a0d1d"); sky.addColorStop(1, shade(settings.neonSecondary, .12)); context.fillStyle = sky; context.fillRect(0, 0, width, sidewalk);
  drawPixelMoon(context, width, height, settings);
  const tileWidth = 58; const buildingTravel = distance * .42; const wholeBuildingTravel = Math.floor(buildingTravel); const buildingOffset = -(wholeBuildingTravel % tileWidth) - tileWidth; const buildingSubpixel = buildingTravel - wholeBuildingTravel;
  context.save(); context.translate(-buildingSubpixel, 0);
  for (let index = -1; index < Math.ceil(width / tileWidth) + 2; index += 1) {
    const seed = Math.floor(wholeBuildingTravel / tileWidth) + index; const buildingHeight = height * (.4 + hash(seed) * .29);
    drawBuilding(context, buildingOffset + index * tileWidth, sidewalk + 2, tileWidth - 3, buildingHeight, seed % 2 ? "#1b1d2b" : "#151b29", seed, seed % 2 ? settings.neonPrimary : settings.neonSecondary);
  }
  context.restore();
  pixelRect(context, "#282b33", 0, sidewalk, width, 19); pixelRect(context, "#72737a", 0, sidewalk, width, 3); pixelRect(context, "#13151b", 0, sidewalk + 17, width, 3);
  const slabWidth = 34; const slabOffset = -(distance % slabWidth); for (let x = slabOffset; x < width; x += slabWidth) { pixelRect(context, "#3c3e46", x, sidewalk + 3, 1, 13); pixelRect(context, "#1d1f26", x + 2, sidewalk + 14, slabWidth - 4, 1); }
  const asphaltY = sidewalk + 20; pixelRect(context, "#050609", 0, asphaltY, width, height - asphaltY);
  for (let index = 0; index < 180; index += 1) {
    const x = ((hash(index * 23) * width - distance * (1.02 + hash(index) * .12)) % width + width) % width; const y = asphaltY + hash(index * 31) * (height - asphaltY); const value = hash(index * 47);
    pixelRect(context, value > .82 ? "#17191e" : value > .42 ? "#0d0f13" : "#08090c", x, y, value > .93 ? 2 : 1, 1);
  }
  for (let crack = 0; crack < 8; crack += 1) {
    let x = ((hash(crack * 71) * width - distance * 1.03) % (width + 30) + width + 30) % (width + 30) - 15; let y = asphaltY + 8 + hash(crack * 83) * Math.max(1, height - asphaltY - 18);
    for (let segment = 0; segment < 5; segment += 1) { pixelRect(context, "#22242a", x, y, 4 + segment % 2, 1); x += 3; y += segment % 2 ? 2 : -1; }
  }
  for (let x = -((distance * 1.15) % 82); x < width; x += 82) pixelRect(context, "#706446", x, asphaltY + 23, 29, 2);
  return sidewalk;
}

function drawTrafficLight(context: CanvasRenderingContext2D, x: number, ground: number, waiting: boolean): void {
  pixelRect(context, "#101218", x, ground - 78, 5, 78); pixelRect(context, "#343943", x - 8, ground - 83, 20, 34); pixelRect(context, "#07080c", x - 6, ground - 80, 16, 28);
  for (let index = 0; index < 3; index += 1) { const active = index === (waiting ? 0 : 2); pixelRect(context, active ? waiting ? "#ff2948" : "#3ee277" : "#1b1d24", x - 2, ground - 77 + index * 9, 8, 7); if (active) pixelRect(context, "#ffffff", x, ground - 76 + index * 9, 2, 2); }
  pixelRect(context, "#161923", x - 12, ground - 46, 29, 3);
}

function drawVenue(context: CanvasRenderingContext2D, x: number, ground: number, width: number, height: number, settings: PixelArtSettings, doorOpen = 0): void {
  const top = ground - height; pixelRect(context, "#090a0f", x, top, width, height); pixelRect(context, shade(settings.neonPrimary, .18), x + 3, top + 4, width - 6, height - 4);
  const doorX = x + 13; const doorY = ground - 56; pixelRect(context, "#05060a", doorX, doorY, 36, 56); pixelRect(context, mix(settings.neonPrimary, "#ffffff", .18), doorX - 2, doorY - 3, 40, 3);
  if (doorOpen > 0) { pixelRect(context, shade(settings.neonSecondary, .28 + doorOpen * .34), doorX + 3, doorY + 3, 30, 50); for (let y = doorY + 5; y < ground - 4; y += 7) pixelRect(context, mix(settings.neonPrimary, settings.neonSecondary, y % 2), doorX + 5, y, 26, 1); }
  const doorPanel = Math.round(15 * (1 - doorOpen)); pixelRect(context, "#171a23", doorX + 2, doorY + 2, doorPanel, 52); pixelRect(context, "#171a23", doorX + 34 - doorPanel, doorY + 2, doorPanel, 52);
  pixelRect(context, "#05060a", x + 5, top + 9, width - 10, 20); pixelRect(context, settings.neonPrimary, x + 7, top + 11, width - 14, 16);
  context.save(); context.fillStyle = "#070710"; context.font = "bold 10px monospace"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(settings.venueName.toUpperCase().slice(0, 12), Math.round(x + width / 2), Math.round(top + 19)); context.restore();
}

function drawLedVenueSign(context: CanvasRenderingContext2D, centerX: number, centerY: number, signWidth: number, signHeight: number, settings: PixelArtSettings, energy: number): void {
  const name = (settings.venueName.trim() || "BAR").toUpperCase().slice(0, 24); const pulse = Math.max(0, Math.min(1, energy)); const left = centerX - signWidth / 2; const top = centerY - signHeight / 2;
  context.save();
  context.globalCompositeOperation = "lighter";
  const wallGlow = context.createRadialGradient(centerX, centerY, 2, centerX, centerY, signWidth * .72);
  wallGlow.addColorStop(0, alphaColor(settings.neonPrimary, .24 + pulse * .14)); wallGlow.addColorStop(.44, alphaColor(settings.neonSecondary, .1 + pulse * .06)); wallGlow.addColorStop(1, alphaColor(settings.neonPrimary, 0));
  context.fillStyle = wallGlow; context.fillRect(left - signWidth * .42, top - signHeight * 1.2, signWidth * 1.84, signHeight * 3.4); context.restore();
  pixelRect(context, "#020307", left - 4, top - 4, signWidth + 8, signHeight + 8);
  pixelRect(context, shade(settings.neonPrimary, .3), left - 2, top - 2, signWidth + 4, signHeight + 4);
  pixelRect(context, "#05060b", left, top, signWidth, signHeight);
  context.save(); context.globalCompositeOperation = "lighter"; context.globalAlpha = .62 + pulse * .28; context.strokeStyle = settings.neonPrimary; context.shadowColor = settings.neonPrimary; context.shadowBlur = 8 + pulse * 10; context.lineWidth = 2; context.strokeRect(Math.round(left + 2), Math.round(top + 2), Math.round(signWidth - 4), Math.round(signHeight - 4)); context.restore();
  const ledSpacing = 7;
  for (let offset = 5, index = 0; offset < signWidth - 4; offset += ledSpacing, index += 1) {
    const color = index % 2 ? settings.neonSecondary : settings.neonPrimary;
    context.save(); context.globalCompositeOperation = "lighter"; context.fillStyle = color; context.shadowColor = color; context.shadowBlur = 4 + pulse * 5; context.globalAlpha = .72 + pulse * .28; context.fillRect(Math.round(left + offset), Math.round(top + 3), 2, 2); context.fillRect(Math.round(left + offset), Math.round(top + signHeight - 5), 2, 2); context.restore();
  }
  const maximumFontSize = Math.max(10, Math.min(18, Math.round(signHeight * .48))); const fittedFontSize = Math.max(8, Math.min(maximumFontSize, Math.floor((signWidth - 14) / Math.max(1, name.length * .64))));
  context.save(); context.font = `bold ${fittedFontSize}px monospace`; context.textAlign = "center"; context.textBaseline = "middle"; context.lineJoin = "round"; context.globalCompositeOperation = "lighter";
  context.strokeStyle = alphaColor(settings.neonPrimary, .7); context.lineWidth = 3; context.shadowColor = settings.neonPrimary; context.shadowBlur = 12 + pulse * 10; context.strokeText(name, Math.round(centerX), Math.round(centerY + 1), signWidth - 12);
  context.fillStyle = mix(settings.neonPrimary, "#ffffff", .82); context.shadowColor = settings.neonSecondary; context.shadowBlur = 5 + pulse * 6; context.fillText(name, Math.round(centerX), Math.round(centerY + 1), signWidth - 12); context.restore();
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement | null, x: number, y: number, size: number, fallback: string): void {
  pixelRect(context, "#05060a", x - 2, y - 2, size + 4, size + 4);
  if (!image?.complete || image.naturalWidth === 0) { pixelRect(context, fallback, x, y, size, size); return; }
  const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight); const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
  context.drawImage(image, Math.round(x + (size - width) / 2), Math.round(y + (size - height) / 2), Math.round(width), Math.round(height));
}

function dancePose(index: number, frame: PixelArtNewYorkFrame): RigPose {
  const tempo = Math.max(60, frame.bpm || 90); const clock = frame.timeSeconds * tempo / 60 * Math.PI * 2; const phase = clock + index * 1.73; const beat = Math.max(frame.rhythmPulse, Math.max(0, Math.sin(clock)) * .32); const style = index % 5;
  if (style === 0) return { ...idlePose(), bob: beat * 3.4, torsoLean: Math.sin(phase) * .13, headTilt: Math.sin(phase) * .08, frontThigh: Math.sin(phase) * .24, backThigh: -Math.sin(phase) * .24, frontKnee: .2 + beat * .32, backKnee: .2 + beat * .32, frontUpperArm: 2.65 + Math.sin(phase) * .18, backUpperArm: -2.65 - Math.sin(phase) * .18, frontForearm: .12, backForearm: -.12 };
  if (style === 1) return { ...idlePose(), bob: beat * 2.2, torsoLean: Math.sin(phase) * .2, headTilt: -Math.sin(phase) * .12, frontThigh: .18 + Math.sin(phase) * .16, backThigh: -.18 - Math.sin(phase) * .16, frontKnee: .25, backKnee: .18, frontUpperArm: 1.25 + Math.sin(phase) * .45, backUpperArm: -1.05 + Math.sin(phase) * .35, frontForearm: -.45, backForearm: .55 };
  if (style === 2) return { ...idlePose(), bob: beat * 4.5, torsoLean: Math.sin(phase * .5) * .08, headTilt: .04, frontThigh: .1, backThigh: -.1, frontKnee: .28 + beat * .52, backKnee: .28 + beat * .52, frontUpperArm: .65 + Math.sin(phase) * .5, backUpperArm: -.65 - Math.sin(phase) * .5, frontForearm: .65, backForearm: -.65 };
  if (style === 3) return { ...idlePose(), bob: beat * 1.7, torsoLean: Math.sin(phase) * .16, headTilt: Math.cos(phase) * .09, frontThigh: Math.sin(phase) * .34, backThigh: -Math.sin(phase) * .34, frontKnee: .14, backKnee: .22, frontUpperArm: Math.sin(phase) * .82, backUpperArm: Math.cos(phase) * .82, frontForearm: -.2, backForearm: .3 };
  return { ...idlePose(), bob: beat * 2.6, torsoLean: Math.sin(phase * .5) * .11, headTilt: Math.sin(phase) * .06, frontThigh: .32 + Math.sin(phase) * .22, backThigh: -.2, frontKnee: .38, backKnee: .16, frontUpperArm: 2.25 + Math.sin(phase) * .35, backUpperArm: -.35 + Math.cos(phase) * .45, frontForearm: -.35, backForearm: .4 };
}

function drawSeatedHero(context: CanvasRenderingContext2D, x: number, floorY: number, settings: PixelArtSettings, frame: PixelArtNewYorkFrame, scale: number, faceSprite: HTMLImageElement | null): void {
  const style = heroStyle(settings, faceSprite); const facing = 1; const sip = (Math.sin(frame.timeSeconds * .72) * .5 + .5) * .9; const hip: Point = { x, y: floorY - 20 * scale }; const shoulder: Point = { x: x + (2.5 + sip * 1.2) * scale, y: hip.y - 21 * scale }; const head: Point = { x: shoulder.x + 3 * scale, y: shoulder.y - 10 * scale };
  pixelRect(context, "#06070b", x - 14 * scale, floorY - scale, 34 * scale, 2 * scale); pixelRect(context, "#272b34", x - 2 * scale, hip.y + 4 * scale, 5 * scale, 23 * scale); pixelRect(context, "#171920", x - 10 * scale, floorY - 2 * scale, 22 * scale, 4 * scale);
  const backKnee = limb(context, hip, 16 * scale, 8 * scale, 1.12, facing, shade(style.bottom, .5)); limb(context, backKnee, 15 * scale, 7 * scale, -.12, facing, shade(style.bottom, .45));
  const frontKnee = limb(context, hip, 17 * scale, 8 * scale, 1.34, facing, shade(style.bottom, .86)); const frontFoot = limb(context, frontKnee, 14 * scale, 7 * scale, .08, facing, shade(style.bottom, .67)); pixelRect(context, style.shoes, frontFoot.x - 2 * scale, frontFoot.y - scale, 10 * scale, 4 * scale);
  polygon(context, "#08090e", [{ x: shoulder.x - 8 * scale, y: shoulder.y }, { x: shoulder.x + 7 * scale, y: shoulder.y }, { x: hip.x + 9 * scale, y: hip.y + 3 * scale }, { x: hip.x - 8 * scale, y: hip.y + 3 * scale }]);
  polygon(context, style.top, [{ x: shoulder.x - 7 * scale, y: shoulder.y + scale }, { x: shoulder.x + 6 * scale, y: shoulder.y + scale }, { x: hip.x + 8 * scale, y: hip.y + scale }, { x: hip.x - 7 * scale, y: hip.y + scale }]);
  pixelRect(context, shade(style.top, .48), shoulder.x - 8 * scale, shoulder.y - 5 * scale, 13 * scale, 11 * scale); drawProfileHead(context, head, style, scale, facing, -.08 - sip * .04);
  const glassX = head.x + 8 * scale; const glassTop = head.y + 7 * scale; const elbow = limb(context, { x: shoulder.x + 4 * scale, y: shoulder.y + 5 * scale }, 11 * scale, 6 * scale, .42, facing, shade(style.top, .9)); const hand = limb(context, elbow, 9 * scale, 5 * scale, -.62, facing, shade(style.top, .72)); pixelRect(context, style.skin, hand.x - 2 * scale, hand.y - 2 * scale, 4 * scale, 4 * scale);
  pixelRect(context, "#071017", glassX - scale, glassTop - scale, 11 * scale, 13 * scale); pixelRect(context, "#9dd8e8aa", glassX, glassTop, 9 * scale, 11 * scale); pixelRect(context, mix(settings.neonPrimary, "#f5b159", .55), glassX + scale, glassTop + 5 * scale, 7 * scale, 5 * scale); pixelRect(context, "#d9f6ff", glassX, glassTop - scale, 9 * scale, scale); pixelRect(context, "#ffffff", glassX + scale, glassTop + scale, scale, 4 * scale);
  context.strokeStyle = settings.neonSecondary; context.lineWidth = Math.max(1, scale); context.beginPath(); context.moveTo(Math.round(glassX + 4 * scale), Math.round(glassTop)); context.lineTo(Math.round(head.x + 5 * scale), Math.round(head.y + 3 * scale)); context.stroke();
}

function drawBar(context: CanvasRenderingContext2D, width: number, height: number, data: PixelSceneData, frame: PixelArtNewYorkFrame): void {
  const settings = data.settings; pixelRect(context, "#05050a", 0, 0, width, height);
  const wall = context.createLinearGradient(0, 0, width, height * .72); wall.addColorStop(0, shade(settings.neonPrimary, .12)); wall.addColorStop(.5, "#0b0d16"); wall.addColorStop(1, shade(settings.neonSecondary, .14)); context.fillStyle = wall; context.fillRect(0, 0, width, height * .72);
  for (let y = 7; y < height * .66; y += 12) for (let x = (y / 12) % 2 ? -9 : 0; x < width; x += 23) { context.strokeStyle = "#1a1d2a"; context.lineWidth = 1; context.strokeRect(x, y, 21, 10); }
  pixelRect(context, settings.neonPrimary, 0, Math.round(height * .1), width, 2); pixelRect(context, settings.neonSecondary, 0, Math.round(height * .125), width, 1);
  const signWidth = Math.min(164, width * .72); const signHeight = width < 220 ? 34 : 30; drawLedVenueSign(context, width / 2, 25, signWidth, signHeight, settings, Math.max(frame.audioPulse, frame.rhythmPulse * .82));
  drawCover(context, data.cover, width - Math.min(60, width * .22), 44, Math.min(45, width * .18), settings.neonSecondary);
  const floorY = Math.round(height * .7); pixelRect(context, "#090b11", 0, floorY, width, height - floorY);
  for (let y = floorY; y < height; y += 9) pixelRect(context, y % 18 ? "#11131c" : "#1c1926", 0, y, width, 1);
  for (let x = 0; x < width; x += 20) { context.strokeStyle = x % 40 ? shade(settings.neonPrimary, .15) : shade(settings.neonSecondary, .15); context.beginPath(); context.moveTo(width / 2, floorY); context.lineTo(x, height); context.stroke(); }
  const dancerCount = width < 220 ? 4 : 6;
  for (let index = dancerCount - 1; index >= 0; index -= 1) {
    const lane = index % 3; const x = width * (.5 + index / Math.max(1, dancerCount - 1) * .44) - lane * 4; const baseline = floorY + 23 + lane * 19; const style = crowdStyles[index % crowdStyles.length]!; const scale = (width < 220 ? .76 : .9) * (1 + lane * .08); const facing = index % 4 === 0 ? -1 : 1;
    drawCharacter(context, x, baseline, scale, facing, style, dancePose(index, frame));
  }
  const counterTop = floorY - 21; pixelRect(context, "#09070c", 0, counterTop - 18, width * .47, 38); pixelRect(context, "#2a1a28", 0, counterTop - 16, width * .47, 34); pixelRect(context, settings.neonSecondary, 0, counterTop - 18, width * .47, 2); pixelRect(context, "#5b3a2c", 0, counterTop, width * .47, 4);
  for (let bottle = 0; bottle < 8; bottle += 1) { const bx = 8 + bottle * 9; const bottleHeight = 7 + bottle % 3 * 3; pixelRect(context, bottle % 2 ? settings.neonPrimary : settings.neonSecondary, bx, counterTop - 20 - bottleHeight, 4, bottleHeight); pixelRect(context, "#dbe9ef", bx + 1, counterTop - 19 - bottleHeight, 2, 2); }
  const glowAlpha = Math.min(.16, .035 + frame.audioPulse * .1); context.save(); context.globalAlpha = glowAlpha; const glow = context.createLinearGradient(0, 0, width, 0); glow.addColorStop(0, settings.neonPrimary); glow.addColorStop(.5, "transparent"); glow.addColorStop(1, settings.neonSecondary); context.fillStyle = glow; context.fillRect(0, 0, width, height); context.restore();
  pixelateEnvironment(context, data.environmentCanvas, data.environmentContext);
  drawSeatedHero(context, width * .24, floorY + 25, settings, frame, width < 220 ? .96 : 1.1, data.heroFace);
}

function drawStreetCharacters(context: CanvasRenderingContext2D, ground: number, trafficX: number, width: number, waiting: boolean): void {
  for (let index = 0; index < 4; index += 1) {
    const offset = [-39, -21, 16, 34][index] ?? 0; const style = crowdStyles[index]!;
    const smallMotion = waiting ? idlePose() : walkingPose(index * .13, true); const characterX = trafficX + offset;
    drawAtSubpixelX(context, characterX, (snappedX) => drawCharacter(context, snappedX, ground, width < 220 ? .55 + index % 2 * .04 : .68 + index % 2 * .05, index % 2 ? 1 : -1, style, smallMotion));
  }
}

function drawWalkingCloseUp(context: CanvasRenderingContext2D, width: number, height: number, settings: PixelArtSettings, frame: PixelArtNewYorkFrame, walkingElapsedSeconds: number, walking: boolean, faceSprite: HTMLImageElement | null): void {
  const portrait = width < 220; const phase = walkingElapsedSeconds / pixelArtWalkCycleSeconds * Math.PI * 2; const scale = portrait ? 1.82 : 1.54; const x = width * (portrait ? .46 : .38) + Math.sin(phase) * .6; const baseline = height + (portrait ? 5 : 4); const pose = walkingPose(walkingElapsedSeconds, walking);
  context.save(); context.globalCompositeOperation = "lighter"; context.globalAlpha = .08 + frame.audioPulse * .05; const rim = context.createRadialGradient(x + scale * 5, baseline - scale * 57, 2, x + scale * 5, baseline - scale * 57, scale * 34); rim.addColorStop(0, alphaColor(settings.neonSecondary, .34)); rim.addColorStop(1, alphaColor(settings.neonSecondary, 0)); context.fillStyle = rim; context.fillRect(x - scale * 35, baseline - scale * 94, scale * 75, scale * 82); context.restore();
  drawFrontCharacter(context, x, baseline, scale, heroStyle(settings, faceSprite), pose);
}

function drawPixelDissolve(context: CanvasRenderingContext2D, source: HTMLCanvasElement, progress: number): void {
  if (progress <= 0) return; if (progress >= .995) { context.drawImage(source, 0, 0); return; }
  const tile = 4; const threshold = progress * 1.08;
  for (let y = 0; y < source.height; y += tile) for (let x = 0; x < source.width; x += tile) if (hash(x * 17 + y * 31) < threshold) context.drawImage(source, x, y, tile, tile, x, y, tile, tile);
}

function drawPixelAudioDeck(context: CanvasRenderingContext2D, width: number, height: number, settings: PixelArtSettings, frame: PixelArtNewYorkFrame): void {
  const portrait = width < 220; const deckHeight = portrait ? 43 : 31; const top = height - deckHeight; const padding = 5; const scopeWidth = portrait ? 47 : 60; const spectrumWidth = width - scopeWidth - padding * 3;
  context.save(); context.globalCompositeOperation = "source-over"; context.globalAlpha = 1;
  pixelRect(context, "rgba(2,3,8,.91)", 0, top, width, deckHeight); pixelRect(context, alphaColor(settings.neonPrimary, .72), 0, top, width, 1); pixelRect(context, alphaColor(settings.neonSecondary, .26), 0, top + 2, width, 1);
  const left = frame.stereoLeftBands?.length ? frame.stereoLeftBands : frame.spectrumBands ?? []; const right = frame.stereoRightBands?.length ? frame.stereoRightBands : frame.spectrumBands ?? [];
  const bandCount = 48; const graphBottom = height - 5; const graphHeight = deckHeight - 12; const pulse = Math.max(frame.audioPulse, frame.rhythmPulse * .72);
  for (let index = 0; index < bandCount; index += 1) {
    const sourceIndex = Math.round(index / (bandCount - 1) * Math.max(0, (frame.spectrumBands?.length ?? left.length) - 1));
    const leftValue = Math.pow(Math.max(.015, left[sourceIndex] ?? frame.spectrumBands?.[sourceIndex] ?? 0), .62); const rightValue = Math.pow(Math.max(.015, right[sourceIndex] ?? frame.spectrumBands?.[sourceIndex] ?? 0), .62);
    const x = padding + Math.round(index / (bandCount - 1) * Math.max(1, spectrumWidth - 2)); const leftHeight = Math.max(1, Math.round(leftValue * graphHeight)); const rightHeight = Math.max(1, Math.round(rightValue * graphHeight));
    pixelRect(context, alphaColor(settings.neonPrimary, .76 + pulse * .2), x, graphBottom - leftHeight, 1, leftHeight);
    pixelRect(context, alphaColor(settings.neonSecondary, .72 + pulse * .24), x + 1, graphBottom - rightHeight, 1, rightHeight);
    if ((index + Math.round(frame.timeSeconds * 12)) % 7 === 0) pixelRect(context, "rgba(255,255,255,.78)", x, graphBottom - Math.max(leftHeight, rightHeight), 2, 1);
  }
  const scopeLeft = width - scopeWidth - padding; const scopeTop = top + 6; const scopeHeight = deckHeight - 11; const centerX = scopeLeft + scopeWidth / 2; const centerY = scopeTop + scopeHeight / 2; const radius = Math.min(scopeWidth, scopeHeight) * .42; const stereoWidth = Math.max(0, Math.min(1, frame.stereoWidth ?? 0));
  pixelRect(context, alphaColor(settings.neonSecondary, .18), scopeLeft, scopeTop, scopeWidth, scopeHeight); pixelRect(context, alphaColor(settings.neonPrimary, .62), scopeLeft, scopeTop, scopeWidth, 1); pixelRect(context, alphaColor(settings.neonPrimary, .32), scopeLeft, scopeTop + scopeHeight - 1, scopeWidth, 1);
  context.strokeStyle = alphaColor(settings.neonSecondary, .34); context.lineWidth = 1; context.beginPath(); context.moveTo(Math.round(centerX), scopeTop + 2); context.lineTo(Math.round(centerX), scopeTop + scopeHeight - 2); context.moveTo(scopeLeft + 2, Math.round(centerY)); context.lineTo(scopeLeft + scopeWidth - 2, Math.round(centerY)); context.stroke();
  context.save(); context.globalCompositeOperation = "lighter"; context.strokeStyle = mix(settings.neonPrimary, settings.neonSecondary, .5 + stereoWidth * .32); context.shadowColor = settings.neonSecondary; context.shadowBlur = 3 + pulse * 4; context.lineWidth = 1; context.beginPath();
  const sampleCount = 18;
  for (let index = 0; index < sampleCount; index += 1) {
    const sourceIndex = Math.round(index / (sampleCount - 1) * Math.max(0, left.length - 1)); const l = left[sourceIndex] ?? 0; const r = right[sourceIndex] ?? l; const phase = index / (sampleCount - 1) * Math.PI * 2;
    const x = centerX + (l - r) * radius * (1.2 + stereoWidth) + Math.sin(phase) * radius * stereoWidth * .34; const y = centerY + Math.cos(phase) * radius * ((l + r) * .42 + .12);
    if (index === 0) context.moveTo(Math.round(x), Math.round(y)); else context.lineTo(Math.round(x), Math.round(y));
  }
  context.stroke(); context.restore();
  context.font = "bold 5px monospace"; context.textBaseline = "top"; context.fillStyle = alphaColor(settings.neonPrimary, .86); context.fillText("L", 2, top + 4); context.fillStyle = alphaColor(settings.neonSecondary, .86); context.fillText("R", 2, top + 10); context.textAlign = "right"; context.fillStyle = "rgba(255,255,255,.58)"; context.fillText("STEREO", width - padding, top + 1);
  context.restore();
}

function renderPixelArtFrame(group: THREE.Group, frame: PixelArtNewYorkFrame): void {
  const data = group.userData.pixelScene as PixelSceneData | undefined; if (!data) return; data.lastFrame = frame;
  const { canvas, context, transitionCanvas, transitionContext, settings } = data; const width = canvas.width; const height = canvas.height; context.imageSmoothingEnabled = false; context.globalAlpha = 1; context.globalCompositeOperation = "source-over"; pixelRect(context, "#030408", 0, 0, width, height);
  const timeline = resolvePixelArtNewYorkTimeline(frame.timeSeconds, frame.durationSeconds); const heroX = width * .38; const venueTargetX = heroX - 18;
  if (timeline.phase === "bar") drawBar(context, width, height, data, frame);
  else if (timeline.phase === "barEntry") {
    const entranceWalkSeconds = timeline.barEntryProgress * Math.min(1.1, Math.max(.55, frame.durationSeconds * .018)); const entranceDistance = entranceWalkSeconds * pixelArtWalkSpeedPixelsPerSecond;
    const sidewalk = drawStreet(context, width, height, timeline.venueDistancePixels, settings); drawVenue(context, venueTargetX, sidewalk, 68, Math.min(112, height * .62), settings, Math.min(1, timeline.barEntryProgress * 2.2));
    pixelateEnvironment(context, data.environmentCanvas, data.environmentContext);
    const entrancePose = walkingPose(timeline.walkingElapsedSeconds + entranceWalkSeconds, true); const portrait = width < 220; const cameraPullBack = smoothstep(timeline.barEntryProgress / .48); const closeScale = portrait ? 1.82 : 1.54; const fullScale = portrait ? .92 : 1.08; const scale = closeScale + (fullScale - closeScale) * cameraPullBack; const closeX = width * (portrait ? .46 : .38); const characterX = closeX + (heroX + Math.min(16, entranceDistance) - closeX) * cameraPullBack; const closeBaseline = height + (portrait ? 5 : 4); const fullBaseline = sidewalk - timeline.barEntryProgress * 6; const baseline = closeBaseline + (fullBaseline - closeBaseline) * cameraPullBack; drawFrontCharacter(context, characterX, baseline, scale, heroStyle(settings, data.heroFace), entrancePose);
    const vignette = Math.max(0, (timeline.barEntryProgress - .18) / .45); context.save(); context.globalAlpha = vignette * .72; pixelRect(context, "#020307", 0, 0, width * .22 * vignette, height); pixelRect(context, "#020307", width - width * .22 * vignette, 0, width * .22 * vignette, height); context.restore();
    transitionContext.imageSmoothingEnabled = false; transitionContext.globalAlpha = 1; pixelRect(transitionContext, "#030408", 0, 0, width, height); drawBar(transitionContext, width, height, data, frame); drawPixelDissolve(context, transitionCanvas, Math.max(0, (timeline.barEntryProgress - .34) / .66));
  } else {
    const sidewalk = drawStreet(context, width, height, timeline.worldDistancePixels, settings); const stopDistance = timeline.trafficStopStartSeconds * pixelArtWalkSpeedPixelsPerSecond; const trafficX = heroX + 30 + stopDistance - timeline.worldDistancePixels;
    if (trafficX > -48 && trafficX < width + 48) { drawAtSubpixelX(context, trafficX, (snappedX) => drawTrafficLight(context, snappedX, sidewalk, timeline.phase === "trafficLight")); drawStreetCharacters(context, sidewalk, trafficX, width, timeline.phase === "trafficLight"); }
    const venueX = venueTargetX + timeline.venueDistancePixels - timeline.worldDistancePixels; if (venueX < width + 90) drawVenue(context, venueX, sidewalk, 68, Math.min(112, height * .62), settings);
    pixelateEnvironment(context, data.environmentCanvas, data.environmentContext);
    drawWalkingCloseUp(context, width, height, settings, frame, timeline.walkingElapsedSeconds, timeline.walking, data.heroFace);
  }
  drawPixelAudioDeck(context, width, height, settings, frame);
  data.texture.needsUpdate = true;
}

export function createPixelArtNewYorkScene(settings: PixelArtSettings, aspectRatio: string): THREE.Group {
  const group = new THREE.Group(); group.name = "pixel-art-new-york-scene";
  const portrait = aspectRatio === "9:16"; const canvas = document.createElement("canvas"); canvas.width = portrait ? 180 : 320; canvas.height = portrait ? 320 : 180;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: false }); const environmentCanvas = document.createElement("canvas"); environmentCanvas.width = canvas.width; environmentCanvas.height = canvas.height; const environmentContext = environmentCanvas.getContext("2d", { alpha: false, willReadFrequently: false }); const transitionCanvas = document.createElement("canvas"); transitionCanvas.width = canvas.width; transitionCanvas.height = canvas.height; const transitionContext = transitionCanvas.getContext("2d", { alpha: false, willReadFrequently: false });
  if (!context || !environmentContext || !transitionContext) return group;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  const planeHeight = 6.02; const planeWidth = planeHeight * canvas.width / canvas.height; const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, transparent: false, depthWrite: true, depthTest: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeWidth, planeHeight), material); plane.name = "pixel-art-new-york-screen"; plane.position.z = .65; plane.renderOrder = 20; group.add(plane);
  const data: PixelSceneData = { canvas, context, environmentCanvas, environmentContext, transitionCanvas, transitionContext, texture, settings, cover: null, heroFace: null, lastFrame: { timeSeconds: 0, durationSeconds: 30, rhythmPulse: 0, audioPulse: 0, bpm: 90 } }; group.userData.pixelScene = data;
  const heroFace = new Image(); data.heroFace = heroFace; heroFace.onload = () => renderPixelArtFrame(group, data.lastFrame); heroFace.src = settings.characterImageUrl ?? heroFaceSpriteUrl;
  if (settings.coverImageUrl) { const cover = new Image(); data.cover = cover; cover.onload = () => renderPixelArtFrame(group, data.lastFrame); cover.src = settings.coverImageUrl; }
  renderPixelArtFrame(group, data.lastFrame); return group;
}

export function updatePixelArtNewYorkScene(group: THREE.Group, frame: PixelArtNewYorkFrame): void {
  renderPixelArtFrame(group, frame);
}
