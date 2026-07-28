export const ANALYZER_VERSION = "web-timbre-stereo-4";

export interface AnalysisParameters { sensitivity: number; minBpm: number; maxBpm: number; frameSize: number; hopSize: number; }
export type DetectedInstrument = "kick" | "snare" | "hihat" | "piano" | "guitar" | "strings" | "percussion";
export interface AnalysisEvent { timeSeconds: number; timeSamples: number; type: DetectedInstrument; strength: number; confidence: number; frequencyBand: "low" | "mid" | "high" | "full"; }
export interface TempoPoint { timeSeconds: number; bpm: number; confidence: number; }
export interface EnergyFrame {
  timeSeconds: number; rms: number; low: number; mid: number; high: number; flux: number; spectralCentroid: number; spectralFlatness: number;
  bands48?: number[]; bands24?: number[];
  leftBands48?: number[]; rightBands48?: number[]; leftRms?: number; rightRms?: number; stereoWidth?: number;
}
export interface LowEnergySegment { startSeconds: number; endSeconds: number; averageRms: number; }
export interface AudioAnalysisResult {
  analyzerVersion: string; durationSeconds: number; sampleRate: number; globalBpm: number | null;
  bpmConfidence: number; localTempo: TempoPoint[]; beats: number[]; downbeats: number[];
  events: AnalysisEvent[]; energy: EnergyFrame[]; onsetEnvelope: number[]; spectralFlux: number[]; lowEnergySegments: LowEnergySegment[];
}
export interface AnalysisProgress { stage: "features" | "tempo" | "events" | "complete"; progress: number; }

export const defaultAnalysisParameters: AnalysisParameters = { sensitivity: 0.55, minBpm: 60, maxBpm: 200, frameSize: 1024, hopSize: 512 };
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function fft(real: Float64Array, imaginary: Float64Array): void {
  const size = real.length;
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1; for (; reversed & bit; bit >>= 1) reversed ^= bit; reversed ^= bit;
    if (index < reversed) { [real[index], real[reversed]] = [real[reversed] ?? 0, real[index] ?? 0]; [imaginary[index], imaginary[reversed]] = [imaginary[reversed] ?? 0, imaginary[index] ?? 0]; }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length; const cosine = Math.cos(angle); const sine = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let wr = 1; let wi = 0;
      for (let inner = 0; inner < length / 2; inner += 1) {
        const even = offset + inner; const odd = even + length / 2; const oddReal = real[odd] ?? 0; const oddImaginary = imaginary[odd] ?? 0;
        const tr = wr * oddReal - wi * oddImaginary; const ti = wr * oddImaginary + wi * oddReal; const evenReal = real[even] ?? 0; const evenImaginary = imaginary[even] ?? 0;
        real[odd] = evenReal - tr; imaginary[odd] = evenImaginary - ti; real[even] = evenReal + tr; imaginary[even] = evenImaginary + ti;
        const nextWr = wr * cosine - wi * sine; wi = wr * sine + wi * cosine; wr = nextWr;
      }
    }
  }
}

function normalize(values: number[]): number[] {
  const maximum = values.reduce((largest, value) => Math.max(largest, value), 1e-9); return values.map((value) => value / maximum);
}

function estimateTempo(envelope: number[], framesPerSecond: number, minBpm: number, maxBpm: number): { bpm: number | null; confidence: number } {
  if (envelope.length < framesPerSecond * 2) return { bpm: null, confidence: 0 };
  const minimumLag = Math.max(1, Math.floor(framesPerSecond * 60 / maxBpm)); const maximumLag = Math.min(envelope.length - 1, Math.ceil(framesPerSecond * 60 / minBpm));
  let bestLag = 0; let bestScore = 0; let total = 0;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let score = 0; for (let index = lag; index < envelope.length; index += 1) score += (envelope[index] ?? 0) * (envelope[index - lag] ?? 0);
    const bpm = 60 * framesPerSecond / lag; const plausibility = Math.exp(-Math.abs(Math.log2(bpm / 120)) * 0.12); score = score / Math.max(1, envelope.length - lag) * plausibility; total += score;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  return bestLag ? { bpm: 60 * framesPerSecond / bestLag, confidence: clamp01(bestScore / Math.max(1e-9, total / Math.max(1, maximumLag - minimumLag + 1)) / 4) } : { bpm: null, confidence: 0 };
}

