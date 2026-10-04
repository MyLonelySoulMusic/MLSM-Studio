import type { AnalysisFrame } from "./analysis-engine";

export type RippleSource = "stereo" | "peaks";
export interface RippleTrigger { source: RippleSource; strength: number; }
export interface WaterImpact { x: number; y: number; born: number; strength: number; }
export const rippleLifetime = 5;
export const maxWaterImpacts = 8;

/** Read measurements only: no changes to audio routing, gain or analysis.
 * Separate cooldowns let both widgets strike the same water simultaneously. */
export class RippleDetector {
  private lastSequence = -1;
  private lastElapsed = -1;
  private lastTime = -1;
  private width = 0;
  private level = -90;
  private samples = 0;
  private lastStereo = -Infinity;
  private lastPeak = -Infinity;

  reset() { this.lastSequence = this.lastElapsed = this.lastTime = -1; this.samples = 0; this.lastStereo = this.lastPeak = -Infinity; }
  observe(frame: AnalysisFrame, time: number): RippleTrigger[] {
    if (frame.elapsed < this.lastElapsed || (this.lastTime >= 0 && time - this.lastTime > .6)) this.reset();
    if (frame.sequence === this.lastSequence) return [];
    const level = Math.max(...frame.truePeak, ...frame.peak);
    if (!Number.isFinite(level) || level < -65 || !Number.isFinite(frame.width)) { this.reset(); return []; }
    const width = Math.max(0, Math.min(100, frame.width));
    const dt = this.lastTime < 0 ? .033 : Math.max(.001, Math.min(.15, time - this.lastTime));
    this.lastTime = time; this.lastSequence = frame.sequence; this.lastElapsed = frame.elapsed;
    if (!this.samples++) { this.width = width; this.level = level; return []; }
    const result: RippleTrigger[] = [];
    const opening = width - this.width, jump = Math.abs(level - this.level);
    if (this.samples >= 3 && width >= 30 && opening >= 19 && level > -50 && time - this.lastStereo >= 1.1) {
      result.push({ source: "stereo", strength: Math.min(1.5, .65 + opening / 60) }); this.lastStereo = time;
    }
    if (this.samples >= 3 && jump >= 7 && Math.max(level, this.level) > -42 && time - this.lastPeak >= .8) {
      result.push({ source: "peaks", strength: Math.min(1.5, .65 + jump / 18) }); this.lastPeak = time;
    }
    this.width += (width - this.width) * (1 - Math.exp(-dt / .22));
    this.level += (level - this.level) * (1 - Math.exp(-dt / .18));
    return result;
  }
}

/** Damped, radially spreading capillary wave packet. Signed height and slope
 * are summed BEFORE lighting, so crossings reinforce or cancel each other.
 * The packet spans several crests, rather than independent CSS circles. */
export function waterField(x: number, y: number, time: number, impacts: readonly WaterImpact[]) {
  let height = 0, dx = 0, dy = 0;
  for (const impact of impacts) {
    const age = time - impact.born;
    if (age <= 0 || age >= rippleLifetime) continue;
    const ox = x - impact.x, oy = y - impact.y, distance = Math.hypot(ox, oy);
    const spread = 32 + age * 7, offset = distance - age * 175, k = Math.PI * 2 / 32;
    const envelope = impact.strength * Math.min(1, age / .12) * Math.exp(-age * .52 - (offset / spread) ** 2) / Math.sqrt(1 + distance * .025);
    const phase = offset * k;
    const value = envelope * Math.cos(phase);
    const slope = envelope * (-Math.sin(phase) * k - Math.cos(phase) * (2 * offset / (spread * spread) + .0125 / (1 + distance * .025)));
    height += value;
    if (distance > .001) { dx += slope * ox / distance; dy += slope * oy / distance; }
  }
  return { height, dx, dy };
}
