import type { SongPlayerAnalysis } from "./song-player-types";
import type { SongPlayerSettings } from "@rbs/project-schema";
import { resolveSongPlayerLayout, type SongPlayerLayout } from "./song-player-layout";
import { sampleSongPlayerChroma } from "./song-player-analysis";
import { songPlayerMediaTime, type SongPlayerPlaybackRange } from "./song-player-playback";

export interface SongPlayerRenderInput { settings: SongPlayerSettings; analysis?: SongPlayerAnalysis | null; playbackRange: SongPlayerPlaybackRange; localTimeSeconds: number; }
export interface ImageFitRect { x: number; y: number; width: number; height: number; }
export function resolveSongPlayerImageFit(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number, fit: "cover" | "contain"): ImageFitRect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  const scale = fit === "cover" ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight) : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight); const width = sourceWidth * scale; const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}
export function projectSongPlayerCube(timeSeconds: number, centerX: number, centerY: number, size: number): Array<{ x: number; y: number; depth: number }> {
  const angleY = timeSeconds * .72; const angleX = .42 + Math.sin(timeSeconds * .31) * .18; const sinX = Math.sin(angleX); const cosX = Math.cos(angleX); const sinY = Math.sin(angleY); const cosY = Math.cos(angleY);
  return [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(([x, y, z]) => { const y1 = y! * cosX - z! * sinX; const z1 = y! * sinX + z! * cosX; const x2 = x! * cosY + z1 * sinY; const z2 = -x! * sinY + z1 * cosY; const perspective = 3.8 / (3.8 - z2); return { x: centerX + x2 * size * .5 * perspective, y: centerY + y1 * size * .5 * perspective, depth: z2 }; });
}
function parseHex(color: string): [number, number, number] { const value = /^#([0-9a-f]{6})$/i.exec(color)?.[1] ?? "ffffff"; return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)]; }
export function resolveSongPlayerElementPalette(settings: SongPlayerSettings, element: "spectrum" | "spectrogram"): readonly [string, string, string] {
  if (element === "spectrum") return settings.spectrumPaletteMode === "auto" ? settings.palette : settings.spectrumPalette;
  return settings.spectrogramPaletteMode === "auto" ? settings.palette : settings.spectrogramPalette;
}

function spectrogramColor(colors: readonly [number, number, number][], amount: number): [number, number, number] {
  const intensity = Math.max(0, Math.min(1, Math.sqrt(amount))); const position = intensity * Math.max(0, colors.length - 1); const leftIndex = Math.floor(position); const rightIndex = Math.min(colors.length - 1, leftIndex + 1); const mix = position - leftIndex; const left = colors[leftIndex] ?? [255, 255, 255]; const right = colors[rightIndex] ?? left; const brightness = .28 + intensity * .72;
  return [0, 1, 2].map((index) => Math.round(((left[index] ?? 255) * (1 - mix) + (right[index] ?? 255) * mix) * brightness)) as [number, number, number];
}

export class SongPlayerRenderer {
  readonly canvas: HTMLCanvasElement; private context: CanvasRenderingContext2D | null; private width = 1; private height = 1; private input: SongPlayerRenderInput | null = null; private layout: SongPlayerLayout = resolveSongPlayerLayout(1, 1); private images = new Map<string, HTMLImageElement>(); private imageLoads = new Map<string, Promise<void>>(); private imageLoadRejectors = new Map<string, (reason: Error) => void>(); private imageLoadStates = new Map<string, "loading" | "loaded" | "failed">(); private disposed = false; private spectrogramCanvas: HTMLCanvasElement | null = null; private spectrogramKey = ""; readonly barCount = 48; lastBars: number[] = []; lastCubeVertices: Array<{ x: number; y: number; depth: number }> = []; spectrogramCellCount = 0;
  constructor(canvas?: HTMLCanvasElement) { this.canvas = canvas ?? document.createElement("canvas"); this.context = this.canvas.getContext("2d"); }
  update(input: SongPlayerRenderInput): void { this.input = input; this.renderNow(input.localTimeSeconds); }
  setExportSize(width: number, height: number): void { this.width = Math.max(1, Math.round(width)); this.height = Math.max(1, Math.round(height)); this.canvas.width = this.width; this.canvas.height = this.height; this.layout = resolveSongPlayerLayout(this.width, this.height); }
  restorePreviewSize(): void { const rect = this.canvas.getBoundingClientRect(); const dpr = typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1); this.setExportSize((rect.width || this.width) * dpr, (rect.height || this.height) * dpr); }
  private image(url: string): HTMLImageElement {
    const cached = this.images.get(url); if (cached) return cached;
    const image = new Image(); let settled = false; let resolveLoad!: () => void; let rejectLoad!: (reason: Error) => void;
    const finish = (reason?: Error) => { if (settled) return; settled = true; this.imageLoadRejectors.delete(url); image.onload = null; image.onerror = null; this.imageLoadStates.set(url, reason ? "failed" : "loaded"); if (reason) rejectLoad(reason); else { this.renderNow(); resolveLoad(); } };
    const load = new Promise<void>((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject; }); void load.catch(() => undefined);
    image.onload = () => finish(); image.onerror = () => finish(new Error("Immagine Song Player non caricabile."));
    this.imageLoads.set(url, load); this.imageLoadRejectors.set(url, (reason) => finish(reason)); this.imageLoadStates.set(url, "loading"); this.images.set(url, image); image.src = url;
    if (image.complete) finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? undefined : new Error("Immagine Song Player non caricabile."));
    return image;
  }
  async prepare(): Promise<void> { if (this.disposed) throw new Error("Renderer Song Player dismesso."); const settings = this.input?.settings; if (!settings) return; const urls = [settings.coverImageUrl, settings.backgroundImageUrl].filter((url): url is string => Boolean(url)); urls.forEach((url) => this.image(url)); await Promise.all(urls.map((url) => this.imageLoads.get(url) ?? Promise.resolve())); if (this.disposed) throw new Error("Renderer Song Player dismesso."); this.renderNow(); }
  private matrix(analysis: SongPlayerAnalysis, palette: readonly string[]): HTMLCanvasElement | null {
    const cache = analysis.spectrogram; const key = `${analysis.sourceHash}:${cache.frameCount}:${cache.bands}:${palette.join(":")}`; if (this.spectrogramCanvas && this.spectrogramKey === key) return this.spectrogramCanvas;
    const canvas = document.createElement("canvas"); canvas.width = cache.frameCount; canvas.height = cache.bands; const context = canvas.getContext("2d"); if (!context) return null;
    const pixels = context.createImageData(cache.frameCount, cache.bands); const data = new Uint8Array(cache.data); const colors = palette.map(parseHex); this.spectrogramCellCount = cache.frameCount * cache.bands;
    for (let frame = 0; frame < cache.frameCount; frame += 1) for (let band = 0; band < cache.bands; band += 1) { const amount = data[frame * cache.bands + band]! / 255; const color = spectrogramColor(colors, amount); const targetY = cache.bands - 1 - band; const pixel = (targetY * cache.frameCount + frame) * 4; pixels.data[pixel] = color[0]; pixels.data[pixel + 1] = color[1]; pixels.data[pixel + 2] = color[2]; pixels.data[pixel + 3] = 255; }
    context.putImageData(pixels, 0, 0); this.spectrogramCanvas = canvas; this.spectrogramKey = key; return canvas;
  }
  renderNow(localFragmentTimeSeconds = this.input?.localTimeSeconds ?? 0): void {
    const input = this.input; const context = this.context; if (!context || !input) return; const settings = input.settings; const analysis = input.analysis; const range = input.playbackRange; const fullDuration = Math.max(.001, analysis?.durationSeconds ?? range.endSeconds); const fullTime = songPlayerMediaTime(localFragmentTimeSeconds, range); const palette = settings.palette; const spectrumPalette = resolveSongPlayerElementPalette(settings, "spectrum"); const spectrogramPalette = resolveSongPlayerElementPalette(settings, "spectrogram");
    const background = context.createLinearGradient(0, 0, this.width, this.height); background.addColorStop(0, palette[0]); background.addColorStop(1, palette[1]); context.globalAlpha = 1; context.fillStyle = background; context.fillRect(0, 0, this.width, this.height); this.layout = resolveSongPlayerLayout(this.width, this.height);
    if (settings.backgroundImageUrl) { const image = this.image(settings.backgroundImageUrl); if (this.imageLoadStates.get(settings.backgroundImageUrl) === "loaded" && image.naturalWidth > 0 && image.naturalHeight > 0) { const fit = resolveSongPlayerImageFit(image.naturalWidth, image.naturalHeight, this.width, this.height, settings.backgroundFit); context.save(); context.globalAlpha = .35; context.drawImage(image, fit.x, fit.y, fit.width, fit.height); context.restore(); } }
    const cover = this.layout.cover; context.save(); context.globalAlpha = .15; context.fillStyle = palette[2]; context.fillRect(cover.x, cover.y, cover.width, cover.height); context.restore();
    if (settings.coverStyle === "flat") { if (settings.coverImageUrl) { const image = this.image(settings.coverImageUrl); if (this.imageLoadStates.get(settings.coverImageUrl) === "loaded" && image.naturalWidth > 0 && image.naturalHeight > 0) context.drawImage(image, cover.x, cover.y, cover.width, cover.height); } this.lastCubeVertices = []; }
    else {
      this.lastCubeVertices = projectSongPlayerCube(fullTime, cover.x + cover.width / 2, cover.y + cover.height / 2, Math.min(cover.width, cover.height) * .78);
      const faces = [[0,1,2,3],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,3,7,4]] as const;
      const visibleFaces = [...faces]
        .sort((left, right) => right.reduce<number>((sum, index) => sum + this.lastCubeVertices[index]!.depth, 0) - left.reduce<number>((sum, index) => sum + this.lastCubeVertices[index]!.depth, 0))
        .slice(0, 3)
        .reverse();
      const coverImage = settings.coverImageUrl ? this.image(settings.coverImageUrl) : null;
      visibleFaces.forEach((face, faceIndex) => {
        const facePoints = face.map((index) => this.lastCubeVertices[index]!);
        const minX = Math.min(...facePoints.map((point) => point.x)); const maxX = Math.max(...facePoints.map((point) => point.x)); const minY = Math.min(...facePoints.map((point) => point.y)); const maxY = Math.max(...facePoints.map((point) => point.y));
        context.save(); context.beginPath(); context.moveTo(facePoints[0]!.x, facePoints[0]!.y); facePoints.slice(1).forEach((point) => context.lineTo(point.x, point.y)); context.closePath(); context.clip(); context.globalAlpha = .7 + faceIndex * .1; context.fillStyle = palette[faceIndex % palette.length] ?? palette[1]; context.fillRect(minX, minY, maxX - minX, maxY - minY);
        if (settings.coverImageUrl && coverImage && this.imageLoadStates.get(settings.coverImageUrl) === "loaded" && coverImage.naturalWidth > 0 && coverImage.naturalHeight > 0) context.drawImage(coverImage, minX, minY, maxX - minX, maxY - minY);
        context.restore();
      });
      const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]] as const; context.strokeStyle = palette[2]; context.lineWidth = Math.max(2, this.width * .006); context.beginPath(); edges.forEach(([a,b]) => { const from = this.lastCubeVertices[a]!; const to = this.lastCubeVertices[b]!; context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); }); context.stroke();
    }
    const chroma = analysis ? sampleSongPlayerChroma(analysis, fullTime) : new Float32Array(12); this.lastBars = Array.from({ length: this.barCount }, (_, index) => Math.max(.05, Math.min(1, (chroma[index % 12] ?? .15) * settings.spectrumGain + .1))); this.lastBars.forEach((amountValue, index) => { const angle = index / this.barCount * Math.PI * 2; const amount = amountValue * Math.min(cover.width, cover.height) * .12; const cx = cover.x + cover.width / 2 + Math.cos(angle) * (cover.width / 2 + amount * .7); const cy = cover.y + cover.height / 2 + Math.sin(angle) * (cover.height / 2 + amount * .7); context.save(); context.fillStyle = spectrumPalette[Math.min(spectrumPalette.length - 1, Math.floor(index / this.barCount * spectrumPalette.length))] ?? spectrumPalette[0]; context.translate(cx, cy); context.rotate(angle + Math.PI / 2); context.fillRect(-Math.max(1, this.width * .002), -amount, Math.max(2, this.width * .004), amount); context.restore(); });
    const spec = this.layout.spectrogram; if (analysis) { const matrix = this.matrix(analysis, spectrogramPalette); if (matrix) { context.save(); context.globalAlpha = settings.spectrogramOpacity; context.imageSmoothingEnabled = true; context.drawImage(matrix, spec.x, spec.y, spec.width, spec.height); context.restore(); } } else this.spectrogramCellCount = 0;
    const segmentX = spec.x + Math.max(0, Math.min(1, range.startSeconds / fullDuration)) * spec.width; const segmentWidth = Math.max(1, Math.min(spec.width - Math.max(0, segmentX - spec.x), range.durationSeconds / fullDuration * spec.width)); context.strokeStyle = spectrogramPalette[0]; context.lineWidth = Math.max(1, this.width * .002); context.strokeRect(segmentX, spec.y, segmentWidth, spec.height); context.fillStyle = spectrogramPalette[2]; const playhead = spec.x + Math.max(0, Math.min(1, fullTime / fullDuration)) * spec.width; context.fillRect(playhead - 1, spec.y, 2, spec.height);
    if (settings.metadataVisible) { context.fillStyle = "#fff"; context.font = `${Math.max(12, this.width * .026)}px sans-serif`; context.fillText(settings.title || "Song Player", this.layout.metadata.x, this.layout.metadata.y + 20); context.fillText(settings.artist, this.layout.metadata.x, this.layout.metadata.y + 42); }
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.input = null; this.context = null; this.imageLoadRejectors.forEach((reject) => reject(new Error("Renderer Song Player dismesso."))); this.images.forEach((image) => { image.onload = null; image.onerror = null; }); this.images.clear(); this.imageLoads.clear(); this.imageLoadRejectors.clear(); this.imageLoadStates.clear(); this.spectrogramCanvas = null; }
}