function peakIndexes(envelope: number[], sensitivity: number, framesPerSecond: number): number[] {
  const peaks: number[] = []; const radius = Math.max(2, Math.round(framesPerSecond * 0.18)); const refractory = Math.max(1, Math.round(framesPerSecond * 0.055));
  for (let index = 1; index < envelope.length - 1; index += 1) {
    const from = Math.max(0, index - radius); const to = Math.min(envelope.length, index + radius + 1); let mean = 0; for (let cursor = from; cursor < to; cursor += 1) mean += envelope[cursor] ?? 0; mean /= to - from;
    const value = envelope[index] ?? 0; const threshold = mean * (1.12 + (1 - sensitivity) * 1.3) + 0.035;
    if (value >= threshold && value >= (envelope[index - 1] ?? 0) && value > (envelope[index + 1] ?? 0) && (peaks.length === 0 || index - (peaks.at(-1) ?? 0) >= refractory)) peaks.push(index);
  }
  return peaks;
}

function findLowEnergySegments(energy: EnergyFrame[], hopSeconds: number): LowEnergySegment[] {
  if (energy.length === 0) return []; const average = energy.reduce((sum, frame) => sum + frame.rms, 0) / energy.length; const threshold = average * 0.28; const minimumFrames = Math.max(2, Math.ceil(0.75 / hopSeconds)); const segments: LowEnergySegment[] = []; let start = -1;
  for (let index = 0; index <= energy.length; index += 1) { const low = index < energy.length && (energy[index]?.rms ?? 0) < threshold; if (low && start < 0) start = index; if (!low && start >= 0) { if (index - start >= minimumFrames) { const slice = energy.slice(start, index); segments.push({ startSeconds: energy[start]?.timeSeconds ?? 0, endSeconds: (energy[index - 1]?.timeSeconds ?? 0) + hopSeconds, averageRms: slice.reduce((sum, frame) => sum + frame.rms, 0) / slice.length }); } start = -1; } }
  return segments;
}

export function classifyInstrumentAtFrame(energy: readonly EnergyFrame[], frame: number): DetectedInstrument {
  const item = energy[frame]; if (!item) return "percussion";
  const total = item.low + item.mid + item.high + 1e-9; const lowShare = item.low / total; const midShare = item.mid / total; const highShare = item.high / total;
  const tail = energy.slice(frame + 2, frame + 14); const tailRms = tail.length ? tail.reduce((sum, value) => sum + value.rms, 0) / tail.length : 0;
  const sustain = tailRms / Math.max(item.rms, 1e-9);
  if (lowShare > .52) return "kick";
  if (highShare > .46 && item.spectralFlatness > .08) return "hihat";
  if (item.spectralFlatness > .2 && midShare > .27) return "snare";
  if (sustain > .62 && item.spectralFlatness < .12) return "strings";
  if (sustain > .3 && item.spectralFlatness < .14 && item.spectralCentroid > 950) return "guitar";
  if (sustain > .18 && item.spectralFlatness < .1 && midShare > .34) return "piano";
  if (highShare > .38) return "hihat";
  return midShare > .4 ? "snare" : "percussion";
}

