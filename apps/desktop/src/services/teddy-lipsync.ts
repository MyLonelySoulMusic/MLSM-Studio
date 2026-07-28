import type { EnergyFrame } from "@rbs/audio-analysis";

export interface TeddyLipSyncPose {
  jawOpen: number;
  lipRound: number;
  lipWide: number;
  lipPress: number;
  tongue: number;
  voicing: number;
}

export type TeddyViseme = "A" | "EI" | "OU" | "MBP" | "LT" | "S";
export interface TeddyPhonemeCue {
  id: string;
  startSeconds: number;
  endSeconds: number;
  viseme: TeddyViseme;
  confidence: number;
  manual: boolean;
}

interface EnergyStatistics {
  noiseFloor: number;
  vocalLevel: number;
  fluxLevel: number;
}

const statisticsCache = new WeakMap<object, EnergyStatistics>();
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (value: number): number => { const clamped = clamp01(value); return clamped * clamped * (3 - 2 * clamped); };
const emptyPose = (): TeddyLipSyncPose => ({ jawOpen: 0, lipRound: 0, lipWide: 0, lipPress: 0, tongue: 0, voicing: 0 });

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  values.sort((left, right) => left - right);
  return values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * ratio)))] ?? 0;
}

function energyStatistics(energy: readonly EnergyFrame[]): EnergyStatistics {
  const cached = statisticsCache.get(energy);
  if (cached) return cached;
  const activeRms = energy.map((frame) => Math.max(0, frame.rms));
  const activeFlux = energy.map((frame) => Math.max(0, frame.flux));
  const vocalLevel = Math.max(1e-6, percentile([...activeRms], .88));
  const result = {
    // Una stem vocale può non contenere silenzi nel tratto analizzato: in quel
    // caso il dodicesimo percentile non deve diventare erroneamente la soglia.
    noiseFloor: Math.min(percentile([...activeRms], .12), vocalLevel * .18),
    vocalLevel,
    fluxLevel: Math.max(1e-6, percentile([...activeFlux], .84))
  };
  statisticsCache.set(energy, result);
  return result;
}

function closestFrameIndex(energy: readonly EnergyFrame[], timeSeconds: number): number {
  let low = 0; let high = energy.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if ((energy[middle]?.timeSeconds ?? 0) < timeSeconds) low = middle + 1; else high = middle; }
  if (low > 0 && Math.abs((energy[low - 1]?.timeSeconds ?? 0) - timeSeconds) < Math.abs((energy[low]?.timeSeconds ?? 0) - timeSeconds)) return low - 1;
  return low;
}

function band(frame: EnergyFrame, index: number): number {
  if (frame.bands48) return frame.bands48[index] ?? 0;
  if (frame.bands24) return frame.bands24[Math.floor(index / 2)] ?? 0;
  return index < 18 ? frame.low : index < 36 ? frame.mid : frame.high;
}

function bandRange(frame: EnergyFrame, from: number, to: number): number {
  let total = 0;
  for (let index = from; index <= to; index += 1) total += band(frame, index);
  return total / Math.max(1, to - from + 1);
}

/**
 * Estrae visemi continui dalle zone formantiche della voce.
 *
 * Non cerca di muovere una foto: restituisce pesi indipendenti per mandibola,
 * arrotondamento, sorriso, chiusura bilabiale e lingua, applicati poi ai mesh
 * del muso. La finestra asimmetrica anticipa di pochi millisecondi consonanti
 * e attacchi, come avviene nel labiale umano.
 */
