import type { EnergyFrame } from "@rbs/audio-analysis";
import type { OverlaySpectralSettings } from "@rbs/project-schema";
import { resolveCoverSpectrum, type CoverSpectrumFrame } from "./cover-spectrum";
import { mixOverlaySpectralPalette, overlaySpectralPreset } from "./overlay-spectral-catalog";

export interface OverlaySpectralRenderInput { settings: OverlaySpectralSettings; energyFrames: readonly EnergyFrame[]; timeSeconds: number; }
export interface OverlaySpectralImageFit { x: number; y: number; width: number; height: number; }

export function resolveOverlaySpectralImageFit(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number, fit: "cover" | "contain"): OverlaySpectralImageFit {
  if (sourceWidth <= 0 || sourceHeight <= 0) return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  const scale = fit === "cover" ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight) : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale; const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function band(spectrum: CoverSpectrumFrame, index: number, settings: OverlaySpectralSettings): number { return clamp01((spectrum.bands[index % 48] ?? 0) * settings.sensitivity * 2.2 + spectrum.pulse * .16); }

export class OverlaySpectralRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly bandCount = 48;
  lastBandValues: number[] = [];
  private context: CanvasRenderingContext2D | null;
  private width = 1;
  private height = 1;
  private input: OverlaySpectralRenderInput | null = null;
  private image: HTMLImageElement | null = null;
  private imageUrl: string | null = null;
  private imageState: "idle" | "loading" | "loaded" | "failed" = "idle";
  private imageLoad: Promise<void> | null = null;
  private rejectImage: ((error: Error) => void) | null = null;
  private video: HTMLVideoElement | null = null;
  private videoUrl: string | null = null;
  private videoState: "idle" | "loading" | "loaded" | "failed" = "idle";
  private previewPlaying = false;
  private previewPlaybackTime = 0;
  private videoPlayPending = false;
  private externalBackground = false;
  private renderTimeSeconds = 0;
  private disposed = false;

  constructor(canvas?: HTMLCanvasElement) { this.canvas = canvas ?? document.createElement("canvas"); this.context = this.canvas.getContext("2d"); }
  update(input: OverlaySpectralRenderInput): void { this.input = input; this.ensureMedia(input.settings.backgroundImageUrl, input.settings.backgroundMediaType); if (this.video) this.video.style.objectFit = input.settings.backgroundFit; this.renderNow(input.timeSeconds); }
  setExternalBackground(enabled: boolean): void { this.externalBackground = enabled; this.renderNow(); }
  setPreviewPlaying(playing: boolean, timeSeconds = this.renderTimeSeconds): void { this.previewPlaying = playing; this.previewPlaybackTime = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0; const video = this.video; if (!video || this.videoState !== "loaded") return; this.syncVideoTime(video, this.previewPlaybackTime, true); if (playing) this.startVideoPlayback(video); else video.pause(); }
  setExportSize(width: number, height: number): void { this.width = Math.max(1, Math.round(width)); this.height = Math.max(1, Math.round(height)); this.canvas.width = this.width; this.canvas.height = this.height; }
  restorePreviewSize(): void { const rect = this.canvas.getBoundingClientRect(); const dpr = typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1); this.setExportSize((rect.width || this.width) * dpr, (rect.height || this.height) * dpr); }

  private ensureMedia(url: string | null, mediaType: "image" | "video"): void {
    if (mediaType === "video") { this.ensureVideo(url); this.ensureImage(null); return; }
    this.ensureVideo(null); this.ensureImage(url);
  }

  private ensureImage(url: string | null): void {
    if (url === this.imageUrl) return;
    this.rejectImage?.(new Error("Caricamento sfondo sostituito.")); this.rejectImage = null; this.image = null; this.imageUrl = url; this.imageState = url ? "loading" : "idle"; this.imageLoad = null;
    if (!url || this.disposed) return;
    const image = new Image(); this.image = image;
    this.imageLoad = new Promise<void>((resolve, reject) => { let settled = false; const finish = (error?: Error) => { if (settled) return; settled = true; this.rejectImage = null; image.onload = null; image.onerror = null; this.imageState = error ? "failed" : "loaded"; if (error) reject(error); else { resolve(); this.renderNow(); } }; this.rejectImage = (error) => finish(error); image.onload = () => finish(); image.onerror = () => finish(new Error("Sfondo Overlay Spectral non caricabile.")); image.src = url; if (image.complete) finish(image.naturalWidth > 0 ? undefined : new Error("Sfondo Overlay Spectral non caricabile.")); });
    void this.imageLoad.catch(() => undefined);
  }

  private ensureVideo(url: string | null): void {
    if (url === this.videoUrl) return;
    if (this.video) { this.video.pause(); this.video.removeAttribute("src"); this.video.load(); this.video.remove(); }
    this.video = null; this.videoUrl = url; this.videoState = url ? "loading" : "idle"; this.videoPlayPending = false;
    if (!url || this.disposed) return;
    const video = document.createElement("video"); video.muted = true; video.defaultMuted = true; video.loop = true; video.preload = "auto"; video.playsInline = true; video.className = "overlay-spectral-decoder-video"; video.tabIndex = -1; video.setAttribute("muted", ""); video.setAttribute("playsinline", ""); video.setAttribute("aria-hidden", "true"); this.canvas.parentElement?.appendChild(video); this.video = video;
    video.onloadeddata = () => { if (this.video !== video) return; this.videoState = "loaded"; this.syncVideoTime(video, this.previewPlaybackTime || this.renderTimeSeconds, true); if (this.previewPlaying) this.startVideoPlayback(video); this.renderNow(); };
    video.onseeked = () => { if (this.video === video) this.renderNow(); };
    video.onerror = () => { if (this.video === video) this.videoState = "failed"; };
    video.src = url; video.load();
  }

  private videoTime(video: HTMLVideoElement, timeSeconds: number): number { const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0; return duration > 0 ? timeSeconds % duration : timeSeconds; }
  private syncVideoTime(video: HTMLVideoElement, timeSeconds: number, force = false): void { const target = this.videoTime(video, timeSeconds); if (!force && Math.abs(video.currentTime - target) <= (this.previewPlaying ? .35 : .035)) return; try { video.currentTime = target; } catch { /* il decoder conserva l'ultimo frame valido */ } }
  private startVideoPlayback(video: HTMLVideoElement): void { if (this.videoPlayPending || this.video !== video || !this.previewPlaying) return; this.videoPlayPending = true; void video.play().catch(() => undefined).finally(() => { if (this.video === video) this.videoPlayPending = false; }); }

  async prepare(): Promise<void> { if (this.disposed) throw new Error("Renderer Overlay Spectral dismesso."); const settings = this.input?.settings; this.ensureMedia(settings?.backgroundImageUrl ?? null, settings?.backgroundMediaType ?? "image"); if (!this.externalBackground) await (this.imageLoad ?? Promise.resolve()); if (this.disposed) throw new Error("Renderer Overlay Spectral dismesso."); this.renderNow(); }

  private drawRadial(context: CanvasRenderingContext2D, spectrum: CoverSpectrumFrame, settings: OverlaySpectralSettings, time: number): void {
    const radius = Math.min(this.width, this.height) * .19; const cx = this.width / 2; const cy = this.height / 2; const speed = time * settings.motionSpeed * .22;
    this.lastBandValues.forEach((value, index) => { const angle = speed + index / this.bandCount * Math.PI * 2; const length = (this.height * .045 + value * this.height * .18) * settings.intensity; context.save(); context.translate(cx, cy); context.rotate(angle); context.fillStyle = settings.palette[index % 3]!; context.fillRect(radius, -Math.max(1, this.width * .0025), length, Math.max(2, this.width * .005)); context.restore(); });
    context.strokeStyle = settings.palette[2]; context.lineWidth = Math.max(1, this.width * .003); context.beginPath(); context.arc(cx, cy, radius * (1 + spectrum.pulse * .1), 0, Math.PI * 2); context.stroke();
  }

  private drawTunnel(context: CanvasRenderingContext2D, settings: OverlaySpectralSettings, time: number): void {
    const cx = this.width / 2; const cy = this.height / 2; const maximum = Math.hypot(this.width, this.height) * .55;
    for (let ring = 0; ring < 12; ring += 1) { const phase = (ring / 12 + time * settings.motionSpeed * .12) % 1; const radius = Math.max(4, phase * maximum); context.beginPath(); for (let point = 0; point <= 96; point += 1) { const angle = point / 96 * Math.PI * 2; const value = this.lastBandValues[(point + ring * 4) % 48] ?? 0; const r = radius * (1 + value * .16 * settings.intensity); const x = cx + Math.cos(angle) * r; const y = cy + Math.sin(angle) * r; if (point === 0) context.moveTo(x, y); else context.lineTo(x, y); } context.closePath(); context.strokeStyle = settings.palette[ring % 3]!; context.globalAlpha = settings.overlayOpacity * (1 - phase * .65); context.lineWidth = Math.max(1, this.width * .0025); context.stroke(); }
  }

  private drawKaleidoscope(context: CanvasRenderingContext2D, settings: OverlaySpectralSettings, time: number): void {
    const cx = this.width / 2; const cy = this.height / 2; const radius = Math.min(this.width, this.height) * .46;
    for (let segment = 0; segment < settings.symmetry; segment += 1) { context.save(); context.translate(cx, cy); context.rotate(segment / settings.symmetry * Math.PI * 2 + time * settings.motionSpeed * .08); context.beginPath(); context.moveTo(0, 0); for (let index = 0; index < 24; index += 1) { const value = this.lastBandValues[(index * 2 + segment) % 48] ?? 0; const x = index / 23 * radius; const y = Math.sin(index * .72 + time * 2) * radius * .035 + value * radius * .22 * settings.intensity; context.lineTo(x, y); } context.strokeStyle = settings.palette[segment % 3]!; context.lineWidth = Math.max(1, this.width * .003); context.stroke(); context.restore(); }
  }

  private drawPlasma(context: CanvasRenderingContext2D, settings: OverlaySpectralSettings, time: number): void {
    for (let index = 0; index < 14; index += 1) { const value = this.lastBandValues[(index * 7) % 48] ?? 0; const x = this.width * (.5 + .42 * Math.sin(time * settings.motionSpeed * (.17 + index * .011) + index * 1.7)); const y = this.height * (.5 + .42 * Math.cos(time * settings.motionSpeed * (.13 + index * .009) + index)); const radius = Math.min(this.width, this.height) * (.04 + value * .14 * settings.intensity); const glow = context.createRadialGradient(x, y, 0, x, y, radius); glow.addColorStop(0, settings.palette[index % 3]!); glow.addColorStop(1, "transparent"); context.fillStyle = glow; context.fillRect(x - radius, y - radius, radius * 2, radius * 2); }
  }

  private drawSpectrumBars(context: CanvasRenderingContext2D, settings: OverlaySpectralSettings): void { const width = this.width * .88 / 48; const baseline = this.height * .84; this.lastBandValues.forEach((value, index) => { const height = Math.max(3, value * this.height * .32 * settings.intensity); context.fillStyle = settings.palette[Math.floor(index / 16)]!; context.globalAlpha = .35 + value * .65; context.fillRect(this.width * .06 + index * width, baseline - height, Math.max(1, width * .72), height); }); }

  private drawWaveform(context: CanvasRenderingContext2D, settings: OverlaySpectralSettings, time: number, mirrored: boolean): void { const center = this.height * .55; const amplitude = this.height * .22 * settings.intensity; const trace = (direction: number) => { context.beginPath(); this.lastBandValues.forEach((value, index) => { const x = index / 47 * this.width; const y = center + direction * (value * amplitude + Math.sin(index * .65 + time * settings.motionSpeed * 2) * amplitude * .08); if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); }); context.stroke(); }; context.lineWidth = Math.max(1.5, this.width * .004); context.strokeStyle = settings.palette[0]; trace(1); context.strokeStyle = settings.palette[2]; trace(mirrored ? -1 : .32); }

  private drawParticleBurst(context: CanvasRenderingContext2D, settings: OverlaySpectralSettings, time: number, spectrum: CoverSpectrumFrame): void { const count = 96; const base = Math.min(this.width, this.height) * .06; for (let index = 0; index < count; index += 1) { const value = this.lastBandValues[index % 48] ?? 0; const hash = Math.sin((index + 1) * 91.731) * 43758.5453; const unit = hash - Math.floor(hash); const phase = (time * (.22 + unit * .18) + unit) % 1; const distance = base + phase * Math.min(this.width, this.height) * (.22 + value * .35) * settings.intensity; const angle = index / count * Math.PI * 2 + unit * .18; const alpha = (1 - phase) * (.25 + spectrum.pulse * .75); context.globalAlpha = alpha; context.fillStyle = settings.palette[index % 3]!; context.beginPath(); context.arc(this.width / 2 + Math.cos(angle) * distance, this.height / 2 + Math.sin(angle) * distance, Math.max(1, this.width * (.002 + value * .005)), 0, Math.PI * 2); context.fill(); } }

  private drawPulseShapes(context: CanvasRenderingContext2D, settings: OverlaySpectralSettings, time: number, spectrum: CoverSpectrumFrame): void { for (let index = 0; index < 7; index += 1) { const phase = (time * settings.motionSpeed * .2 + index / 7) % 1; const sides = 3 + index % 6; const radius = Math.min(this.width, this.height) * (.06 + phase * .43) * (1 + spectrum.pulse * .12); context.beginPath(); for (let side = 0; side <= sides; side += 1) { const angle = side / sides * Math.PI * 2 + time * .08; const x = this.width / 2 + Math.cos(angle) * radius; const y = this.height / 2 + Math.sin(angle) * radius; if (side === 0) context.moveTo(x, y); else context.lineTo(x, y); } context.strokeStyle = settings.palette[index % 3]!; context.globalAlpha = 1 - phase; context.lineWidth = Math.max(1, this.width * .003); context.stroke(); } }

  private drawDynamicVignette(context: CanvasRenderingContext2D, settings: OverlaySpectralSettings, spectrum: CoverSpectrumFrame): void { const radius = Math.max(this.width, this.height) * .68; const gradient = context.createRadialGradient(this.width / 2, this.height / 2, radius * .05, this.width / 2, this.height / 2, radius); gradient.addColorStop(0, `${settings.palette[0]}22`); gradient.addColorStop(.58, `${settings.palette[1]}44`); gradient.addColorStop(1, `${settings.palette[2]}${Math.round((.45 + spectrum.pulse * .45) * 255).toString(16).padStart(2, "0")}`); context.fillStyle = gradient; context.fillRect(0, 0, this.width, this.height); }

  private drawRadialRays(context: CanvasRenderingContext2D, settings: OverlaySpectralSettings, time: number): void { const cx = this.width / 2; const cy = this.height / 2; const inner = Math.min(this.width, this.height) * .15; for (let index = 0; index < 96; index += 1) { const value = this.lastBandValues[index % 48] ?? 0; const angle = index / 96 * Math.PI * 2 + time * settings.motionSpeed * .08; const outer = inner + Math.max(2, value * this.width * .22 * settings.intensity); context.strokeStyle = settings.palette[Math.floor(index / 32)]!; context.globalAlpha = .35 + value * .65; context.beginPath(); context.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner); context.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer); context.stroke(); } }

  private drawAudioGrid(context: CanvasRenderingContext2D, settings: OverlaySpectralSettings, time: number): void { const columns = 12; const rows = 8; const cellWidth = this.width / columns; const cellHeight = this.height / rows; for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) { const index = (row * columns + column) % 48; const value = this.lastBandValues[index] ?? 0; const scale = .12 + value * .82; const wave = .92 + Math.sin(time * settings.motionSpeed + row * .6 + column * .3) * .08; const width = cellWidth * scale * wave; const height = cellHeight * scale * wave; context.fillStyle = settings.palette[(row + column) % 3]!; context.globalAlpha = .18 + value * .82; context.fillRect(column * cellWidth + (cellWidth - width) / 2, row * cellHeight + (cellHeight - height) / 2, width, height); } }

  private drawOrbitingParticles(context: CanvasRenderingContext2D, settings: OverlaySpectralSettings, time: number, spectrum: CoverSpectrumFrame): void { const count = 120; for (let index = 0; index < count; index += 1) { const unit = ((Math.imul(index + 17, 2654435761) >>> 0) / 0x1_0000_0000); const value = this.lastBandValues[index % 48] ?? 0; for (let trail = 2; trail >= 0; trail -= 1) { const angle = unit * Math.PI * 2 + time * settings.motionSpeed * (.18 + unit * .25) - trail * .035; const radius = Math.min(this.width, this.height) * (.19 + unit * .18 + spectrum.pulse * .04); context.globalAlpha = (1 - trail / 3) * (.3 + value * .7); context.fillStyle = settings.palette[index % 3]!; context.beginPath(); context.arc(this.width / 2 + Math.cos(angle) * radius, this.height / 2 + Math.sin(angle) * radius * (.45 + unit * .45), Math.max(1, this.width * (.0015 + value * .004)), 0, Math.PI * 2); context.fill(); } } }

  private drawPreset(context: CanvasRenderingContext2D, spectrum: CoverSpectrumFrame, settings: OverlaySpectralSettings, time: number): void { switch (settings.presetId) { case "milkdrop-spectral-tunnel": this.drawTunnel(context, settings, time); break; case "milkdrop-kaleidoscope": this.drawKaleidoscope(context, settings, time); break; case "milkdrop-plasma-field": this.drawPlasma(context, settings, time); break; case "milkdrop-spectrum-bars": this.drawSpectrumBars(context, settings); break; case "milkdrop-waveform-line": this.drawWaveform(context, settings, time, false); break; case "milkdrop-particle-burst": this.drawParticleBurst(context, settings, time, spectrum); break; case "milkdrop-pulse-shapes": this.drawPulseShapes(context, settings, time, spectrum); break; case "milkdrop-dynamic-vignette": this.drawDynamicVignette(context, settings, spectrum); break; case "milkdrop-radial-rays": this.drawRadialRays(context, settings, time); break; case "milkdrop-mirrored-waveform": this.drawWaveform(context, settings, time, true); break; case "milkdrop-audio-grid": this.drawAudioGrid(context, settings, time); break; case "milkdrop-orbiting-particles": this.drawOrbitingParticles(context, settings, time, spectrum); break; case "milkdrop-circular-spectrum": case "milkdrop-radial-spectrum": default: this.drawRadial(context, spectrum, settings, time); } }

  renderNow(timeSeconds = this.renderTimeSeconds): void {
    this.renderTimeSeconds = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
    timeSeconds = this.renderTimeSeconds;
    const context = this.context; const input = this.input; if (!context || !input) return; const sourceSettings = input.settings; const preset = overlaySpectralPreset(sourceSettings.presetId); const settings = { ...sourceSettings, palette: mixOverlaySpectralPalette(preset.nativePalette, sourceSettings.palette, sourceSettings.paletteInfluence) }; const spectrum = resolveCoverSpectrum(input.energyFrames, timeSeconds); this.lastBandValues = Array.from({ length: this.bandCount }, (_, index) => band(spectrum, index, settings));
    context.globalAlpha = 1; context.globalCompositeOperation = "source-over"; context.clearRect(0, 0, this.width, this.height);
    if (!this.externalBackground) { const background = context.createLinearGradient(0, 0, this.width, this.height); background.addColorStop(0, settings.palette[0]); background.addColorStop(.55, "#080914"); background.addColorStop(1, settings.palette[1]); context.fillStyle = background; context.fillRect(0, 0, this.width, this.height);
      if (this.image && this.imageState === "loaded") { const fit = resolveOverlaySpectralImageFit(this.image.naturalWidth, this.image.naturalHeight, this.width, this.height, settings.backgroundFit); context.drawImage(this.image, fit.x, fit.y, fit.width, fit.height); }
      if (this.video && this.videoState === "loaded" && this.video.videoWidth > 0 && this.video.videoHeight > 0) { this.previewPlaybackTime = timeSeconds; this.syncVideoTime(this.video, timeSeconds); const fit = resolveOverlaySpectralImageFit(this.video.videoWidth, this.video.videoHeight, this.width, this.height, settings.backgroundFit); context.drawImage(this.video, fit.x, fit.y, fit.width, fit.height); }
      if (settings.backgroundImageUrl) { context.fillStyle = `rgba(0,0,0,${settings.backgroundDim})`; context.fillRect(0, 0, this.width, this.height); }
    } else if (settings.backgroundImageUrl) { context.fillStyle = `rgba(0,0,0,${settings.backgroundDim})`; context.fillRect(0, 0, this.width, this.height); }
    context.save(); context.globalAlpha = settings.overlayOpacity; context.globalCompositeOperation = settings.blendMode; const ghostPasses = Math.max(1, Math.round(1 + settings.trail * 4)); for (let pass = ghostPasses - 1; pass >= 0; pass -= 1) { context.globalAlpha = settings.overlayOpacity * (pass === 0 ? 1 : settings.trail * .24); this.drawPreset(context, spectrum, settings, timeSeconds - pass * .035); } context.restore();
    if (!settings.backgroundImageUrl) { const vignette = context.createRadialGradient(this.width / 2, this.height / 2, Math.min(this.width, this.height) * .15, this.width / 2, this.height / 2, Math.max(this.width, this.height) * .68); vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(1, "rgba(0,0,0,.72)"); context.fillStyle = vignette; context.fillRect(0, 0, this.width, this.height); }
    if (settings.showMetadata) { const pad = Math.max(18, this.width * .045); context.fillStyle = "rgba(0,0,0,.5)"; context.fillRect(pad * .65, this.height - pad * 2.55, Math.min(this.width - pad * 1.3, this.width * .66), pad * 1.9); context.fillStyle = "#fff"; context.font = `700 ${Math.max(16, this.width * .035)}px sans-serif`; context.fillText(settings.title || "Overlay Spectral", pad, this.height - pad * 1.45); context.font = `500 ${Math.max(11, this.width * .021)}px sans-serif`; context.fillStyle = settings.palette[2]; context.fillText(settings.artist, pad, this.height - pad * .78); }
  }

  dispose(): void { if (this.disposed) return; this.disposed = true; this.previewPlaying = false; this.videoPlayPending = false; this.rejectImage?.(new Error("Renderer Overlay Spectral dismesso.")); this.rejectImage = null; if (this.image) { this.image.onload = null; this.image.onerror = null; } if (this.video) { this.video.pause(); this.video.onloadeddata = null; this.video.onseeked = null; this.video.onerror = null; this.video.removeAttribute("src"); this.video.load(); this.video.remove(); } this.image = null; this.video = null; this.input = null; this.context = null; }
}