export function analyzePcm(samples: Float32Array, sampleRate: number, parameters: AnalysisParameters = defaultAnalysisParameters, onProgress?: (progress: AnalysisProgress) => void): AudioAnalysisResult {
  const frameSize = parameters.frameSize; if ((frameSize & (frameSize - 1)) !== 0) throw new Error("frameSize deve essere una potenza di due");
  const hopSize = parameters.hopSize; const frameCount = Math.max(0, Math.floor((samples.length - frameSize) / hopSize) + 1); const framesPerSecond = sampleRate / hopSize; const energy: EnergyFrame[] = []; const flux: number[] = []; let previous = new Float64Array(frameSize / 2);
  const lowEnd = Math.min(frameSize / 2 - 1, Math.ceil(180 * frameSize / sampleRate)); const midEnd = Math.min(frameSize / 2 - 1, Math.ceil(4000 * frameSize / sampleRate));
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const real = new Float64Array(frameSize); const imaginary = new Float64Array(frameSize); let sumSquares = 0;
    for (let index = 0; index < frameSize; index += 1) { const sample = samples[frameIndex * hopSize + index] ?? 0; sumSquares += sample * sample; real[index] = sample * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (frameSize - 1))); }
    fft(real, imaginary); let low = 0; let mid = 0; let high = 0; let spectralFlux = 0; let magnitudeSum = 0; let weightedFrequency = 0; let logarithmicMagnitude = 0; const magnitudes = new Float64Array(frameSize / 2);
    for (let bin = 1; bin < frameSize / 2; bin += 1) { const magnitude = Math.hypot(real[bin] ?? 0, imaginary[bin] ?? 0); magnitudes[bin] = magnitude; magnitudeSum += magnitude; weightedFrequency += magnitude * bin * sampleRate / frameSize; logarithmicMagnitude += Math.log(magnitude + 1e-12); spectralFlux += Math.max(0, magnitude - (previous[bin] ?? 0)); if (bin <= lowEnd) low += magnitude * magnitude; else if (bin <= midEnd) mid += magnitude * magnitude; else high += magnitude * magnitude; }
    const binCount = frameSize / 2 - 1; const spectralCentroid = weightedFrequency / Math.max(magnitudeSum, 1e-9); const spectralFlatness = Math.exp(logarithmicMagnitude / binCount) / Math.max(magnitudeSum / binCount, 1e-9);
    const bandEnergy = Array.from({ length: 48 }, () => 0); const minimumFrequency = 35; const maximumFrequency = Math.min(18_000, sampleRate / 2);
    for (let bin = 1; bin < magnitudes.length; bin += 1) { const frequency = bin * sampleRate / frameSize; if (frequency < minimumFrequency || frequency > maximumFrequency) continue; const band = Math.min(47, Math.max(0, Math.floor(Math.log(frequency / minimumFrequency) / Math.log(maximumFrequency / minimumFrequency) * 48))); const magnitude = magnitudes[bin] ?? 0; bandEnergy[band] = (bandEnergy[band] ?? 0) + magnitude * magnitude; }
    const bands48 = bandEnergy.map((value) => Math.sqrt(value) / frameSize); const bandMaximum = Math.max(...bands48, 1e-9);
    flux.push(spectralFlux / frameSize); energy.push({ timeSeconds: frameIndex * hopSize / sampleRate, rms: Math.sqrt(sumSquares / frameSize), low: Math.sqrt(low) / frameSize, mid: Math.sqrt(mid) / frameSize, high: Math.sqrt(high) / frameSize, flux: spectralFlux / frameSize, spectralCentroid, spectralFlatness, bands48: bands48.map((value) => value / bandMaximum) }); previous = magnitudes;
    if (frameIndex % 128 === 0) onProgress?.({ stage: "features", progress: frameCount ? frameIndex / frameCount * .62 : .62 });
  }
  const onsetEnvelope = normalize(flux); onProgress?.({ stage: "tempo", progress: .68 }); const tempo = estimateTempo(onsetEnvelope, framesPerSecond, parameters.minBpm, parameters.maxBpm); const peakFrames = peakIndexes(onsetEnvelope, parameters.sensitivity, framesPerSecond);
  const events: AnalysisEvent[] = peakFrames.map((frame) => { const item = energy[frame] ?? { low: 0, mid: 0, high: 0, flux: 0, rms: 0, timeSeconds: frame * hopSize / sampleRate, spectralCentroid: 0, spectralFlatness: 1 }; const bands = [item.low, item.mid, item.high] as const; const maximum = Math.max(...bands, 1e-9); const bandIndex = bands.indexOf(maximum); const frequencyBand = (["low", "mid", "high"] as const)[bandIndex] ?? "full"; const type = classifyInstrumentAtFrame(energy, frame); const timeSamples = Math.min(samples.length - 1, frame * hopSize); return { timeSeconds: timeSamples / sampleRate, timeSamples, type, frequencyBand, strength: clamp01(onsetEnvelope[frame] ?? 0), confidence: clamp01(maximum / (bands.reduce((sum, value) => sum + value, 0) + 1e-9) * .55 + (onsetEnvelope[frame] ?? 0) * .25 + (1 - item.spectralFlatness) * .2) }; });
  onProgress?.({ stage: "events", progress: .82 }); const beats: number[] = []; const downbeats: number[] = [];
  if (tempo.bpm) { const period = 60 / tempo.bpm; let phase = events[0]?.timeSeconds ?? 0; if (events.length > 0) { let best = -1; for (const event of events.slice(0, 24)) { let score = 0; for (const candidate of events) { const distance = Math.abs((candidate.timeSeconds - event.timeSeconds) / period - Math.round((candidate.timeSeconds - event.timeSeconds) / period)); score += candidate.strength * Math.exp(-distance * 14); } if (score > best) { best = score; phase = event.timeSeconds; } } } while (phase - period >= 0) phase -= period; for (let time = phase; time <= samples.length / sampleRate + 1e-9; time += period) beats.push(Math.max(0, time)); let strongestPhase = 0; let strongest = -1; for (let phaseIndex = 0; phaseIndex < 4; phaseIndex += 1) { let score = 0; for (let index = phaseIndex; index < beats.length; index += 4) { const beat = beats[index] ?? 0; score += events.reduce((best, event) => Math.abs(event.timeSeconds - beat) < .08 ? Math.max(best, event.strength) : best, 0); } if (score > strongest) { strongest = score; strongestPhase = phaseIndex; } } for (let index = strongestPhase; index < beats.length; index += 4) downbeats.push(beats[index] ?? 0); }
  const localTempo: TempoPoint[] = []; const windowFrames = Math.max(8, Math.round(framesPerSecond * 8)); for (let offset = 0; offset < onsetEnvelope.length; offset += windowFrames) { const local = estimateTempo(onsetEnvelope.slice(offset, offset + windowFrames), framesPerSecond, parameters.minBpm, parameters.maxBpm); if (local.bpm) localTempo.push({ timeSeconds: offset / framesPerSecond, bpm: local.bpm, confidence: local.confidence }); }
  onProgress?.({ stage: "complete", progress: 1 }); return { analyzerVersion: ANALYZER_VERSION, durationSeconds: samples.length / sampleRate, sampleRate, globalBpm: tempo.bpm, bpmConfidence: tempo.confidence, localTempo, beats, downbeats, events, energy, onsetEnvelope, spectralFlux: flux, lowEnergySegments: findLowEnergySegments(energy, hopSize / sampleRate) };
}

