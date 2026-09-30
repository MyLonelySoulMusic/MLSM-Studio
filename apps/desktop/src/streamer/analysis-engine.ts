/** Stereo streaming measurements. BS.1770 K weighting, 400 ms/75% gating;
 * EBU 3342 3 s windows, -20 LU gate and 10th/95th percentiles for LRA.
 * No source audio or measurement history is uploaded or persisted. */
export interface AnalysisSettings { fftSize: 2048 | 4096 | 8192; smoothing: number; peakHold: number; }
export interface AnalysisFrame {
  sampleRate: number; elapsed: number; sequence: number;
  peak: [number, number]; rms: [number, number]; truePeak: [number, number]; hold: [number, number]; clip: [boolean, boolean];
  momentary: number; shortTerm: number; integrated: number; lra: number; maxMomentary: number; maxShortTerm: number; maxTruePeak: number;
  correlation: number; width: number; lowCorrelation: number;
  spectrumLeft: Float32Array; spectrumRight: Float32Array; waveLeft: Float32Array; waveRight: Float32Array; bands: Float32Array;
}
export const defaultAnalysisSettings: AnalysisSettings = { fftSize: 4096, smoothing: .72, peakHold: 2 };
export const amplitudeDb = (value: number) => value > 1e-12 ? 20 * Math.log10(value) : -Infinity;
const energyLufs = (value: number) => value > 1e-14 ? -.691 + 10 * Math.log10(value) : -Infinity;

class Biquad {
  private z1 = 0; private z2 = 0;
  constructor(private b0: number, private b1: number, private b2: number, private a1: number, private a2: number) {}
  next(x: number): number { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
}
function kFilters(rate: number): [Biquad, Biquad] {
  const k = Math.tan(Math.PI * 1681.974450955533 / rate), vh = 10 ** (3.999843853973347 / 20), vb = vh ** .4996667741545416, q = .7071752369554196;
  const a0 = 1 + k / q + k * k;
  const shelf = new Biquad((vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0);
  const h = Math.tan(Math.PI * 38.13547087602444 / rate), hq = .5003270373238773, d = 1 + h / hq + h * h;
  return [shelf, new Biquad(1, -2, 1, 2 * (h * h - 1) / d, (1 - h / hq + h * h) / d)];
}

/** Bounded histogram: .01 LU bins, independent of session length. */
class LoudnessHistogram {
  counts = new Float64Array(12001); sums = new Float64Array(12001); total = 0; energy = 0;
  add(energy: number) { const level = energyLufs(energy); if (level < -70) return; const index = Math.min(12000, Math.max(0, Math.round((level + 70) * 100))); this.counts[index]!++; this.sums[index]! += energy; this.total++; this.energy += energy; }
  gated(relative: number): { mean: number; low: number; high: number } {
    if (!this.total) return { mean: -Infinity, low: -Infinity, high: -Infinity };
    const threshold = Math.max(-70, energyLufs(this.energy / this.total) + relative);
    const start = Math.max(0, Math.ceil((threshold + 70) * 100)); let count = 0, sum = 0;
    for (let i = start; i < this.counts.length; i++) { count += this.counts[i]!; sum += this.sums[i]!; }
    let cumulative = 0, low = -Infinity, high = -Infinity;
    for (let i = start; i < this.counts.length; i++) { cumulative += this.counts[i]!; if (low === -Infinity && cumulative >= count * .1) low = i / 100 - 70; if (cumulative >= count * .95) { high = i / 100 - 70; break; } }
    return { mean: count ? energyLufs(sum / count) : -Infinity, low, high };
  }
}

/** 4x polyphase windowed-sinc interpolation, 32 input taps. Includes sample
 * peaks and preserves filter history between blocks (no per-block edge reset). */
class TruePeak {
  private ring = new Float64Array(32); private cursor = 0;
  private coefficients = Array.from({ length: 3 }, (_, phase) => {
    const c = new Float64Array(32); let sum = 0;
    for (let j = 0; j < 32; j++) { const x = j - 15 - (phase + 1) / 4; const window = .42 - .5 * Math.cos(2 * Math.PI * j / 31) + .08 * Math.cos(4 * Math.PI * j / 31); c[j] = (Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * window; sum += c[j]!; }
    for (let j = 0; j < 32; j++) c[j]! /= sum;
    return c;
  });
  next(value: number): number { this.ring[this.cursor] = value; this.cursor = (this.cursor + 1) % 32; let peak = Math.abs(value); for (const c of this.coefficients) { let sum = 0; for (let j = 0; j < 32; j++) sum += this.ring[(this.cursor + j) % 32]! * c[j]!; peak = Math.max(peak, Math.abs(sum)); } return peak; }
}

class Spectrum {
  private real: Float64Array; private imaginary: Float64Array; private window: Float64Array;
  readonly values: Float32Array;
  constructor(readonly size: number) { this.real = new Float64Array(size); this.imaginary = new Float64Array(size); this.window = Float64Array.from({ length: size }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / size)); this.values = new Float32Array(size / 2).fill(-120); }
  calculate(ring: Float32Array, cursor: number, smoothing: number): Float32Array {
    const n = this.size, r = this.real, im = this.imaginary; im.fill(0);
    for (let i = 0; i < n; i++) r[i] = ring[(cursor - n + i + ring.length) % ring.length]! * this.window[i]!;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const t = r[i]!; r[i] = r[j]!; r[j] = t; } }
    for (let length = 2; length <= n; length *= 2) { const a = -2 * Math.PI / length, cr = Math.cos(a), ci = Math.sin(a); for (let start = 0; start < n; start += length) { let wr = 1, wi = 0; for (let j = 0; j < length / 2; j++) { const e = start + j, o = e + length / 2, tr = wr * r[o]! - wi * im[o]!, ti = wr * im[o]! + wi * r[o]!; r[o] = r[e]! - tr; im[o] = im[e]! - ti; r[e]! += tr; im[e]! += ti; const old = wr; wr = wr * cr - wi * ci; wi = old * ci + wi * cr; } } }
    for (let i = 0; i < n / 2; i++) { const magnitude = Math.hypot(r[i]!, im[i]!) * (i === 0 ? 2 : 4) / n; const previous = 10 ** (this.values[i]! / 20); this.values[i] = Math.max(-120, amplitudeDb(smoothing * previous + (1 - smoothing) * magnitude)); }
    return this.values;
  }
}

