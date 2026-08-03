import type { RhythmBallProject } from "@rbs/project-schema";
import * as THREE from "three";
import { createWalkingCubeScene, updateWalkingCubeScene } from "./walking-cube-renderer";
import { renderProSubtitleCompositionFrame, type ProSubtitleCue, type ProSubtitleSettings } from "./pro-subtitles";

export type PortraitLandscapeSettings = RhythmBallProject["animation"]["portraitLandscape"];
export type PortraitLandscapeLayer = PortraitLandscapeSettings["effectLayers"][keyof PortraitLandscapeSettings["effectLayers"]];
export type PortraitLandscapeRenderQuality = "preview" | "export";

export interface PortraitLandscapeFrameInput {
  timeSeconds: number;
  durationSeconds: number;
  bpm: number;
  quality: PortraitLandscapeRenderQuality;
  analysisReady: boolean;
  audioPulse: number;
  rhythmPulse: number;
  spectrumBands: readonly number[];
  stereoLeftBands: readonly number[];
  stereoRightBands: readonly number[];
  videoFrame: CanvasImageSource | null;
  sideImage: CanvasImageSource | null;
  coverImage: CanvasImageSource | null;
  settings: PortraitLandscapeSettings;
  subtitlesEnabled?: boolean;
  subtitleCues?: readonly ProSubtitleCue[];
  subtitleSettings?: ProSubtitleSettings;
}

export interface PortraitLandscapeRect { x: number; y: number; width: number; height: number }
export interface PortraitCubePose { x: number; y: number; size: number; rotation: number; edgeImpact: number }
export interface PortraitCubeRotationState { angle: number; direction: -1 | 1; changeCount: number }
export interface PortraitSpectrumValues { left: number[]; right: number[]; peak: number }
export interface PortraitSpectrumDisplayValues extends PortraitSpectrumValues { analyzed: boolean }
export interface PortraitLandscapeQualityProfile { canvasMaxWidth: number; cubeMinPixels: number; cubeMaxPixels: number; effectDensity: number; glowScale: number; blurLimit: number; antialias: boolean }

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const fract = (value: number) => value - Math.floor(value);
const hash = (value: number) => fract(Math.sin(value * 12.9898 + 78.233) * 43758.5453);

export function portraitParticleFlicker(index: number, timeSeconds: number): number {
  const wave = .5 + .5 * Math.sin(timeSeconds * (2.1 + hash(index + 31) * 3.7) + hash(index + 77) * Math.PI * 2);
  return clamp01(Math.pow(wave, 3.2));
}

export function portraitLandscapeQualityProfile(quality: PortraitLandscapeRenderQuality): PortraitLandscapeQualityProfile {
  return quality === "preview"
    ? { canvasMaxWidth: 960, cubeMinPixels: 176, cubeMaxPixels: 480, effectDensity: .48, glowScale: .42, blurLimit: 4, antialias: false }
    : { canvasMaxWidth: 7680, cubeMinPixels: 384, cubeMaxPixels: 1400, effectDensity: 1, glowScale: 1, blurLimit: 12, antialias: true };
}

export function portraitSpectrumPalette(settings: PortraitLandscapeSettings): readonly [string, string, string] {
  if (settings.spectrumPaletteSource === "manual") return settings.spectrumManualPalette;
  return settings.spectrumPaletteSource === "sideImage" ? settings.sideImagePalette : settings.palette;
}

export function fitPortraitLandscapePreview(containerWidth: number, containerHeight: number): { width: number; height: number } {
  const availableWidth = Math.max(0, containerWidth);
  const availableHeight = Math.max(0, containerHeight);
  const width = Math.min(availableWidth, availableHeight * 16 / 9);
  return { width, height: width * 9 / 16 };
}

export function portraitCenterRect(width: number, height: number): PortraitLandscapeRect {
  const centerWidth = Math.min(width, height * 9 / 16);
  return { x: (width - centerWidth) / 2, y: 0, width: centerWidth, height };
}