export function resolveTeddyLipSync(
  energy: readonly EnergyFrame[] | undefined,
  timeSeconds: number,
  sensitivity = 1,
  intensity = 1
): TeddyLipSyncPose {
  if (!energy?.length) return emptyPose();
  const firstTime = energy[0]?.timeSeconds ?? 0; const lastTime = energy.at(-1)?.timeSeconds ?? firstTime;
  const frameStep = energy.length > 1 ? Math.max(.008, (lastTime - firstTime) / (energy.length - 1)) : .02;
  if (timeSeconds < firstTime - frameStep * 2 || timeSeconds >= lastTime + frameStep * 1.5) return emptyPose();
  const statistics = energyStatistics(energy);
  const center = closestFrameIndex(energy, Math.max(0, timeSeconds));
  let weightTotal = 0; let rms = 0; let flux = 0; let flatness = 0; let fundamental = 0; let firstFormant = 0; let secondFormant = 0; let sibilance = 0;

  for (let offset = -9; offset <= 4; offset += 1) {
    const frame = energy[center + offset];
    if (!frame) continue;
    const delta = frame.timeSeconds - timeSeconds;
    const falloff = delta <= 0 ? .075 : .038;
    const weight = Math.exp(-Math.abs(delta) / falloff);
    weightTotal += weight;
    rms += frame.rms * weight;
    flux += frame.flux * weight;
    flatness += frame.spectralFlatness * weight;
    fundamental += bandRange(frame, 12, 19) * weight;
    firstFormant += bandRange(frame, 20, 27) * weight;
    secondFormant += bandRange(frame, 28, 34) * weight;
    sibilance += bandRange(frame, 35, 41) * weight;
  }
  if (weightTotal <= 0) return emptyPose();
  rms /= weightTotal; flux /= weightTotal; flatness /= weightTotal; fundamental /= weightTotal; firstFormant /= weightTotal; secondFormant /= weightTotal; sibilance /= weightTotal;

  const dynamicRange = Math.max(1e-6, statistics.vocalLevel - statistics.noiseFloor);
  const loudness = clamp01((rms - statistics.noiseFloor * 1.05) / dynamicRange);
  const midFocus = clamp01((firstFormant + secondFormant) / Math.max(1e-6, fundamental + firstFormant + secondFormant + sibilance) * 2.15);
  const tonalFocus = clamp01(1.18 - flatness * 3.2);
  const gate = smoothstep(loudness * Math.max(.2, sensitivity) * (.72 + midFocus * .34) - .035);
  const voicing = clamp01(gate * (.72 + tonalFocus * .28));
  if (voicing < .008) return emptyPose();

  const formantTotal = Math.max(1e-6, fundamental + firstFormant + secondFormant);
  const openVowel = clamp01(firstFormant / formantTotal * 2.7);
  const frontVowel = clamp01(secondFormant / Math.max(1e-6, firstFormant + secondFormant) * 1.65 - .28);
  const backVowel = clamp01((fundamental + firstFormant * .6) / Math.max(1e-6, secondFormant) * .46 - .08);
  const consonant = clamp01(flux / statistics.fluxLevel * .72 + sibilance / Math.max(1e-6, firstFormant + secondFormant) * .22);
  const expressive = Math.max(.1, intensity);

  const jawOpen = clamp01(voicing * (.12 + openVowel * .72 + loudness * .18) * expressive);
  const lipWide = clamp01(voicing * frontVowel * (1 - backVowel * .48) * expressive);
  const lipRound = clamp01(voicing * backVowel * (1 - frontVowel * .34) * expressive);
  const lipPress = clamp01(voicing * consonant * (1 - jawOpen) * 1.25 * expressive);
  const tongue = clamp01(voicing * (frontVowel * .52 + consonant * .48) * (1 - lipPress * .7) * expressive);
  const endRelease = timeSeconds <= lastTime - frameStep ? 1 : smoothstep((lastTime + frameStep * 1.5 - timeSeconds) / (frameStep * 2.5));
  return { jawOpen: jawOpen * endRelease, lipRound: lipRound * endRelease, lipWide: lipWide * endRelease, lipPress: lipPress * endRelease, tongue: tongue * endRelease, voicing: voicing * endRelease };
}

function classifyViseme(pose: TeddyLipSyncPose): TeddyViseme | null {
  if (pose.voicing < .055) return null;
  if (pose.lipPress > .36 && pose.jawOpen < .42) return "MBP";
  if (pose.lipRound > pose.lipWide * 1.08 && pose.lipRound > .2) return "OU";
  if (pose.lipWide > pose.lipRound && pose.lipWide > .22) return "EI";
  if (pose.tongue > .48 && pose.jawOpen < .58) return "LT";
  if (pose.jawOpen > .28) return "A";
  return "S";
}