export function analyzePcmStereo(left: Float32Array, right: Float32Array | undefined, sampleRate: number, parameters: AnalysisParameters = defaultAnalysisParameters, onProgress?: (progress: AnalysisProgress) => void): AudioAnalysisResult {
  if (!right || right.length === 0) {
    const mono = analyzePcm(left, sampleRate, parameters, onProgress);
    mono.energy = mono.energy.map((frame) => ({ ...frame, leftBands48: [...frame.bands48 ?? []], rightBands48: [...frame.bands48 ?? []], leftRms: frame.rms, rightRms: frame.rms, stereoWidth: 0 }));
    return mono;
  }
  const length = Math.min(left.length, right.length); const monoSamples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) monoSamples[index] = ((left[index] ?? 0) + (right[index] ?? 0)) * .5;
  const result = analyzePcm(monoSamples, sampleRate, parameters, (progress) => onProgress?.({ stage: "features", progress: progress.progress * .58 }));
  const leftAnalysis = analyzePcm(left.subarray(0, length), sampleRate, parameters, (progress) => { if (progress.stage === "features") onProgress?.({ stage: "features", progress: .58 + progress.progress * .19 }); });
  const rightAnalysis = analyzePcm(right.subarray(0, length), sampleRate, parameters, (progress) => { if (progress.stage === "features") onProgress?.({ stage: "features", progress: .77 + progress.progress * .19 }); });
  result.energy = result.energy.map((frame, index) => {
    const leftFrame = leftAnalysis.energy[index] ?? frame; const rightFrame = rightAnalysis.energy[index] ?? frame;
    const sum = Math.max(1e-6, leftFrame.rms + rightFrame.rms); const balanceDifference = Math.abs(leftFrame.rms - rightFrame.rms) / sum;
    const leftBands = leftFrame.bands48 ?? frame.bands48 ?? []; const rightBands = rightFrame.bands48 ?? frame.bands48 ?? [];
    const spectralDifference = leftBands.reduce((total, value, band) => total + Math.abs(value - (rightBands[band] ?? value)), 0) / Math.max(1, leftBands.length);
    return { ...frame, leftBands48: [...leftBands], rightBands48: [...rightBands], leftRms: leftFrame.rms, rightRms: rightFrame.rms, stereoWidth: clamp01(balanceDifference * .45 + spectralDifference * .8) };
  });
  onProgress?.({ stage: "complete", progress: 1 });
  return result;
}

export function analysisCacheKey(audioHash: string, parameters: AnalysisParameters): string {
  return `${audioHash}:${ANALYZER_VERSION}:${parameters.sensitivity}:${parameters.minBpm}:${parameters.maxBpm}:${parameters.frameSize}:${parameters.hopSize}`;
}