export function portraitSpectrumValues(spectrumBands: readonly number[], stereoLeftBands: readonly number[], stereoRightBands: readonly number[]): PortraitSpectrumValues {
  const count = 24;
  const leftSource = stereoLeftBands.length >= 48 ? stereoLeftBands : spectrumBands;
  const rightSource = stereoRightBands.length >= 48 ? stereoRightBands : spectrumBands;
  const left = Array.from({ length: count }, (_, index) => Math.max(0, leftSource[index] ?? 0));
  const right = Array.from({ length: count }, (_, index) => Math.max(0, rightSource[index + count] ?? rightSource[index] ?? 0));
  return { left, right, peak: Math.max(.08, ...left, ...right) };
}

export function portraitSpectrumDisplayValues(spectrumBands: readonly number[], stereoLeftBands: readonly number[], stereoRightBands: readonly number[], timeSeconds: number, bpm: number, analysisReady = false): PortraitSpectrumDisplayValues {
  const resolved = portraitSpectrumValues(spectrumBands, stereoLeftBands, stereoRightBands);
  const analyzed = analysisReady || [...resolved.left, ...resolved.right].some((value) => value > .002);
  if (analyzed) return { ...resolved, analyzed };
  const beat = timeSeconds * Math.max(40, bpm || 96) / 60; const beatPulse = Math.exp(-fract(beat) * 7.5);
  const fallback = (sideOffset: number) => Array.from({ length: 24 }, (_, index) => {
    const drift = .5 + .5 * Math.sin(timeSeconds * (.8 + index * .017) + index * .83 + sideOffset);
    return .16 + drift * .19 + beatPulse * (.12 + hash(index + sideOffset * 17) * .19);
  });
  const left = fallback(0); const right = fallback(1.7);
  return { left, right, peak: Math.max(.08, ...left, ...right), analyzed };
}

export function portraitSpectrumBandLevel(amplitude: number, intensity: number, audioPulse: number): number {
  const absoluteLevel = Math.pow(clamp01(Math.max(0, amplitude) * 1.85), .72);
  return clamp01(absoluteLevel * Math.max(0, intensity) * (.88 + clamp01(audioPulse) * .16));
}

export function portraitLightningIntensity(timeSeconds: number, bpm: number, audioPulse: number, rhythmPulse: number): number {
  const beats = timeSeconds * Math.max(40, bpm || 96) / 60; const phase = fract(beats);
  const rhythmicFlash = Math.exp(-phase * 11) * (.45 + .55 * (Math.floor(beats) % 4 === 0 ? 1 : .35));
  return Math.max(rhythmPulse, audioPulse * .72, rhythmicFlash);
}

function appendPeriodicEvents(target: number[], first: number, period: number, until: number): void {
  if (!Number.isFinite(first) || !Number.isFinite(period) || period <= 0 || first > until) return;
  for (let time = Math.max(first, first + Math.ceil((0 - first) / period) * period); time <= until + 1e-7; time += period) if (time > 1e-7) target.push(time);
}

export function portraitCubeRotationState(timeSeconds: number, bpm: number, settings: PortraitLandscapeSettings): PortraitCubeRotationState {
  const time = Math.max(0, timeSeconds);
  const movementRate = Math.max(.15, settings.cubeSpeed) / 12;
  const interval = Math.max(4, settings.cubeRotationBeats || 8);
  const tempo = Math.max(40, bpm || 92);
  const events: number[] = [];
  appendPeriodicEvents(events, interval * 60 / tempo, interval * 60 / tempo, time);
  appendPeriodicEvents(events, (.5 - .08) / movementRate, .5 / movementRate, time);
  appendPeriodicEvents(events, (.5 - .31) / (movementRate * .73), .5 / (movementRate * .73), time);
  events.sort((left, right) => left - right);
  const merged = events.filter((eventTime, index) => index === 0 || eventTime - events[index - 1]! > .18);
  const angularSpeed = .16 * Math.max(.25, settings.cubeRotationSpeed || 1);
  let angle = .42; let cursor = 0; let direction: -1 | 1 = 1;
  for (const eventTime of merged) { angle += direction * (eventTime - cursor) * angularSpeed; cursor = eventTime; direction = direction === 1 ? -1 : 1; }
  angle += direction * (time - cursor) * angularSpeed;
  return { angle, direction, changeCount: merged.length };
}

