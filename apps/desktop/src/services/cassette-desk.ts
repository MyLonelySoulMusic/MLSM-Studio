import type { AudioAnalysisResult } from "@rbs/audio-analysis";

export const CASSETTE_DESK_DEFAULT_INTRO_SECONDS = 4.8;
export type CassetteDeskPhase = "case" | "opening" | "inserting" | "closing" | "pressing" | "playing";
export interface CassetteDeskTimeline { phase: CassetteDeskPhase; phaseProgress: number; songTimeSeconds: number; musicStarted: boolean; }
export interface CassetteDeskPitchFrame { timeSeconds: number; midi: number; confidence: number; }
export interface CassetteDeskMusicalAnalysis { bpm:number;keyRoot:number;keyMode:"major"|"minor";keyConfidence:number; }
export interface CassetteDeskAnalysisOptions { musicalAnalysis?:CassetteDeskMusicalAnalysis|null;tempoDetectionMode?:"auto"|"manual";manualBpm?:number;halfTime?:boolean;keyDetectionMode?:"auto"|"manual";manualKeyRoot?:number;manualKeyMode?:"major"|"minor"; }
export interface CassetteDeskSpectrumFrame { timeSeconds:number;bands12:number[]; }
export interface CassetteDeskAnalysis { bpm: number | null; keyLabel: string; keyRoot: number; keyMode: "major" | "minor"; waveform: number[]; spectrumFrames:CassetteDeskSpectrumFrame[];vocalNotes: CassetteDeskPitchFrame[]; }

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export function cassetteDeskTimeline(timeSeconds: number, introSeconds = CASSETTE_DESK_DEFAULT_INTRO_SECONDS): CassetteDeskTimeline {
  const time = Math.max(0, timeSeconds); const scale = introSeconds / CASSETTE_DESK_DEFAULT_INTRO_SECONDS;
  const steps: Array<[CassetteDeskPhase, number, number]> = [["case", 0, .55], ["opening", .55, 1.55], ["inserting", 1.55, 3.25], ["closing", 3.25, 4.05], ["pressing", 4.05, 4.8]];
  for (const [phase, from, to] of steps) if (time < to * scale) return { phase, phaseProgress: clamp01((time - from * scale) / ((to - from) * scale)), songTimeSeconds: 0, musicStarted: false };
  return { phase: "playing", phaseProgress: 1, songTimeSeconds: Math.max(0, time - introSeconds), musicStarted: true };
}

const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_SCALE = [0,2,4,5,7,9,11] as const;
const MINOR_SCALE = [0,2,3,5,7,8,10] as const;
function correlation(chroma: readonly number[], profile: readonly number[], root: number): number { let score = 0; for (let note = 0; note < 12; note += 1) score += (chroma[note] ?? 0) * (profile[(note - root + 12) % 12] ?? 0); return score; }
export function estimateCassetteDeskKey(analysis: AudioAnalysisResult | null): Pick<CassetteDeskAnalysis, "keyLabel" | "keyRoot" | "keyMode"> {
  const chroma = Array(12).fill(0) as number[];
  analysis?.energy.forEach((frame) => (frame.bands48 ?? []).forEach((amount, band) => { const frequency = 35 * Math.pow(18_000 / 35, (band + .5) / 48); const midi = Math.round(69 + 12 * Math.log2(frequency / 440)); const note=(midi % 12 + 12) % 12; chroma[note]=(chroma[note]??0)+amount*Math.max(.05,1-frame.spectralFlatness); }));
  let best = -Infinity; let keyRoot = 0; let keyMode: "major" | "minor" = "minor";
  for (let root = 0; root < 12; root += 1) for (const [mode, profile] of [["major", MAJOR], ["minor", MINOR]] as const) { const score = correlation(chroma, profile, root); if (score > best) { best = score; keyRoot = root; keyMode = mode; } }
  return { keyRoot, keyMode, keyLabel: `${NOTE_NAMES[keyRoot]} ${keyMode}` };
}