export function extractTeddyPhonemeCues(
  energy: readonly EnergyFrame[] | undefined,
  sensitivity = 1,
  intensity = 1
): TeddyPhonemeCue[] {
  if (!energy?.length) return [];
  const raw: TeddyPhonemeCue[] = [];
  const defaultStep = energy.length > 1 ? Math.max(.008, (energy.at(-1)!.timeSeconds - energy[0]!.timeSeconds) / (energy.length - 1)) : .02;
  for (const [index, frame] of energy.entries()) {
    const pose = resolveTeddyLipSync(energy, frame.timeSeconds, sensitivity, intensity);
    const viseme = classifyViseme(pose);
    if (!viseme) continue;
    const nextTime = energy[index + 1]?.timeSeconds ?? frame.timeSeconds + defaultStep;
    const previous = raw.at(-1);
    if (previous?.viseme === viseme && frame.timeSeconds - previous.endSeconds <= defaultStep * 1.6) {
      previous.endSeconds = nextTime;
      previous.confidence = Math.max(previous.confidence, pose.voicing);
    } else raw.push({ id: "", startSeconds: frame.timeSeconds, endSeconds: nextTime, viseme, confidence: pose.voicing, manual: false });
  }
  const minimumDuration = Math.max(.035, defaultStep * 2.2);
  const consolidated: TeddyPhonemeCue[] = [];
  for (const cue of raw) {
    const duration = cue.endSeconds - cue.startSeconds; const previous = consolidated.at(-1);
    if (duration < minimumDuration && previous && cue.startSeconds - previous.endSeconds <= defaultStep * 1.6) previous.endSeconds = cue.endSeconds;
    else if (duration >= minimumDuration) consolidated.push(cue);
  }
  return consolidated.map((cue, index) => ({ ...cue, id: `phoneme-${Math.round(cue.startSeconds * 1_000)}-${index}` }));
}

export function applyTeddyPhonemeTimeline(
  pose: TeddyLipSyncPose,
  timeSeconds: number,
  cues: readonly TeddyPhonemeCue[],
  generated: boolean,
  timelineEndSeconds?: number
): TeddyLipSyncPose {
  const globalRelease = timelineEndSeconds && timelineEndSeconds > 0
    ? smoothstep((timelineEndSeconds - timeSeconds) / .12)
    : 1;
  if (!generated) return globalRelease >= 1 ? pose : {
    jawOpen: pose.jawOpen * globalRelease, lipRound: pose.lipRound * globalRelease, lipWide: pose.lipWide * globalRelease,
    lipPress: pose.lipPress * globalRelease, tongue: pose.tongue * globalRelease, voicing: pose.voicing * globalRelease
  };
  const cue = cues.find((item) => timeSeconds >= item.startSeconds && timeSeconds < item.endSeconds);
  if (!cue) return emptyPose();
  const edge = Math.min(.08, (cue.endSeconds - cue.startSeconds) * .34);
  const fadeIn = edge > 0 ? smoothstep((timeSeconds - cue.startSeconds) / edge) : 1;
  const fadeOut = edge > 0 ? smoothstep((cue.endSeconds - timeSeconds) / edge) : 1;
  const weight = Math.min(fadeIn, fadeOut) * globalRelease;
  const shaped: TeddyLipSyncPose = { ...pose };
  if (cue.viseme === "A") { shaped.jawOpen = Math.max(shaped.jawOpen, .52 * shaped.voicing); shaped.lipRound *= .45; shaped.lipWide *= .72; }
  else if (cue.viseme === "EI") { shaped.lipWide = Math.max(shaped.lipWide, .58 * shaped.voicing); shaped.lipRound *= .28; shaped.jawOpen = Math.min(shaped.jawOpen, .48); }
  else if (cue.viseme === "OU") { shaped.lipRound = Math.max(shaped.lipRound, .62 * shaped.voicing); shaped.lipWide *= .22; shaped.jawOpen = Math.max(.16 * shaped.voicing, Math.min(shaped.jawOpen, .52)); }
  else if (cue.viseme === "MBP") { shaped.lipPress = Math.max(shaped.lipPress, .82 * shaped.voicing); shaped.jawOpen = Math.min(shaped.jawOpen, .06); shaped.lipRound *= .25; }
  else if (cue.viseme === "LT") { shaped.tongue = Math.max(shaped.tongue, .72 * shaped.voicing); shaped.jawOpen = Math.max(.2 * shaped.voicing, Math.min(shaped.jawOpen, .46)); }
  else { shaped.lipWide = Math.max(shaped.lipWide, .28 * shaped.voicing); shaped.jawOpen = Math.max(.12 * shaped.voicing, Math.min(shaped.jawOpen, .34)); }
  return {
    jawOpen: shaped.jawOpen * weight,
    lipRound: shaped.lipRound * weight,
    lipWide: shaped.lipWide * weight,
    lipPress: shaped.lipPress * weight,
    tongue: shaped.tongue * weight,
    voicing: shaped.voicing * weight
  };
}