export function portraitCubePose(width: number, height: number, timeSeconds: number, bpm: number, settings: PortraitLandscapeSettings): PortraitCubePose {
  const size = Math.min(width, height) * .2 * settings.cubeScale;
  const movementRate = Math.max(.15, settings.cubeSpeed) / 12;
  const horizontalPhase = fract(timeSeconds * movementRate + .08);
  const verticalPhase = fract(timeSeconds * movementRate * .73 + .31);
  const horizontalTravel = 1 - Math.abs(horizontalPhase * 2 - 1);
  const verticalTravel = 1 - Math.abs(verticalPhase * 2 - 1);
  const margin = size * .92;
  const edgeDistance = Math.min(horizontalPhase, Math.abs(horizontalPhase - .5), 1 - horizontalPhase, verticalPhase, Math.abs(verticalPhase - .5), 1 - verticalPhase);
  return {
    x: margin + horizontalTravel * Math.max(1, width - margin * 2),
    y: margin + verticalTravel * Math.max(1, height - margin * 2),
    size,
    rotation: portraitCubeRotationState(timeSeconds, bpm, settings).angle,
    edgeImpact: Math.pow(Math.max(0, 1 - edgeDistance * 24), 2)
  };
}

function drawCover(context: CanvasRenderingContext2D, source: CanvasImageSource, rect: PortraitLandscapeRect, mirror = false): void {
  const dimensions = source as CanvasImageSource & { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const sourceWidth = dimensions.videoWidth ?? dimensions.naturalWidth ?? dimensions.width ?? 1;
  const sourceHeight = dimensions.videoHeight ?? dimensions.naturalHeight ?? dimensions.height ?? 1;
  const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight);
  const drawWidth = sourceWidth * scale; const drawHeight = sourceHeight * scale;
  context.save(); context.beginPath(); context.rect(rect.x, rect.y, rect.width, rect.height); context.clip();
  if (mirror) { context.translate(rect.x * 2 + rect.width, 0); context.scale(-1, 1); }
  context.drawImage(source, rect.x + (rect.width - drawWidth) / 2, rect.y + (rect.height - drawHeight) / 2, drawWidth, drawHeight);
  context.restore();
}