export function stabilizeCassetteVocalMidi(sourceMidi:number,confidence:number,keyRoot:number,keyMode:"major"|"minor",toleranceCents:number){const rounded=Math.round(sourceMidi);const pitchClass=(rounded%12+12)%12;const scale=keyMode==="major"?MAJOR_SCALE:MINOR_SCALE;const allowed=new Set(scale.map(step=>(keyRoot+step)%12));if(allowed.has(pitchClass)||confidence>=.82)return rounded;let nearest=rounded,nearestDistance=Infinity;for(let candidate=rounded-6;candidate<=rounded+6;candidate+=1){if(!allowed.has((candidate%12+12)%12))continue;const distance=Math.abs(candidate-sourceMidi);if(distance<nearestDistance){nearest=candidate;nearestDistance=distance;}}const confidenceAllowance=Math.max(0,.82-clamp01(confidence))*100;const effectiveTolerance=Math.max(0,Math.min(100,toleranceCents))+confidenceAllowance;return nearestDistance*100<=effectiveTolerance?nearest:rounded;}

/**
 * Consuma esclusivamente note pYIN ricavate dallo stem vocale separato da
 * Demucs. Lo spettro del mix non viene mai usato come surrogato della voce.
 * Solo le rilevazioni meno sicure possono essere stabilizzate nella tonalità.
 */
export function buildCassetteDeskAnalysis(analysis: AudioAnalysisResult | null, waveform: readonly number[], separatedVocalNotes: readonly CassetteDeskPitchFrame[] = [], toleranceCents = 42, options:CassetteDeskAnalysisOptions={}): CassetteDeskAnalysis {
  const automaticKey=options.musicalAnalysis?{keyRoot:options.musicalAnalysis.keyRoot,keyMode:options.musicalAnalysis.keyMode,keyLabel:""}:estimateCassetteDeskKey(analysis);
  const keyRoot=options.keyDetectionMode==="manual"?Math.max(0,Math.min(11,Math.round(options.manualKeyRoot??0))):automaticKey.keyRoot;
  const keyMode=options.keyDetectionMode==="manual"?(options.manualKeyMode??"major"):automaticKey.keyMode;
  const key={keyRoot,keyMode,keyLabel:`${NOTE_NAMES[keyRoot]} ${keyMode}`};
  const vocalNotes = separatedVocalNotes.flatMap((source) => { if (!Number.isFinite(source.timeSeconds) || !Number.isFinite(source.midi) || source.confidence < .45) return []; const midi=stabilizeCassetteVocalMidi(source.midi,source.confidence,key.keyRoot,key.keyMode,toleranceCents);return [{timeSeconds:Math.max(0,source.timeSeconds),midi:Math.max(36,Math.min(84,midi)),confidence:clamp01(source.confidence)}]; });
  const spectrumFrames=(analysis?.energy??[]).map(frame=>({timeSeconds:frame.timeSeconds,bands12:Array.from({length:12},(_,band)=>{const values=(frame.bands48??[]).slice(band*4,band*4+4);return clamp01(values.reduce((sum,value)=>sum+Math.max(0,value),0)/Math.max(1,values.length));})}));
  const detectedBpm=options.musicalAnalysis?.bpm??analysis?.globalBpm??null;const baseBpm=options.tempoDetectionMode==="manual"?Math.max(20,Math.min(300,options.manualBpm??120)):detectedBpm;const bpm=baseBpm===null?null:baseBpm*(options.halfTime?.5:1);
  return { bpm, ...key, waveform: [...waveform], spectrumFrames,vocalNotes };
}

export function cassetteDeskActiveNote(analysis: CassetteDeskAnalysis | null, songTimeSeconds: number): CassetteDeskPitchFrame | null {
  if (!analysis?.vocalNotes.length) return null; let nearest: CassetteDeskPitchFrame | null = null; for (const note of analysis.vocalNotes) { if (note.timeSeconds > songTimeSeconds + .12) break; if (Math.abs(note.timeSeconds - songTimeSeconds) <= .22) nearest = note; } return nearest;
}

export function cassetteDeskSpectrumBars(analysis:CassetteDeskAnalysis|null,songTimeSeconds:number):number[]{if(!analysis?.spectrumFrames.length)return Array(12).fill(0);let nearest=analysis.spectrumFrames[0]!;for(const frame of analysis.spectrumFrames){if(frame.timeSeconds>songTimeSeconds)break;nearest=frame;}return Array.from({length:12},(_,index)=>clamp01(nearest.bands12[index]??0));}

export const cassetteDeskMechanicalEvents = (introSeconds = CASSETTE_DESK_DEFAULT_INTRO_SECONDS) => {
  const scale = introSeconds / CASSETTE_DESK_DEFAULT_INTRO_SECONDS; return [{ timeSeconds: 1.7 * scale, kind: "slide" as const }, { timeSeconds: 3.82 * scale, kind: "door" as const }, { timeSeconds: 4.38 * scale, kind: "play" as const }];
};