export class StereoAnalysisEngine {
  readonly sampleRate: number; private settings: AnalysisSettings;
  private filters: [[Biquad, Biquad], [Biquad, Biquad]]; private interpolators = [new TruePeak(), new TruePeak()];
  private spectra: [Spectrum, Spectrum]; private rings = [new Float32Array(8192), new Float32Array(8192)]; private cursor = 0;
  private samples = 0; private chunkEnergy = 0; private chunkSamples = 0; private energyBlocks: number[] = []; private integrated = new LoudnessHistogram(); private range = new LoudnessHistogram();
  private momentary = -Infinity; private shortTerm = -Infinity; private maxM = -Infinity; private maxS = -Infinity; private maxTp = -Infinity;
  private peak = [0, 0]; private truePeak = [0, 0]; private squares = [0, 0]; private cross = 0; private frameSamples = 0;
  private low = [0, 0]; private lowSquares = [0, 0]; private lowCross = 0; private hold = [-Infinity, -Infinity]; private holdUntil = [0, 0]; private clip: [boolean, boolean] = [false, false]; private sequence = 0;
  constructor(rate: number, settings = defaultAnalysisSettings) { if (!Number.isFinite(rate) || rate < 8000 || rate > 384000) throw new Error("Unsupported PCM sample rate"); this.sampleRate = rate; this.settings = { ...settings }; this.filters = [kFilters(rate), kFilters(rate)]; this.spectra = [new Spectrum(settings.fftSize), new Spectrum(settings.fftSize)]; }
  configure(settings: AnalysisSettings) { if (settings.fftSize !== this.settings.fftSize) this.spectra = [new Spectrum(settings.fftSize), new Spectrum(settings.fftSize)]; this.settings = { ...settings }; }
  push(interleaved: Float32Array) {
    const lowAlpha = 1 - Math.exp(-2 * Math.PI * 120 / this.sampleRate), hop = Math.round(this.sampleRate / 10);
    for (let i = 0; i + 1 < interleaved.length; i += 2) {
      const l = Number.isFinite(interleaved[i]) ? interleaved[i]! : 0, r = Number.isFinite(interleaved[i + 1]) ? interleaved[i + 1]! : 0;
      for (let c = 0; c < 2; c++) { const x = c ? r : l; this.rings[c]![this.cursor] = x; this.peak[c] = Math.max(this.peak[c]!, Math.abs(x)); this.truePeak[c] = Math.max(this.truePeak[c]!, this.interpolators[c]!.next(x)); this.squares[c]! += x * x; this.clip[c] ||= Math.abs(x) >= 1; const filters = this.filters[c]!; const k = filters[1].next(filters[0].next(x)); this.chunkEnergy += k * k; this.low[c]! += lowAlpha * (x - this.low[c]!); this.lowSquares[c]! += this.low[c]! ** 2; }
      this.cross += l * r; this.lowCross += this.low[0]! * this.low[1]!; this.frameSamples++; this.samples++; this.chunkSamples++; this.cursor = (this.cursor + 1) % 8192;
      if (this.chunkSamples >= hop) {
        this.energyBlocks.push(this.chunkEnergy / this.chunkSamples); if (this.energyBlocks.length > 30) this.energyBlocks.shift();
        if (this.energyBlocks.length >= 4) { const energy = this.energyBlocks.slice(-4).reduce((a, b) => a + b, 0) / 4; this.momentary = energyLufs(energy); this.maxM = Math.max(this.maxM, this.momentary); this.integrated.add(energy); }
        if (this.energyBlocks.length === 30) { const energy = this.energyBlocks.reduce((a, b) => a + b, 0) / 30; this.shortTerm = energyLufs(energy); this.maxS = Math.max(this.maxS, this.shortTerm); this.range.add(energy); }
        this.chunkEnergy = 0; this.chunkSamples = 0;
      }
    }
  }
  snapshot(): AnalysisFrame {
    const time = this.samples / this.sampleRate, count = Math.max(1, this.frameSamples), dt = this.frameSamples / this.sampleRate;
    const peak = this.peak.map(amplitudeDb) as [number, number], rms = this.squares.map(e => amplitudeDb(Math.sqrt(e / count))) as [number, number], truePeak = this.truePeak.map(amplitudeDb) as [number, number];
    for (let c = 0; c < 2; c++) { if (peak[c]! >= this.hold[c]!) { this.hold[c] = peak[c]!; this.holdUntil[c] = time + this.settings.peakHold; } else if (time > this.holdUntil[c]!) this.hold[c] = Math.max(peak[c]!, this.hold[c]! - 12 * dt); }
    this.maxTp = Math.max(this.maxTp, ...truePeak);
    const correlation = this.squares[0]! * this.squares[1]! > 1e-20 ? Math.max(-1, Math.min(1, this.cross / Math.sqrt(this.squares[0]! * this.squares[1]!))) : 0;
    const total = this.squares[0]! + this.squares[1]!, width = total > 1e-20 ? Math.max(0, Math.min(100, 50 * (total - 2 * this.cross) / total)) : 0;
    const lowCorrelation = this.lowSquares[0]! * this.lowSquares[1]! > 1e-20 ? Math.max(-1, Math.min(1, this.lowCross / Math.sqrt(this.lowSquares[0]! * this.lowSquares[1]!))) : 0;
    const smoothing = this.settings.smoothing ** (dt * 30), spectrumLeft = this.spectra[0].calculate(this.rings[0]!, this.cursor, smoothing).slice(), spectrumRight = this.spectra[1].calculate(this.rings[1]!, this.cursor, smoothing).slice();
    const waveLeft = new Float32Array(1024), waveRight = new Float32Array(1024); for (let i = 0; i < 1024; i++) { waveLeft[i] = this.rings[0]![(this.cursor - 1024 + i + 8192) % 8192]!; waveRight[i] = this.rings[1]![(this.cursor - 1024 + i + 8192) % 8192]!; }
    const bands = new Float32Array(6), edges = [20, 60, 250, 500, 2000, 6000, Math.min(20000, this.sampleRate / 2)]; let sum = 0;
    for (let bin = 1; bin < spectrumLeft.length; bin++) { const f = bin * this.sampleRate / this.settings.fftSize; for (let band = 0; band < 6; band++) if (f >= edges[band]! && f < edges[band + 1]!) { const energy = 10 ** (spectrumLeft[bin]! / 10) + 10 ** (spectrumRight[bin]! / 10); bands[band]! += energy; sum += energy; break; } }
    if (sum > 1e-12) for (let i = 0; i < bands.length; i++) bands[i]! /= sum;
    const range = this.range.gated(-20);
    const frame: AnalysisFrame = { sampleRate: this.sampleRate, elapsed: time, sequence: ++this.sequence, peak, rms, truePeak, hold: [...this.hold] as [number, number], clip: [...this.clip], momentary: this.momentary, shortTerm: this.shortTerm, integrated: this.integrated.gated(-10).mean, lra: Number.isFinite(range.high) ? range.high - range.low : NaN, maxMomentary: this.maxM, maxShortTerm: this.maxS, maxTruePeak: this.maxTp, correlation, width, lowCorrelation, spectrumLeft, spectrumRight, waveLeft, waveRight, bands };
    this.peak.fill(0); this.truePeak.fill(0); this.squares.fill(0); this.lowSquares.fill(0); this.lowCross = 0; this.cross = 0; this.frameSamples = 0;
    return frame;
  }
}