function drawContain(context: CanvasRenderingContext2D, source: CanvasImageSource, rect: PortraitLandscapeRect): void {
  const dimensions = source as CanvasImageSource & { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const sourceWidth = dimensions.videoWidth ?? dimensions.naturalWidth ?? dimensions.width ?? 1;
  const sourceHeight = dimensions.videoHeight ?? dimensions.naturalHeight ?? dimensions.height ?? 1;
  const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const drawWidth = sourceWidth * scale; const drawHeight = sourceHeight * scale;
  context.fillStyle = "#030304"; context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.drawImage(source, rect.x + (rect.width - drawWidth) / 2, rect.y + (rect.height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawAdjustedSideImage(context: CanvasRenderingContext2D, source: CanvasImageSource, rect: PortraitLandscapeRect, mirror: boolean, settings: PortraitLandscapeSettings, quality: PortraitLandscapeRenderQuality): void {
  const adjustment = settings.sideImageAdjustments; const exposure = 2 ** adjustment.exposure; const profile = portraitLandscapeQualityProfile(quality);
  context.save(); context.filter = `brightness(${adjustment.brightness * exposure}) contrast(${adjustment.contrast}) saturate(${adjustment.saturation}) blur(${Math.min(adjustment.blur, profile.blurLimit)}px)`; drawCover(context, source, rect, mirror); context.restore();
  if (Math.abs(adjustment.temperature) > .005) { context.save(); context.beginPath(); context.rect(rect.x, rect.y, rect.width, rect.height); context.clip(); context.globalCompositeOperation = "soft-light"; context.globalAlpha = Math.abs(adjustment.temperature) * .24; context.fillStyle = adjustment.temperature > 0 ? "#ff7b32" : "#3f8dff"; context.fillRect(rect.x, rect.y, rect.width, rect.height); context.restore(); }
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath(); context.moveTo(x + r, y); context.arcTo(x + width, y, x + width, y + height, r); context.arcTo(x + width, y + height, x, y + height, r); context.arcTo(x, y + height, x, y, r); context.arcTo(x, y, x + width, y, r); context.closePath();
}

function drawImageInPolygon(context: CanvasRenderingContext2D, image: CanvasImageSource | null, points: readonly [number, number][], fallback: string): void {
  const xs = points.map((point) => point[0]); const ys = points.map((point) => point[1]);
  const x = Math.min(...xs); const y = Math.min(...ys); const width = Math.max(...xs) - x; const height = Math.max(...ys) - y;
  context.save(); context.beginPath(); context.moveTo(...points[0]!); for (const point of points.slice(1)) context.lineTo(...point); context.closePath(); context.clip();
  if (image) drawCover(context, image, { x, y, width, height }); else { context.fillStyle = fallback; context.fillRect(x, y, width, height); }
  context.restore();
}

function drawGlassCubeFallback(context: CanvasRenderingContext2D, pose: PortraitCubePose, image: CanvasImageSource | null, settings: PortraitLandscapeSettings, audioPulse: number): void {
  const half = pose.size / 2; const depth = pose.size * (.22 + Math.sin(pose.rotation * .73) * .035);
  context.save(); context.translate(pose.x, pose.y); context.rotate(pose.rotation * .42);
  const top: [number, number][] = [[-half, -half], [-half + depth, -half - depth], [half + depth, -half - depth], [half, -half]];
  const side: [number, number][] = [[half, -half], [half + depth, -half - depth], [half + depth, half - depth], [half, half]];
  context.globalAlpha = .76; drawImageInPolygon(context, image, top, settings.palette[1]);
  context.globalAlpha = .64; drawImageInPolygon(context, image, side, settings.palette[2]);
  context.globalAlpha = 1; roundedRect(context, -half, -half, pose.size, pose.size, pose.size * .055); context.save(); context.clip(); if (image) drawCover(context, image, { x: -half, y: -half, width: pose.size, height: pose.size }); else { context.fillStyle = settings.palette[0]; context.fillRect(-half, -half, pose.size, pose.size); } context.restore();
  const glass = context.createLinearGradient(-half, -half, half, half); glass.addColorStop(0, `rgba(255,255,255,${.28 + settings.glassOpacity * .32})`); glass.addColorStop(.28, `rgba(255,255,255,${.025 + settings.glassOpacity * .04})`); glass.addColorStop(.72, `rgba(237,117,167,${.035 + audioPulse * .08})`); glass.addColorStop(1, `rgba(255,255,255,${.18 + settings.glassOpacity * .2})`);
  roundedRect(context, -half, -half, pose.size, pose.size, pose.size * .055); context.fillStyle = glass; context.fill();
  context.shadowColor = settings.palette[0]; context.shadowBlur = pose.size * (.08 + audioPulse * .08); context.strokeStyle = `rgba(255,255,255,${.58 + settings.glassOpacity * .35})`; context.lineWidth = Math.max(1.2, pose.size * .012); context.stroke();
  context.shadowBlur = 0; context.strokeStyle = "rgba(255,255,255,.32)"; context.lineWidth *= .45; context.beginPath(); context.moveTo(-half * .82, -half * .73); context.lineTo(half * .18, -half * .73); context.stroke();
  context.restore();
}

interface SharedCubeRenderState {
  key: string;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  root: THREE.Group;
}

const sharedCubeRenderers = new WeakMap<object, SharedCubeRenderState>();

function sharedCubeKey(settings: PortraitLandscapeSettings, image: CanvasImageSource | null, quality: PortraitLandscapeRenderQuality): string {
  return [quality, settings.coverImageUrl, image ? "ready" : "pending", ...settings.palette].join("|");
}

function createSharedCubeState(settings: PortraitLandscapeSettings, image: CanvasImageSource | null, key: string, quality: PortraitLandscapeRenderQuality): SharedCubeRenderState | null {
  if (typeof document === "undefined") return null;
  try {
    const cubeSettings = {
      imageUrl: null, backgroundImageUrl: null, autoPalette: true,
      palettePrimary: settings.palette[0], paletteSecondary: settings.palette[1], paletteAccent: settings.palette[2],
      rotationIntensity: 1, spectrumIntensity: 1, rippleIntensity: 0, backgroundDim: 0,
      effects: { halo: false, orbitRings: false, particles: false, lightSweeps: false, waterRipples: false },
      motionIntensity: 1, splitDistance: .72, backgroundIntensity: 1, glassOpacity: settings.glassOpacity
    };
    const readyImage = image instanceof HTMLImageElement ? image : null;
    const root = createWalkingCubeScene(cubeSettings, "16:9", true, readyImage);
    for (const name of ["walking-cube-background", "walking-cube-background-atmosphere", "walking-cube-water-ripples", "walking-cube-halo", "walking-cube-orbits", "walking-cube-light-sweeps", "walking-cube-spectrum", "walking-cube-particles"]) {
      const object = root.getObjectByName(name); if (object) object.visible = false;
    }
    const scene = new THREE.Scene(); scene.add(root);
    const camera = new THREE.PerspectiveCamera(30, 1, .1, 30); camera.position.set(0, .05, 6.25); camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: portraitLandscapeQualityProfile(quality).antialias, powerPreference: "high-performance", premultipliedAlpha: true });
    renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
    return { key, renderer, scene, camera, root };
  } catch { return null; }
}

function drawSharedGlassCube(context: CanvasRenderingContext2D, owner: object, pose: PortraitCubePose, image: CanvasImageSource | null, input: PortraitLandscapeFrameInput): boolean {
  const key = sharedCubeKey(input.settings, image, input.quality); let state = sharedCubeRenderers.get(owner);
  if (!state || state.key !== key) {
    state?.renderer.dispose();
    const created = createSharedCubeState(input.settings, image, key, input.quality); if (!created) return false; state = created; sharedCubeRenderers.set(owner, state);
  }
  try {
    const shell = state.root.getObjectByName("walking-cube-glass-shell"); if (shell instanceof THREE.Mesh && shell.material instanceof THREE.MeshPhysicalMaterial) shell.material.opacity = .018 + input.settings.glassOpacity * .11;
    const fresnel = state.root.getObjectByName("walking-cube-fresnel"); if (fresnel instanceof THREE.Mesh && fresnel.material instanceof THREE.ShaderMaterial) fresnel.material.uniforms.uOpacity!.value = .13 + input.settings.glassOpacity * .3;
    const profile = portraitLandscapeQualityProfile(input.quality); const outputSize = input.quality === "preview" ? Math.min(profile.cubeMaxPixels, 384) : Math.round(Math.min(profile.cubeMaxPixels, Math.max(profile.cubeMinPixels, pose.size * 2.15))); if (state.renderer.domElement.width !== outputSize || state.renderer.domElement.height !== outputSize) state.renderer.setSize(outputSize, outputSize, false);
    const rotation = new THREE.Euler(pose.rotation * .72 + Math.sin(pose.rotation * .37) * .18, pose.rotation * .93, pose.rotation * .41 + Math.sin(pose.rotation * .61) * .12, "XYZ"); const orientation = new THREE.Quaternion().setFromEuler(rotation);
    updateWalkingCubeScene(state.root, { pose: { loopPhase: input.durationSeconds > 0 ? fract(input.timeSeconds / input.durationSeconds) : 0, stepIndex: 0, stepProgress: 1 - pose.edgeImpact, position: { x: 0, y: 0, z: 0 }, rotationX: rotation.x, rotationY: rotation.y, rotationZ: rotation.z, orientation: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w }, split: 0, zoom: 0, selectedChildIndex: 0, impactStrength: Math.max(pose.edgeImpact, input.rhythmPulse) }, audioPulse: input.audioPulse, rhythmPulse: input.rhythmPulse, spectrumBands: input.spectrumBands, stereoLeftBands: input.stereoLeftBands, stereoRightBands: input.stereoRightBands, stereoWidth: 0 });
    state.renderer.render(state.scene, state.camera);
    const drawSize = pose.size * 1.82; context.drawImage(state.renderer.domElement, pose.x - drawSize / 2, pose.y - drawSize / 2, drawSize, drawSize); return true;
  } catch { return false; }
}

function drawSpectrum(context: CanvasRenderingContext2D, width: number, height: number, center: PortraitLandscapeRect, input: PortraitLandscapeFrameInput): void {
  if (input.settings.spectrumOpacity <= 0 || input.settings.spectrumIntensity <= 0) return;
  const profile = portraitLandscapeQualityProfile(input.quality);
  const spectrumPalette = portraitSpectrumPalette(input.settings);
  const sideWidth = center.x; const gap = Math.max(2, sideWidth * .008); const count = 24; const barWidth = Math.max(2, (sideWidth - gap * (count + 1)) / count);
  const { left, right } = portraitSpectrumDisplayValues(input.spectrumBands, input.stereoLeftBands, input.stereoRightBands, input.timeSeconds, input.bpm, input.analysisReady);
  const baseY = height * .97;
  const paint = (values: readonly number[], side: "left" | "right") => {
    for (let index = 0; index < count; index += 1) {
      const value = portraitSpectrumBandLevel(values[index] ?? 0, input.settings.spectrumIntensity, input.audioPulse);
      const x = side === "left" ? gap + index * (barWidth + gap) : center.x + center.width + gap + index * (barWidth + gap);
      const barHeight = Math.max(height * .075, value * height * .7);
      const gradient = context.createLinearGradient(0, baseY, 0, baseY - barHeight); gradient.addColorStop(0, spectrumPalette[(index + (side === "right" ? 1 : 0)) % 3]!); gradient.addColorStop(.58, spectrumPalette[(index + 1) % 3]!); gradient.addColorStop(1, spectrumPalette[(index + 2) % 3]!);
      roundedRect(context, x, baseY - barHeight, barWidth, barHeight, Math.min(barWidth / 2, 5));
      context.save(); context.globalCompositeOperation = "screen"; context.globalAlpha = input.settings.spectrumOpacity * .46; context.fillStyle = gradient; context.shadowColor = spectrumPalette[(index + 1) % 3]!; context.shadowBlur = Math.max(2, barWidth * (1.5 + value * 2.8) * profile.glowScale); context.fill(); context.restore();
      context.globalCompositeOperation = "source-over"; context.globalAlpha = input.settings.spectrumOpacity; context.fillStyle = gradient; context.shadowBlur = 0; context.fill(); context.strokeStyle = `rgba(255,255,255,${input.settings.spectrumOpacity})`; context.lineWidth = Math.max(.65, width / 2600); context.stroke();
    }
  };
  context.save(); paint(left, "left"); paint(right, "right"); context.restore();
}

function drawRain(context: CanvasRenderingContext2D, width: number, height: number, input: PortraitLandscapeFrameInput, opacity: number): void {
  const profile = portraitLandscapeQualityProfile(input.quality); const count = Math.round(118 * input.settings.effectIntensity * profile.effectDensity); context.save(); context.globalCompositeOperation = "screen"; context.strokeStyle = input.settings.effectColors.rain; context.lineCap = "round"; context.shadowColor = input.settings.effectColors.rain; context.shadowBlur = Math.max(1, width / 850 * profile.glowScale);
  for (let index = 0; index < count; index += 1) { const speed = .44 + hash(index + 4) * .82; const x = fract(hash(index) + input.timeSeconds * .045 * speed) * (width * 1.08) - width * .04; const y = fract(hash(index + 42) + input.timeSeconds * speed) * (height * 1.1) - height * .05; const length = height * (.026 + hash(index + 91) * .06); context.globalAlpha = (.3 + hash(index + 3) * .54) * opacity; context.lineWidth = Math.max(1, width / 1250) * (.7 + hash(index + 13) * .65); context.beginPath(); context.moveTo(x, y); context.lineTo(x - length * .2, y + length); context.stroke(); }
  context.restore();
}

function drawLightning(context: CanvasRenderingContext2D, width: number, height: number, input: PortraitLandscapeFrameInput, opacity: number): void {
  const beats = input.timeSeconds * Math.max(40, input.bpm || 96) / 60; const intensity = portraitLightningIntensity(input.timeSeconds, input.bpm, input.audioPulse, input.rhythmPulse); if (intensity < .2) return; const seed = Math.floor(beats); const startX = width * (.12 + hash(seed) * .76);
  const profile = portraitLandscapeQualityProfile(input.quality);
  context.save(); context.globalCompositeOperation = "screen"; context.lineJoin = "round"; context.lineCap = "round";
  context.globalAlpha = intensity * opacity * .09; context.fillStyle = input.settings.effectColors.lightning; context.fillRect(0, 0, width, height);
  const lightningPasses = input.quality === "preview" ? [[width / 680, .82, width / 180], [Math.max(1, width / 1500), 1, 0]] as const : [[width / 260, .12, width / 45], [width / 720, .8, width / 95], [Math.max(1, width / 1500), 1, 0]] as const;
  for (const [lineWidth, alpha, blur] of lightningPasses) { context.beginPath(); context.moveTo(startX, -10); for (let step = 1; step <= 9; step += 1) context.lineTo(startX + (hash(seed * 17 + step) - .5) * width * .13, step / 9 * height * .78); context.strokeStyle = input.settings.effectColors.lightning; context.globalAlpha = alpha * intensity * opacity; context.lineWidth = lineWidth; context.shadowColor = input.settings.effectColors.lightning; context.shadowBlur = blur * profile.glowScale; context.stroke(); }
  context.restore();
}

function drawFeathers(context: CanvasRenderingContext2D, width: number, height: number, input: PortraitLandscapeFrameInput, opacity: number): void {
  const profile = portraitLandscapeQualityProfile(input.quality); const count = Math.round(14 * input.settings.effectIntensity * Math.max(.65, profile.effectDensity)); context.save(); context.strokeStyle = input.settings.effectColors.feathers; context.fillStyle = input.settings.effectColors.feathers;
  for (let index = 0; index < count; index += 1) { const size = width * (.009 + hash(index + 3) * .014); const x = fract(hash(index) + input.timeSeconds * (.012 + hash(index + 4) * .008)) * (width + size * 2) - size; const y = fract(hash(index + 20) + input.timeSeconds * (.02 + hash(index + 7) * .018)) * (height + size * 3) - size; context.save(); context.translate(x, y); context.rotate(input.timeSeconds * (.22 + hash(index) * .24) + hash(index + 8) * 6); context.globalAlpha = (.62 + hash(index + 10) * .34) * opacity; context.beginPath(); context.moveTo(0, -size); context.quadraticCurveTo(size * .72, 0, 0, size); context.quadraticCurveTo(-size * .4, 0, 0, -size); context.fill(); context.globalAlpha *= .88; context.lineWidth = Math.max(.6, size * .055); context.beginPath(); context.moveTo(0, -size * .78); context.lineTo(0, size * 1.2); context.stroke(); context.restore(); }
  context.restore();
}

function drawParticles(context: CanvasRenderingContext2D, width: number, height: number, input: PortraitLandscapeFrameInput, opacity: number): void {
  const profile = portraitLandscapeQualityProfile(input.quality); const count = Math.round(48 * input.settings.effectIntensity * profile.effectDensity); context.save();
  for (let index = 0; index < count; index += 1) {
    const x = fract(hash(index) + input.timeSeconds * (.004 + hash(index + 2) * .008)) * width; const y = fract(hash(index + 30) - input.timeSeconds * (.006 + hash(index + 8) * .014)) * height; const flicker = portraitParticleFlicker(index, input.timeSeconds); const radius = width * (.00075 + hash(index + 12) * .0021) * (1 + input.audioPulse * .35); const glowRadius = radius * (3.5 + flicker * 4.5) * Math.max(.55, profile.glowScale);
    const glow = context.createRadialGradient(x, y, 0, x, y, glowRadius); glow.addColorStop(0, "rgba(255,255,255,.98)"); glow.addColorStop(.16, input.settings.effectColors.particles); glow.addColorStop(1, "rgba(0,0,0,0)");
    context.globalCompositeOperation = "screen"; context.globalAlpha = opacity * (.16 + flicker * .72); context.fillStyle = glow; context.beginPath(); context.arc(x, y, glowRadius, 0, Math.PI * 2); context.fill();
    context.globalCompositeOperation = "source-over"; context.globalAlpha = opacity; context.fillStyle = input.settings.effectColors.particles; context.beginPath(); context.arc(x, y, radius * (1 + flicker * .18), 0, Math.PI * 2); context.fill();
    context.fillStyle = "#ffffff"; context.beginPath(); context.arc(x - radius * .14, y - radius * .14, Math.max(.7, radius * (.3 + flicker * .16)), 0, Math.PI * 2); context.fill();
  }
  context.restore();
}

export function renderPortraitLandscapeFrame(canvas: HTMLCanvasElement | OffscreenCanvas, input: PortraitLandscapeFrameInput): void {
  const context = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error("Canvas 2D non disponibile per From 9:16 to 16:9.");
  const width = canvas.width; const height = canvas.height; const center = portraitCenterRect(width, height); const sideWidth = center.x;
  context.save(); context.clearRect(0, 0, width, height); context.fillStyle = input.settings.palette[2]; context.fillRect(0, 0, width, height);
  const drawSideLayer = () => { if (input.sideImage) { const originalOnLeft = input.settings.sideImagePlacement === "left"; drawAdjustedSideImage(context as CanvasRenderingContext2D, input.sideImage, { x: 0, y: 0, width: sideWidth, height }, !originalOnLeft, input.settings, input.quality); drawAdjustedSideImage(context as CanvasRenderingContext2D, input.sideImage, { x: center.x + center.width, y: 0, width: sideWidth, height }, originalOnLeft, input.settings, input.quality); } else { const gradient = context.createLinearGradient(0, 0, width, height); gradient.addColorStop(0, input.settings.palette[2]); gradient.addColorStop(.5, input.settings.palette[0]); gradient.addColorStop(1, input.settings.palette[1]); context.fillStyle = gradient; context.fillRect(0, 0, width, height); } context.fillStyle = "rgba(0,0,0,.14)"; context.fillRect(0, 0, sideWidth, height); context.fillRect(center.x + center.width, 0, sideWidth, height); };
  const drawVideoLayer = () => { if (input.videoFrame) drawContain(context as CanvasRenderingContext2D, input.videoFrame, center); else { context.fillStyle = "#08080a"; context.fillRect(center.x, 0, center.width, height); context.fillStyle = "rgba(255,255,255,.6)"; context.font = `600 ${Math.max(14, height * .026)}px Inter, sans-serif`; context.textAlign = "center"; context.fillText("Carica un video 9:16", width / 2, height / 2); } context.strokeStyle = "rgba(255,255,255,.22)"; context.lineWidth = Math.max(1, width / 1600); context.strokeRect(center.x, 0, center.width, height); };
  const cubePose = portraitCubePose(width, height, input.timeSeconds, input.bpm, input.settings);
  for (const layer of input.settings.layerOrder) {
    if (layer === "sideImage") drawSideLayer();
    else if (layer === "cube") { if (!drawSharedGlassCube(context as CanvasRenderingContext2D, canvas, cubePose, input.coverImage, input)) drawGlassCubeFallback(context as CanvasRenderingContext2D, cubePose, input.coverImage, input.settings, input.audioPulse); }
    else if (layer === "centerVideo") drawVideoLayer();
    else if (layer === "spectrum") drawSpectrum(context as CanvasRenderingContext2D, width, height, center, input);
    else if (layer === "rain" && input.settings.effects.rain) drawRain(context as CanvasRenderingContext2D, width, height, input, input.settings.effectOpacity.rain);
    else if (layer === "lightning" && input.settings.effects.lightning) drawLightning(context as CanvasRenderingContext2D, width, height, input, input.settings.effectOpacity.lightning);
    else if (layer === "feathers" && input.settings.effects.feathers) drawFeathers(context as CanvasRenderingContext2D, width, height, input, input.settings.effectOpacity.feathers);
    else if (layer === "particles" && input.settings.effects.particles) drawParticles(context as CanvasRenderingContext2D, width, height, input, input.settings.effectOpacity.particles);
  }
  const vignette = context.createRadialGradient(width / 2, height / 2, height * .2, width / 2, height / 2, width * .62); vignette.addColorStop(.55, "rgba(0,0,0,0)"); vignette.addColorStop(1, "rgba(0,0,0,.3)"); context.fillStyle = vignette; context.fillRect(0, 0, width, height); context.restore();
  if (input.subtitlesEnabled && input.subtitleSettings && input.subtitleCues?.length) {
    renderProSubtitleCompositionFrame(context as CanvasRenderingContext2D, input.subtitleCues, input.subtitleSettings, { timeSeconds: input.timeSeconds, width, height, clear: false });
  }
}
